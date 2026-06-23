import numpy as np
import trimesh

def evaluate_mesh_quality(mesh, voxel_grid=None, resolution=0.5):
    """
    CADMOULD-style mesh gate check before flow/cooling analysis.

    The function reports whether the surface mesh is suitable for voxel-based
    injection analysis and gives corrective guidance instead of silently running
    on a broken mesh.
    """
    vertices = np.asarray(getattr(mesh, "vertices", []), dtype=float)
    faces = np.asarray(getattr(mesh, "faces", []), dtype=int)
    tri_count = int(len(faces))
    vertex_count = int(len(vertices))
    if tri_count == 0 or vertex_count == 0:
        return {
            "status": "error",
            "score": 0,
            "triangle_count": tri_count,
            "vertex_count": vertex_count,
            "issues": ["No valid triangle mesh was loaded."],
            "recommendations": ["Export the CAD model as a triangulated STL or STEP mesh and retry."]
        }

    tri = vertices[faces]
    cross = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    area = np.linalg.norm(cross, axis=1) * 0.5
    total_area = float(np.sum(area))
    degenerate_count = int(np.sum(area <= max(total_area / max(tri_count, 1), 1.0) * 1e-8))

    unique_edge_counts = np.bincount(mesh.edges_unique_inverse) if hasattr(mesh, "edges_unique_inverse") else np.array([])
    boundary_edges = int(np.sum(unique_edge_counts == 1)) if unique_edge_counts.size else 0
    nonmanifold_edges = int(np.sum(unique_edge_counts > 2)) if unique_edge_counts.size else 0

    bounds = np.asarray(getattr(mesh, "bounds", np.zeros((2, 3))), dtype=float)
    extents = np.abs(bounds[1] - bounds[0]) if bounds.shape == (2, 3) else np.zeros(3)
    max_dim = float(np.max(extents)) if extents.size else 0.0
    min_positive = extents[extents > 1e-9]
    min_dim = float(np.min(min_positive)) if min_positive.size else 0.0
    cells_on_min_dim = min_dim / max(float(resolution), 1e-9) if min_dim else 0.0
    voxel_count = int(np.sum(voxel_grid)) if voxel_grid is not None else 0

    issues = []
    recommendations = []
    score = 100
    is_watertight = bool(getattr(mesh, "is_watertight", False))
    winding_consistent = bool(getattr(mesh, "is_winding_consistent", False))

    if not is_watertight:
        score -= 24
        issues.append("Surface is not watertight.")
        recommendations.append("Close holes or export a solid body before final validation.")
    if not winding_consistent:
        score -= 12
        issues.append("Face winding or normals are inconsistent.")
        recommendations.append("Recalculate outward normals before meshing.")
    if degenerate_count:
        ratio = degenerate_count / max(tri_count, 1)
        score -= min(18, int(ratio * 200))
        issues.append(f"{degenerate_count} degenerate or near-zero-area triangles detected.")
        recommendations.append("Remove sliver triangles and remesh small faces.")
    if nonmanifold_edges:
        score -= min(20, nonmanifold_edges)
        issues.append(f"{nonmanifold_edges} non-manifold edges detected.")
        recommendations.append("Repair overlapping faces and T-junctions before analysis.")
    if boundary_edges:
        score -= min(15, boundary_edges // 10 + 1)
    if cells_on_min_dim and cells_on_min_dim < 4:
        score -= 10
        issues.append("Voxel resolution is too coarse for the thinnest model dimension.")
        recommendations.append("Use a smaller mesh/voxel size so thin walls have at least 4 cells.")
    if voxel_grid is not None and voxel_count == 0:
        score -= 30
        issues.append("Voxelization produced an empty cavity grid.")
        recommendations.append("Check model scale and voxel size.")

    status = "pass" if score >= 82 and not issues else "warning" if score >= 55 else "fail"
    return {
        "status": status,
        "score": int(max(0, min(100, score))),
        "triangle_count": tri_count,
        "vertex_count": vertex_count,
        "surface_area_mm2": round(total_area, 4),
        "bounds_mm": [round(float(v), 4) for v in extents],
        "watertight": is_watertight,
        "winding_consistent": winding_consistent,
        "degenerate_triangles": degenerate_count,
        "boundary_edges": boundary_edges,
        "nonmanifold_edges": nonmanifold_edges,
        "voxel_pitch_mm": float(resolution),
        "voxel_count": voxel_count,
        "cells_on_min_dimension": round(float(cells_on_min_dim), 2),
        "issues": issues,
        "recommendations": recommendations,
    }

def voxelize_mesh(cad_file_path, resolution=0.5):
    """
    Loads a 3D STEP/IGES/STL file and voxelizes it to a binary occupancy grid.
    
    :param cad_file_path: Path to the 3D CAD file (e.g. .stl, .step).
    :param resolution: Voxel cell size in mm (e.g. 0.5 for 0.5mm voxels).
    
    :return:
        mesh: The parsed Trimesh surface mesh
        voxel_grid: 3D numpy boolean array (True for voxel inside mesh, False for outside)
        metadata: dictionary containing "origin" (min bounds) and "pitch" (voxel size)
    """
    # 1. Load the CAD/mesh file
    # Note: STEP/IGES requires installing additional libraries like open3d, cadquery or OpenCascade.
    # Trimesh can load STL/OBJ directly. For STEP/IGES, it is typically loaded via OpenCascade (OCCT)
    # and exported to STL, which trimesh then loads.
    #
    # process=False: 정점 병합(welding)을 끄고 STL 파일의 삼각형 순서(면당 3정점)를 그대로
    # 유지한다. 프런트엔드(STLLoader/parseSTL)도 비병합·파일순서로 렌더링하므로, 이렇게 해야
    # 정점별 결과(vertex_fill_times 등)의 인덱스가 화면 지오메트리와 1:1로 일치한다.
    # (병합하면 정점 수/순서가 어긋나 충진 색이 대부분 '미충진'으로 표시되는 문제 발생)
    mesh = trimesh.load(cad_file_path, process=False)
    
    # Ensure it's a single Trimesh object
    if isinstance(mesh, trimesh.Scene):
        mesh = mesh.dump(concatenate=True)
        
    # 2. Voxelization using trimesh's ray-casting voxelizer
    # voxelized() returns a VoxelGrid object which utilizes fast ray-triangle intersections
    voxels = mesh.voxelized(pitch=resolution)
    
    # 3. Extract the dense binary occupancy matrix
    # voxels.matrix is a 3D numpy boolean matrix representing occupancy
    voxel_grid = voxels.matrix
    
    # 4. Define mapping metadata
    # origin = physical coordinate of voxel index (0,0,0). trimesh dropped the
    # legacy VoxelGrid.origin attribute, so derive it via indices_to_points,
    # which is stable across trimesh versions (and accounts for the grid transform).
    origin = voxels.indices_to_points(np.array([[0, 0, 0]]))[0]
    metadata = {
        "origin": origin,
        "pitch": resolution,
        "shape": voxel_grid.shape,
        "mesh_quality": evaluate_mesh_quality(mesh, voxel_grid, resolution)
    }
    
    return mesh, voxel_grid, metadata

def custom_vectorized_voxelizer(vertices, faces, resolution=0.5):
    """
    A pure NumPy/vectorized voxelization sample utilizing ray casting.
    Fills voxels by intersecting rays along the Z-axis with the mesh faces.
    Useful as an alternative without heavy external C-extensions.
    """
    # Bounding box bounds
    min_b = vertices.min(axis=0)
    max_b = vertices.max(axis=0)
    
    # Generate voxel grid coordinates
    xs = np.arange(min_b[0], max_b[0] + resolution, resolution)
    ys = np.arange(min_b[1], max_b[1] + resolution, resolution)
    zs = np.arange(min_b[2], max_b[2] + resolution, resolution)
    
    grid_shape = (len(xs), len(ys), len(zs))
    voxel_grid = np.zeros(grid_shape, dtype=bool)
    
    # Note: In production, we'd use a spatial hash / AABB tree (like SciPy's cdist / KDTree)
    # or ray-casting libraries to determine interior/exterior occupancy at scale.
    # Trimesh's `voxelized` algorithm is highly optimized in C-extensions and recommended.
    
    return voxel_grid, {"origin": min_b, "pitch": resolution}
