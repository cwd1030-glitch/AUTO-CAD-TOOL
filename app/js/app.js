// app.js (슬라이더 조작 시 자동으로 파이썬과 연동하는 핵심 자바스크립트)

let updateTimer;

// 화면의 모든 슬라이더와 냉각 온/오프 스위치에 '자동 업데이트 이벤트' 연결
function setupAutoUpdate() {
    // Select elements supporting both classes/IDs and standard slide inputs
    const inputs = document.querySelectorAll('.injection-slider, .cooling-toggle, input[type="range"], input[type="checkbox"]');
    
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            // 사용자가 슬라이더를 움직이는 중에는 계산을 잠시 대기하고,
            clearTimeout(updateTimer);
            
            // 슬라이더 조작을 멈추고 0.3초(300ms)가 지나면 자동으로 파이썬에 데이터 전송!
            updateTimer = setTimeout(() => {
                autoRunPythonSimulation();
            }, 300);
        });
    });
}

// 실제로 파이썬에게 데이터를 던지고 화면을 자동으로 업데이트하는 함수
async function autoRunPythonSimulation() {
    // Gracefully resolve toggle and input elements supporting multiple potential IDs
    const coolingToggleEl = document.getElementById('cooling_toggle') || 
                            document.getElementById('cooling_on_off_toggle') || 
                            document.getElementById('btn-cooling-overlay') || 
                            document.getElementById('tree-chk-solid'); // fallback
                            
    const isCoolingOn = coolingToggleEl ? (coolingToggleEl.checked || coolingToggleEl.classList.contains('active')) : false;
    
    const meltTempEl = document.getElementById('melt_temp') || document.getElementById('slide-melt-temp');
    const coolantTempEl = document.getElementById('coolant_temp') || document.getElementById('slide-mold-temp');
    const gate1SpeedEl = document.getElementById('gate1_speed') || { value: 100 };
    const gate2SpeedEl = document.getElementById('gate2_speed') || { value: 100 };

    const currentParams = {
        cooling_enabled: isCoolingOn,
        melt_temp: meltTempEl ? parseFloat(meltTempEl.value) : 230.0,
        coolant_temp: isCoolingOn ? (coolantTempEl ? parseFloat(coolantTempEl.value) : 25.0) : 25.0,
        gate1_speed: gate1SpeedEl ? parseFloat(gate1SpeedEl.value) : 100.0,
        gate2_speed: gate2SpeedEl ? parseFloat(gate2SpeedEl.value) : 100.0,
        gateSpeeds: [
            gate1SpeedEl ? parseFloat(gate1SpeedEl.value) : 100.0,
            gate2SpeedEl ? parseFloat(gate2SpeedEl.value) : 100.0
        ]
    };

    // If STL analyzer has a parsed model, we append its STL data or path to the payload
    if (window.App && window.App.stl && window.App.stl.parsed) {
        if (window.App.stl.file) {
            const arrayBuffer = await window.App.stl.file.arrayBuffer();
            const base64Stl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1];
                    resolve(base64data);
                };
                reader.readAsDataURL(window.App.stl.file);
            });
            currentParams.stl_data = base64Stl;
        }
        
        if (window.STLAnalyzer && typeof window.STLAnalyzer.getGatePositions === 'function') {
            const gps = window.STLAnalyzer.getGatePositions();
            currentParams.gates = gps.map((gp, idx) => ({
                id: idx + 1,
                coord: [gp.x, gp.y, gp.z],
                speed_factor: currentParams.gateSpeeds[idx] !== undefined ? currentParams.gateSpeeds[idx] / 100.0 : 1.0
            }));
        }
    }

    try {
        console.log("[AutoSimulation] Triggering background Python analysis...", currentParams);
        // 백그라운드에서 돌고 있는 파이썬 서버로 자동 요청
        const response = await fetch('http://127.0.0.1:5000/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentParams)
        });
        
        const result = await response.json();
        
        // 파이썬이 계산해 준 결과로 Three.js 3D 화면 자동 업데이트!
        if (result.status === "success") {
            console.log("[AutoSimulation] Simulation completed successfully:", result);
            
            // Map parameters back into STLAnalyzer so the coloring actually updates!
            if (window.STLAnalyzer) {
                if (result.vertex_fill_times && typeof window.STLAnalyzer.setFlowDistances === 'function') {
                    window.STLAnalyzer.setFlowDistances(result.vertex_fill_times);
                    // calculate max flow distance
                    let maxD = 0;
                    result.vertex_fill_times.forEach(d => {
                        if (d !== -1.0 && d > maxD) maxD = d;
                    });
                    window.STLAnalyzer.setMaxFlowDistance(maxD);
                }
                if (result.sinkMarks && typeof window.STLAnalyzer.setVertexSinkRisk === 'function') {
                    window.STLAnalyzer.setVertexSinkRisk(result.sinkMarks);
                }
                if (result.vertexTemperatures && typeof window.STLAnalyzer.setVertexTemperatures === 'function') {
                    window.STLAnalyzer.setVertexTemperatures(result.vertexTemperatures);
                }
            }

            // 웰드라인 위치 자동 갱신
            updateWeldLinesOnMesh(result.weldLines);
            // 싱크마크 위험도 자동 갱신
            updateSinkMarkHazards(result.sinkMarks);
            
            // 냉각 스위치가 ON 일때만 냉각 채널과 열분포 히트맵 표시
            if (isCoolingOn) {
                applyThermalHeatmap(result.vertexTemperatures);
                renderCoolingChannels(result.coolingChannels);
            } else {
                clearCoolingGraphics(); // 냉각 탭 OFF 시 냉각 표시 자동 삭제
            }
            
            // Force redraw of geometry coloring
            if (window.STLAnalyzer && typeof window.STLAnalyzer.recolorGeometry === 'function') {
                window.STLAnalyzer.recolorGeometry();
            }
        }
    } catch (err) {
        console.error("자동 업데이트 연동 실패:", err);
    }
}

// Visualizers and wrappers to update the active Three.js mesh colors/overlays
function applyThermalHeatmap(vertexTemperatures) {
    if (window.STLAnalyzer && typeof window.STLAnalyzer.setVertexTemperatures === 'function') {
        window.STLAnalyzer.setVertexTemperatures(vertexTemperatures);
        if (typeof window.STLAnalyzer.toggleCoolingOverlay === 'function') {
            window.STLAnalyzer.toggleCoolingOverlay(true);
        } else {
            window.STLAnalyzer.recolorGeometry();
        }
    }
}

function updateWeldLinesOnMesh(weldLines) {
    console.log("[AutoSimulation] Displaying weld lines:", weldLines);
    // Draw or register weld lines in STL view
    if (window.STLAnalyzer && typeof window.STLAnalyzer.updateWeldLines === 'function') {
        window.STLAnalyzer.updateWeldLines(weldLines);
    }
}

function updateSinkMarkHazards(sinkMarks) {
    console.log("[AutoSimulation] Displaying sink marks:", sinkMarks);
    if (window.STLAnalyzer && typeof window.STLAnalyzer.setVertexTemperatures === 'function') {
        // We can reuse the heat map colors or toggle the sink overlay
        if (typeof window.STLAnalyzer.toggleSinkOverlay === 'function') {
            window.STLAnalyzer.toggleSinkOverlay(true);
        }
    }
}

// Temporary storage for cooling channel visual mesh objects in the Three.js scene
let coolingChannelObjects = [];

function renderCoolingChannels(coolingChannels) {
    clearCoolingGraphics();
    
    if (!coolingChannels || coolingChannels.length === 0) return;
    
    // Attempt to access Three.js scene from STLAnalyzer
    const canvasEl = document.getElementById('canvas-3d');
    if (!canvasEl) return;
    
    // We can inject channels by creating visual lines or pipes inside the scene
    if (window.STLAnalyzer && typeof window.STLAnalyzer.getCanvas === 'function') {
        // If STLAnalyzer exposes a custom channel drawing function, call it
        if (typeof window.STLAnalyzer.drawCoolingChannels === 'function') {
            window.STLAnalyzer.drawCoolingChannels(coolingChannels);
            return;
        }
    }
}

function clearCoolingGraphics() {
    // If STLAnalyzer has a clear function, call it
    if (window.STLAnalyzer && typeof window.STLAnalyzer.clearCoolingChannels === 'function') {
        window.STLAnalyzer.clearCoolingChannels();
    }
    
    if (window.STLAnalyzer && typeof window.STLAnalyzer.toggleCoolingOverlay === 'function') {
        window.STLAnalyzer.toggleCoolingOverlay(false);
    }
}

// 웹앱이 켜지면 자동 연동 감지 기능 시작
window.addEventListener('DOMContentLoaded', () => {
    setupAutoUpdate();
});
