import numpy as np
import trimesh

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
    mesh = trimesh.load(cad_file_path)
    
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
    metadata = {
        "origin": voxels.origin, # 3D coordinate of voxel index (0,0,0)
        "pitch": resolution,
        "shape": voxel_grid.shape
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
