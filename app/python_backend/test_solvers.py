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
from cooling_solver import solve_mold_cooling, calculate_warpage_and_sink


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


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
