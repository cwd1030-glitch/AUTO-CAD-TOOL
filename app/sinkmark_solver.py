import os
import sys
import numpy as np

# Add python_backend to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'python_backend'))

from cooling_solver import calculate_warpage_and_sink
import flow_solver

def _map_risk_to_vertices(mesh, voxel_grid, metadata, sink_risk):
    origin = np.array(metadata["origin"])
    pitch_val = metadata["pitch"]
    shape = voxel_grid.shape
    
    mesh_vertices = mesh.vertices
    vertex_voxel_coords = ((mesh_vertices - origin) / pitch_val).astype(int)
    vertex_voxel_coords[:, 0] = np.clip(vertex_voxel_coords[:, 0], 0, shape[0] - 1)
    vertex_voxel_coords[:, 1] = np.clip(vertex_voxel_coords[:, 1], 0, shape[1] - 1)
    vertex_voxel_coords[:, 2] = np.clip(vertex_voxel_coords[:, 2], 0, shape[2] - 1)
    
    vertex_sink_risk = sink_risk[vertex_voxel_coords[:, 0], vertex_voxel_coords[:, 1], vertex_voxel_coords[:, 2]]
    return vertex_sink_risk.tolist()

def calculate_sinkmarks_with_thermal(cooling_grid, data):
    mesh = cooling_grid["mesh"]
    voxel_grid = cooling_grid["voxel_grid"]
    metadata = cooling_grid["metadata"]
    T_final = cooling_grid["T_final"]
    solidification_time = cooling_grid["solidification_time"]
    
    displacements, sink_risk = calculate_warpage_and_sink(
        voxel_grid, T_final, solidification_time, parting_axis=2
    )
    return _map_risk_to_vertices(mesh, voxel_grid, metadata, sink_risk)

def calculate_sinkmarks_geometric_only(data):
    mesh, voxel_grid, metadata = flow_solver.get_or_create_voxel_grid(data)
    shape = voxel_grid.shape
    
    # Use dummy uniform T_final and solidification_time to run purely geometric thickness estimation
    T_final = np.full(shape, 50.0)
    solidification_time = np.full(shape, 10.0)
    
    displacements, sink_risk = calculate_warpage_and_sink(
        voxel_grid, T_final, solidification_time, parting_axis=2
    )
    return _map_risk_to_vertices(mesh, voxel_grid, metadata, sink_risk)
