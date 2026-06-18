import numpy as np
import heapq

def solve_injection_flow(voxel_grid, gates, flow_resistance=1.0, temperature_grid=None, melt_temp=240.0, coolant_temp=25.0):
    """
    Simulates injection molding wavefront propagation using a priority queue (Fast Marching style).
    
    :param voxel_grid: 3D numpy boolean array (True = cavity, False = solid)
    :param gates: List of gate dictionaries. Example:
        {
            "id": 1,
            "coord": (10, 20, 5),
            "speed_factor": 1.0,
            "pressure_factor": 1.0,
            "time_delay": 0.0,
            "trigger_voxel": None  # or (x, y, z) tuple
        }
    :param flow_resistance: Base resistance factor of the resin.
    :param temperature_grid: Optional 3D numpy float array of temperatures
    :param melt_temp: Melt temperature
    :param coolant_temp: Coolant temperature
    
    :return: 
        fill_times: 3D numpy array of fill times (np.inf for unfilled)
        weld_lines: List of coordinate tuples where independent fronts met
        gate_sources: 3D numpy array indicating which gate filled each voxel
    """
    shape = voxel_grid.shape
    fill_times = np.full(shape, np.inf)
    gate_sources = np.full(shape, -1, dtype=int)  # Tracks which gate filled the voxel
    
    # Priority queue stores tuples: (fill_time, x, y, z, gate_id)
    pq = []
    
    # Track gates waiting for a flow front trigger
    triggered_gates = []
    
    # Initialize gates
    for gate in gates:
        coord = gate["coord"]
        if not voxel_grid[coord]:
            continue # Gate is not in cavity
            
        if gate.get("trigger_voxel"):
            triggered_gates.append(gate)
        else:
            time_delay = gate.get("time_delay", 0.0)
            heapq.heappush(pq, (time_delay, coord[0], coord[1], coord[2], gate["id"]))
            fill_times[coord] = time_delay
            gate_sources[coord] = gate["id"]
            
    # Gate property lookup for fast access
    gate_props = {g["id"]: {"speed": g["speed_factor"], "pressure": g["pressure_factor"]} for g in gates}
    
    # 6-way connectivity neighbors (3D)
    neighbors = [(-1,0,0), (1,0,0), (0,-1,0), (0,1,0), (0,0,-1), (0,0,1)]
    
    weld_lines = []
    
    # Wavefront propagation
    while pq:
        current_time, x, y, z, gate_id = heapq.heappop(pq)
        
        # Check if this voxel just triggered any waiting valve gates
        for tg in list(triggered_gates):
            if tg["trigger_voxel"] == (x, y, z):
                tg_coord = tg["coord"]
                heapq.heappush(pq, (current_time, tg_coord[0], tg_coord[1], tg_coord[2], tg["id"]))
                fill_times[tg_coord] = current_time
                gate_sources[tg_coord] = tg["id"]
                triggered_gates.remove(tg)
                
        props = gate_props[gate_id]
        speed_factor = max(props["speed"], 0.01)       # Prevent division by zero
        pressure_factor = max(props["pressure"], 0.01)
        
        for dx, dy, dz in neighbors:
            nx, ny, nz = x + dx, y + dy, z + dz
            
            # Boundary check
            if 0 <= nx < shape[0] and 0 <= ny < shape[1] and 0 <= nz < shape[2]:
                if not voxel_grid[nx, ny, nz]:
                    continue # Solid mold, cannot flow here
                
                # Temperature-dependent localized viscosity / flow resistance
                local_res = flow_resistance
                if temperature_grid is not None:
                    local_temp = temperature_grid[nx, ny, nz]
                    temp_diff = melt_temp - local_temp
                    temp_range = max(10.0, melt_temp - coolant_temp)
                    # Exponential increase in viscosity as temperature drops
                    visc_factor = np.exp(2.5 * temp_diff / temp_range)
                    local_res = flow_resistance * visc_factor
                
                # Calculate time required to fill a neighboring voxel
                dt = local_res / (speed_factor * pressure_factor)
                neighbor_time = current_time + dt
                
                # If neighbor is already filled by a different gate, check for weld line
                if fill_times[nx, ny, nz] <= current_time:
                    if gate_sources[nx, ny, nz] != gate_id and gate_sources[nx, ny, nz] != -1:
                        # Fronts from two different gates meet. 
                        weld_lines.append((nx, ny, nz))
                    continue
                
                # If we found a faster route to an unfilled (or slower filled) voxel
                if neighbor_time < fill_times[nx, ny, nz]:
                    fill_times[nx, ny, nz] = neighbor_time
                    gate_sources[nx, ny, nz] = gate_id
                    heapq.heappush(pq, (neighbor_time, nx, ny, nz, gate_id))
                    
    # Deduplicate weld lines
    weld_lines = list(set(weld_lines))
    
    return fill_times, weld_lines, gate_sources
