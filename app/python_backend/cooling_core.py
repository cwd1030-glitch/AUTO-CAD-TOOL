import numpy as np

def solve_mold_cooling(
    voxel_grid,
    coolant_temp=25.0,
    coolant_flow=10.0,  # L/min
    pitch=50.0,         # mm
    depth=20.0,         # mm (H: depth from part surface)
    diameter=10.0,      # mm (D: channel diameter)
    resolution=0.5,     # mm
    melt_temp=240.0,
    eject_temp=80.0
):
    """
    Solves 3D transient heat conduction in the mold incorporating:
    - Kinematic viscosity, Reynolds number, Prandtl number, and Dittus-Boelter equations for h.
    - Convective boundary updates matching analytical thermal resistance R_therm = H/k_steel + 1/h.
    """
    shape = voxel_grid.shape

    # Guard against zero/negative physical inputs that would cause division
    # by zero (NaN/Inf propagating into the temperature field and the JSON
    # response). Clamp to small positive minimums instead of crashing.
    resolution = max(float(resolution), 1e-3)
    depth = max(float(depth), 1e-3)
    diameter = max(float(diameter), 1e-3)
    coolant_flow = max(float(coolant_flow), 1e-6)

    dx = resolution * 1e-3  # mm to meters
    H = depth * 1e-3        # mm to meters
    D = diameter * 1e-3     # mm to meters

    # 1. Coolant physical properties (Water at 25°C)
    nu = 8.94e-7      # Kinematic viscosity (m²/s)
    Pr = 6.1          # Prandtl number
    k_f = 0.607       # Coolant thermal conductivity W/(m·K)

    # Flow rate conversion: L/min to m³/s
    Q = (coolant_flow * 1e-3) / 60.0
    # Coolant velocity inside channel
    u = (4.0 * Q) / (np.pi * D**2)

    # Reynolds Number
    Re = (u * D) / nu

    # Nusselt Number calculation via Dittus-Boelter
    if Re > 4000:
        # Turbulent flow (heating of coolant / cooling of mold -> n = 0.4)
        Nu = 0.023 * (Re ** 0.8) * (Pr ** 0.4)
    else:
        # Laminar flow fallback
        Nu = 4.36

    # Convective Heat Transfer Coefficient (h)
    h = (Nu * k_f) / D

    # 2. Mold and Polymer properties
    k_p = 0.20        # Polymer conductivity W/(m·K)
    rho_p = 1000.0    # Polymer density kg/m³
    cp_p = 2000.0     # Polymer heat capacity J/(kg·K)

    k_s = 29.0        # P20 Steel conductivity W/(m·K)
    rho_s = 7800.0    # Steel density kg/m³
    cp_s = 460.0      # Steel heat capacity J/(kg·K)

    # Grid initialization
    k_grid = np.full(shape, k_s)
    k_grid[voxel_grid] = k_p

    rho_grid = np.full(shape, rho_s)
    rho_grid[voxel_grid] = rho_p

    cp_grid = np.full(shape, cp_s)
    cp_grid[voxel_grid] = cp_p

    # 3. Virtual Cooling Channels Mask
    pitch_voxels = int(pitch / resolution)
    depth_voxels = int(depth / resolution)
    radius_voxels = int((diameter / 2) / resolution)

    cooling_mask = np.zeros(shape, dtype=bool)
    part_z_indices = np.where(voxel_grid)[2]
    if len(part_z_indices) > 0:
        base_z = max(0, np.min(part_z_indices) - depth_voxels)
        for x in range(radius_voxels, shape[0] - radius_voxels, max(1, pitch_voxels)):
            for y in range(shape[1]):
                for z in range(max(0, base_z - radius_voxels), min(shape[2], base_z + radius_voxels + 1)):
                    if (x - x)**2 + (z - base_z)**2 <= radius_voxels**2:
                        if 0 <= x < shape[0] and not voxel_grid[x, y, z]:
                            cooling_mask[x, y, z] = True

    # 4. Thermal Resistance and Effective Boundary Transmittance (U_eff)
    # R_therm = H/k_steel + 1/h
    R_therm = (H / k_s) + (1.0 / h)
    U_eff = 1.0 / R_therm

    # Initial Temperature setup
    T = np.full(shape, 50.0)
    T[voxel_grid] = melt_temp
    T[cooling_mask] = coolant_temp

    # Explicit stability: dt <= dx^2 / (6 * alpha)
    alpha_max = max(k_s / (rho_s * cp_s), k_p / (rho_p * cp_p))
    dt = 0.9 * (dx ** 2) / (6.0 * alpha_max)

    total_time = 0.0
    max_steps = 1500
    cycle_time = 0.0
    cooling_rates = np.zeros(shape)
    solidification_time = np.zeros(shape)

    # 5. Conduction explicit Euler iteration
    for step in range(max_steps):
        T_prev = T.copy()
        dT_dt = np.zeros(shape)

        # Conduction fluxes
        flux_x = k_grid[1:, :, :] * (T_prev[1:, :, :] - T_prev[:-1, :, :])
        flux_y = k_grid[:, 1:, :] * (T_prev[:, 1:, :] - T_prev[:, :-1, :])
        flux_z = k_grid[:, :, 1:] * (T_prev[:, :, 1:] - T_prev[:, :, :-1])

        dT_dt[1:-1, :, :] += (flux_x[1:, :, :] - flux_x[:-1, :, :]) / (rho_grid[1:-1, :, :] * cp_grid[1:-1, :, :] * dx**2)
        dT_dt[:, 1:-1, :] += (flux_y[:, 1:, :] - flux_y[:, :-1, :]) / (rho_grid[:, 1:-1, :] * cp_grid[:, 1:-1, :] * dx**2)
        dT_dt[:, :, 1:-1] += (flux_z[:, :, 1:] - flux_z[:, :, :-1]) / (rho_grid[:, :, 1:-1] * cp_grid[:, :, 1:-1] * dx**2)

        # Convective Heat Sink update at cooling channel boundary voxels
        # For steel voxels adjacent to coolant, we apply Newton's Law of Cooling scaled by U_eff
        # q = U_eff * (T_coolant - T)
        # dT/dt_conv = U_eff * (T_coolant - T) * Area / (rho * Cp * Volume) = U_eff * (T_cool - T) / (rho * Cp * dx)
        adj_cool_term = U_eff * (coolant_temp - T_prev[cooling_mask]) / (rho_grid[cooling_mask] * cp_grid[cooling_mask] * dx)
        dT_dt[cooling_mask] += adj_cool_term

        T += dt * dT_dt
        # Re-enforce coolant fixed core temperature inside channels
        T[cooling_mask] = coolant_temp

        total_time += dt

        # Mark solidification
        part_cooling = (voxel_grid) & (T_prev > eject_temp) & (T <= eject_temp)
        solidification_time[part_cooling] = total_time
        cooling_rates[part_cooling] = (melt_temp - eject_temp) / total_time

        if not np.any((voxel_grid) & (T > eject_temp)):
            cycle_time = total_time
            break

    if cycle_time == 0.0:
        cycle_time = total_time
        solidification_time[(voxel_grid) & (solidification_time == 0)] = total_time
        cooling_rates[(voxel_grid) & (cooling_rates == 0)] = (melt_temp - eject_temp) / total_time

    slowest = np.argsort(solidification_time[voxel_grid])[-20:]
    part_coords = np.argwhere(voxel_grid)
    hot_spots = [tuple(part_coords[idx]) for idx in slowest]

    return T, cooling_rates, cycle_time, hot_spots, solidification_time


def calculate_warpage_and_sink(voxel_grid, T_final, solidification_time, parting_axis=2):
    """
    Calculates differential shrinkage and residual warpage vectors.
    """
    shape = voxel_grid.shape
    displacement = np.zeros(shape + (3,))

    # CTE of typical polymer (PC/ABS ~ 6.0e-5 / K)
    alpha_th = 6.0e-5
    T_room = 25.0

    # Track part boundaries
    part_indices = np.argwhere(voxel_grid)
    if len(part_indices) == 0:
        return displacement, np.zeros(shape)

    # Geometric Center of Mass
    center = np.mean(part_indices, axis=0)

    # Calculate differential shrinkage delta T across part thickness
    for x in range(shape[0]):
        for y in range(shape[1]):
            # Get part voxel indices along Z (parting_axis)
            z_indices = np.where(voxel_grid[x, y, :])[0] if parting_axis == 2 else \
                        np.where(voxel_grid[:, y, x])[0] if parting_axis == 1 else \
                        np.where(voxel_grid[:, x, y])[0]

            if len(z_indices) < 2:
                continue

            mid = len(z_indices) // 2
            cavity_indices = z_indices[:mid]
            core_indices = z_indices[mid:]

            # Temperatures on cavity and core sides
            T_cavity = np.mean(T_final[x, y, cavity_indices])
            T_core = np.mean(T_final[x, y, core_indices])

            # Temperature delta and mean temperature
            dT = T_cavity - T_core
            T_mean = (T_cavity + T_core) / 2.0

            # Local part thickness in meters
            thickness = len(z_indices) * 0.5 * 1e-3

            # Bending curvature: kappa = alpha_th * dT / thickness
            kappa = (alpha_th * dT) / max(thickness, 1e-4)

            # Thermal displacement calculations:
            # Out-of-plane bending: u_z = 0.5 * kappa * (r_xy^2)
            # In-plane shrinkage: u_x = alpha_th * (T_mean - T_room) * dx
            for z_idx in z_indices:
                dx_from_center = (x - center[0]) * 0.5 * 1e-3
                dy_from_center = (y - center[1]) * 0.5 * 1e-3
                r_sq = dx_from_center**2 + dy_from_center**2

                # Z Bending displacement
                displacement[x, y, z_idx, 2] = 0.5 * kappa * r_sq * 1000.0 # converted back to mm
                # Radial in-plane contraction
                displacement[x, y, z_idx, 0] = alpha_th * (T_mean - T_room) * dx_from_center * 1000.0
                displacement[x, y, z_idx, 1] = alpha_th * (T_mean - T_room) * dy_from_center * 1000.0

    # Sink Mark index
    sink_risk = np.zeros(shape)
    # Guard against an all-zero solidification field (e.g. geometric-only mode
    # with no thermal data) which would make this a 0/0 division producing NaN.
    max_solid_time = float(np.max(solidification_time))
    if max_solid_time <= 0.0:
        max_solid_time = 1.0
    for x in range(1, shape[0]-1):
        for y in range(1, shape[1]-1):
            for z in range(1, shape[2]-1):
                if voxel_grid[x, y, z]:
                    local_thickness = np.sum(voxel_grid[x-1:x+2, y-1:y+2, z-1:z+2])
                    risk = (local_thickness / 27.0) * (solidification_time[x, y, z] / max_solid_time)
                    sink_risk[x, y, z] = np.clip(risk, 0.0, 1.0)

    return displacement, sink_risk
