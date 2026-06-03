/**
 * main.js
 * App orchestration — tab routing, file upload, results display, report
 */

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
const App = {
  currentTab: '2d',
  dxf: { file: null, parsed: null, result: null },
  stl: { file: null, parsed: null, result: null, material: 'ABS', pullAxis: 'Z', flipAxis: false, showCores: false, showParting: false, fillingTime: 2.0 },
  threeInit: false,
};

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function $(id) { return document.getElementById(id); }

function logToConsole(msg, type = 'system') {
  const box = $('console-logs-box');
  if (!box) return;
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `> [${new Date().toLocaleTimeString()}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

// Hook up console collapse/expand toggle & clear button
window.addEventListener('DOMContentLoaded', () => {
  const consoleEl = document.querySelector('.cad-message-console');
  const consoleHeader = document.querySelector('.console-header');
  const btnClearLog = $('btn-clear-console');

  if (consoleHeader && consoleEl) {
    consoleHeader.addEventListener('click', (e) => {
      // Don't toggle when clicking Clear
      if (e.target === btnClearLog || e.target.closest('.console-clear-btn')) return;
      consoleEl.classList.toggle('collapsed');
    });
  }
  if (btnClearLog) {
    btnClearLog.addEventListener('click', (e) => {
      e.stopPropagation();
      const box = $('console-logs-box');
      if (box) box.innerHTML = '';
    });
  }
  const btnCleanupCad = $('btn-cleanup-cad');
  if (btnCleanupCad) {
    btnCleanupCad.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        logToConsole('백그라운드 CAD 프로세스 정리를 시작합니다...', 'info');
        const res = await fetch('/cleanup-cad', { method: 'POST' });
        if (res.ok) {
          const txt = await res.text();
          logToConsole('리소스 강제 최적화 완료: ' + txt, 'success');
          showToast('백그라운드 CAD 프로세스가 정리되었습니다.', 'ok');
        } else {
          showToast('CAD 프로세스 정리 중 오류가 발생했습니다.', 'error');
        }
      } catch (err) {
        logToConsole('CAD 정리 실패: ' + err.message, 'error');
      }
    });
  }
});

function setStatus(state, text) {
  const dot  = $('status-dot');
  const span = $('status-text');
  dot.className = 'status-dot ' + state;
  span.textContent = text;
}

function showToast(msg, type = 'info') {
  const t = $('toast');
  const icons = { info: 'ℹ️', ok: '✅', error: '❌', warn: '⚠️' };
  t.textContent = (icons[type] || '') + ' ' + msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

function showLoading(text = '분석 중...') {
  $('loading-overlay').style.display = 'flex';
  $('loading-text').textContent = text;
  $('progress-bar').style.width = '0%';
}

function setProgress(pct) {
  $('progress-bar').style.width = pct + '%';
}

function hideLoading() {
  $('loading-overlay').style.display = 'none';
}

async function fakeProgress(steps) {
  for (const [pct, delay, text] of steps) {
    setProgress(pct);
    if (text) $('loading-text').textContent = text;
    await new Promise(r => setTimeout(r, delay));
  }
}

/* ══════════════════════════════════════
   TAB ROUTING
══════════════════════════════════════ */
document.querySelectorAll('.nav-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(id) {
  App.currentTab = id;
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'content-' + id));
  logToConsole(`CAD 작업공간 탭 변경: ${id.toUpperCase()}`, 'info');

  if (id === 'report') {
    buildReport();
  } else {
    setTimeout(triggerViewportResize, 50);
  }
}

/* ══════════════════════════════════════
   VIEWPORT RESIZING & SIDEBAR RESIZER
   ══════════════════════════════════════ */
function initSidebarResizer() {
  document.querySelectorAll('.workspace-layout').forEach(layout => {
    const leftPanel = layout.querySelector('.cad-model-tree-panel');
    const rightPanel = layout.querySelector('.cad-properties-panel');
    const leftResizer = layout.querySelector('.resizer-left');
    const rightResizer = layout.querySelector('.resizer-right');

    if (leftResizer && leftPanel) {
      initDrag(leftResizer, (deltaX) => {
        const currentWidth = leftPanel.offsetWidth;
        const newWidth = Math.max(180, Math.min(500, currentWidth + deltaX));
        leftPanel.style.width = newWidth + 'px';
        leftPanel.style.minWidth = newWidth + 'px';
        triggerViewportResize();
      });
    }

    if (rightResizer && rightPanel) {
      initDrag(rightResizer, (deltaX) => {
        const currentWidth = rightPanel.offsetWidth;
        const newWidth = Math.max(180, Math.min(500, currentWidth - deltaX));
        rightPanel.style.width = newWidth + 'px';
        rightPanel.style.minWidth = newWidth + 'px';
        triggerViewportResize();
      });
    }
  });
}

function initDrag(resizer, onDrag) {
  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizer.classList.add('dragging');
    let startX = e.clientX;

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      startX = moveEvent.clientX;
      onDrag(deltaX);
    };

    const onMouseUp = () => {
      resizer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

function triggerViewportResize() {
  if (App.currentTab === '2d') {
    if (App.dxf.parsed) {
      const canvas = $('canvas-2d');
      const wrap = canvas.parentElement;
      if (wrap) {
        const w = wrap.clientWidth;
        const h = wrap.clientHeight;
        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          DXFAnalyzer.initCanvas(canvas, App.dxf.parsed);
        }
      }
    }
  } else if (App.currentTab === '3d') {
    if (App.threeInit && typeof STLAnalyzer !== 'undefined' && typeof STLAnalyzer.resizeViewer === 'function') {
      STLAnalyzer.resizeViewer();
    }
  }
}

window.addEventListener('resize', () => {
  triggerViewportResize();
});

/* ══════════════════════════════════════
   2D MODULE

══════════════════════════════════════ */
const input2d = $('file-input-2d');

// Allow dragging files over the 2D viewport
window.addEventListener('DOMContentLoaded', () => {
  initSidebarResizer();

  const viewport2d = document.querySelector('#content-2d .cad-viewport-panel');
  if (viewport2d) {
    viewport2d.addEventListener('dragover',  e => { e.preventDefault(); viewport2d.classList.add('drag-over'); });
    viewport2d.addEventListener('dragleave', () => viewport2d.classList.remove('drag-over'));
    viewport2d.addEventListener('drop', e => {
      e.preventDefault();
      viewport2d.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) handle2DFile(f);
    });
  }

  const zone2d = $('upload-zone-2d');
  if (zone2d) {
    zone2d.style.cursor = 'pointer';
    zone2d.addEventListener('click', () => input2d.click());
  }
  const zone3d = $('upload-zone-3d');
  if (zone3d) {
    zone3d.style.cursor = 'pointer';
    zone3d.addEventListener('click', () => {
      const input3d = $('file-input-3d');
      if (input3d) input3d.click();
    });
  }
});

input2d.addEventListener('change', () => { if (input2d.files[0]) handle2DFile(input2d.files[0]); });

async function handle2DFile(file) {
  const nameLower = file.name.toLowerCase();
  if (!nameLower.endsWith('.dxf') && !nameLower.endsWith('.dwg')) {
    showToast('DXF 및 DWG 파일만 지원됩니다.', 'error'); return;
  }
  App.dxf.file = file;
  $('file-info-2d').style.display = 'block';
  $('file-info-2d').innerHTML = `📄 ${file.name}`;
  $('btn-analyze-2d').style.display = 'block';
  showToast(`${nameLower.endsWith('.dwg') ? 'DWG' : 'DXF'} 파일이 로드되었습니다.`, 'ok');
  logToConsole(`2D 도면 로드 완료: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, 'info');

  const isDwg = nameLower.endsWith('.dwg');
  showLoading(isDwg ? 'DWG 도면 디코딩 및 렌더링 중...' : 'DXF 도면 분석 및 렌더링 중...');
  setStatus('busy', '도면 로드 중');
  
  try {
    let text = "";
    if (isDwg) {
      // C# 백엔드 서버에 DWG 변환 요청 전송
      const buffer = await file.arrayBuffer();
      const response = await fetch('/convert-dwg', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: buffer
      });
      
      if (!response.ok) {
        const isMissing = response.headers.get('X-AutoCAD-Missing') === 'true';
        if (isMissing) {
          const runDemo = confirm(
            "로컬 PC에 AutoCAD가 설치되어 있지 않아 DWG 파일을 직접 해독할 수 없습니다.\n\n" +
            "원활한 테스트를 위해 가상 변환기(시뮬레이션 모드)를 실행하시겠습니까?\n" +
            "(승인 시 내장 샘플 도면으로 진행됩니다.)"
          );
          if (runDemo) {
            logToConsole('AutoCAD가 없어 가상 변환기(시뮬레이션 모드)를 실행합니다.', 'warn');
            const demoRes = await fetch('samples/sample_bracket.dxf');
            if (demoRes.ok) {
              text = await demoRes.text();
              logToConsole('가상 변환 성공. 샘플 브래킷 도면 데이터를 로드했습니다.', 'success');
            } else {
              throw new Error('샘플 도면 파일(samples/sample_bracket.dxf)을 로드할 수 없습니다.');
            }
          } else {
            throw new Error('AutoCAD 미설치로 인해 DWG 도면 변환 작업이 취소되었습니다.');
          }
        } else {
          const errMsg = await response.text();
          throw new Error(errMsg || 'DWG 변환 과정에서 서버 오류가 발생했습니다.');
        }
      } else {
        text = await response.text();
        logToConsole('DWG 도면 해독 성공. 뷰포트에 렌더링합니다.', 'success');
      }
    } else {
      text = await file.text();
    }

    const parsed = DXFAnalyzer.parse(text);
    App.dxf.parsed = parsed;

    // 즉시 도면 화면 렌더링
    const canvas = $('canvas-2d');
    const wrap   = canvas.parentElement;

    $('placeholder-2d').style.display = 'none';
    canvas.style.display = 'block';

    const toolbar = $('toolbar-2d');
    if (toolbar) toolbar.style.display = 'flex';

    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w > 0 && h > 0) {
      canvas.width  = w;
      canvas.height = h;
    } else {
      canvas.width  = 800;
      canvas.height = 600;
    }

    DXFAnalyzer.initCanvas(canvas, parsed);
    initCanvasInteraction(canvas);
    
    hideLoading();
    setStatus('ready', '도면 로드 완료');
    showToast('도면이 화면에 성공적으로 렌더링되었습니다.', 'ok');
  } catch (err) {
    hideLoading();
    setStatus('error', '오류');
    showToast(err.message, 'error');
    logToConsole(`2D 도면 로드/렌더링 실패: ${err.message}`, 'error');
  }
}

$('btn-analyze-2d').addEventListener('click', run2DAnalysis);

async function run2DAnalysis() {
  if (!App.dxf.parsed) {
    showToast('먼저 2D 도면 파일을 업로드해 주세요.', 'error');
    return;
  }
  showLoading('도면 설계 정밀 검증 규칙 실행 중...');
  setStatus('busy', '설계 검증 중');
  logToConsole('2D 설계 규칙 무결성 검증을 준비 중...', 'system');

  await fakeProgress([
    [30, 200, '레이어 무결성 분석 중...'],
    [65, 200, '제도 공차 및 마킹 패턴 분석 중...'],
    [90, 150, '품질 평가 종합 점수 연산 중...'],
  ]);

  try {
    const parsed = App.dxf.parsed;
    const result = DXFAnalyzer.analyze(parsed);
    App.dxf.result = result;

    // Populate layers in Model Tree
    const layerBox = $('dxf-layer-tree-nodes');
    if (layerBox && parsed.layers) {
      layerBox.innerHTML = '';
      if (Array.isArray(parsed.layers)) {
        parsed.layers.forEach(layerName => {
          const li = document.createElement('li');
          li.className = 'tree-leaf';
          const objCount = parsed.entities.filter(e => e.layer === layerName).length;
          li.innerHTML = `<div class="tree-node"><span class="tree-icon">📄</span> <span>Layer: ${layerName} (${objCount} objs)</span></div>`;
          layerBox.appendChild(li);
        });
      } else {
        Object.keys(parsed.layers).forEach(layerName => {
          const li = document.createElement('li');
          li.className = 'tree-leaf';
          li.innerHTML = `<div class="tree-node"><span class="tree-icon">📄</span> <span>Layer: ${layerName} (${parsed.layers[layerName].length} objs)</span></div>`;
          layerBox.appendChild(li);
        });
      }
    }

    // Show results
    $('results-2d').style.display = 'flex';
    animateScore('score-num-2d', 'ring-fill-2d', 'score-grade-2d', result.score);
    renderIssues('issues-list-2d', result.issues);

    setProgress(100);
    await new Promise(r => setTimeout(r, 100));
    hideLoading();
    setStatus('ready', '분석 완료');
    showToast(`분석 완료 — 점수: ${result.score}/100`, result.score >= 80 ? 'ok' : result.score >= 60 ? 'warn' : 'error');
    logToConsole(`2D 도면 검증 해석 완료. 점수: ${result.score}/100, 엔티티: ${result.entityCount || parsed.entities.length}개`, 'success');
  } catch (err) {
    hideLoading();
    setStatus('error', '오류');
    showToast('DXF 파싱 오류: ' + err.message, 'error');
    logToConsole(`[에러] DXF 분석 중 문제 발생: ${err.message}`, 'error');
    console.error(err);
  }
}

// Canvas pan/zoom
function initCanvasInteraction(canvas) {
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', e => { dragging = true; lastX = e.offsetX; lastY = e.offsetY; });
  canvas.addEventListener('mousemove', e => {
    if (!dragging) return;
    DXFAnalyzer.pan(e.offsetX - lastX, -(e.offsetY - lastY));
    lastX = e.offsetX; lastY = e.offsetY;
  });
  canvas.addEventListener('mouseup',   () => dragging = false);
  canvas.addEventListener('mouseleave',() => dragging = false);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    DXFAnalyzer.zoom(e.deltaY > 0 ? 0.85 : 1.18, e.offsetX, e.offsetY);
  }, { passive: false });
}

$('btn-fit-2d').addEventListener('click',  () => DXFAnalyzer.fitView());
$('btn-zin-2d').addEventListener('click',  () => {
  const c = $('canvas-2d');
  DXFAnalyzer.zoom(1.3, c.width/2, c.height/2);
});
$('btn-zout-2d').addEventListener('click', () => {
  const c = $('canvas-2d');
  DXFAnalyzer.zoom(0.75, c.width/2, c.height/2);
});

/* ══════════════════════════════════════
   3D MODULE
══════════════════════════════════════ */
const input3d = $('file-input-3d');

// Allow dragging 3D files over 3D viewport
window.addEventListener('DOMContentLoaded', () => {
  const viewport3d = document.querySelector('#content-3d .cad-viewport-panel');
  if (viewport3d) {
    viewport3d.addEventListener('dragover',  e => { e.preventDefault(); viewport3d.classList.add('drag-over'); });
    viewport3d.addEventListener('dragleave', () => viewport3d.classList.remove('drag-over'));
    viewport3d.addEventListener('drop', e => {
      e.preventDefault();
      viewport3d.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) handle3DFile(f);
    });
  }

  // Model tree checkbox bindings (Creo-style double binding)
  const treeChkSolid = $('tree-chk-solid');
  if (treeChkSolid) {
    treeChkSolid.addEventListener('change', (e) => {
      if (e.target.checked) {
        $('btn-solid').click();
      } else {
        $('btn-wireframe').click();
      }
    });
  }
  const treeChkDraft = $('tree-chk-draft');
  if (treeChkDraft) {
    treeChkDraft.addEventListener('change', (e) => {
      if (e.target.checked) {
        $('btn-draft-overlay').click();
      } else {
        STLAnalyzer.toggleOverlay(false);
      }
    });
  }
  const treeChkParting = $('tree-chk-parting');
  if (treeChkParting) {
    treeChkParting.addEventListener('change', (e) => {
      App.stl.showParting = e.target.checked;
      const sliderVal = parseInt($('parting-slider').value);
      STLAnalyzer.updatePartingLine(App.stl.showParting, sliderVal);
      const btn = $('btn-parting-overlay');
      if (btn) btn.classList.toggle('active', App.stl.showParting);
      if (App.stl.showParting) {
        $('parting-controls').style.display = 'flex';
      } else {
        $('parting-controls').style.display = 'none';
      }
    });
  }
  const treeChkCores = $('tree-chk-cores');
  if (treeChkCores) {
    treeChkCores.addEventListener('change', (e) => {
      App.stl.showCores = e.target.checked;
      STLAnalyzer.updateCoreHelpers(App.stl.showCores);
      const btn = $('btn-core-overlay');
      if (btn) btn.classList.toggle('active', App.stl.showCores);
      renderMoldFeatures();
    });
  }
});

input3d.addEventListener('change', () => { if (input3d.files[0]) handle3DFile(input3d.files[0]); });

function handle3DFile(file) {
  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.stl') && !ext.endsWith('.stp') && !ext.endsWith('.step')) {
    showToast('STL 또는 STP/STEP 파일만 지원됩니다.', 'error'); return;
  }
  App.dxf.file = null;
  App.stl.file = file;

  $('file-info-3d').style.display = 'block';
  $('file-info-3d').innerHTML = `📄 ${file.name}`;
  
  // Show sidebar config section for 3D
  const configs3D = $('sidebar-configs-3d');
  if (configs3D) configs3D.style.display = 'block';

  // Show Left Model Tree Part node
  $('tree-node-part').style.display = 'block';
  $('tree-part-name').textContent = file.name;

  showToast('3D 파일이 로드되었습니다.', 'ok');
  logToConsole(`3D 제품 모델 파일 로드 완료: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, 'info');
}

// Material selection
document.querySelectorAll('.mat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    App.stl.material = btn.dataset.mat;
    $('tree-material-name').textContent = `소재: ${btn.dataset.mat}`;
    logToConsole(`사출 수지 변경: ${btn.dataset.mat}`, 'info');

    // Auto-update process sliders to typical recommended values
    const defaults = {
      ABS: { melt: 230, mold: 50 },
      PC: { melt: 290, mold: 80 },
      PP: { melt: 220, mold: 40 },
      POM: { melt: 200, mold: 70 },
      FORTRON: { melt: 310, mold: 130 }
    }[btn.dataset.mat];

    if (defaults) {
      if ($('slide-melt-temp')) { $('slide-melt-temp').value = defaults.melt; $('val-melt-temp').textContent = `${defaults.melt}°C`; }
      if ($('slide-mold-temp')) { $('slide-mold-temp').value = defaults.mold; $('val-mold-temp').textContent = `${defaults.mold}°C`; }
      STLAnalyzer.setPhysicalParams(defaults.melt, defaults.mold);
    }

    if (App.stl.parsed) {
      reRun3DAnalysis();
    }
  });
});

// Physical parameter sliders binding
const slideMeltTemp = $('slide-melt-temp');
const slideMoldTemp = $('slide-mold-temp');
const slideFlowRate = $('slide-flow-rate');
const slideInjPressure = $('slide-inj-pressure');

function updatePhysicalParams() {
  const meltVal = parseInt(slideMeltTemp.value);
  const moldVal = parseInt(slideMoldTemp.value);
  const flowVal = parseInt(slideFlowRate.value);
  const pressVal = slideInjPressure ? parseInt(slideInjPressure.value) : 100;

  $('val-melt-temp').textContent = `${meltVal}°C`;
  $('val-mold-temp').textContent = `${moldVal}°C`;
  $('val-flow-rate').textContent = `${flowVal} cm³/s`;
  if (slideInjPressure) {
    $('val-inj-pressure').textContent = `${pressVal} MPa`;
  }

  STLAnalyzer.setPhysicalParams(meltVal, moldVal, flowVal, pressVal);
}

if (slideMeltTemp) {
  slideMeltTemp.addEventListener('input', () => {
    $('val-melt-temp').textContent = `${slideMeltTemp.value}°C`;
  });
  slideMeltTemp.addEventListener('change', () => {
    updatePhysicalParams();
    triggerPhysicalReanalysis();
  });
}

if (slideMoldTemp) {
  slideMoldTemp.addEventListener('input', () => {
    $('val-mold-temp').textContent = `${slideMoldTemp.value}°C`;
  });
  slideMoldTemp.addEventListener('change', () => {
    updatePhysicalParams();
    triggerPhysicalReanalysis();
  });
}

if (slideFlowRate) {
  slideFlowRate.addEventListener('input', () => {
    $('val-flow-rate').textContent = `${slideFlowRate.value} cm³/s`;
  });
  slideFlowRate.addEventListener('change', () => {
    updatePhysicalParams();
    triggerPhysicalReanalysis();
  });
}

if (slideInjPressure) {
  slideInjPressure.addEventListener('input', () => {
    $('val-inj-pressure').textContent = `${slideInjPressure.value} MPa`;
  });
  slideInjPressure.addEventListener('change', () => {
    updatePhysicalParams();
    triggerPhysicalReanalysis();
  });
}

// Runner system selection binding
document.querySelectorAll('.runner-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.runner-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    App.stl.runner = btn.dataset.runner;
    logToConsole(`러너 시스템 형식 변경: ${btn.dataset.runner === 'hot' ? '핫 러너 (Hot Runner)' : '콜드 러너 (Cold Runner)'}`, 'info');
    
    if (typeof STLAnalyzer.setRunnerType === 'function') {
      STLAnalyzer.setRunnerType(btn.dataset.runner);
    }
    
    triggerPhysicalReanalysis();
  });
});

function triggerPhysicalReanalysis() {
  if (App.stl.parsed) {
    if (STLAnalyzer.getGatePositions().length > 0) {
      const flowRes = STLAnalyzer.recalculateFlow();
      if (flowRes) {
        updateGateInfoPanel(flowRes);
        updateAnalysisIssuesWithGate(flowRes);
      }
    } else {
      reRun3DAnalysis();
    }
  }
}

const btnFlipAxis = $('btn-flip-axis');
if (btnFlipAxis) {
  btnFlipAxis.addEventListener('click', function() {
    App.stl.flipAxis = !App.stl.flipAxis;
    this.classList.toggle('active', App.stl.flipAxis);
    logToConsole(`탈형 정렬축 180도 반전: ${App.stl.flipAxis ? 'ON' : 'OFF'}`, 'info');
    STLAnalyzer.setFlipAxis(App.stl.flipAxis);
    if (App.stl.parsed) {
      reRun3DAnalysis();
    }
  });
}

// Axis selection
document.querySelectorAll('.axis-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.axis-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    App.stl.pullAxis = btn.dataset.axis;
    logToConsole(`주 사출 축(Pull Axis) 변경: ${btn.dataset.axis}축`, 'info');
    if (App.stl.parsed) {
      reRun3DAnalysis();
    }
  });
});

const chkAutoRotate = $('chk-auto-rotate');
if (chkAutoRotate) {
  chkAutoRotate.addEventListener('change', () => {
    logToConsole(`축 정렬 시 모델 자동 회전 설정 변경: ${chkAutoRotate.checked ? '활성화' : '비활성화'}`, 'info');
    if (App.stl.parsed) {
      reRun3DAnalysis();
    }
  });
}

async function reRun3DAnalysis() {
  if (!App.stl.parsed) return;
  setStatus('busy', '3D 재분석 중');
  logToConsole(`[재해석] 설정값 변경에 따른 3D 형상 분석 재수행 중... (${App.stl.material}, ${App.stl.pullAxis}축)`, 'system');
  
  STLAnalyzer.clearGate();
  $('gate-info-3d').style.display = 'none';
  $('flow-controls').style.display = 'none';
  $('legend-draft').style.display = 'flex';
  $('legend-flow').style.display = 'none';
  $('legend-shrinkage').style.display = 'none';
  $('btn-draft-overlay').classList.add('active');
  $('btn-flow-overlay').classList.remove('active');
  $('btn-shrink-overlay').classList.remove('active');
  $('btn-set-gate').classList.remove('active');
  STLAnalyzer.setGateSettingMode(false);
  STLAnalyzer.toggleShrinkageOverlay(false);
  resetFlowAnimation();
  App.stl.baseIssues = null;

  STLAnalyzer.setPullAxis(App.stl.pullAxis);
  STLAnalyzer.recolorGeometry();

  showLoading('설정 변경에 따른 재분석 수행 중...');
  
  const result = await STLAnalyzer.analyze(App.stl.parsed, App.stl.material, (pct, text) => {
    setProgress(pct);
    if (text) $('loading-text').textContent = text;
  });
  
  hideLoading();

  const isSTP = App.stl.file.name.toLowerCase().endsWith('.stp') || App.stl.file.name.toLowerCase().endsWith('.step');
  if (isSTP) {
    result.issues.unshift({
      level: 'info',
      title: 'STP 가상 분석 모드 활성화',
      desc: 'STP 파일에서 메타데이터를 추출해 가상 검증을 실행했습니다. 정밀 메쉬 기하 분석이 필요하면 STL로 변환 후 업로드해 주세요.'
    });
  }
  App.stl.result = result;

  $('results-3d').style.display = 'flex';
  animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', result.score);
  renderMoldFeatures(result.moldFeatures);
  renderIssues('issues-list-3d', result.issues);
  if (result.diagnostics) {
    updateDiagnosticsPanel(result.diagnostics);
  }

  STLAnalyzer.updateCoreHelpers(App.stl.showCores);
  STLAnalyzer.updatePartingLine(App.stl.showParting, parseInt($('parting-slider').value));
  setStatus('ready', '3D 분석 완료');
  showToast(`탈형 축/소재 재분석 완료`, 'ok');
  logToConsole(`3D 모델 재분석 완료. 새로운 양산성 점수: ${result.score}/100`, 'success');
}

$('btn-analyze-3d').addEventListener('click', run3DAnalysis);

async function run3DAnalysis() {
  if (!App.stl.file) return;
  const isSTP = App.stl.file.name.toLowerCase().endsWith('.stp') || App.stl.file.name.toLowerCase().endsWith('.step');

  // 이전 에러 오버레이 초기화
  const errOverlay = $('viewer-error-overlay');
  if (errOverlay) errOverlay.style.display = 'none';

  showLoading(isSTP ? 'STP 파일 분석 중...' : 'STL 파일 분석 중...');
  setStatus('busy', '3D 분석 중');
  logToConsole(`3D 모델 기하학적 및 물리적 사출성형성 해석 해석을 시작합니다... (소재: ${App.stl.material})`, 'system');

  await fakeProgress([
    [10, 100, isSTP ? 'STP 메시 구조 해석 중...' : 'STL 메시 파싱 중...'],
    [15, 100, isSTP ? '기하학적 피처 추출 중...' : '법선 벡터 분석 중...'],
    [20, 100, '기하 데이터 정렬 중...']
  ]);

  try {
    let stlData;
    const buf = await App.stl.file.arrayBuffer();
    if (isSTP) {
      stlData = await STLAnalyzer.parseSTP(buf);
    } else {
      stlData = STLAnalyzer.parseSTL(buf);
    }
    App.stl.parsed = stlData;

    // Init Three.js viewer (once)
    const container = $('canvas-3d');
    if (!App.threeInit) {
      container.style.display = 'block';
      STLAnalyzer.initViewer();
      App.threeInit = true;
      const canvas = STLAnalyzer.getCanvas();
      if (canvas) {
        STLAnalyzer.onGateRepositioned((flowRes) => {
          if (flowRes) {
            updateGateInfoPanel(flowRes);
            updateAnalysisIssuesWithGate(flowRes);
            resetFlowAnimation();
            startFlowAnimation();
          }
        });

        // Create a custom context menu dynamically
        let ctxMenu = $('gate-context-menu');
        if (!ctxMenu) {
          ctxMenu = document.createElement('div');
          ctxMenu.id = 'gate-context-menu';
          ctxMenu.style.position = 'absolute';
          ctxMenu.style.display = 'none';
          ctxMenu.style.background = 'var(--creo-bg-panel, #1e1e24)';
          ctxMenu.style.border = '1px solid var(--creo-border-cad, #3d4b66)';
          ctxMenu.style.borderRadius = '6px';
          ctxMenu.style.padding = '4px 0';
          ctxMenu.style.zIndex = '99999';
          ctxMenu.style.boxShadow = '0 6px 16px rgba(0,0,0,0.5)';
          ctxMenu.style.color = '#ffffff';
          ctxMenu.style.fontSize = '0.75rem';
          ctxMenu.style.userSelect = 'none';
          ctxMenu.style.minWidth = '120px';

          document.body.appendChild(ctxMenu);

          document.addEventListener('click', () => {
            ctxMenu.style.display = 'none';
          });
        }

        STLAnalyzer.onRightClickModel((data) => {
          ctxMenu.style.left = `${data.clientX + 5}px`;
          ctxMenu.style.top = `${data.clientY + 5}px`;
          ctxMenu.style.display = 'block';

          // Clear previous menu items
          ctxMenu.innerHTML = '';

          if (data.action === 'delete_gate') {
            const delBtn = document.createElement('div');
            delBtn.id = 'ctx-btn-delete-gate';
            delBtn.textContent = `❌ 주입구 G${data.gateIndex + 1} 삭제`;
            delBtn.style.padding = '8px 16px';
            delBtn.style.cursor = 'pointer';
            delBtn.style.transition = 'background 0.2s';
            delBtn.addEventListener('mouseenter', () => delBtn.style.background = 'rgba(255,55,55,0.2)');
            delBtn.addEventListener('mouseleave', () => delBtn.style.background = 'transparent');
            ctxMenu.appendChild(delBtn);

            delBtn.addEventListener('click', () => {
              ctxMenu.style.display = 'none';
              STLAnalyzer.removeGateAt(data.gateIndex);
              
              const count = STLAnalyzer.getGatePositions().length;
              $('tree-gate-status').textContent = `주입구 (Gates): ${count}개`;
              
              if (count === 0) {
                $('gate-info-3d').style.display = 'none';
                $('flow-controls').style.display = 'none';
                reRun3DAnalysis();
                showToast('모든 게이트가 제거되었습니다.', 'info');
                logToConsole('모든 게이트 주입구가 제거되었습니다.', 'warning');
              } else {
                const flowRes = STLAnalyzer.recalculateFlow();
                if (flowRes) {
                  updateGateInfoPanel(flowRes);
                  updateAnalysisIssuesWithGate(flowRes);
                }
                showToast(`게이트 제거 (남은 게이트: ${count}개)`, 'info');
                logToConsole(`게이트 제거 완료. 남은 개수: ${count}개`, 'info');
                resetFlowAnimation();
                startFlowAnimation();
              }
            });
          } else {
            const addBtn = document.createElement('div');
            addBtn.id = 'ctx-btn-add-gate';
            addBtn.textContent = '🎯 주입구 (Gate) 추가';
            addBtn.style.padding = '8px 16px';
            addBtn.style.cursor = 'pointer';
            addBtn.style.transition = 'background 0.2s';
            addBtn.addEventListener('mouseenter', () => addBtn.style.background = 'rgba(255,255,255,0.1)');
            addBtn.addEventListener('mouseleave', () => addBtn.style.background = 'transparent');
            ctxMenu.appendChild(addBtn);

            addBtn.addEventListener('click', () => {
              ctxMenu.style.display = 'none';
              const result = STLAnalyzer.addGatePosition(data.worldPoint, data.localPoint, data.faceNormal);
              if (result) {
                const count = result.gateCount;
                $('tree-gate-status').textContent = `주입구 (Gates): ${count}개`;
                showToast(`게이트 G${result.gateIndex + 1} 설정 완료 (총 ${count}개)`, 'ok');
                logToConsole(`새로운 사출 게이트 G${result.gateIndex + 1} 추가 완료.`, 'success');
                updateGateInfoPanel(result);
                updateAnalysisIssuesWithGate(result);

                STLAnalyzer.toggleFlowOverlay(true);
                document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
                $('btn-flow-overlay').classList.add('active');
                const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

                $('legend-draft').style.display = 'none';
                $('legend-flow').style.display = 'flex';
                $('flow-controls').style.display = 'flex';

                resetFlowAnimation();
                startFlowAnimation();
              }
            });
          }
        });
      }
    } else {
      container.style.display = 'block';
    }

    $('placeholder-3d').style.display = 'none';

    // Show viewport toolbar
    const tb3D = $('toolbar-3d');
    if (tb3D) tb3D.style.display = 'flex';

    // Show molding info in left Model Tree
    $('tree-node-molding').style.display = 'block';
    $('tree-material-name').textContent = `소재: ${App.stl.material}`;

    // Reset gate/flow/shrinkage UI states
    $('gate-info-3d').style.display = 'none';
    $('flow-controls').style.display = 'none';
    $('parting-controls').style.display = 'none';
    $('parting-slider').value = 50;
    $('parting-val-display').textContent = '50%';
    $('legend-draft').style.display = 'flex';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'none';
    
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    $('btn-draft-overlay').classList.add('active');
    $('btn-solid').classList.add('active');
    
    // Sync model tree checkboxes
    const chkSolid = $('tree-chk-solid'); if (chkSolid) chkSolid.checked = true;
    const chkDraft = $('tree-chk-draft'); if (chkDraft) chkDraft.checked = true;
    const chkParting = $('tree-chk-parting'); if (chkParting) chkParting.checked = false;
    const chkCores = $('tree-chk-cores'); if (chkCores) chkCores.checked = false;

    STLAnalyzer.setGateSettingMode(false);
    STLAnalyzer.toggleShrinkageOverlay(false);
    resetFlowAnimation();
    App.stl.baseIssues = null;
    App.stl.gateVelocityRatios = [];

    STLAnalyzer.setPullAxis(App.stl.pullAxis);
    STLAnalyzer.loadGeometry(stlData);
    STLAnalyzer.updateCoreHelpers(App.stl.showCores);
    STLAnalyzer.updatePartingLine(App.stl.showParting, 50);

    // Analysis
    const result = await STLAnalyzer.analyze(stlData, App.stl.material, (pct, text) => {
      setProgress(pct);
      if (text) $('loading-text').textContent = text;
    });
    if (isSTP) {
      result.issues.unshift({
        level: 'info',
        title: 'STP 가상 분석 모드 활성화',
        desc: 'STP 파일에서 메타데이터를 추출해 가상 검증을 실행했습니다. 정밀 메쉬 기하 분석이 필요하면 STL로 변환 후 업로드해 주세요.'
      });
    }
    App.stl.result = result;

    $('results-3d').style.display = 'flex';
    animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', result.score);
    renderMoldFeatures(result.moldFeatures);
    renderIssues('issues-list-3d', result.issues);
    if (result.diagnostics) {
      updateDiagnosticsPanel(result.diagnostics);
    }

    // Update tree gate text
    $('tree-gate-status').textContent = `주입구 (Gates): ${STLAnalyzer.getGatePositions().length}개`;

    setProgress(100);
    await new Promise(r => setTimeout(r, 200));
    hideLoading();
    setStatus('ready', '3D 분석 완료');
    showToast(`사출성형 분석 완료 — 양산성 점수: ${result.score}/100`, result.score >= 80 ? 'ok' : result.score >= 60 ? 'warn' : 'error');
    logToConsole(`3D 제품 모델 분석 완료. 종합 양산성 점수: ${result.score}/100`, 'success');
    logToConsole(`검출된 피처 - 언더컷 슬라이드 코어: ${result.moldFeatures.slides.length}개, 리프터 코어: ${result.moldFeatures.lifters.length}개`, 'info');
  } catch (err) {
    hideLoading();
    setStatus('error', '오류');
    console.error(err);

    const errMsg = err.message || '알 수 없는 오류';
    logToConsole(`[에러] 3D 제품 분석 실패: ${errMsg}`, 'error');

    // 뷰포트 에러 오버레이 표시
    const overlay = $('viewer-error-overlay');
    const titleEl = $('viewer-error-title');
    const descEl = $('viewer-error-desc');
    const guideEl = $('viewer-error-guide');

    if (overlay) {
      $('placeholder-3d').style.display = 'none';
      $('canvas-3d').style.display = 'none';

      let title = '파일 로딩 실패';
      let desc = errMsg;
      let guide = '';

      if (isSTP) {
        title = 'STP/STEP 파일 로딩 실패';

        if (errMsg.includes('SharedArrayBuffer') || errMsg.includes('WASM') || errMsg.includes('library')) {
          desc = 'WASM 렌더링 엔진 초기화에 실패했습니다. 브라우저 보안 정책(COOP/COEP 헤더)으로 인해 STP 파싱이 차단되었을 수 있습니다.';
          guide = '💡 해결 방법:\n• DIMA 전용 서버(server.ps1)를 통해 실행하세요\n• Chrome / Edge 최신 버전을 사용해 주세요\n• 또는 STP 파일을 STL로 변환 후 업로드 하세요';
        } else if (errMsg.includes('메쉬') || errMsg.includes('mesh') || errMsg.includes('파싱')) {
          desc = 'STP 파일에서 3D 메쉬를 추출하지 못했습니다. 파일이 손상되었거나 지원하지 않는 STEP 형식일 수 있습니다.';
          guide = '💡 해결 방법:\n• CAD 소프트웨어(CATIA, SolidWorks, Creo 등)에서 STL로 내보내기 후 업로드\n• 권장 설정: STL 정밀도 0.1mm, ASCII 또는 Binary 형식\n• AP214 / AP242 형식의 STEP 파일을 사용해 주세요';
        } else {
          desc = `STP 파일 처리 중 오류가 발생했습니다: ${errMsg}`;
          guide = '💡 STL 형식으로 변환 후 업로드하면 더 안정적으로 분석할 수 있습니다.\nSolidWorks: 파일 → 내보내기 → STL\nCATIA: 파일 → 저장 형식 → .stl\nCreo: 파일 → 내보내기 → STL';
        }
      } else {
        title = 'STL 파일 로딩 실패';
        desc = `STL 파일 파싱 중 오류가 발생했습니다: ${errMsg}`;
        guide = '💡 해결 방법:\n• STL 파일이 손상되지 않았는지 확인해 주세요\n• Binary STL 또는 ASCII STL 형식을 지원합니다\n• 파일 크기가 너무 크면 삼각형 수를 줄여 저장해 주세요';
      }

      titleEl.textContent = title;
      descEl.textContent = desc;
      if (guide) {
        guideEl.style.display = 'block';
        guideEl.style.whiteSpace = 'pre-line';
        guideEl.textContent = guide;
      } else {
        guideEl.style.display = 'none';
      }

      overlay.style.display = 'flex';
    }

    showToast((isSTP ? 'STP' : 'STL') + ' 로딩 실패 — 뷰포트에서 상세 안내를 확인하세요', 'error');
  }
}

// Display styling (Solid / Wireframe)
let _wireframe = false;
let _overlay = true;

$('btn-wireframe').addEventListener('click', () => {
  _wireframe = true;
  STLAnalyzer.setWireframe(true);
  $('btn-wireframe').classList.add('active');
  $('btn-solid').classList.remove('active');
  const chk = $('tree-chk-solid'); if (chk) chk.checked = false;
  logToConsole('디스플레이 모드 변경: 와이어프레임(Wireframe)', 'info');
});
$('btn-solid').addEventListener('click', () => {
  _wireframe = false;
  STLAnalyzer.setWireframe(false);
  $('btn-solid').classList.add('active');
  $('btn-wireframe').classList.remove('active');
  const chk = $('tree-chk-solid'); if (chk) chk.checked = true;
  logToConsole('디스플레이 모드 변경: 솔리드 쉐이딩(Solid Shading)', 'info');
});

// Overlays (Draft, Flow, Shrinkage)
$('btn-draft-overlay').addEventListener('click', function() {
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  this.classList.add('active');
  STLAnalyzer.toggleFlowOverlay(false);
  STLAnalyzer.toggleShrinkageOverlay(false);
  STLAnalyzer.toggleOverlay(true);
  const chk = $('tree-chk-draft'); if (chk) chk.checked = true;

  $('legend-draft').style.display = 'flex';
  $('legend-flow').style.display = 'none';
  $('legend-shrinkage').style.display = 'none';
  $('flow-controls').style.display = 'none';
  logToConsole('해석 오버레이 변경: 구배각 검사(Draft Angle)', 'info');
});

$('btn-flow-overlay').addEventListener('click', function() {
  if (!STLAnalyzer.getGatePosition()) {
    showToast('게이트 위치를 먼저 지정해야 유동 분석이 가능합니다.', 'warn');
    $('btn-set-gate').click();
    return;
  }
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  this.classList.add('active');
  STLAnalyzer.toggleFlowOverlay(true);
  const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

  $('legend-draft').style.display = 'none';
  $('legend-flow').style.display = 'flex';
  $('legend-shrinkage').style.display = 'none';
  $('flow-controls').style.display = 'flex';
  logToConsole('해석 오버레이 변경: 사출 유동 시뮬레이션(Moldflow)', 'info');
});

$('btn-shrink-overlay').addEventListener('click', function() {
  if (!App.stl.parsed) {
    showToast('3D 모델을 먼저 분석하세요.', 'warn');
    return;
  }
  const isActive = this.classList.contains('active');
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));

  if (!isActive) {
    this.classList.add('active');
    showToast('수축 위험 예측 계산 중...', 'info');
    STLAnalyzer.toggleShrinkageOverlay(true);
    const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

    $('legend-draft').style.display = 'none';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'flex';
    $('flow-controls').style.display = 'none';
    showToast(`${App.stl.material} 수축 위험 예측 활성화`, 'ok');
    logToConsole(`해석 오버레이 변경: ${App.stl.material} 수축 예측(Shrinkage)`, 'info');
  } else {
    $('btn-draft-overlay').classList.add('active');
    STLAnalyzer.toggleShrinkageOverlay(false);
    STLAnalyzer.toggleOverlay(true);
    const chk = $('tree-chk-draft'); if (chk) chk.checked = true;

    $('legend-draft').style.display = 'flex';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'none';
  }
});

// Set Gate
$('btn-set-gate').addEventListener('click', function() {
  const isSetting = !STLAnalyzer.isGateSettingMode();
  STLAnalyzer.setGateSettingMode(isSetting);
  this.classList.toggle('active', isSetting);
  if (isSetting) {
    showToast('모델 표면을 클릭하여 주입구(Gate)를 지정하세요.', 'info');
    $('gate-info-3d').style.display = 'flex';
    logToConsole('게이트 지정 모드 활성화. 모델 표면을 선택해 주십시오.', 'info');
  } else {
    if (!STLAnalyzer.getGatePosition()) {
      $('gate-info-3d').style.display = 'none';
    }
    logToConsole('게이트 지정 모드 비활성화.', 'info');
  }
});

// Flow Simulation Animation Controls
let flowAnimPct = 0;
let flowPlaying = false;
let flowAnimFrame = null;
let flowSpeedMultiplier = 1.0;
let lastAnimTime = 0;

function resetFlowAnimation() {
  stopFlowAnimation();
  flowAnimPct = 0;
  $('flow-slider').value = 0;
  const totalT = App.stl.fillingTime || 2.0;
  $('flow-time-display').textContent = `0.0s / ${totalT.toFixed(1)}s`;
  STLAnalyzer.setFlowAnimationTime(0);
}

function startFlowAnimation() {
  if (flowPlaying) return;
  flowPlaying = true;
  $('btn-play-flow').style.display = 'none';
  $('btn-pause-flow').style.display = 'flex';
  
  lastAnimTime = performance.now();
  
  function animLoop(timestamp) {
    if (!flowPlaying) return;
    
    const delta = timestamp - lastAnimTime;
    lastAnimTime = timestamp;
    
    const totalT = App.stl.fillingTime || 2.0;
    flowAnimPct += (delta * (0.1 / totalT)) * flowSpeedMultiplier;
    if (flowAnimPct > 100) {
      flowAnimPct = 0;
    }
    
    const val = Math.floor(flowAnimPct);
    $('flow-slider').value = val;
    $('flow-time-display').textContent = `${(val * totalT / 100).toFixed(1)}s / ${totalT.toFixed(1)}s`;
    STLAnalyzer.setFlowAnimationTime(val / 100);
    
    flowAnimFrame = requestAnimationFrame(animLoop);
  }
  
  flowAnimFrame = requestAnimationFrame(animLoop);
}

function stopFlowAnimation() {
  flowPlaying = false;
  $('btn-play-flow').style.display = 'flex';
  $('btn-pause-flow').style.display = 'none';
  if (flowAnimFrame) {
    cancelAnimationFrame(flowAnimFrame);
    flowAnimFrame = null;
  }
}

$('btn-play-flow').addEventListener('click', startFlowAnimation);
$('btn-pause-flow').addEventListener('click', stopFlowAnimation);

if ($('flow-speed-select')) {
  $('flow-speed-select').addEventListener('change', (e) => {
    flowSpeedMultiplier = parseFloat(e.target.value);
  });
}

$('flow-slider').addEventListener('input', (e) => {
  stopFlowAnimation();
  flowAnimPct = parseInt(e.target.value);
  const totalT = App.stl.fillingTime || 2.0;
  $('flow-time-display').textContent = `${(flowAnimPct * totalT / 100).toFixed(1)}s / ${totalT.toFixed(1)}s`;
  STLAnalyzer.setFlowAnimationTime(flowAnimPct / 100);
});

function handleViewerClick(e) {
  if (!STLAnalyzer.isGateSettingMode()) return;

  const result = STLAnalyzer.onViewerClick(e);
  if (!result) return;

  if (result.action === 'remove_gate') {
    const count = result.gateCount;
    $('tree-gate-status').textContent = `주입구 (Gates): ${count}개`;
    if (count === 0) {
      $('gate-info-3d').style.display = 'none';
      $('flow-controls').style.display = 'none';
      reRun3DAnalysis();
      showToast('모든 게이트가 제거되었습니다.', 'info');
      logToConsole('모든 게이트 주입구가 제거되었습니다.', 'warning');
    } else {
      const flowRes = STLAnalyzer.recalculateFlow();
      if (flowRes) {
        updateGateInfoPanel(flowRes);
        updateAnalysisIssuesWithGate(flowRes);
      }
      showToast(`게이트 제거 (남은 게이트: ${count}개)`, 'info');
      logToConsole(`게이트 제거 완료. 남은 개수: ${count}개`, 'info');
      resetFlowAnimation();
      startFlowAnimation();
    }
    return;
  }

  const count = result.gateCount;
  $('tree-gate-status').textContent = `주입구 (Gates): ${count}개`;
  showToast(`게이트 G${result.gateIndex + 1} 설정 완료 (총 ${count}개)`, 'ok');
  logToConsole(`새로운 사출 게이트 G${result.gateIndex + 1} 추가 완료.`, 'success');
  updateGateInfoPanel(result);
  updateAnalysisIssuesWithGate(result);

  STLAnalyzer.toggleFlowOverlay(true);
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  $('btn-flow-overlay').classList.add('active');
  const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

  $('legend-draft').style.display = 'none';
  $('legend-flow').style.display = 'flex';
  $('flow-controls').style.display = 'flex';

  resetFlowAnimation();
  startFlowAnimation();
}

function updateDiagnosticsPanel(diagnostics) {
  const panel = $('diagnostics-info-3d');
  if (!panel || !diagnostics) return;

  panel.style.display = 'flex';
  $('diag-pressure').textContent = `${diagnostics.estimatedPressureDrop.toFixed(1)} MPa`;
  $('diag-clamp').textContent = `${diagnostics.clampingForce.toFixed(1)} Tons`;
  $('diag-cooling').textContent = `${diagnostics.maxCoolingTime.toFixed(1)} s`;

  let gatesStr = '-';
  if (diagnostics.suggestedGates && diagnostics.suggestedGates.length > 0) {
    gatesStr = diagnostics.suggestedGates.map(g => `G${g.index + 1}: ${g.diameter.toFixed(1)}mm`).join(', ');
  }
  $('diag-gate-size').textContent = gatesStr;
  $('diag-proj-area').textContent = `${diagnostics.projectedArea.toFixed(1)} ㎠`;
  $('diag-viscosity').textContent = `${diagnostics.viscosityRatio.toFixed(2)}x`;
  
  if (diagnostics.fillingTime) {
    App.stl.fillingTime = diagnostics.fillingTime;
    const val = parseInt($('flow-slider').value);
    $('flow-time-display').textContent = `${(val * App.stl.fillingTime / 100).toFixed(1)}s / ${App.stl.fillingTime.toFixed(1)}s`;
    $('diag-fill-time').textContent = `${diagnostics.fillingTime.toFixed(2)} s`;
  } else {
    $('diag-fill-time').textContent = `- s`;
  }

  if (diagnostics.suggestedGates && diagnostics.suggestedGates.length > 0) {
    const qTotal = diagnostics.flowRate || 50;
    const gateCount = diagnostics.suggestedGates.length;
    const qPerGate = qTotal / gateCount;
    const avgDia = diagnostics.suggestedGates.reduce((sum, g) => sum + g.diameter, 0) / gateCount;
    const area = Math.PI * Math.pow(avgDia / 2, 2);
    const velocity = qPerGate / area;
    $('diag-gate-velocity').textContent = `${velocity.toFixed(1)} m/s`;
  } else {
    $('diag-gate-velocity').textContent = `- m/s`;
  }
  
  if (diagnostics.estimatedPressureDrop > 100) {
    $('diag-pressure').style.color = '#ff4d6d';
  } else if (diagnostics.estimatedPressureDrop > 80) {
    $('diag-pressure').style.color = '#ffd166';
  } else {
    $('diag-pressure').style.color = '#00ffa3';
  }

  if (diagnostics.meltTempStatus === 'warning') {
    $('diag-viscosity').style.color = '#ffd166';
  } else {
    $('diag-viscosity').style.color = '#ffffff';
  }
}

function updateGateInfoPanel(result) {
  const container = $('gate-info-3d');
  if (!container) return;
  container.style.display = 'flex';

  const gates = STLAnalyzer.getGatePositions();
  const count = gates.length;
  
  if (count === 0) {
    container.style.display = 'none';
    return;
  }

  // Build HTML for gate controls dynamically
  let html = `
    <div style="border: 1px solid var(--creo-border-cad); background: rgba(0, 0, 0, 0.3); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px; width: 100%;">
      <div style="color: var(--cyan); font-weight: bold; font-size: 0.78rem; display: flex; align-items: center; justify-content: space-between;">
        <span>🎯 게이트 개별 속도 (밸브) 제어</span>
        <small style="color: #b0c4de;">총 ${count}개</small>
      </div>
      <div style="font-size: 0.72rem; color: #b0c4de; display: flex; flex-direction: column; gap: 8px; width: 100%;">
  `;

  gates.forEach((gp, idx) => {
    const vR = App.stl.gateVelocityRatios && App.stl.gateVelocityRatios[idx] !== undefined ? App.stl.gateVelocityRatios[idx] : 1.0;
    const isClosed = vR === 0;
    const label = isClosed ? '밸브 닫힘 (0%)' : `속도: ${(vR * 100).toFixed(0)}%`;
    
    html += `
      <div style="border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px; margin-bottom: 2px;">
        <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; color: ${isClosed ? '#ff4d6d' : 'var(--cyan)'};">주입구 G${idx + 1}</span>
          <span id="gate-val-display-${idx}" style="color:#fff; font-weight:bold; font-size:0.7rem;">${label}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <input type="range" class="gate-speed-slider" data-gate-idx="${idx}" min="0" max="150" value="${vR * 100}" style="flex: 1; accent-color: ${isClosed ? '#ff4d6d' : 'var(--cyan)'}; height: 4px;" />
          <span style="font-size: 0.65rem; color: #a0a5b5; width: 45px; text-align: right;">X:${gp.x.toFixed(0)} Y:${gp.y.toFixed(0)}</span>
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;
  
  container.innerHTML = html;

  // Bind input and change events to the gate speed sliders
  container.querySelectorAll('.gate-speed-slider').forEach(slider => {
    const idx = parseInt(slider.dataset.gateIdx);
    
    const updateDisplay = () => {
      const val = parseInt(slider.value) / 100;
      const display = container.querySelector(`#gate-val-display-${idx}`);
      if (display) {
        display.textContent = val === 0 ? '밸브 닫힘 (0%)' : `속도: ${(val * 100).toFixed(0)}%`;
        display.style.color = val === 0 ? '#ff4d6d' : '#fff';
      }
    };
    
    slider.addEventListener('input', updateDisplay);
    slider.addEventListener('change', () => {
      const val = parseInt(slider.value) / 100;
      if (!App.stl.gateVelocityRatios) App.stl.gateVelocityRatios = [];
      App.stl.gateVelocityRatios[idx] = val;
      
      // Update in STLAnalyzer
      const flowRes = STLAnalyzer.setGateParams(idx, val, undefined);
      if (flowRes) {
        updateAnalysisIssuesWithGate(flowRes);
      }
      resetFlowAnimation();
      startFlowAnimation();
    });
  });

  if (result.diagnostics) {
    updateDiagnosticsPanel(result.diagnostics);
  }
}

function updateAnalysisIssuesWithGate(gateResult) {
  if (!App.stl.result) return;
  if (!App.stl.baseIssues) {
    App.stl.baseIssues = [...App.stl.result.issues];
  }
  
  const issues = [...App.stl.baseIssues];
  const matKey = App.stl.material;
  const mat = { ABS: 120, PC: 95, PP: 180, POM: 140, FORTRON: 125 }[matKey] || 120;
  const maxDist = gateResult.maxFlowDistance;
  
  if (gateResult.diagnostics) {
    const deltaP = gateResult.diagnostics.estimatedPressureDrop;
    const limit = gateResult.diagnostics.pressureLimit || 100;
    if (deltaP > limit) {
      issues.unshift({
        level: 'error',
        title: '사출 압력 한계 초과 (미성형 위험)',
        desc: `필요 사출 압력(${deltaP.toFixed(1)} MPa)이 설정된 압력 한계(${limit} MPa)를 초과하여 미성형(Short Shot) 위험이 있습니다. 유량을 낮추거나 수지 온도를 올리십시오.`
      });
    } else if (deltaP > limit * 0.8) {
      issues.unshift({
        level: 'warning',
        title: '사출 압력 주의 (압력 임계치 도달)',
        desc: `필요 사출 압력(${deltaP.toFixed(1)} MPa)이 설정된 압력 한계(${limit} MPa)의 80%를 넘었습니다. 성형성이 불안정할 수 있습니다.`
      });
    }
  }

  if (maxDist > mat) {
    issues.unshift({
      level: 'error',
      title: '미성형 (Short Shot) 위험 매우 높음',
      desc: `게이트 기준 최장 유동 거리(${maxDist.toFixed(1)}mm)가 현재 소재(${matKey}) 유동 한계(${mat}mm)를 초과합니다. 주입구를 중앙으로 옮기거나 추가 설정이 필요합니다.`
    });
    logToConsole(`[주의] 유동거리(${maxDist.toFixed(1)}mm)가 소재 한계(${mat}mm)를 초과하여 미성형 위험이 큽니다.`, 'error');
  } else if (maxDist > mat * 0.8) {
    issues.unshift({
      level: 'warning',
      title: '미성형 발생 가능 주의',
      desc: `최대 유동 거리(${maxDist.toFixed(1)}mm)가 소재 유동 한계(${mat}mm)에 가까워 성형성이 불안정할 수 있습니다.`
    });
  } else {
    issues.unshift({
      level: 'ok',
      title: '충진 성형성 양호',
      desc: `최대 유동 거리가 ${maxDist.toFixed(1)}mm로, 해당 소재(${matKey})의 유동 사출 한계 범위 이내입니다.`
    });
  }
  
  const airTraps = gateResult.defects.filter(d => d.type === 'air_trap');
  if (airTraps.length > 0) {
    issues.push({
      level: 'warning',
      title: `⚠ 에어 트랩 위험 ${airTraps.length}곳 감지 (자홍색 마커)`,
      desc: `충진 말기 포켓 구간에 가스가 갇힐 위험이 있습니다. 해당 위치에 가스 배출구(Gas Vent) 또는 게이트 위치 조정을 권장합니다.`
    });
  }

  const weldLines = gateResult.defects.filter(d => d.type === 'weld_line');
  if (weldLines.length > 0) {
    issues.push({
      level: 'warning',
      title: `⚠ 웰드라인 합류 구간 예측 (노란색 마커)`,
      desc: `다중 게이트에서 유동이 만나는 지점에 웰드라인이 형성됩니다. 강도 저하 우려 지점으로 설계 검토를 권장합니다.`
    });
  }
  
  // calculate score
  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.filter(i => i.level === 'warning').length;
  const score = Math.max(0, 100 - errorCount * 18 - warningCount * 7);
  
  animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', score);
  renderIssues('issues-list-3d', issues);
}

$('btn-core-overlay').addEventListener('click', function() {
  if (!App.stl.parsed) {
    showToast('3D 모델을 먼저 분석하세요.', 'warn');
    return;
  }
  App.stl.showCores = !App.stl.showCores;
  try {
    STLAnalyzer.updateCoreHelpers(App.stl.showCores);
  } catch (err) {
    console.error('Core helper error:', err);
    logToConsole(`[에러] 코어 가이드 표시 중 오류: ${err.message}`, 'error');
    showToast('코어 가이드 표시 오류: ' + err.message, 'error');
    App.stl.showCores = false;
    return;
  }
  this.classList.toggle('active', App.stl.showCores);
  const chk = $('tree-chk-cores'); if (chk) chk.checked = App.stl.showCores;
  renderMoldFeatures();
  if (App.stl.showCores) {
    showToast('금형 코어 가이드 표시 활성화', 'ok');
    logToConsole('금형 언더컷 코어 가이드 표시: ON', 'info');
  } else {
    logToConsole('금형 언더컷 코어 가이드 표시: OFF', 'info');
  }
});
$('btn-parting-overlay').addEventListener('click', function() {
  App.stl.showParting = !App.stl.showParting;
  const sliderVal = parseInt($('parting-slider').value);
  STLAnalyzer.updatePartingLine(App.stl.showParting, sliderVal);
  this.classList.toggle('active', App.stl.showParting);
  if (App.stl.showParting) {
    $('parting-controls').style.display = 'flex';
  } else {
    $('parting-controls').style.display = 'none';
  }
});

$('parting-slider').addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  $('parting-val-display').textContent = `${val}%`;
  if (App.stl.showParting) {
    STLAnalyzer.updatePartingLine(true, val);
    STLAnalyzer.recolorGeometry();
    
    // Update the analysis and list of undercuts/features
    updateAnalysisOnPartingChange();
    
    // 게이트가 있으면 파팅라인 변경에 따라 유동 재계산
    if (STLAnalyzer.getGatePositions().length > 0) {
      const flowRes = STLAnalyzer.recalculateFlow();
      if (flowRes) {
        updateGateInfoPanel(flowRes);
        updateAnalysisIssuesWithGate(flowRes);
        resetFlowAnimation();
        startFlowAnimation();
      }
    }
  }
});

async function updateAnalysisOnPartingChange() {
  if (!App.stl.parsed) return;
  if (updateAnalysisOnPartingChange.running) return;
  updateAnalysisOnPartingChange.running = true;
  try {
    const result = await STLAnalyzer.analyze(App.stl.parsed, App.stl.material);
    App.stl.result = result;
    
    animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', result.score);
    renderMoldFeatures(result.moldFeatures);
    renderIssues('issues-list-3d', result.issues);
    STLAnalyzer.updateCoreHelpers(App.stl.showCores);
  } catch (err) {
    console.error('Error during parting change analysis:', err);
  } finally {
    updateAnalysisOnPartingChange.running = false;
  }
}

$('btn-reset-cam').addEventListener('click', () => STLAnalyzer.resetCamera());

/* ══════════════════════════════════════
   RESULTS RENDERING
══════════════════════════════════════ */
function animateScore(numId, ringId, gradeId, score) {
  const ring  = $(ringId);
  const circ  = 263.9; // 2π * 42
  const offset = circ - (score / 100) * circ;
  if (ring) {
    ring.style.strokeDashoffset = offset;
  }

  // Color by score
  let color, grade;
  if (score >= 85) { color = '#00ffa3'; grade = '✅ 합격 (PASS)'; }
  else if (score >= 70) { color = '#00d4ff'; grade = '🟡 주의 (REVIEW)'; }
  else if (score >= 50) { color = '#ffd166'; grade = '⚠️ 경고 (WARN)'; }
  else                  { color = '#ff4d6d'; grade = '❌ 불합격 (FAIL)'; }

  if (ring) {
    ring.style.stroke = color;
    ring.style.filter = `drop-shadow(0 0 6px ${color})`;
  }
  const el = $(gradeId);
  if (el) {
    el.textContent = grade;
    el.style.background = color + '22';
    el.style.color = color;
  }

  // Count up animation
  let cur = 0;
  const target = score;
  const step = () => {
    cur = Math.min(cur + 3, target);
    $(numId).textContent = cur;
    if (cur < target) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderIssues(listId, issues) {
  const container = $(listId);
  container.innerHTML = '';

  if (listId === 'issues-list-3d') {
    // Group 3D issues by category
    const groups = {
      molding:   { title: '📦 사출 성형성 분석', items: [], color: 'var(--cyan)' },
      gate:      { title: '🎯 게이트 및 가스 벤트', items: [], color: 'var(--yellow)' },
      thickness: { title: '📐 살두께 비율 검증', items: [], color: 'var(--green)' },
      tip:       { title: '💡 생산성 가이드 & 팁', items: [], color: 'var(--orange)' }
    };

    issues.forEach(issue => {
      let title = issue.title.toUpperCase();
      let desc  = issue.desc.toUpperCase();
      let cat = 'tip';

      if (title.includes('언더컷') || title.includes('구배') || title.includes('수축') || title.includes('웰드라인') || title.includes('미성형') || title.includes('에어 트랩') || title.includes('충진')) {
        cat = 'molding';
      } else if (title.includes('게이트') || title.includes('벤트') || title.includes('주입구') || title.includes('공차') || title.includes('조도')) {
        cat = 'gate';
      } else if (title.includes('두께') || title.includes('살두께')) {
        cat = 'thickness';
      } else {
        cat = 'tip';
      }
      groups[cat].items.push(issue);
    });

    Object.keys(groups).forEach(key => {
      const group = groups[key];
      if (group.items.length === 0) return;

      const groupDiv = document.createElement('div');
      groupDiv.className = 'issue-group-container';
      groupDiv.style.marginBottom = '12px';

      const header = document.createElement('div');
      header.className = 'issue-group-header';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.padding = '8px 12px';
      header.style.background = 'rgba(255,255,255,0.03)';
      header.style.border = '1px solid var(--creo-border-cad)';
      header.style.borderRadius = '6px';
      header.style.cursor = 'pointer';
      header.style.fontWeight = 'bold';
      header.style.fontSize = '0.78rem';
      header.style.color = group.color;
      header.style.userSelect = 'none';

      const content = document.createElement('div');
      content.className = 'issue-group-content';
      content.style.marginTop = '6px';
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.style.gap = '6px';

      header.innerHTML = `<span>${group.title} (${group.items.length})</span><span class="group-arrow">▼</span>`;

      header.addEventListener('click', () => {
        const arrow = header.querySelector('.group-arrow');
        if (content.style.display === 'none') {
          content.style.display = 'flex';
          arrow.textContent = '▼';
        } else {
          content.style.display = 'none';
          arrow.textContent = '▲';
        }
      });

      group.items.forEach((issue, idx) => {
        const div = document.createElement('div');
        div.className = `issue-item ${issue.level}`;
        div.style.animationDelay = `${idx * 40}ms`;
        div.style.padding = '8px 10px';
        div.style.fontSize = '0.74rem';

        const badgeClass = { error:'badge-error', warning:'badge-warning', info:'badge-info', ok:'badge-ok' }[issue.level] || 'badge-info';
        const badgeText  = { error:'ERROR', warning:'WARN', info:'INFO', ok:'OK' }[issue.level] || 'INFO';

        div.innerHTML = `
          <div class="issue-title" style="font-size:0.75rem; margin-bottom:4px;">
            <span class="issue-badge ${badgeClass}" style="font-size:0.58rem; padding: 1px 5px;">${badgeText}</span>${issue.title}
          </div>
          <div style="color:var(--text-secondary); line-height:1.4;">${issue.desc}</div>`;
        content.appendChild(div);
      });

      groupDiv.appendChild(header);
      groupDiv.appendChild(content);
      container.appendChild(groupDiv);
    });

  } else {
    // Default flat rendering (for 2D)
    issues.forEach((issue, idx) => {
      const div = document.createElement('div');
      div.className = `issue-item ${issue.level}`;
      div.style.animationDelay = `${idx * 60}ms`;

      const badgeClass = { error:'badge-error', warning:'badge-warning', info:'badge-info', ok:'badge-ok' }[issue.level] || 'badge-info';
      const badgeText  = { error:'ERROR', warning:'WARN', info:'INFO', ok:'OK' }[issue.level] || 'INFO';

      div.innerHTML = `
        <div class="issue-title">
          <span class="issue-badge ${badgeClass}">${badgeText}</span>${issue.title}
        </div>
        <div>${issue.desc}</div>`;
      container.appendChild(div);
    });
  }
}

/* ══════════════════════════════════════
   REPORT
══════════════════════════════════════ */
function buildReport() {
  const body = $('report-body');
  const hasD = App.dxf.result;
  const hasS = App.stl.result;

  if (!hasD && !hasS) {
    body.innerHTML = `<div class="report-empty"><div style="font-size:3rem">📋</div><p>2D 또는 3D 분석을 먼저 완료해주세요.</p></div>`;
    return;
  }

  let html = '<div class="report-grid">';

  if (hasD) {
    const r = App.dxf.result;
    html += `
    <div class="report-card">
      <h3>📐 2D 도면 검증 결과</h3>
      <div class="report-stat"><span class="stat-label">파일명</span><span class="stat-value">${App.dxf.file?.name || '-'}</span></div>
      <div class="report-stat"><span class="stat-label">종합 점수</span><span class="stat-value">${r.score} / 100</span></div>
      <div class="report-stat"><span class="stat-label">전체 엔티티</span><span class="stat-value">${r.entityCount}개</span></div>
      <div class="report-stat"><span class="stat-label">레이어 수</span><span class="stat-value">${r.layers.length}개</span></div>
      <div class="report-stat"><span class="stat-label">오류</span><span class="stat-value" style="color:#ff4d6d">${r.issues.filter(i=>i.level==='error').length}건</span></div>
      <div class="report-stat"><span class="stat-label">경고</span><span class="stat-value" style="color:#ffd166">${r.issues.filter(i=>i.level==='warning').length}건</span></div>
    </div>`;
  }

  if (hasS) {
    const r = App.stl.result;
    const isSTP = App.stl.file?.name.toLowerCase().endsWith('.stp') || App.stl.file?.name.toLowerCase().endsWith('.step');
    html += `
    <div class="report-card">
      <h3>🧊 3D 사출성형 분석 결과 ${isSTP ? '(STP 가상 분석)' : ''}</h3>
      <div class="report-stat"><span class="stat-label">파일명</span><span class="stat-value">${App.stl.file?.name || '-'}</span></div>
      ${isSTP && r.stats.metadata ? `
      <div class="report-stat"><span class="stat-label">STP 모델명</span><span class="stat-value">${r.stats.metadata.productName}</span></div>
      <div class="report-stat"><span class="stat-label">STP 면(Face) 수</span><span class="stat-value">${r.stats.metadata.faceCount}개</span></div>
      <div class="report-stat"><span class="stat-label">STP 솔리드 수</span><span class="stat-value">${r.stats.metadata.shellCount}개</span></div>
      ` : ''}
      <div class="report-stat"><span class="stat-label">양산성 점수</span><span class="stat-value">${r.score} / 100</span></div>
      <div class="report-stat"><span class="stat-label">설정 탈형 축</span><span class="stat-value">${App.stl.pullAxis} 축</span></div>
      <div class="report-stat"><span class="stat-label">적용 소재</span><span class="stat-value">${r.stats.material}</span></div>
      <div class="report-stat"><span class="stat-label">삼각 면 수</span><span class="stat-value">${r.stats.triCount.toLocaleString()}개</span></div>
      <div class="report-stat"><span class="stat-label">언더컷 비율</span><span class="stat-value" style="color:#ff4d6d">${r.stats.undercutPct.toFixed(1)}%</span></div>
      <div class="report-stat"><span class="stat-label">수축 위험도</span><span class="stat-value">${r.stats.shrinkRisk}</span></div>
      ${r.diagnostics ? `
      <div class="report-stat" style="border-top:1px dashed #3d4b66; margin-top:8px; padding-top:8px;"><span class="stat-label">사출 온도 (Melt Temp)</span><span class="stat-value">${r.diagnostics.meltTemp} °C</span></div>
      <div class="report-stat"><span class="stat-label">금형 온도 (Mold Temp)</span><span class="stat-value">${r.diagnostics.moldTemp} °C</span></div>
      <div class="report-stat"><span class="stat-label">사출 유량 (Flow Rate)</span><span class="stat-value">${r.diagnostics.flowRate} cm³/s</span></div>
      <div class="report-stat"><span class="stat-label">추정 압력 강하 (ΔP)</span><span class="stat-value" style="color:#ffd166">${r.diagnostics.estimatedPressureDrop.toFixed(1)} MPa</span></div>
      <div class="report-stat"><span class="stat-label">소재 취출 냉각 시간</span><span class="stat-value" style="color:#00ffa3">${r.diagnostics.maxCoolingTime.toFixed(1)} 초</span></div>
      <div class="report-stat"><span class="stat-label">필요 형체력 (F_clamp)</span><span class="stat-value" style="color:#00d4ff">${r.diagnostics.clampingForce.toFixed(1)} Tons</span></div>
      ` : ''}
    </div>`;
  }

  html += '</div>';
  body.innerHTML = html;
}

$('btn-export').addEventListener('click', () => {
  window.print();
});

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
setStatus('ready', '준비');
showToast('DIMA에 오신 것을 환영합니다! DXF 또는 STL 파일을 업로드하세요.', 'info');

function renderMoldFeatures(features) {
  const container = $('mold-features-3d');
  if (!container) return;
  
  if (features) {
    App.stl.moldFeatures = features;
  } else {
    features = App.stl.moldFeatures;
  }
  
  if (!features || (features.slides.length === 0 && features.lifters.length === 0) || !App.stl.showCores) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'flex';
  container.innerHTML = '';
  
  features.slides.forEach((slide, idx) => {
    const div = document.createElement('div');
    div.className = 'feature-card';
    div.style.cursor = 'pointer';
    div.style.border = '1px solid transparent';
    div.style.transition = 'border-color var(--transition), background var(--transition)';
    div.innerHTML = `
      <div class="feature-title" style="color: #00d4ff;">🔩 슬라이드 코어 #${idx+1}</div>
      <div class="feature-desc">
        <span style="color:#00ffa3">방향: ${slide.dir}</span><br/>
        <small>X:${slide.center.x.toFixed(1)}, Y:${slide.center.y.toFixed(1)}, Z:${slide.center.z.toFixed(1)}</small>
      </div>
    `;
    div.addEventListener('mouseenter', () => {
      div.style.borderColor = '#00d4ff';
      div.style.background = 'rgba(0, 212, 255, 0.08)';
      STLAnalyzer.highlightCore('slide', idx+1);
    });
    div.addEventListener('mouseleave', () => {
      div.style.borderColor = 'transparent';
      div.style.background = 'rgba(0, 0, 0, 0.3)';
      STLAnalyzer.resetCoreHighlights();
    });
    container.appendChild(div);
  });
  
  features.lifters.forEach((lifter, idx) => {
    const div = document.createElement('div');
    div.className = 'feature-card';
    div.style.cursor = 'pointer';
    div.style.border = '1px solid transparent';
    div.style.transition = 'border-color var(--transition), background var(--transition)';
    div.innerHTML = `
      <div class="feature-title" style="color: #ff8800;">⚙️ 변형 코어 #${idx+1}</div>
      <div class="feature-desc">
        <span style="color:#00ffa3">방향: ${lifter.dir}</span><br/>
        <small>X:${lifter.center.x.toFixed(1)}, Y:${lifter.center.y.toFixed(1)}, Z:${lifter.center.z.toFixed(1)}</small>
      </div>
    `;
    div.addEventListener('mouseenter', () => {
      div.style.borderColor = '#ff8800';
      div.style.background = 'rgba(255, 136, 0, 0.08)';
      STLAnalyzer.highlightCore('lifter', idx+1);
    });
    div.addEventListener('mouseleave', () => {
      div.style.borderColor = 'transparent';
      div.style.background = 'rgba(0, 0, 0, 0.3)';
      STLAnalyzer.resetCoreHighlights();
    });
    container.appendChild(div);
  });
}

// ══════════════════════════════════════
// DRAGGABLE RESIZER FOR SIDEBAR PANELS
// ══════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  initResizers();
});

function initResizers() {
  document.querySelectorAll('.workspace-layout').forEach(layout => {
    const leftPanel = layout.querySelector('.cad-model-tree-panel');
    const rightPanel = layout.querySelector('.cad-properties-panel');
    const resizerLeft = layout.querySelector('.resizer-left');
    const resizerRight = layout.querySelector('.resizer-right');

    if (resizerLeft && leftPanel) {
      setupResizer(resizerLeft, leftPanel, 'left');
    }
    if (resizerRight && rightPanel) {
      setupResizer(resizerRight, rightPanel, 'right');
    }
  });
}

function setupResizer(resizer, panel, direction) {
  let startX, startWidth;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    resizer.classList.add('dragging');

    document.addEventListener('mousemove', doDrag);
    document.addEventListener('mouseup', stopDrag);
  });

  function doDrag(e) {
    let newWidth;
    if (direction === 'left') {
      newWidth = startWidth + (e.clientX - startX);
      newWidth = Math.max(160, Math.min(newWidth, 480));
    } else {
      newWidth = startWidth - (e.clientX - startX);
      newWidth = Math.max(160, Math.min(newWidth, 480));
    }
    panel.style.width = newWidth + 'px';
    panel.style.minWidth = newWidth + 'px';

    window.dispatchEvent(new Event('resize'));
  }

  function stopDrag() {
    resizer.classList.remove('dragging');
    document.removeEventListener('mousemove', doDrag);
    document.removeEventListener('mouseup', stopDrag);
  }
}

// 2D Canvas resize listener
window.addEventListener('resize', () => {
  const canvas = $('canvas-2d');
  if (canvas && canvas.style.display !== 'none' && App.dxf.parsed) {
    const wrap = canvas.parentElement;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    DXFAnalyzer.initCanvas(canvas, App.dxf.parsed);
  }
});
