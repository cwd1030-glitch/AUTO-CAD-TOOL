"""
Lightweight multi-algorithm quality predictor for DIMA.

The production path can later replace the in-memory baseline data with real
Moldflow, molding trial, or demand records. Until then this module gives the
solver a deterministic, testable ensemble layer without requiring scikit-learn.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np


FEATURE_NAMES = (
    "volume_mm3",
    "surface_area_mm2",
    "mean_thickness_mm",
    "triangle_count",
    "gate_count",
    "melt_temp_c",
    "mold_temp_c",
    "flow_rate_cm3_s",
    "pressure_limit_mpa",
    "undercut_ratio",
    "runner_hot",
)

TARGET_NAMES = (
    "fill_time_s",
    "cooling_time_s",
    "pressure_drop_mpa",
    "shrinkage_pct",
    "warp_mm",
    "risk_score",
)


def _safe_float(value, default: float = 0.0) -> float:
    try:
        out = float(value)
        return out if np.isfinite(out) else default
    except Exception:
        return default


def build_feature_vector(features: Mapping[str, float]) -> np.ndarray:
    """Return a stable numeric feature vector in FEATURE_NAMES order."""
    values = [_safe_float(features.get(name, 0.0)) for name in FEATURE_NAMES]
    return np.asarray(values, dtype=float)


def build_baseline_training_set() -> Tuple[np.ndarray, np.ndarray]:
    """
    Deterministic engineering baseline used when real comparison data is absent.

    The rows are not fabricated real-world validation data. They are synthetic
    anchors that keep the ensemble stable until the user supplies Moldflow or
    molding-trial observations.
    """
    rows: List[List[float]] = []
    targets: List[List[float]] = []
    volumes = (8000.0, 28000.0, 75000.0, 160000.0)
    thicknesses = (1.2, 2.2, 3.6)
    gates = (1.0, 2.0, 4.0)
    for volume in volumes:
        for thickness in thicknesses:
            for gate_count in gates:
                surface = (volume ** (2.0 / 3.0)) * 6.0
                tri_count = max(1200.0, surface * 2.3)
                melt = 230.0 + (thickness - 2.0) * 10.0
                mold = 50.0 + thickness * 3.0
                flow = 45.0 + gate_count * 12.0
                pressure_limit = 100.0
                undercut = 0.04 + (thickness / 100.0)
                runner_hot = 1.0 if gate_count >= 4 else 0.0

                fill = (volume / max(flow * gate_count * 900.0, 1.0)) * (1.0 + thickness * 0.18)
                cooling = 1.6 * (thickness ** 2) * (1.0 + volume / 220000.0)
                pressure = (volume / 1800.0) / gate_count * (1.0 + undercut * 2.5)
                pressure *= 0.9 if runner_hot else 1.0
                shrink = 0.35 + thickness * 0.08 + max(melt - 230.0, 0.0) * 0.003
                warp = 0.05 + undercut * 1.8 + thickness * 0.035 + (mold - 50.0) * 0.002
                risk = np.clip(
                    38.0 + pressure / pressure_limit * 22.0 + shrink * 12.0 + warp * 30.0,
                    0.0,
                    100.0,
                )

                rows.append([
                    volume,
                    surface,
                    thickness,
                    tri_count,
                    gate_count,
                    melt,
                    mold,
                    flow,
                    pressure_limit,
                    undercut,
                    runner_hot,
                ])
                targets.append([fill, cooling, pressure, shrink, warp, risk])
    return np.asarray(rows, dtype=float), np.asarray(targets, dtype=float)


@dataclass
class Standardizer:
    mean: np.ndarray
    scale: np.ndarray

    @classmethod
    def fit(cls, x: np.ndarray) -> "Standardizer":
        mean = np.mean(x, axis=0)
        scale = np.std(x, axis=0)
        scale[scale < 1e-9] = 1.0
        return cls(mean=mean, scale=scale)

    def transform(self, x: np.ndarray) -> np.ndarray:
        return (x - self.mean) / self.scale


class LinearRegressor:
    def __init__(self, ridge: float = 1e-4):
        self.ridge = ridge
        self.coef_: Optional[np.ndarray] = None

    def fit(self, x: np.ndarray, y: np.ndarray) -> "LinearRegressor":
        xb = np.c_[np.ones((x.shape[0], 1)), x]
        reg = np.eye(xb.shape[1]) * self.ridge
        reg[0, 0] = 0.0
        self.coef_ = np.linalg.solve(xb.T @ xb + reg, xb.T @ y)
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        if self.coef_ is None:
            raise RuntimeError("LinearRegressor is not fitted")
        xb = np.c_[np.ones((x.shape[0], 1)), x]
        return xb @ self.coef_


class DecisionTreeRegressor:
    def __init__(self, max_depth: int = 4, min_samples_leaf: int = 3):
        self.max_depth = max_depth
        self.min_samples_leaf = min_samples_leaf
        self.root = None

    def fit(self, x: np.ndarray, y: np.ndarray) -> "DecisionTreeRegressor":
        self.root = self._build(x, y, depth=0)
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        if self.root is None:
            raise RuntimeError("DecisionTreeRegressor is not fitted")
        return np.asarray([self._predict_one(row, self.root) for row in x], dtype=float)

    def _build(self, x: np.ndarray, y: np.ndarray, depth: int):
        if depth >= self.max_depth or x.shape[0] <= self.min_samples_leaf * 2:
            return {"value": np.mean(y, axis=0)}

        base_error = self._sse(y)
        best = None
        for feature_idx in range(x.shape[1]):
            values = np.unique(x[:, feature_idx])
            if values.size <= 1:
                continue
            thresholds = (values[:-1] + values[1:]) / 2.0
            for threshold in thresholds:
                left = x[:, feature_idx] <= threshold
                right = ~left
                if left.sum() < self.min_samples_leaf or right.sum() < self.min_samples_leaf:
                    continue
                error = self._sse(y[left]) + self._sse(y[right])
                if best is None or error < best[0]:
                    best = (error, feature_idx, threshold, left, right)

        if best is None or best[0] >= base_error:
            return {"value": np.mean(y, axis=0)}

        _, feature_idx, threshold, left, right = best
        return {
            "feature": feature_idx,
            "threshold": float(threshold),
            "left": self._build(x[left], y[left], depth + 1),
            "right": self._build(x[right], y[right], depth + 1),
        }

    @staticmethod
    def _sse(y: np.ndarray) -> float:
        centered = y - np.mean(y, axis=0)
        return float(np.sum(centered * centered))

    def _predict_one(self, row: np.ndarray, node) -> np.ndarray:
        while "value" not in node:
            node = node["left"] if row[node["feature"]] <= node["threshold"] else node["right"]
        return node["value"]


class RandomForestRegressor:
    def __init__(self, n_estimators: int = 9, max_depth: int = 4, random_state: int = 17):
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.random_state = random_state
        self.trees: List[Tuple[np.ndarray, DecisionTreeRegressor]] = []

    def fit(self, x: np.ndarray, y: np.ndarray) -> "RandomForestRegressor":
        rng = np.random.default_rng(self.random_state)
        self.trees = []
        feature_count = max(3, int(np.sqrt(x.shape[1])) + 1)
        for _ in range(self.n_estimators):
            rows = rng.integers(0, x.shape[0], size=x.shape[0])
            cols = np.sort(rng.choice(x.shape[1], size=feature_count, replace=False))
            tree = DecisionTreeRegressor(max_depth=self.max_depth, min_samples_leaf=2)
            tree.fit(x[rows][:, cols], y[rows])
            self.trees.append((cols, tree))
        return self

    def predict(self, x: np.ndarray) -> np.ndarray:
        if not self.trees:
            raise RuntimeError("RandomForestRegressor is not fitted")
        preds = [tree.predict(x[:, cols]) for cols, tree in self.trees]
        return np.mean(np.stack(preds, axis=0), axis=0)


def _clip_predictions(prediction: np.ndarray) -> np.ndarray:
    clipped = np.asarray(prediction, dtype=float).copy()
    clipped[..., 0:5] = np.maximum(clipped[..., 0:5], 0.0)
    clipped[..., 5] = np.clip(clipped[..., 5], 0.0, 100.0)
    return clipped


def _to_named_metrics(values: Sequence[float]) -> Dict[str, float]:
    return {name: round(float(value), 4) for name, value in zip(TARGET_NAMES, values)}


def predict_quality(
    features: Mapping[str, float],
    training_rows: Optional[Iterable[Mapping[str, float]]] = None,
) -> Dict[str, object]:
    """
    Predict quality metrics with linear regression, decision tree, and forest.

    training_rows may contain feature fields plus TARGET_NAMES. Rows missing any
    target are ignored. If fewer than six valid rows remain, the deterministic
    baseline is used.
    """
    x_train, y_train = _coerce_training_rows(training_rows)
    scaler = Standardizer.fit(x_train)
    xs = scaler.transform(x_train)
    x_one = scaler.transform(build_feature_vector(features).reshape(1, -1))

    models = {
        "linear_regression": LinearRegressor().fit(xs, y_train),
        "decision_tree": DecisionTreeRegressor().fit(xs, y_train),
        "random_forest": RandomForestRegressor().fit(xs, y_train),
    }
    model_predictions = {
        name: _clip_predictions(model.predict(x_one)[0])
        for name, model in models.items()
    }
    stacked = np.stack(list(model_predictions.values()), axis=0)
    ensemble = _clip_predictions(np.mean(stacked, axis=0))
    spread = np.std(stacked, axis=0)
    uncertainty_pct = float(np.clip(np.mean(spread / np.maximum(np.abs(ensemble), 1.0)) * 100.0, 0.0, 100.0))

    return {
        "engine": "numpy_multi_algorithm_ensemble",
        "algorithms": list(models.keys()),
        "training_source": "baseline" if training_rows is None else "calibration_rows_or_baseline",
        "features": {name: round(float(value), 4) for name, value in zip(FEATURE_NAMES, build_feature_vector(features))},
        "predictions": {name: _to_named_metrics(value) for name, value in model_predictions.items()},
        "ensemble": _to_named_metrics(ensemble),
        "uncertainty_pct": round(uncertainty_pct, 2),
    }


def _coerce_training_rows(training_rows: Optional[Iterable[Mapping[str, float]]]) -> Tuple[np.ndarray, np.ndarray]:
    if training_rows is None:
        return build_baseline_training_set()
    x_rows = []
    y_rows = []
    for row in training_rows:
        if all(name in row for name in TARGET_NAMES):
            x_rows.append(build_feature_vector(row))
            y_rows.append([_safe_float(row.get(name)) for name in TARGET_NAMES])
    if len(x_rows) < 6:
        return build_baseline_training_set()
    return np.asarray(x_rows, dtype=float), np.asarray(y_rows, dtype=float)

