/**
 * app-connector.js
 * Debounces UI inputs, posts parameters to Flask backend, and maps float arrays back to Three.js vertex color buffers.
 */

const AppConnector = (() => {
  let debounceTimeout = null;

  /**
   * Debounces any parameter changes and triggers simulation request.
   */
  function handleParameterChange(params, threeMesh, colorMode = 'temperature') {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }
    
    debounceTimeout = setTimeout(async () => {
      console.log("[AppConnector] Triggering simulation with updated parameters:", params);
      try {
        const results = await runSimulation(params);
        if (results && results.status === 'success') {
          updateThreeMeshColors(threeMesh, results, colorMode);
        } else {
          console.error("[AppConnector] Simulation failed:", results ? results.message : "No response");
        }
      } catch (err) {
        console.error("[AppConnector] Error posting simulation:", err);
      }
    }, 300); // 300ms debounce
  }

  /**
   * Posts parameters to Flask backend.
   */
  async function runSimulation(params) {
    // Check if we can extract local path from cached file.
    // If not, you can convert your STL array buffer to a base64 string.
    const payload = {
      stl_path: params.stlPath || null,
      stl_data: params.stlData || null, // Base64 encoding of STL bytes if offline path not available
      gates: params.gates || [],
      resolution: params.resolution || 0.5,
      melt_temp: params.meltTemp || 240.0,
      eject_temp: params.ejectTemp || 80.0,
      coolant_temp: params.coolantTemp || 25.0,
      coolant_flow: params.coolantFlow || 10.0,
      pitch: params.pitch || 50.0,
      depth: params.depth || 20.0,
      diameter: params.diameter || 10.0
    };

    const response = await fetch('http://127.0.0.1:5000/api/simulate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Maps returned scalar float arrays directly to Three.js vertex colors.
   */
  function updateThreeMeshColors(threeMesh, simulationResults, colorMode) {
    if (!threeMesh || !threeMesh.geometry) return;
    
    const geometry = threeMesh.geometry;
    const positions = geometry.attributes.position;
    if (!positions) return;
    
    const vertexCount = positions.count;
    
    // Select result array based on colorMode
    let dataArray = [];
    let maxVal = 1.0;
    
    // 큰 배열에서 Math.max(...array)는 호출 스택을 초과하므로 루프로 안전하게 계산
    const safeMax = (arr, base) => {
      let m = base;
      for (let i = 0; i < arr.length; i++) { if (arr[i] > m) m = arr[i]; }
      return m;
    };

    if (colorMode === 'temperature') {
      dataArray = simulationResults.vertex_temperatures || [];
      maxVal = safeMax(dataArray, 1.0);
    } else if (colorMode === 'flow') {
      dataArray = simulationResults.vertex_fill_times || [];
      maxVal = safeMax(dataArray, 1.0);
    } else if (colorMode === 'sink') {
      dataArray = simulationResults.vertex_sink_risk || [];
      maxVal = 1.0; // Risk range is 0.0 to 1.0
    }
    
    if (dataArray.length === 0) return;
    
    // Fetch or create color attribute
    let colorAttr = geometry.attributes.color;
    if (!colorAttr) {
      const colors = new Float32Array(vertexCount * 3);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      colorAttr = geometry.attributes.color;
    }
    
    const colorArray = colorAttr.array;
    
    // Map values to RGB heatmaps
    // Standard Blue -> Cyan -> Green -> Yellow -> Red spectrum
    for (let i = 0; i < vertexCount; i++) {
      const val = dataArray[i] !== undefined ? dataArray[i] : 0.0;
      let r = 0, g = 0, b = 0;
      
      if (val === -1.0) {
        // Unfilled or out of calculation zone (render as light gray)
        r = 0.9; g = 0.9; b = 0.9;
      } else {
        // Normalize value between 0 and 1
        const t = Math.max(0.0, Math.min(1.0, val / maxVal));
        
        if (t < 0.25) {
          // Blue to Cyan
          const s = t / 0.25;
          r = 0.0; g = s; b = 1.0;
        } else if (t < 0.5) {
          // Cyan to Green
          const s = (t - 0.25) / 0.25;
          r = 0.0; g = 1.0; b = 1.0 - s;
        } else if (t < 0.75) {
          // Green to Yellow
          const s = (t - 0.5) / 0.25;
          r = s; g = 1.0; b = 0.0;
        } else {
          // Yellow to Red
          const s = (t - 0.75) / 0.25;
          r = 1.0; g = 1.0 - s; b = 0.0;
        }
      }
      
      colorArray[i * 3] = r;
      colorArray[i * 3 + 1] = g;
      colorArray[i * 3 + 2] = b;
    }
    
    // Notify Three.js to re-upload the modified color buffer to the GPU
    colorAttr.needsUpdate = true;
    
    // If material doesn't use vertexColors, force enable it
    if (threeMesh.material) {
      threeMesh.material.vertexColors = true;
      threeMesh.material.needsUpdate = true;
    }
    
    console.log(`[AppConnector] Successfully mapped ${colorMode} heatmap onto Three.js geometry.`);
  }

  return { handleParameterChange, runSimulation };
})();
