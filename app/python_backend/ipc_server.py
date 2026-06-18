import socket
import json
import argparse
import sys
import threading
from voxelizer import voxelize_mesh
from solver import solve_injection_flow

def handle_client(conn, addr):
    print(f"[Python Engine] Connected by {addr}")
    buffer = ""
    try:
        while True:
            data = conn.recv(4096).decode('utf-8')
            if not data:
                break
            buffer += data
            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                if not line.strip():
                    continue
                
                request = json.loads(line)
                response = process_request(request)
                
                # Send JSON-RPC response back terminated by newline
                conn.sendall((json.dumps(response) + "\n").encode('utf-8'))
    except Exception as e:
        print(f"[Python Engine] Error: {e}")
    finally:
        conn.close()

def process_request(request):
    cmd = request.get("command")
    if cmd == "solve":
        # Example command args
        step_path = request.get("step_path")
        gates = request.get("gates", [])
        resolution = request.get("resolution", 0.5) # mm
        
        # 1. Load, mesh and voxelize
        # Note: In production, mesh vertices are retrieved to map results back to them.
        mesh, voxel_grid, grid_metadata = voxelize_mesh(step_path, resolution)
        
        # 2. Run Flow Solver
        fill_times, weld_lines, gate_sources = solve_injection_flow(voxel_grid, gates)
        
        # 3. Map Voxel grid results back to Surface Mesh Vertices (for low-weight C# rendering)
        # Convert voxel coordinate back to nearest mesh vertex index
        mesh_vertices = mesh.vertices
        origin = grid_metadata["origin"]
        pitch = grid_metadata["pitch"]
        
        # Vectorized mapping: mapping mesh vertices to voxel index coordinates
        voxel_coords = ((mesh_vertices - origin) / pitch).astype(int)
        
        # Ensure inside voxel bounds
        shape = voxel_grid.shape
        voxel_coords[:, 0] = np.clip(voxel_coords[:, 0], 0, shape[0] - 1)
        voxel_coords[:, 1] = np.clip(voxel_coords[:, 1], 0, shape[1] - 1)
        voxel_coords[:, 2] = np.clip(voxel_coords[:, 2], 0, shape[2] - 1)
        
        # Map values
        vertex_fill_times = fill_times[voxel_coords[:, 0], voxel_coords[:, 1], voxel_coords[:, 2]]
        # Replace inf with -1.0 for JSON compatibility
        vertex_fill_times[np.isinf(vertex_fill_times)] = -1.0
        
        # Construct lightweight response matching vertex indices
        response = {
            "status": "success",
            "vertex_fill_times": vertex_fill_times.tolist(),
            "weld_lines": weld_lines, # Voxel coords of weldlines
            "mesh_vertices": mesh_vertices.tolist(), # Return surface mesh to render
            "mesh_faces": mesh.faces.tolist()
        }
        return response
    else:
        return {"status": "error", "message": "Unknown command"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=65432)
    args = parser.parse_args()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", args.port))
    server.listen(5)
    print(f"[Python Engine] Server listening on 127.0.0.1:{args.port}")
    
    try:
        while True:
            conn, addr = server.accept()
            client_thread = threading.Thread(target=handle_client, args=(conn, addr))
            client_thread.daemon = True
            client_thread.start()
    except KeyboardInterrupt:
        print("[Python Engine] Server shutting down.")
    finally:
        server.close()

if __name__ == "__main__":
    import numpy as np # Import numpy inside main thread wrapper or module scope
    main()
