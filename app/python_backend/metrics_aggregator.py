"""
검증된 물리 솔버(cooling_solver.calculate_warpage_and_sink)의 출력에서
UI 요약 지표(수축%·휨·싱크)를 산출한다.

설계 원칙:
- 프런트엔드의 JS 추정식을 대체할 "권위 있는" 수치를 만든다.
- 모든 값은 검증된 솔버가 이미 계산한 물리장(변위·싱크리스크·온도)에서 유도한다.
- 순수 함수(부수효과 없음)라 단위 검증이 쉽다.
"""
import numpy as np

# 솔버 내부와 동일한 물성 상수(일관성 유지)
ALPHA_TH = 6.0e-5   # 폴리머 열팽창계수 1/K (calculate_warpage_and_sink와 동일)
T_ROOM = 25.0


def _safe(v, d=0.0):
    try:
        f = float(v)
        return f if np.isfinite(f) else d
    except Exception:
        return d


def aggregate_defect_metrics(voxel_grid, T_final, solidification_time,
                             displacement=None, sink_risk=None,
                             parting_axis=2):
    """
    검증된 솔버 출력 → {shrinkage, warpage, sink} 요약.

    displacement / sink_risk를 직접 넘기면 그대로 사용하고,
    없으면 calculate_warpage_and_sink로 계산한다.
    """
    if displacement is None or sink_risk is None:
        # 지연 임포트(순환 방지)
        from cooling_solver import calculate_warpage_and_sink
        displacement, sink_risk = calculate_warpage_and_sink(
            voxel_grid, T_final, solidification_time, parting_axis=parting_axis)

    part = np.asarray(voxel_grid, dtype=bool)
    n_part = int(part.sum())
    if n_part == 0:
        return _empty_metrics()

    # ── 1) 휨(Warpage): 면외 변위(z성분) 크기 ──
    warp_z = displacement[..., 2][part]
    warp_abs = np.abs(warp_z)
    warp_max = _safe(np.max(warp_abs))
    warp_mean = _safe(np.mean(warp_abs))
    signed_mean = _safe(np.mean(warp_z))
    direction = '+Z' if signed_mean >= 0 else '-Z'
    if warp_max > 0.5:
        warp_risk = 'HIGH'
    elif warp_max > 0.15:
        warp_risk = 'MEDIUM'
    else:
        warp_risk = 'LOW'

    # ── 2) 수축(Shrinkage): 선형 열수축 변형률 = ALPHA_TH*(T - T_room) ──
    # 솔버의 in-plane 변위와 동일한 물리에서 유도(절대 변위가 아니라 변형률 %).
    Tpart = T_final[part].astype(float)
    strain = ALPHA_TH * np.clip(Tpart - T_ROOM, 0.0, None)  # 음수 방지
    shrink_pct = strain * 100.0
    shrink_avg = _safe(np.mean(shrink_pct))
    shrink_max = _safe(np.max(shrink_pct))
    shrink_p90 = _safe(np.percentile(shrink_pct, 90)) if shrink_pct.size else 0.0
    # 위험도: 부위별 편차(불균일 수축이 변형/싱크 유발)
    rel_spread = (shrink_max - shrink_avg) / shrink_avg if shrink_avg > 1e-9 else 0.0
    if rel_spread > 0.5:
        shrink_risk = 'HIGH'
    elif rel_spread > 0.25:
        shrink_risk = 'MEDIUM'
    else:
        shrink_risk = 'LOW'

    # ── 싱크마크는 의도적으로 제외 ──
    # 검증된 솔버의 sink_risk 장은 "냉각 난이도" 프록시로, 균일하게 두꺼운 영역까지
    # 포화(≈1.0)되어 국부 싱크 "개소" 산출에는 부적합하다(균일 평판도 과대검출).
    # 싱크마크는 이웃 대비 국부 두께 이상에서 발생하므로, 프런트엔드의 상대-기하
    # 판정(predictSinkMarks)을 그대로 사용하는 것이 더 정확하다.

    return {
        "engine": "python_validated",
        "shrinkage": {
            "avgShrinkage": round(shrink_avg, 3),
            "maxShrinkage": round(shrink_max, 3),
            "p90Shrinkage": round(shrink_p90, 3),
            "riskLevel": shrink_risk,
        },
        "warpage": {
            "magnitude": round(warp_max, 3),
            "meanMagnitude": round(warp_mean, 3),
            "direction": direction,
            "risk": warp_risk,
        },
    }


def _empty_metrics():
    return {
        "engine": "python_validated",
        "shrinkage": {"avgShrinkage": 0.0, "maxShrinkage": 0.0, "p90Shrinkage": 0.0, "riskLevel": "LOW"},
        "warpage": {"magnitude": 0.0, "meanMagnitude": 0.0, "direction": "+Z", "risk": "LOW"},
        "sink": {"count": 0, "area": 0.0, "severity": "LOW", "highVoxels": 0},
    }
