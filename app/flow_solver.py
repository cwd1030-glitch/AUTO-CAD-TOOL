import os
import sys
import numpy as np
import tempfile

# Add python_backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'python_backend'))

from voxelizer import voxelize_mesh
from solver import solve_injection_flow

# Cache of the latest voxelized mesh details
_last_voxel_grid = None
_last_grid_metadata = None
_last_mesh = None
mesh_cache = {}

def set_latest_mesh(mesh, voxel_grid, grid_metadata):
    global _last_mesh, _last_voxel_grid, _last_grid_metadata
    _last_mesh = mesh
    _last_voxel_grid = voxel_grid
    _last_grid_metadata = grid_metadata

def get_or_create_voxel_grid(data):
    global _last_voxel_grid, _last_grid_metadata, _last_mesh
    
    # Check if we have new stl data to voxelize
    stl_base64 = data.get("stl_data") or data.get("stlData")
    stl_path = data.get("stl_path") or data.get("stlPath")
    resolution = float(data.get("resolution", 0.5))
    
    if stl_path or stl_base64:
        cache_key = f"{stl_path}_{resolution}" if stl_path else None
        if cache_key and cache_key in mesh_cache:
            mesh, voxel_grid, grid_metadata = mesh_cache[cache_key]
            set_latest_mesh(mesh, voxel_grid, grid_metadata)
            return mesh, voxel_grid, grid_metadata
            
        if stl_path:
            target_path = stl_path
            temp_file = None
        else:
            import base64
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".stl")
            temp_file.write(base64.b64decode(stl_base64))
            temp_file.close()
            target_path = temp_file.name
            
        try:
            mesh, voxel_grid, grid_metadata = voxelize_mesh(target_path, resolution)
        finally:
            # Always remove the temp STL, even if voxelization raises, so the
            # temp directory does not accumulate orphaned files over time.
            if temp_file:
                try:
                    os.unlink(temp_file.name)
                except OSError:
                    pass
        if cache_key:
            mesh_cache[cache_key] = (mesh, voxel_grid, grid_metadata)
        set_latest_mesh(mesh, voxel_grid, grid_metadata)
        return mesh, voxel_grid, grid_metadata
        
    if _last_voxel_grid is not None:
        return _last_mesh, _last_voxel_grid, _last_grid_metadata
        
    # Standard fallback
    sample_path = os.path.join(os.path.dirname(__file__), 'samples', 'sample_part.stl')
    if os.path.exists(sample_path):
        mesh, voxel_grid, grid_metadata = voxelize_mesh(sample_path, 1.0)
        set_latest_mesh(mesh, voxel_grid, grid_metadata)
        return mesh, voxel_grid, grid_metadata
        
    # Dummy grid
    _last_voxel_grid = np.ones((10, 10, 10), dtype=bool)
    _last_grid_metadata = {"origin": [0.0, 0.0, 0.0], "pitch": 1.0}
    class DummyMesh:
        def __init__(self):
            self.vertices = np.zeros((10, 3))
    _last_mesh = DummyMesh()
    return _last_mesh, _last_voxel_grid, _last_grid_metadata

def _run_flow_solver(mesh, voxel_grid, metadata, data, temperature_grid=None, melt_temp=240.0, coolant_temp=25.0):
    shape = voxel_grid.shape
    gates = data.get("gates")
    gate_speeds = data.get("gateSpeeds")
    
    mapped_gates = []
    origin = np.array(metadata["origin"])
    pitch_val = metadata["pitch"]
    
    if gates:
        for g in gates:
            coord_mesh = np.array(g["coord"])
            coord_voxel = ((coord_mesh - origin) / pitch_val).astype(int)
            coord_voxel[0] = np.clip(coord_voxel[0], 0, shape[0] - 1)
            coord_voxel[1] = np.clip(coord_voxel[1], 0, shape[1] - 1)
            coord_voxel[2] = np.clip(coord_voxel[2], 0, shape[2] - 1)
            mapped_gates.append({
                "id": g["id"],
                "coord": tuple(coord_voxel),
                "speed_factor": g.get("speed_factor", g.get("speedFactor", 1.0)),
                "pressure_factor": g.get("pressure_factor", g.get("pressureFactor", 1.0)),
                "time_delay": g.get("time_delay", g.get("timeDelay", 0.0)),
                "trigger_voxel": None
            })
    elif gate_speeds:
        for idx, speed in enumerate(gate_speeds):
            x_coord = int(shape[0] * (idx + 1) / (len(gate_speeds) + 1))
            y_coord = int(shape[1] / 2)
            z_coord = int(shape[2] / 2)
            mapped_gates.append({
                "id": idx + 1,
                "coord": (x_coord, y_coord, z_coord),
                "speed_factor": float(speed) / 100.0 if speed else 1.0,
                "pressure_factor": 1.0,
                "time_delay": 0.0,
                "trigger_voxel": None
            })
    else:
        mapped_gates.append({
            "id": 1,
            "coord": (shape[0] // 2, shape[1] // 2, shape[2] // 2),
            "speed_factor": 1.0,
            "pressure_factor": 1.0,
            "time_delay": 0.0,
            "trigger_voxel": None
        })
        
    fill_times, weld_lines, gate_sources = solve_injection_flow(
        voxel_grid, mapped_gates, 
        temperature_grid=temperature_grid, 
        melt_temp=melt_temp, 
        coolant_temp=coolant_temp
    )
    
    real_weld_lines = []
    for wl in weld_lines:
        real_coord = origin + np.array(wl) * pitch_val
        real_weld_lines.append(real_coord.tolist())
        
    # Map voxel fill times back to mesh vertices
    mesh_vertices = mesh.vertices
    vertex_voxel_coords = ((mesh_vertices - origin) / pitch_val).astype(int)
    vertex_voxel_coords[:, 0] = np.clip(vertex_voxel_coords[:, 0], 0, shape[0] - 1)
    vertex_voxel_coords[:, 1] = np.clip(vertex_voxel_coords[:, 1], 0, shape[1] - 1)
    vertex_voxel_coords[:, 2] = np.clip(vertex_voxel_coords[:, 2], 0, shape[2] - 1)
    
    vertex_fill_times = fill_times[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
    vertex_fill_times[np.isinf(vertex_fill_times)] = -1.0
    
    return real_weld_lines, vertex_fill_times.tolist()

def calculate_weld_lines_with_cooling(cooling_grid, data):
    mesh = cooling_grid["mesh"]
    voxel_grid = cooling_grid["voxel_grid"]
    metadata = cooling_grid["metadata"]
    T_final = cooling_grid["T_final"]
    
    melt_temp = float(data.get("melt_temp", data.get("meltTemp", 240.0)))
    coolant_temp_raw = data.get("coolant_temp") or data.get("coolantTemp")
    coolant_temp = float(coolant_temp_raw) if coolant_temp_raw is not None else 25.0
    
    return _run_flow_solver(
        mesh, voxel_grid, metadata, data, 
        temperature_grid=T_final, 
        melt_temp=melt_temp, 
        coolant_temp=coolant_temp
    )

def calculate_weld_lines_geometric_only(data):
    mesh, voxel_grid, metadata = get_or_create_voxel_grid(data)
    return _run_flow_solver(mesh, voxel_grid, metadata, data)

# Keep simple fallback compatibility
def calculate_weld_lines(gate_speeds):
    mesh, voxel_grid, metadata = get_or_create_voxel_grid({})
    weld_lines, _ = _run_flow_solver(mesh, voxel_grid, metadata, {"gateSpeeds": gate_speeds})
    return weld_lines
