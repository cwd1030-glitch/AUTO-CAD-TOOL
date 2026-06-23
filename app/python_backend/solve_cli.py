import sys
import json
import argparse
import numpy as np
from voxelizer import voxelize_mesh
from solver import solve_injection_flow
from cooling_core import solve_mold_cooling, calculate_warpage_and_sink
from ml_predictor import predict_quality

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stl", type=str, required=True, help="Path to the STL file")
    parser.add_argument("--gates_file", type=str, required=True, help="Path to gates configuration JSON file")
    parser.add_argument("--resolution", type=float, default=0.5, help="Voxel size in mm")
    parser.add_argument("--cooling_enabled", type=str, default="false", help="Whether cooling simulation is enabled")
    parser.add_argument("--coolant_temp", type=float, default=25.0, help="Coolant temperature in C")
    parser.add_argument("--melt_temp", type=float, default=230.0, help="Melt temperature in C")
    args = parser.parse_args()

    try:
        # Parse gates JSON (utf-8-sig tolerates a leading BOM if the caller wrote one)
        with open(args.gates_file, 'r', encoding='utf-8-sig') as f:
            gates = json.load(f)
        
        # Load mesh and voxelize
        mesh, voxel_grid, grid_metadata = voxelize_mesh(args.stl, args.resolution)
        origin = np.array(grid_metadata["origin"])
        pitch = grid_metadata["pitch"]
        shape = voxel_grid.shape
        
        # Map physical gate coordinates to voxel coordinates
        mapped_gates = []
        for g in gates:
            coord_mesh = np.array(g["coord"])
            coord_voxel = ((coord_mesh - origin) / pitch).astype(int)
            coord_voxel[0] = np.clip(coord_voxel[0], 0, shape[0] - 1)
            coord_voxel[1] = np.clip(coord_voxel[1], 0, shape[1] - 1)
            coord_voxel[2] = np.clip(coord_voxel[2], 0, shape[2] - 1)
            
            trigger_voxel_mesh = g.get("trigger_voxel")
            trigger_voxel_mapped = None
            if trigger_voxel_mesh:
                tv_mesh = np.array(trigger_voxel_mesh)
                tv_voxel = ((tv_mesh - origin) / pitch).astype(int)
                tv_voxel[0] = np.clip(tv_voxel[0], 0, shape[0] - 1)
                tv_voxel[1] = np.clip(tv_voxel[1], 0, shape[1] - 1)
                tv_voxel[2] = np.clip(tv_voxel[2], 0, shape[2] - 1)
                trigger_voxel_mapped = tuple(tv_voxel)

            mapped_gates.append({
                "id": g["id"],
                "coord": tuple(coord_voxel),
                "speed_factor": g.get("speed_factor", 1.0),
                "pressure_factor": g.get("pressure_factor", 1.0),
                "time_delay": g.get("time_delay", 0.0),
                "trigger_voxel": trigger_voxel_mapped
            })

        cooling_on = args.cooling_enabled.lower() in ("true", "1", "yes", "on")

        if cooling_on:
            # 1. Run Mold Cooling (Transient Heat Conduction FDM)
            T_final, cooling_rates, cycle_time, hot_spots, solidification_time = solve_mold_cooling(
                voxel_grid, coolant_temp=args.coolant_temp, melt_temp=args.melt_temp, resolution=args.resolution
            )
            # 2. Run Flow Solver (with temperature-dependent viscosity)
            fill_times, weld_lines, gate_sources = solve_injection_flow(
                voxel_grid, mapped_gates, temperature_grid=T_final, melt_temp=args.melt_temp, coolant_temp=args.coolant_temp
            )
        else:
            # Run basic flow solver (constant viscosity / geometric)
            fill_times, weld_lines, gate_sources = solve_injection_flow(voxel_grid, mapped_gates)
            T_final = np.full(voxel_grid.shape, args.melt_temp)
            cooling_rates = np.zeros(voxel_grid.shape)
            cycle_time = 0.0
            hot_spots = []
            solidification_time = np.zeros(voxel_grid.shape)
        
        # 3. Predict Warpage & Sink Marks
        displacements, sink_risk = calculate_warpage_and_sink(
            voxel_grid, T_final, solidification_time, parting_axis=2
        )
        finite_fill = fill_times[np.isfinite(fill_times) & voxel_grid]
        part_volume = float(getattr(mesh, "volume", 0.0) or (int(voxel_grid.sum()) * (pitch ** 3)))
        surface_area = float(getattr(mesh, "area", 0.0) or 0.0)
        bounds = np.asarray(getattr(mesh, "bounds", np.zeros((2, 3))), dtype=float)
        extents = np.abs(bounds[1] - bounds[0]) if bounds.shape == (2, 3) else np.zeros(3)
        positive_extents = extents[extents > 1e-9]
        mean_thickness = float(np.min(positive_extents)) if positive_extents.size else float(args.resolution)
        flow_rate = 50.0
        pressure_limit = 100.0
        pressure_drop = float(np.nanmax(finite_fill)) * 8.0 if finite_fill.size else 0.0
        ml_features = {
            "volume_mm3": abs(part_volume),
            "surface_area_mm2": surface_area,
            "mean_thickness_mm": mean_thickness,
            "triangle_count": float(len(getattr(mesh, "faces", []))),
            "gate_count": float(max(len(mapped_gates), 1)),
            "melt_temp_c": args.melt_temp,
            "mold_temp_c": args.coolant_temp,
            "flow_rate_cm3_s": flow_rate,
            "pressure_limit_mpa": pressure_limit,
            "undercut_ratio": 0.0,
            "runner_hot": 0.0,
        }
        ml_prediction = predict_quality(ml_features)
        
        # Map voxel results back to the original STL mesh vertices
        mesh_vertices = mesh.vertices
        vertex_voxel_coords = ((mesh_vertices - origin) / pitch).astype(int)
        vertex_voxel_coords[:, 0] = np.clip(vertex_voxel_coords[:, 0], 0, shape[0] - 1)
        vertex_voxel_coords[:, 1] = np.clip(vertex_voxel_coords[:, 1], 0, shape[1] - 1)
        vertex_voxel_coords[:, 2] = np.clip(vertex_voxel_coords[:, 2], 0, shape[2] - 1)
        
        # Vertex flow times
        vertex_fill_times = fill_times[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
        vertex_fill_times[np.isinf(vertex_fill_times)] = -1.0
        
        # Vertex temperature & cooling rate
        vertex_temp = T_final[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
        vertex_cooling_rates = cooling_rates[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
        
        # Vertex warpage displacement (3D displacement vector)
        vertex_disp = displacements[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
        
        # Vertex sink mark risk index
        vertex_sink_risk = sink_risk[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]

        # Convert weld line voxel coordinates back to mesh coordinates
        weld_lines_mesh = []
        for wl in weld_lines:
            wl_mesh = origin + np.array(wl) * pitch
            weld_lines_mesh.append(wl_mesh.tolist())
            
        # Convert hot spot voxel coordinates back to mesh coordinates
        hot_spots_mesh = []
        for hs in hot_spots:
            hs_mesh = origin + np.array(hs) * pitch
            hot_spots_mesh.append(hs_mesh.tolist())

        output = {
            "status": "success",
            "vertex_fill_times": vertex_fill_times.tolist(),
            "vertex_temperatures": vertex_temp.tolist(),
            "vertex_cooling_rates": vertex_cooling_rates.tolist(),
            "vertex_displacements": vertex_disp.tolist(),
            "vertex_sink_risk": vertex_sink_risk.tolist(),
            "weld_lines": weld_lines_mesh,
            "hot_spots": hot_spots_mesh,
            "cycle_time": float(cycle_time),
            "mesh_quality": grid_metadata.get("mesh_quality", {}),
            "quality_prediction": ml_prediction,
            "diagnostics": {
                "filling_time": float(np.nanmax(finite_fill)) if finite_fill.size else 0.0,
                "estimated_pressure_drop": pressure_drop,
                "mesh_volume_mm3": abs(part_volume),
                "mesh_surface_area_mm2": surface_area,
                "mean_thickness_mm": mean_thickness,
                "solver_mode": "thermal_coupled" if cooling_on else "geometric_flow"
            }
        }
        print(json.dumps(output))
        
    except Exception as e:
        # Emit the structured error on stdout (consumed by the frontend) and a
        # full traceback on stderr so the launching server can log the real
        # cause instead of a bare one-line message.
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    main()
