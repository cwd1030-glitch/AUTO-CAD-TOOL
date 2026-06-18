import os
import sys
import numpy as np

# Add python_backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'python_backend'))

from cooling_solver import solve_mold_cooling
import flow_solver

def calculate_transient_thermal_field(data):
    mesh, voxel_grid, metadata = flow_solver.get_or_create_voxel_grid(data)
    
    # Extract params
    melt_temp = float(data.get("melt_temp", data.get("meltTemp", 240.0)))
    eject_temp = float(data.get("eject_temp", data.get("ejectTemp", 80.0)))
    resolution = float(data.get("resolution", 0.5))
    
    coolant_temp_raw = data.get("coolant_temp") or data.get("coolantTemp")
    coolant_temp = float(coolant_temp_raw) if coolant_temp_raw is not None else 25.0
    
    coolant_flow_raw = data.get("coolant_flow") or data.get("coolantFlow")
    coolant_flow = float(coolant_flow_raw) if coolant_flow_raw is not None else 10.0
    
    pitch_raw = data.get("pitch") or data.get("cooling_pitch") or data.get("coolingPitch")
    pitch = float(pitch_raw) if pitch_raw is not None else 50.0
    
    depth = float(data.get("depth", data.get("depth", 20.0)))
    diameter = float(data.get("diameter", data.get("diameter", 10.0)))
    
    T_final, cooling_rates, cycle_time, hot_spots, solidification_time = solve_mold_cooling(
        voxel_grid, coolant_temp=coolant_temp, coolant_flow=coolant_flow,
        pitch=pitch, depth=depth, diameter=diameter, resolution=resolution,
        melt_temp=melt_temp, eject_temp=eject_temp
    )
    
    # Map T_final to mesh vertices
    origin = np.array(metadata["origin"])
    pitch_val = metadata["pitch"]
    shape = voxel_grid.shape
    
    mesh_vertices = mesh.vertices
    vertex_voxel_coords = ((mesh_vertices - origin) / pitch_val).astype(int)
    vertex_voxel_coords[:, 0] = np.clip(vertex_voxel_coords[:, 0], 0, shape[0] - 1)
    vertex_voxel_coords[:, 1] = np.clip(vertex_voxel_coords[:, 1], 0, shape[1] - 1)
    vertex_voxel_coords[:, 2] = np.clip(vertex_voxel_coords[:, 2], 0, shape[2] - 1)
    
    vertex_temp = T_final[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
    
    # Calculate channels
    cooling_channel_coords = []
    pitch_voxels = int(pitch / resolution)
    depth_voxels = int(depth / resolution)
    radius_voxels = int((diameter / 2) / resolution)
    part_z_indices = np.where(voxel_grid)[2]
    if len(part_z_indices) > 0:
        base_z = max(0, np.min(part_z_indices) - depth_voxels)
        for x in range(radius_voxels, shape[0] - radius_voxels, max(1, pitch_voxels)):
            p_start = origin + np.array([x, 0, base_z]) * pitch_val
            p_end = origin + np.array([x, shape[1] - 1, base_z]) * pitch_val
            cooling_channel_coords.append([p_start.tolist(), p_end.tolist()])
            
    return {
        "vertex_temperatures": vertex_temp.tolist(),
        "temp": vertex_temp.tolist(),
        "channels": cooling_channel_coords,
        "coolingChannels": cooling_channel_coords,
        "mesh": mesh,
        "voxel_grid": voxel_grid,
        "metadata": metadata,
        "T_final": T_final,
        "solidification_time": solidification_time,
        "cycle_time": cycle_time
    }

# Keep fallback compatibility
def calculate_cooling_and_channels(coolant_temp):
    return calculate_transient_thermal_field({"coolantTemp": coolant_temp})
