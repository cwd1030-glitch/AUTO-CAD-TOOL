import os
import tempfile
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from voxelizer import voxelize_mesh
from solver import solve_injection_flow
from cooling_solver import solve_mold_cooling, calculate_warpage_and_sink

app = Flask(__name__)
CORS(app) # Enable CORS for frontend cross-origin requests

# Cache for loaded meshes to prevent redundant loading/voxelization of the same file
mesh_cache = {}

@app.route('/api/simulate', methods=['POST'])
def simulate():
    try:
        data = request.json
        if not data:
            return jsonify({"status": "error", "message": "Missing request body"}), 400
            
        stl_base64 = data.get("stl_data")  # Option A: Direct upload as base64 string
        stl_path = data.get("stl_path")      # Option B: Path on local disk (faster for desktop integrations)
        gates = data.get("gates", [])
        resolution = float(data.get("resolution", 0.5))
        
        # Melt and Mold inputs
        melt_temp = float(data.get("melt_temp", 240.0))
        eject_temp = float(data.get("eject_temp", 80.0))
        
        # Cooling Channel Parameters
        coolant_temp = float(data.get("coolant_temp", 25.0))
        coolant_flow = float(data.get("coolant_flow", 10.0))
        pitch = float(data.get("pitch", 50.0))
        depth = float(data.get("depth", 20.0))
        diameter = float(data.get("diameter", 10.0))
        
        temp_file = None
        
        # Determine how to retrieve the STL mesh
        cache_key = None
        if stl_path:
            cache_key = f"{stl_path}_{resolution}"
        
        if cache_key and cache_key in mesh_cache:
            mesh, voxel_grid, grid_metadata = mesh_cache[cache_key]
        else:
            if stl_path:
                target_path = stl_path
            elif stl_base64:
                import base64
                temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".stl")
                temp_file.write(base64.b64decode(stl_base64))
                temp_file.close()
                target_path = temp_file.name
            else:
                return jsonify({"status": "error", "message": "No STL model provided"}), 400
                
            mesh, voxel_grid, grid_metadata = voxelize_mesh(target_path, resolution)
            
            if cache_key:
                mesh_cache[cache_key] = (mesh, voxel_grid, grid_metadata)
                
            if temp_file:
                try:
                    os.unlink(temp_file.name)
                except OSError:
                    pass

        origin = np.array(grid_metadata["origin"])
        pitch_val = grid_metadata["pitch"]
        shape = voxel_grid.shape
        
        # Map physical gate coordinates to voxel coordinates
        mapped_gates = []
        for g in gates:
            coord_mesh = np.array(g["coord"])
            coord_voxel = ((coord_mesh - origin) / pitch_val).astype(int)
            coord_voxel[0] = np.clip(coord_voxel[0], 0, shape[0] - 1)
            coord_voxel[1] = np.clip(coord_voxel[1], 0, shape[1] - 1)
            coord_voxel[2] = np.clip(coord_voxel[2], 0, shape[2] - 1)
            
            mapped_gates.append({
                "id": g["id"],
                "coord": tuple(coord_voxel),
                "speed_factor": g.get("speed_factor", 1.0),
                "pressure_factor": g.get("pressure_factor", 1.0),
                "time_delay": g.get("time_delay", 0.0),
                "trigger_voxel": None
            })
            
        # 1. Run Flow Simulation
        fill_times, weld_lines, gate_sources = solve_injection_flow(voxel_grid, mapped_gates)
        
        # 2. Run Cooling Simulation
        T_final, cooling_rates, cycle_time, hot_spots, solidification_time = solve_mold_cooling(
            voxel_grid, coolant_temp=coolant_temp, coolant_flow=coolant_flow,
            pitch=pitch, depth=depth, diameter=diameter, resolution=resolution,
            melt_temp=melt_temp, eject_temp=eject_temp
        )
        
        # 3. Calculate Differential Shrinkage & Warpage / Sink marks
        displacements, sink_risk = calculate_warpage_and_sink(
            voxel_grid, T_final, solidification_time, parting_axis=2
        )
        
        # 4. Map Results back to Mesh Vertices
        mesh_vertices = mesh.vertices
        vertex_voxel_coords = ((mesh_vertices - origin) / pitch_val).astype(int)
        vertex_voxel_coords[:, 0] = np.clip(vertex_voxel_coords[:, 0], 0, shape[0] - 1)
        vertex_voxel_coords[:, 1] = np.clip(vertex_voxel_coords[:, 1], 0, shape[1] - 1)
        vertex_voxel_coords[:, 2] = np.clip(vertex_voxel_coords[:, 2], 0, shape[2] - 1)
        
        # Extract values
        vertex_fill_times = fill_times[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
        vertex_fill_times[np.isinf(vertex_fill_times)] = -1.0
        
        vertex_temp = T_final[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
        vertex_disp = displacements[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
        vertex_sink_risk = sink_risk[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]

        # Return results to client
        return jsonify({
            "status": "success",
            "vertex_fill_times": vertex_fill_times.tolist(),
            "vertex_temperatures": vertex_temp.tolist(),
            "vertex_displacements": vertex_disp.tolist(),
            "vertex_sink_risk": vertex_sink_risk.tolist(),
            "cycle_time": float(cycle_time)
        })
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    # Runs the Flask server on http://127.0.0.1:5000/
    app.run(host='127.0.0.1', port=5000, debug=True)
