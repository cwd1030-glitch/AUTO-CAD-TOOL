"""
DIMA 솔버 단위/통합 테스트
실행: app/python_backend 에서  python -m pytest test_solvers.py -v
의존성: numpy, scipy, trimesh, pytest

이 테스트는 사출 검증 솔버의 핵심 신뢰성을 검증한다:
- 출력 형상(shape) 및 타입 계약
- NaN/Inf 미발생 (수치 안정성)
- 0 입력 등 경계 조건에서의 견고성
- 멀티 게이트 웰드라인 검출
- 형상-온도 연계 모드 일관성
"""
import numpy as np
import pytest

from solver import solve_injection_flow
from cooling_core import solve_mold_cooling, calculate_warpage_and_sink


# ---------------------------------------------------------------------------
# 헬퍼: 단순한 직육면체 캐비티 복셀 그리드 생성
# ---------------------------------------------------------------------------
def make_block(nx=12, ny=12, nz=6):
    grid = np.zeros((nx, ny, nz), dtype=bool)
    grid[2:nx - 2, 2:ny - 2, 1:nz - 1] = True
    return grid


def center_gate(grid):
    s = grid.shape
    return [{
        "id": 1,
        "coord": (s[0] // 2, s[1] // 2, s[2] // 2),
        "speed_factor": 1.0,
        "pressure_factor": 1.0,
        "time_delay": 0.0,
        "trigger_voxel": None,
    }]


# ---------------------------------------------------------------------------
# solve_injection_flow
# ---------------------------------------------------------------------------
class TestFlowSolver:
    def test_output_contract(self):
        grid = make_block()
        fill, weld, src = solve_injection_flow(grid, center_gate(grid))
        assert fill.shape == grid.shape
        assert src.shape == grid.shape
        assert isinstance(weld, list)

    def test_fills_all_cavity_voxels(self):
        grid = make_block()
        fill, _, _ = solve_injection_flow(grid, center_gate(grid))
        # 캐비티 내부의 모든 복셀은 채워져야 함 (inf 가 아니어야 함)
        assert np.all(np.isfinite(fill[grid]))

    def test_solid_voxels_remain_unfilled(self):
        grid = make_block()
        fill, _, _ = solve_injection_flow(grid, center_gate(grid))
        # 캐비티 밖(솔리드)은 채워지면 안 됨
        assert np.all(np.isinf(fill[~grid]))

    def test_fill_time_monotonic_from_gate(self):
        grid = make_block()
        gate = center_gate(grid)
        fill, _, _ = solve_injection_flow(grid, gate)
        gc = gate[0]["coord"]
        # 게이트 위치의 충진 시각이 최소
        assert fill[gc] == np.min(fill[grid])

    def test_two_gates_produce_weld_line(self):
        grid = make_block(20, 8, 4)
        s = grid.shape
        gates = [
            {"id": 1, "coord": (3, s[1] // 2, s[2] // 2), "speed_factor": 1.0,
             "pressure_factor": 1.0, "time_delay": 0.0, "trigger_voxel": None},
            {"id": 2, "coord": (s[0] - 4, s[1] // 2, s[2] // 2), "speed_factor": 1.0,
             "pressure_factor": 1.0, "time_delay": 0.0, "trigger_voxel": None},
        ]
        _, weld, _ = solve_injection_flow(grid, gates)
        # 마주보는 두 게이트는 가운데서 만나 웰드라인을 형성해야 함
        assert len(weld) > 0

    def test_zero_speed_factor_no_crash(self):
        # speed_factor 0 → 솔버 내부에서 0.01 로 클램프되어 division-by-zero 회피
        grid = make_block()
        gate = center_gate(grid)
        gate[0]["speed_factor"] = 0.0
        gate[0]["pressure_factor"] = 0.0
        fill, _, _ = solve_injection_flow(grid, gate)
        assert np.all(np.isfinite(fill[grid]))

    def test_gate_outside_cavity_ignored(self):
        grid = make_block()
        gate = [{"id": 1, "coord": (0, 0, 0), "speed_factor": 1.0,
                 "pressure_factor": 1.0, "time_delay": 0.0, "trigger_voxel": None}]
        # 캐비티 밖 게이트만 있으면 아무것도 채워지지 않지만 크래시는 없어야 함
        fill, weld, _ = solve_injection_flow(grid, gate)
        assert fill.shape == grid.shape


# ---------------------------------------------------------------------------
# solve_mold_cooling
# ---------------------------------------------------------------------------
class TestCoolingSolver:
    def test_output_contract(self):
        grid = make_block()
        T, rates, cycle, hot, solid = solve_mold_cooling(grid, resolution=1.0)
        assert T.shape == grid.shape
        assert rates.shape == grid.shape
        assert solid.shape == grid.shape
        assert isinstance(cycle, float)
        assert isinstance(hot, list)

    def test_no_nan_or_inf_in_temperature(self):
        grid = make_block()
        T, _, _, _, _ = solve_mold_cooling(grid, resolution=1.0)
        assert np.all(np.isfinite(T)), "온도장에 NaN/Inf 가 존재하면 안 됨"

    def test_cycle_time_positive(self):
        grid = make_block()
        _, _, cycle, _, _ = solve_mold_cooling(grid, resolution=1.0)
        assert cycle > 0.0

    def test_zero_diameter_guarded(self):
        # diameter=0 → 과거에는 h, u 계산에서 division-by-zero 발생.
        # 가드 추가 후에는 유한값을 반환해야 함.
        grid = make_block()
        T, _, _, _, _ = solve_mold_cooling(grid, diameter=0.0, resolution=1.0)
        assert np.all(np.isfinite(T))

    def test_zero_flow_guarded(self):
        grid = make_block()
        T, _, _, _, _ = solve_mold_cooling(grid, coolant_flow=0.0, resolution=1.0)
        assert np.all(np.isfinite(T))

    def test_empty_grid_no_crash(self):
        grid = np.zeros((8, 8, 8), dtype=bool)
        T, _, cycle, _, _ = solve_mold_cooling(grid, resolution=1.0)
        assert np.all(np.isfinite(T))


# ---------------------------------------------------------------------------
# calculate_warpage_and_sink
# ---------------------------------------------------------------------------
class TestWarpageSink:
    def test_output_contract(self):
        grid = make_block()
        T = np.full(grid.shape, 60.0)
        solid = np.full(grid.shape, 5.0)
        disp, sink = calculate_warpage_and_sink(grid, T, solid)
        assert disp.shape == grid.shape + (3,)
        assert sink.shape == grid.shape

    def test_sink_risk_in_unit_range(self):
        grid = make_block()
        T = np.full(grid.shape, 60.0)
        solid = np.full(grid.shape, 5.0)
        _, sink = calculate_warpage_and_sink(grid, T, solid)
        assert sink.min() >= 0.0 and sink.max() <= 1.0

    def test_all_zero_solidification_no_nan(self):
        # 핵심 회귀 테스트: solidification_time 이 전부 0 이면
        # 과거에는 sink_risk = x / max(0) = NaN 이 되었음.
        grid = make_block()
        T = np.full(grid.shape, 60.0)
        solid = np.zeros(grid.shape)
        _, sink = calculate_warpage_and_sink(grid, T, solid)
        assert np.all(np.isfinite(sink)), "0 고화시간에서 NaN 발생하면 안 됨"
        assert sink.max() == 0.0

    def test_empty_grid_returns_zeros(self):
        grid = np.zeros((6, 6, 6), dtype=bool)
        T = np.full(grid.shape, 60.0)
        solid = np.zeros(grid.shape)
        disp, sink = calculate_warpage_and_sink(grid, T, solid)
        assert np.all(disp == 0.0)
        assert np.all(sink == 0.0)


# ---------------------------------------------------------------------------
# 통합: 냉각 → 유동(온도 연계) → 싱크마크 파이프라인
# ---------------------------------------------------------------------------
class TestIntegrationPipeline:
    def test_thermal_coupled_pipeline(self):
        grid = make_block()
        T, _, cycle, hot, solid = solve_mold_cooling(grid, resolution=1.0)
        fill, weld, _ = solve_injection_flow(
            grid, center_gate(grid), temperature_grid=T,
            melt_temp=240.0, coolant_temp=25.0,
        )
        disp, sink = calculate_warpage_and_sink(grid, T, solid)
        # 전체 파이프라인 결과가 모두 유한해야 함
        assert np.all(np.isfinite(fill[grid]))
        assert np.all(np.isfinite(sink))
        assert np.all(np.isfinite(disp))


# ---------------------------------------------------------------------------
# 검증: 알려진 형상(직육면체)을 voxelize_mesh로 복셀화 → 전체 파이프라인
# 운영 진입점(solve_cli)이 실제로 거치는 voxelize_mesh 경로를 검증한다.
# trimesh 버전에 따라 사라진 VoxelGrid.origin 의존을 회귀 차단한다.
# ---------------------------------------------------------------------------
class TestVoxelizeKnownBox:
    def _box(self, extents=(40.0, 30.0, 18.0)):
        import trimesh
        return trimesh.creation.box(extents=list(extents))

    def test_origin_is_finite_3vector(self):
        from voxelizer import voxelize_mesh
        import trimesh, tempfile, os
        mesh = self._box()
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as f:
            path = f.name
        try:
            mesh.export(path)
            _, grid, meta = voxelize_mesh(path, resolution=2.0)
            origin = np.asarray(meta["origin"], dtype=float)
            assert origin.shape == (3,)
            assert np.all(np.isfinite(origin))      # VoxelGrid.origin 회귀 가드
            assert grid.any()                        # 박스가 실제로 복셀로 채워짐
        finally:
            os.remove(path)

    def test_origin_maps_surface_vertices_onto_voxels(self):
        # voxelized()는 표면 셸을 만든다. origin/pitch 매핑이 올바르면 메시 표면 정점이
        # 그리드 내부의 '점유' 복셀로 사상돼야 한다. origin이 어긋나면 이 정합이 깨진다
        # → solve_cli가 실제로 의존하는 핵심 불변식의 회귀 가드.
        from voxelizer import voxelize_mesh
        import tempfile, os
        mesh = self._box()
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as f:
            path = f.name
        try:
            mesh.export(path)
            m, grid, meta = voxelize_mesh(path, resolution=2.0)
            origin = np.asarray(meta["origin"], dtype=float)
            pitch = meta["pitch"]
            shape = np.array(grid.shape)
            v = np.asarray(m.vertices, dtype=float)
            idx = ((v - origin) / pitch).astype(int)
            in_bounds = np.all((idx >= 0) & (idx < shape), axis=1)
            assert in_bounds.mean() > 0.9          # 정점 대부분이 그리드 내부로 사상
            idxc = np.clip(idx, 0, shape - 1)
            hit = grid[idxc[:, 0], idxc[:, 1], idxc[:, 2]]
            assert hit.mean() > 0.5                 # 표면 정점 다수가 점유 복셀에 사상
        finally:
            os.remove(path)

    def test_full_pipeline_on_box_is_physically_plausible(self):
        from voxelizer import voxelize_mesh
        import tempfile, os
        mesh = self._box()
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as f:
            path = f.name
        try:
            mesh.export(path)
            _, grid, meta = voxelize_mesh(path, resolution=2.0)
            # 게이트는 실제 점유 복셀(표면)에 배치 — 거기서 유동이 전파된다.
            occ = np.argwhere(grid)
            gv = occ[len(occ) // 2]
            gate = [{"id": 1, "coord": tuple(int(x) for x in gv), "speed_factor": 1.0,
                     "pressure_factor": 1.0, "time_delay": 0.0, "trigger_voxel": None}]
            T, _, cycle, _, solid = solve_mold_cooling(grid, resolution=2.0)
            fill, weld, _ = solve_injection_flow(grid, gate, temperature_grid=T,
                                                 melt_temp=240.0, coolant_temp=25.0)
            disp, sink = calculate_warpage_and_sink(grid, T, solid)
            assert cycle > 0                                       # 사이클타임 양수
            assert np.all(np.isfinite(sink)) and np.all(np.isfinite(disp))
            assert float(sink.max()) <= 1.0 + 1e-6                 # 위험도 정규화 범위
            # 게이트에서 연결된 표면 복셀 대부분이 충진(유한 충진시간)돼야 한다.
            filled = np.isfinite(fill) & grid
            assert filled.sum() > 0.5 * int(grid.sum())
        finally:
            os.remove(path)

    def test_mesh_quality_metadata_is_reported(self):
        from voxelizer import voxelize_mesh
        import tempfile, os
        mesh = self._box()
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as f:
            path = f.name
        try:
            mesh.export(path)
            _, _, meta = voxelize_mesh(path, resolution=2.0)
            quality = meta["mesh_quality"]
            assert quality["triangle_count"] > 0
            assert quality["voxel_count"] > 0
            assert quality["score"] >= 0
            assert quality["status"] in {"pass", "warning", "fail"}
            assert "recommendations" in quality
        finally:
            os.remove(path)


class TestMultiAlgorithmPredictor:
    def test_predictor_contract(self):
        from ml_predictor import FEATURE_NAMES, predict_quality

        features = {name: 1.0 for name in FEATURE_NAMES}
        features.update({
            "volume_mm3": 42000.0,
            "surface_area_mm2": 6800.0,
            "mean_thickness_mm": 2.4,
            "triangle_count": 18000.0,
            "gate_count": 2.0,
            "melt_temp_c": 235.0,
            "mold_temp_c": 55.0,
            "flow_rate_cm3_s": 60.0,
            "pressure_limit_mpa": 110.0,
        })

        result = predict_quality(features)
        assert result["engine"] == "numpy_multi_algorithm_ensemble"
        assert result["algorithms"] == ["linear_regression", "decision_tree", "random_forest"]
        assert "ensemble" in result
        assert 0.0 <= result["ensemble"]["risk_score"] <= 100.0
        assert result["ensemble"]["fill_time_s"] >= 0.0
        assert 0.0 <= result["uncertainty_pct"] <= 100.0

    def test_predictor_accepts_real_training_rows(self):
        from ml_predictor import FEATURE_NAMES, TARGET_NAMES, predict_quality

        rows = []
        for idx in range(8):
            row = {name: float(idx + 1) for name in FEATURE_NAMES}
            row.update({
                "volume_mm3": 10000.0 + idx * 3000.0,
                "surface_area_mm2": 3000.0 + idx * 500.0,
                "mean_thickness_mm": 1.5 + idx * 0.2,
                "gate_count": 1.0 + (idx % 3),
                "fill_time_s": 0.5 + idx * 0.1,
                "cooling_time_s": 6.0 + idx,
                "pressure_drop_mpa": 20.0 + idx * 2.0,
                "shrinkage_pct": 0.5 + idx * 0.02,
                "warp_mm": 0.1 + idx * 0.01,
                "risk_score": 35.0 + idx * 3.0,
            })
            assert all(name in row for name in TARGET_NAMES)
            rows.append(row)

        result = predict_quality(rows[-1], training_rows=rows)
        assert result["training_source"] == "calibration_rows_or_baseline"
        assert result["ensemble"]["cooling_time_s"] >= 0.0


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
