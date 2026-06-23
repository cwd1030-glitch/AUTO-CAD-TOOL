/**
 * main.js
 * App orchestration — tab routing, file upload, results display, report
 */

/* ══════════════════════════════════════
   STATE
══════════════════════════════════════ */
const App = {
  currentTab: '3d',
  dxf: { file: null, parsed: null, result: null },
  stl: { file: null, parsed: null, result: null, material: 'ABS', pullAxis: 'Z', flipAxis: false, showCores: false, showParting: false, fillingTime: 2.0, analysisChartMode: 'draft', validationComparison: null, meshDetailQuality: 'ultra' },
  threeInit: false,
};
// const 선언은 window 프로퍼티가 되지 않으므로 명시적으로 전역 노출
// (대시보드/app.js 등에서 window.App 으로 접근 가능하도록)
try { window.App = App; } catch (e) {}

let current2DIssues = [];
let current3DIssues = [];
let current2DFilter = 'all';
let current3DFilter = 'all';

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function $(id) { return document.getElementById(id); }

const MESH_DETAIL_PRESETS = {
  fast: { label: '빠름', resolution: 0.8 },
  fine: { label: '정밀', resolution: 0.35 },
  ultra: { label: '초정밀', resolution: 0.15 }
};

function getMeshDetailPresetName() {
  const key = App.stl.meshDetailQuality || 'ultra';
  return MESH_DETAIL_PRESETS[key] ? key : 'ultra';
}

function getMeshDetailLabel(key = getMeshDetailPresetName()) {
  return (MESH_DETAIL_PRESETS[key] || MESH_DETAIL_PRESETS.ultra).label;
}

function getMeshDetailResolution() {
  return (MESH_DETAIL_PRESETS[getMeshDetailPresetName()] || MESH_DETAIL_PRESETS.ultra).resolution;
}

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

  // Hook up issue list filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = btn.dataset.target;
      const filter = btn.dataset.filter;
      
      // Update active state in UI
      const bar = btn.parentElement;
      bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      if (target === '2d') {
        current2DFilter = filter;
        applyIssuesFilter('issues-list-2d');
      } else {
        current3DFilter = filter;
        applyIssuesFilter('issues-list-3d');
      }
    });
  });
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
  if (id === '2d') id = '3d';
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
      if (input3d) {
        input3d.value = '';
        input3d.click();
      }
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

  document.querySelectorAll('.mesh-detail-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.meshDetail === getMeshDetailPresetName());
    btn.addEventListener('click', () => {
      const detail = btn.dataset.meshDetail || 'ultra';
      App.stl.meshDetailQuality = MESH_DETAIL_PRESETS[detail] ? detail : 'ultra';
      document.querySelectorAll('.mesh-detail-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      logToConsole(`메쉬 정밀도 변경: ${getMeshDetailLabel()} (${getMeshDetailResolution()} mm pitch)`, 'info');
      if (App.stl.file) {
        App.stl.parsed = null;
        App.stl.result = null;
        setTimeout(() => run3DAnalysis(), 40);
      }
    });
  });
});

input3d.addEventListener('change', () => { if (input3d.files[0]) handle3DFile(input3d.files[0]); });

function handle3DFile(file) {
  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.stl') && !ext.endsWith('.stp') && !ext.endsWith('.step')) {
    showToast('STL 또는 STP/STEP 파일만 지원됩니다.', 'error'); return;
  }
  App.dxf.file = null;
  App.stl.file = file;
  App.stl.parsed = null;
  App.stl.result = null;

  $('file-info-3d').style.display = 'block';
  $('file-info-3d').textContent = `파일: ${file.name}`;
  
  // Show sidebar config section for 3D
  const configs3D = $('sidebar-configs-3d');
  if (configs3D) configs3D.style.display = 'block';

  // Show Left Model Tree Part node
  $('tree-node-part').style.display = 'block';
  $('tree-part-name').textContent = file.name;

  showToast('3D 파일을 불러왔습니다. 자동 분석을 시작합니다.', 'ok');
  logToConsole(`3D 사출 모델 파일 로드 완료: ${file.name} (${(file.size/1024).toFixed(1)} KB)`, 'info');

  if (typeof run3DAnalysis === 'function') {
    setTimeout(() => run3DAnalysis(), 80);
  }
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
let physicalReanalysisTimer = null;

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

function refreshMoldflowDashboard() {
  if (window.DimaMoldflow && typeof window.DimaMoldflow.refresh === 'function') {
    window.DimaMoldflow.refresh();
  }
}

function schedulePhysicalReanalysis() {
  if (physicalReanalysisTimer) clearTimeout(physicalReanalysisTimer);
  physicalReanalysisTimer = setTimeout(() => {
    physicalReanalysisTimer = null;
    triggerPhysicalReanalysis();
  }, 260);
}

if (slideMeltTemp) {
  slideMeltTemp.addEventListener('input', () => {
    $('val-melt-temp').textContent = `${slideMeltTemp.value}°C`;
    updatePhysicalParams();
    schedulePhysicalReanalysis();
  });
  slideMeltTemp.addEventListener('change', () => {
    updatePhysicalParams();
    triggerPhysicalReanalysis();
  });
}

if (slideMoldTemp) {
  slideMoldTemp.addEventListener('input', () => {
    $('val-mold-temp').textContent = `${slideMoldTemp.value}°C`;
    updatePhysicalParams();
    schedulePhysicalReanalysis();
  });
  slideMoldTemp.addEventListener('change', () => {
    updatePhysicalParams();
    triggerPhysicalReanalysis();
  });
}

if (slideFlowRate) {
  slideFlowRate.addEventListener('input', () => {
    $('val-flow-rate').textContent = `${slideFlowRate.value} cm³/s`;
    updatePhysicalParams();
    schedulePhysicalReanalysis();
  });
  slideFlowRate.addEventListener('change', () => {
    updatePhysicalParams();
    triggerPhysicalReanalysis();
  });
}

if (slideInjPressure) {
  slideInjPressure.addEventListener('input', () => {
    $('val-inj-pressure').textContent = `${slideInjPressure.value} MPa`;
    updatePhysicalParams();
    schedulePhysicalReanalysis();
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

async function sendDataToPython() {
  if (!App.stl.parsed || !App.stl.file) return;
  
  const gates = STLAnalyzer.getGatePositions().map((gp, gIdx) => {
    return {
      id: gIdx + 1,
      coord: [gp.x, gp.y, gp.z],
      speed_factor: App.stl.gateVelocityRatios && App.stl.gateVelocityRatios[gIdx] !== undefined ? App.stl.gateVelocityRatios[gIdx] : 1.0,
      pressure_factor: 1.0,
      time_delay: 0.0,
      trigger_voxel: null
    };
  });
  
  const meltVal = parseInt($('slide-melt-temp').value);
  const moldVal = parseInt($('slide-mold-temp').value);
  const flowVal = parseInt($('slide-flow-rate').value);
  
  const arrayBuffer = await App.stl.file.arrayBuffer();
  const base64Stl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result.split(',')[1];
      resolve(base64data);
    };
    reader.readAsDataURL(App.stl.file);
  });

  const coolingEnabled = App.stl.coolingEnabled || false;

  const payload = {
    stl_data: base64Stl,
    gates: gates,
    resolution: getMeshDetailResolution(),
    mesh_detail_quality: getMeshDetailPresetName(),
    melt_temp: meltVal,
    eject_temp: 80.0,
    cooling_enabled: coolingEnabled,
    coolant_temp: coolingEnabled ? moldVal : null,
    coolant_flow: 10.0,
    pitch: coolingEnabled ? 50.0 : null,
    depth: 20.0,
    diameter: 10.0
  };

  logToConsole('파이썬 백엔드로 사출/냉각 정밀 해석 요청 중...', 'info');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP 오류: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.status === 'success') {
      logToConsole('백엔드 정밀 해석 연산 완료!', 'success');
      if (data.vertex_temperatures) {
        STLAnalyzer.setVertexTemperatures(data.vertex_temperatures);
      }
      if (data.vertex_fill_times) {
        STLAnalyzer.setFlowDistances(data.vertex_fill_times);
        let maxD = 0;
        data.vertex_fill_times.forEach(d => {
          if (d !== -1.0 && d > maxD) maxD = d;
        });
        STLAnalyzer.setMaxFlowDistance(maxD);
      }
      if (data.vertex_sink_risk) {
        STLAnalyzer.setVertexSinkRisk(data.vertex_sink_risk);
      }
      if (data.weld_lines) {
        STLAnalyzer.updateWeldLines(data.weld_lines);
      }
      // 검증된 솔버가 산출한 수축/휨 요약 지표가 오면 JS 추정값 대신 그 값을 권위값으로 표시
      if (data.validated_metrics) {
        applyValidatedMetrics(data.validated_metrics);
      }
      STLAnalyzer.recolorGeometry();
      return data;
    } else {
      logToConsole(`해석 실패: ${data.message}`, 'error');
    }
  } catch (err) {
    logToConsole(`백엔드 통신 오류: ${err.message}`, 'error');
  }
}

// 러너/온도/유량/압력 등 "형상과 무관한" 설정 변경 시 호출된다.
// 이런 값은 언더컷/Auto-Pull(광선추적) 결과를 바꾸지 않으므로 무거운 형상 재분석(reRun3DAnalysis)을
// 다시 돌리지 않고, 사출 진단(압력/냉각/게이트)과 휨만 즉시 재계산한다. → 풀스크린 로딩창 없이 바로 반영.
async function triggerPhysicalReanalysis() {
  if (!App.stl.parsed) return;

  // 게이트가 있으면 백엔드 정밀 해석 + 기존 유동 재계산 경로 사용(광선추적 없음)
  if (STLAnalyzer.getGatePositions().length > 0) {
    await sendDataToPython();
    const flowRes = await STLAnalyzer.recalculateFlow();
    if (flowRes) {
      updateGateInfoPanel(flowRes);
      updateAnalysisIssuesWithGate(flowRes);
      if (flowRes.diagnostics) {
        updateDiagnosticsPanel(flowRes.diagnostics);
        if (App.stl.result) App.stl.result.diagnostics = flowRes.diagnostics;
      }
      if (flowRes.meshQuality && App.stl.result) {
        App.stl.result.meshQuality = flowRes.meshQuality;
        renderMeshQualityPanel(flowRes.meshQuality);
      }
      if (flowRes.qualityPrediction && App.stl.result) {
        App.stl.result.qualityPrediction = flowRes.qualityPrediction;
      }
      if (flowRes.defects && App.stl.result) {
        App.stl.result.defects = {
          ...(App.stl.result.defects || {}),
          ...flowRes.defects
        };
        try { renderDefectPredictionSummary(App.stl.result.defects); refreshTrustAfterSummary(); } catch (e) {}
      }
      if (App.stl.coolingEnabled && typeof STLAnalyzer.applyOptimalCoolingPlan === 'function') {
        updateCoolingOptimizationPanel(STLAnalyzer.applyOptimalCoolingPlan());
      }
      refreshMoldflowDashboard();
    }
    return;
  }

  // 게이트가 없으면: 형상 재분석 없이 진단/휨만 즉시 갱신
  const thermal = STLAnalyzer.recomputeThermal();
  if (!thermal) {
    // 캐시가 아직 없으면(분석 전) 1회만 정식 분석으로 폴백
    reRun3DAnalysis();
    return;
  }
  if (thermal.diagnostics) {
    updateDiagnosticsPanel(thermal.diagnostics);
    if (App.stl.result) App.stl.result.diagnostics = thermal.diagnostics;
  }
  if (thermal.warpage && App.stl.result && App.stl.result.defects) {
    App.stl.result.defects.warpage = thermal.warpage;
    try { renderDefectPredictionSummary(App.stl.result.defects); refreshTrustAfterSummary(); } catch (e) {}
  }
  if (App.stl.coolingEnabled && typeof STLAnalyzer.applyOptimalCoolingPlan === 'function') {
    updateCoolingOptimizationPanel(STLAnalyzer.applyOptimalCoolingPlan());
  }
  refreshMoldflowDashboard();
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

function setEngineBadge(precise) {
  const el = document.getElementById('engine-badge');
  if (!el) return;

  // 정밀 유동 솔버(번들 solve_cli)가 실패해 로컬 근사로 대체된 경우 최우선 경고.
  // 사용자가 "근사 결과"임을 명확히 알도록 검증값 상태보다 우선 표시한다.
  let fidelity = 'precise';
  try {
    if (window.STLAnalyzer && typeof window.STLAnalyzer.getSolverFidelity === 'function') {
      fidelity = window.STLAnalyzer.getSolverFidelity();
    }
  } catch (e) {}
  if (fidelity === 'approximate') {
    el.textContent = '근사(로컬) 결과 · 정밀 엔진 미사용';
    el.style.color = '#ffb347';
    el.style.borderColor = 'rgba(255,179,71,0.5)';
    el.title = '정밀 분석 엔진을 사용할 수 없어 로컬 근사 알고리즘으로 계산된 결과입니다. 정밀도가 제한됩니다.';
    return;
  }
  el.title = '';

  const calibration = buildCalibrationModel();
  if (precise) {
    el.textContent = '정밀 해석 · 검증 솔버';
    el.style.color = '#00ffa3';
    el.style.borderColor = 'rgba(0,255,163,0.45)';
  } else if (calibration.count > 0) {
    el.textContent = `검증 보정 적용 · 샘플 ${calibration.count}건`;
    el.style.color = '#7dd3fc';
    el.style.borderColor = 'rgba(125,211,252,0.45)';
  } else {
    el.textContent = '형상 기반 예측 · 검증값 필요';
    el.style.color = '#ffd166';
    el.style.borderColor = 'rgba(255,209,102,0.4)';
  }
}

// 검증된 Python 솔버가 보낸 수축/휨 요약 지표를 JS 추정값 대신 권위값으로 반영한다.
// 국부 두께 집중 판정은 수축 후보 계산에 포함한다.
function safeDisplay(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '-';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampTrust(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function percentError(predicted, reference) {
  const p = Number(predicted);
  const r = Number(reference);
  if (!Number.isFinite(p) || !Number.isFinite(r) || Math.abs(r) < 1e-6) return null;
  return Math.abs(p - r) / Math.abs(r) * 100;
}

function trustFromError(err, base = 70) {
  if (err == null) return base;
  if (err <= 5) return 94;
  if (err <= 10) return 86;
  if (err <= 20) return 74;
  if (err <= 35) return 58;
  return 42;
}

const CALIBRATION_STORAGE_KEY = 'dima.injection.calibrationSamples.v1';

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function loadCalibrationSamples() {
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(-100) : [];
  } catch (e) {
    return [];
  }
}

function saveCalibrationSamples(samples) {
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(samples.slice(-100)));
  } catch (e) {}
}

function clearCalibrationSamples() {
  try {
    localStorage.removeItem(CALIBRATION_STORAGE_KEY);
  } catch (e) {}
}

function median(values) {
  const arr = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function getPredictionSnapshot(result = App.stl.result) {
  const r = result || {};
  const base = r._calibrationBase || {};
  const diag = base.diagnostics || r.diagnostics || {};
  const shrink = base.shrinkage || r.defects?.shrinkage || {};
  const warp = base.warpage || r.defects?.warpage || {};
  return {
    fillTime: finiteNumber(diag.fillingTime),
    coolingTime: finiteNumber(diag.maxCoolingTime || diag.coolingTime),
    pressureDrop: finiteNumber(diag.estimatedPressureDrop),
    maxShrinkage: finiteNumber(shrink.maxShrinkage),
    warpMagnitude: finiteNumber(warp.magnitude)
  };
}

function captureCalibrationBase(result) {
  if (!result || result._calibrationBase) return;
  result._calibrationBase = {
    diagnostics: result.diagnostics ? {
      fillingTime: finiteNumber(result.diagnostics.fillingTime),
      maxCoolingTime: finiteNumber(result.diagnostics.maxCoolingTime),
      coolingTime: finiteNumber(result.diagnostics.coolingTime),
      estimatedPressureDrop: finiteNumber(result.diagnostics.estimatedPressureDrop)
    } : null,
    shrinkage: result.defects?.shrinkage ? {
      maxShrinkage: finiteNumber(result.defects.shrinkage.maxShrinkage),
      avgShrinkage: finiteNumber(result.defects.shrinkage.avgShrinkage),
      globalShrinkage: finiteNumber(result.defects.shrinkage.globalShrinkage),
      p90Shrinkage: finiteNumber(result.defects.shrinkage.p90Shrinkage)
    } : null,
    warpage: result.defects?.warpage ? {
      magnitude: finiteNumber(result.defects.warpage.magnitude)
    } : null
  };
}

function restoreCalibrationBase(result) {
  const base = result?._calibrationBase;
  if (!result || !base) return;
  if (base.diagnostics && result.diagnostics) {
    ['fillingTime', 'maxCoolingTime', 'coolingTime', 'estimatedPressureDrop'].forEach(key => {
      if (Number.isFinite(base.diagnostics[key])) result.diagnostics[key] = base.diagnostics[key];
    });
  }
  if (base.shrinkage && result.defects?.shrinkage) {
    ['maxShrinkage', 'avgShrinkage', 'globalShrinkage', 'p90Shrinkage'].forEach(key => {
      if (Number.isFinite(base.shrinkage[key])) result.defects.shrinkage[key] = base.shrinkage[key];
    });
    result.defects.shrinkage.calibrated = false;
  }
  if (base.warpage && result.defects?.warpage && Number.isFinite(base.warpage.magnitude)) {
    result.defects.warpage.magnitude = base.warpage.magnitude;
    result.defects.warpage.calibrated = false;
  }
}

function buildCalibrationModel() {
  const samples = loadCalibrationSamples();
  const keys = ['fillTime', 'coolingTime', 'pressureDrop', 'maxShrinkage', 'warpMagnitude'];
  const factors = {};
  const counts = {};
  keys.forEach(key => {
    const ratios = samples
      .map(sample => {
        const pred = finiteNumber(sample.predicted?.[key]);
        const ref = finiteNumber(sample.reference?.[key]);
        if (!pred || !ref || pred <= 0 || ref <= 0) return null;
        return Math.max(0.35, Math.min(2.5, ref / pred));
      })
      .filter(v => v != null);
    counts[key] = ratios.length;
    factors[key] = ratios.length ? median(ratios) : 1;
  });
  const count = samples.length;
  const usableMetricCount = Object.values(counts).filter(v => v > 0).length;
  return {
    count,
    usableMetricCount,
    factors,
    counts,
    confidence: clampTrust(Math.min(92, 20 + count * 8 + usableMetricCount * 7))
  };
}

function addCalibrationSample(reference) {
  if (!App.stl.result) return { saved: false, reason: '해석 결과 없음' };
  const predicted = getPredictionSnapshot();
  const usable = Object.keys(reference).some(key => finiteNumber(reference[key]) != null && finiteNumber(predicted[key]) != null);
  if (!usable) return { saved: false, reason: '비교 가능한 값 없음' };
  const samples = loadCalibrationSamples();
  samples.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    file: App.stl.file?.name || '',
    material: App.stl.material || '',
    predicted,
    reference
  });
  saveCalibrationSamples(samples);
  return { saved: true, count: samples.length };
}

function applyCalibrationToResult(result) {
  if (!result) return result;
  captureCalibrationBase(result);
  restoreCalibrationBase(result);
  const model = buildCalibrationModel();
  if (model.count < 1 || model.usableMetricCount < 1) {
    result.calibration = model;
    return result;
  }
  const f = model.factors;
  if (result.diagnostics) {
    if (Number.isFinite(result.diagnostics.fillingTime) && model.counts.fillTime > 0) {
      result.diagnostics.fillingTime *= f.fillTime;
    }
    if (Number.isFinite(result.diagnostics.maxCoolingTime) && model.counts.coolingTime > 0) {
      result.diagnostics.maxCoolingTime *= f.coolingTime;
    }
    if (Number.isFinite(result.diagnostics.coolingTime) && model.counts.coolingTime > 0) {
      result.diagnostics.coolingTime *= f.coolingTime;
    }
    if (Number.isFinite(result.diagnostics.estimatedPressureDrop) && model.counts.pressureDrop > 0) {
      result.diagnostics.estimatedPressureDrop *= f.pressureDrop;
    }
  }
  const shrink = result.defects?.shrinkage;
  if (shrink && model.counts.maxShrinkage > 0) {
    ['maxShrinkage', 'avgShrinkage', 'globalShrinkage', 'p90Shrinkage'].forEach(key => {
      if (Number.isFinite(shrink[key])) shrink[key] *= f.maxShrinkage;
    });
    shrink.confidence = Math.max(shrink.confidence || 0, Math.min(96, model.confidence));
    shrink.calibrated = true;
  }
  const warp = result.defects?.warpage;
  if (warp && Number.isFinite(warp.magnitude) && model.counts.warpMagnitude > 0) {
    warp.magnitude *= f.warpMagnitude;
    warp.confidence = Math.max(warp.confidence || 0, Math.min(94, model.confidence));
    warp.calibrated = true;
  }
  result.calibration = model;
  result.validated = true;
  return result;
}

function computeTrustModel() {
  const result = App.stl.result || {};
  const fileName = App.stl.file?.name || '';
  const lower = fileName.toLowerCase();
  const isStep = lower.endsWith('.stp') || lower.endsWith('.step');
  const isStl = lower.endsWith('.stl');
  const gateCount = (typeof STLAnalyzer !== 'undefined' && STLAnalyzer.getGatePositions) ? STLAnalyzer.getGatePositions().length : 0;
  const hasDiagnostics = !!result.diagnostics;
  const hasDefects = !!result.defects;
  const hasRecommendation = !!result.recommendation;
  const hasCooling = !!App.stl.coolingEnabled;
  const hasValidatedSolver = !!result.validated || !!result.precise || !!result.backendValidated;
  const triCount = result.stats?.triCount || App.stl.parsed?.triCount || 0;
  const undercutPct = Number(result.stats?.undercutPct || 0);
  const shrink = result.defects?.shrinkage || {};
  const sink = result.defects?.sink || {};
  const warp = result.defects?.warpage || {};
  const diag = result.diagnostics || {};
  const meshQuality = result.meshQuality || result.mesh_quality || (window.STLAnalyzer && typeof STLAnalyzer.getMeshQuality === 'function' ? STLAnalyzer.getMeshQuality() : null);
  const validation = App.stl.validationComparison || {};
  const evidence = [];
  const limits = [];
  const actions = [];
  const uncertaintyDrivers = [];
  let inputScore = 20;

  if (isStep) {
    inputScore += 18;
    evidence.push('STEP 형상 기반으로 면/쉘 정보를 포함한 검토를 수행했습니다.');
  } else if (isStl) {
    inputScore += 10;
    limits.push('STL은 삼각형 메쉬 기반이라 원본 CAD 피처와 정확한 두께 정보가 제한됩니다.');
  } else {
    limits.push('지원 형식 정보가 부족하여 입력 품질 점수를 낮게 평가했습니다.');
  }

  if (triCount >= 50000) {
    inputScore += 12;
    evidence.push(`메쉬 해상도 ${Math.round(triCount).toLocaleString()}개 면으로 형상 샘플이 충분합니다.`);
  } else if (triCount >= 5000) {
    inputScore += 8;
    evidence.push(`메쉬 해상도 ${Math.round(triCount).toLocaleString()}개 면으로 기본 검토가 가능합니다.`);
  } else {
    inputScore += 2;
    limits.push('메쉬 해상도가 낮아 국부 결함 위치 정확도가 제한될 수 있습니다.');
  }

  if (meshQuality) {
    const meshScore = Number(meshQuality.score);
    if (meshQuality.status === 'pass' || meshScore >= 82) {
      inputScore += 12;
      evidence.push(`메쉬 설정 검증 ${Number.isFinite(meshScore) ? Math.round(meshScore) : '-'}점으로 해석 가능한 상태입니다.`);
    } else if (meshQuality.status === 'fail' || meshScore < 55) {
      inputScore -= 14;
      limits.push('메쉬 설정 검증에서 실패 항목이 있어 CADMOULD식 재메쉬/수정 후 해석을 권장합니다.');
      uncertaintyDrivers.push('메쉬 품질 실패');
      actions.push('열린 경계, non-manifold 엣지, 비정상 삼각형을 수정한 뒤 다시 업로드');
    } else {
      inputScore += 3;
      limits.push('메쉬 설정 검증에 경고가 있어 결과 위치 정밀도에 오차가 생길 수 있습니다.');
      uncertaintyDrivers.push('메쉬 품질 경고');
      actions.push('메쉬 검증 패널의 수정 권장 항목 확인');
    }
  } else {
    limits.push('메쉬 설정 검증값이 아직 없어 해석 전 메쉬 승인 상태를 확인해야 합니다.');
  }

  if (App.stl.material) {
    inputScore += 10;
    evidence.push(`소재 ${App.stl.material} 기준 수축률과 공정 윈도우를 적용했습니다.`);
  } else {
    limits.push('소재가 지정되지 않아 재질별 수축/냉각 판단 신뢰도가 낮습니다.');
  }

  if (gateCount > 0) {
    inputScore += 12;
    evidence.push(`게이트 ${gateCount}개 기준으로 유동거리와 압력강하를 갱신했습니다.`);
  } else {
    limits.push('게이트 위치가 없어 충전/보압/수축 위치 판단은 추정치입니다.');
  }

  if (hasDiagnostics) {
    inputScore += 12;
    evidence.push(`충전 시간 ${safeDisplay(diag.fillingTime, 2)}s, 압력강하 ${safeDisplay(diag.estimatedPressureDrop, 1)}MPa 진단값을 반영했습니다.`);
  } else {
    limits.push('압력강하, 충전시간, 형체력 진단값이 없어 공정 신뢰도가 낮습니다.');
  }

  if (hasCooling) {
    inputScore += 8;
    evidence.push('냉각 ON 상태로 냉각 시간 편차를 수축/변형 위험에 반영했습니다.');
  } else {
    limits.push('냉각 회로가 꺼져 있어 수축/변형 위험은 냉각 보정 전 기준입니다.');
  }

  if (hasValidatedSolver) {
    inputScore += 15;
    evidence.push('검증된 백엔드 또는 외부 해석 결과가 반영되었습니다.');
  } else {
    limits.push('현재 결과는 실제 Moldflow/시사출 데이터와 직접 교정된 값이 아닙니다.');
  }

  if (hasDefects) {
    evidence.push(`수축 후보 ${sink.count || 0}개, 최대 수축 ${safeDisplay(shrink.maxShrinkage, 2)}%, 평균 ${safeDisplay(shrink.avgShrinkage, 2)}%를 기준으로 위험도를 산정했습니다.`);
    evidence.push(`변형 위험 ${warp.risk || '-'}, 방향 ${warp.direction || '-'}, 변형량 ${safeDisplay(warp.magnitude, 2)}mm를 표시했습니다.`);
  }

  if (hasRecommendation) {
    evidence.push(`권장 탈형 방향 ${result.recommendation.bestDirection || '-'}, 방향 신뢰도 ${result.recommendation.confidence ?? '-'}%를 계산했습니다.`);
  }

  if (undercutPct > 0) {
    evidence.push(`언더컷 비율 ${undercutPct.toFixed(1)}%가 금형성 점수에 반영되었습니다.`);
  }

  const fillErr = percentError(diag.fillingTime, validation.fillTime);
  const coolErr = percentError(diag.maxCoolingTime || diag.coolingTime, validation.coolingTime);
  const pressureErr = percentError(diag.estimatedPressureDrop, validation.pressureDrop);
  const shrinkErr = percentError(shrink.maxShrinkage, validation.maxShrinkage);
  const warpMagErr = percentError(warp.magnitude, validation.warpMagnitude);
  const calibrationModel = buildCalibrationModel();
  const hasValidation = validation.fillTime || validation.coolingTime || validation.pressureDrop || validation.maxShrinkage || validation.warpMagnitude || validation.warpMatch || validation.trialResult;
  const paperBasis = [];
  let validationBonus = 0;
  if (fillErr != null) {
    validationBonus += fillErr <= 15 ? 8 : fillErr <= 30 ? 3 : -5;
    evidence.push(`Moldflow 충전시간 비교 오차 ${fillErr.toFixed(1)}%를 신뢰도에 반영했습니다.`);
  }
  if (coolErr != null) {
    validationBonus += coolErr <= 15 ? 8 : coolErr <= 30 ? 3 : -5;
    evidence.push(`Moldflow 냉각시간 비교 오차 ${coolErr.toFixed(1)}%를 신뢰도에 반영했습니다.`);
  }
  if (pressureErr != null) {
    validationBonus += pressureErr <= 18 ? 8 : pressureErr <= 35 ? 3 : -5;
    evidence.push(`Moldflow 압력강하 비교 오차 ${pressureErr.toFixed(1)}%를 신뢰도에 반영했습니다.`);
  }
  if (shrinkErr != null) {
    validationBonus += shrinkErr <= 12 ? 9 : shrinkErr <= 25 ? 4 : -6;
    evidence.push(`수축률 비교 오차 ${shrinkErr.toFixed(1)}%를 신뢰도와 보정계수에 반영했습니다.`);
  }
  if (warpMagErr != null) {
    validationBonus += warpMagErr <= 15 ? 8 : warpMagErr <= 30 ? 3 : -6;
    evidence.push(`변형량 비교 오차 ${warpMagErr.toFixed(1)}%를 신뢰도와 보정계수에 반영했습니다.`);
  }
  if (validation.warpMatch === 'yes') {
    validationBonus += 6;
    evidence.push('Moldflow/실측 변형 방향과 DIMA 변형 방향이 일치합니다.');
  } else if (validation.warpMatch === 'no') {
    validationBonus -= 8;
    limits.push('Moldflow/실측 변형 방향과 DIMA 예측 방향이 불일치합니다.');
  }
  if (validation.trialResult === 'pass') {
    validationBonus += 7;
    evidence.push('시사출 결과 양품 기록이 반영되었습니다.');
  } else if (validation.trialResult === 'fail') {
    validationBonus -= 7;
    limits.push('시사출 불량 기록이 있어 DIMA 위험 예측을 재검토해야 합니다.');
  }
  if (!hasValidation) {
    limits.push('Moldflow 또는 시사출 비교값이 아직 없어 신뢰도는 내부 추정 기준입니다.');
    uncertaintyDrivers.push('비교 검증값 없음');
    actions.push('Moldflow 충전시간/냉각시간/압력강하 중 최소 2개 이상 입력');
  }

  if (!gateCount) {
    uncertaintyDrivers.push('게이트 미지정');
    actions.push('게이트 위치를 지정한 뒤 충전/보압 결과 재계산');
  }
  if (!hasCooling) {
    uncertaintyDrivers.push('냉각 조건 미적용');
    actions.push('냉각 탭을 켜고 냉각 위치/시간 분포 확인');
  }
  if (!hasDiagnostics) {
    uncertaintyDrivers.push('공정 진단값 부족');
    actions.push('수지온도, 금형온도, 사출속도, 압력 한계 입력 후 재분석');
  }
  if (triCount < 50000) {
    uncertaintyDrivers.push('메쉬 해상도 제한');
    actions.push('가능하면 원본 STEP 또는 더 높은 해상도 STL 사용');
  }
  if (calibrationModel.count > 0) {
    evidence.push(`누적 검증 샘플 ${calibrationModel.count}건의 중앙값 보정계수를 해석값에 적용합니다.`);
  } else {
    actions.push('검증값 적용 버튼으로 첫 보정 샘플 저장');
  }

  paperBasis.push('Moldflow surrogate 연구 기준: 게이트 거리, 게이트 정보, 형상 피처가 충전시간/변형 분포 신뢰도에 중요합니다.');
  paperBasis.push('Warpage 불확실성 연구 기준: 금형온도, 사출속도, 보압, 보압시간 변화에 대한 강건성 확인이 필요합니다.');
  paperBasis.push('Conformal cooling 연구 기준: 냉각시간, 온도구배, 잔류응력, 변형량을 함께 낮춰야 냉각 신뢰도가 올라갑니다.');
  paperBasis.push('온라인 품질 예측 연구 기준: 실제 공정/센서/시사출 데이터 해상도가 낮으면 예측 신뢰도가 떨어집니다.');

  limits.push('최종 양산 판단 전 실제 소재 PVT 데이터, 사출기 용량, 금형 냉각 회로, 시사출 측정값으로 검증해야 합니다.');
  limits.push('Moldflow 비교값을 입력하면 이 신뢰도는 자동으로 상향/하향 보정되어야 합니다.');

  const inputQuality = clampTrust(inputScore);
  const issuePenalty = (result.issues || []).reduce((sum, item) => sum + (item.level === 'error' ? 7 : item.level === 'warning' ? 3 : 0), 0);
  const defectPenalty = Math.min(18, (sink.count || 0) * 0.8 + (warp.risk === 'HIGH' ? 8 : warp.risk === 'MEDIUM' ? 4 : 0));
  const shrinkConfidence = Number.isFinite(Number(shrink.confidence)) ? Number(shrink.confidence) : null;
  const shrinkUncertainty = Number.isFinite(Number(shrink.uncertainty)) ? Number(shrink.uncertainty) : null;
  const warpConfidence = Number.isFinite(Number(warp.confidence)) ? Number(warp.confidence) : null;
  const warpUncertainty = Number.isFinite(Number(warp.uncertainty)) ? Number(warp.uncertainty) : null;
  const category = {
    fill: clampTrust(trustFromError(fillErr, hasDiagnostics && gateCount ? 74 : 52) + (gateCount ? 6 : -8)),
    shrink: clampTrust((hasDefects ? 66 : 45) + (App.stl.material ? 8 : -8) + (hasCooling ? 7 : -4) + (hasValidation ? 8 : 0) + (shrinkErr != null ? (trustFromError(shrinkErr, 70) - 70) * 0.25 : 0) + (shrinkConfidence != null ? (shrinkConfidence - 60) * 0.25 : 0) - (shrinkUncertainty != null ? shrinkUncertainty * 0.10 : 0) - Math.min(18, sink.count || 0)),
    cooling: clampTrust(trustFromError(coolErr, hasCooling ? 72 : 46) + (hasCooling ? 8 : -10)),
    warpage: clampTrust((warp.risk ? 62 : 42) + (hasCooling ? 7 : -4) + (warpMagErr != null ? (trustFromError(warpMagErr, 70) - 70) * 0.22 : 0) + (warpConfidence != null ? (warpConfidence - 55) * 0.25 : 0) - (warpUncertainty != null ? warpUncertainty * 0.08 : 0) + (validation.warpMatch === 'yes' ? 18 : validation.warpMatch === 'no' ? -18 : 0)),
    tooling: clampTrust(72 + (isStep ? 8 : 0) + (hasRecommendation ? 8 : -6) - Math.min(18, undercutPct * 0.4))
  };
  const uncertainty = {
    fill: clampTrust(100 - category.fill + (!validation.fillTime ? 12 : 0)),
    shrink: clampTrust(shrinkUncertainty != null ? shrinkUncertainty + (!validation.trialResult ? 8 : 0) : 100 - category.shrink + (!hasCooling ? 10 : 0) + (!validation.trialResult ? 8 : 0)),
    cooling: clampTrust(100 - category.cooling + (!validation.coolingTime ? 12 : 0)),
    warpage: clampTrust(warpUncertainty != null ? warpUncertainty + (!validation.warpMatch ? 8 : 0) : 100 - category.warpage + (!validation.warpMatch ? 12 : 0)),
    tooling: clampTrust(100 - category.tooling + (isStep ? 0 : 10))
  };
  const categoryAvg = Object.values(category).reduce((a, b) => a + b, 0) / Object.keys(category).length;
  const overall = clampTrust((inputQuality * 0.45) + (categoryAvg * 0.55) - issuePenalty - defectPenalty + validationBonus + (hasValidatedSolver ? 8 : 0) + Math.min(8, calibrationModel.count * 1.5));
  const grade = overall >= 82 ? '검증 보강됨' : overall >= 65 ? '설계 검토용' : overall >= 45 ? '초기 검토' : '검증 데이터 필요';

  return {
    overall,
    inputQuality,
    grade,
    category,
    uncertainty,
    validation: { fillErr, coolErr, pressureErr, shrinkErr, warpMagErr, hasValidation },
    calibration: calibrationModel,
    paperBasis,
    actions: Array.from(new Set(actions)).slice(0, 5),
    uncertaintyDrivers: Array.from(new Set(uncertaintyDrivers)).slice(0, 5),
    evidence: evidence.slice(0, 6),
    limits: Array.from(new Set(limits)).slice(0, 5)
  };
}

function renderTrustPanel() {
  const panel = $('trust-panel-3d');
  if (!panel || !App.stl.result) return;
  const trust = computeTrustModel();
  const validation = App.stl.validationComparison || {};
  panel.style.display = 'block';
  $('trust-overall-score').textContent = `${trust.overall}%`;
  $('trust-input-quality').textContent = `${trust.inputQuality}%`;
  $('trust-analysis-grade').textContent = trust.grade;
  const fill = $('trust-meter-fill');
  if (fill) {
    fill.style.width = `${trust.overall}%`;
    fill.style.background = trust.overall >= 75 ? 'linear-gradient(90deg,#00a3ff,#00d46a)' : trust.overall >= 55 ? 'linear-gradient(90deg,#00a3ff,#f2e600)' : 'linear-gradient(90deg,#f2e600,#ff3300)';
  }
  const evidenceList = $('trust-evidence-list');
  const limitList = $('trust-limit-list');
  const categoryGrid = $('trust-category-grid');
  if (categoryGrid) {
    const names = { fill: '충전', shrink: '수축', cooling: '냉각', warpage: '변형', tooling: '금형성' };
    categoryGrid.innerHTML = Object.keys(trust.category).map(key => {
      const val = trust.category[key];
      const band = trust.uncertainty?.[key] ?? 0;
      return `<div><span>${names[key]}</span><b>${val}%</b><i style="width:${val}%"></i><em>±${band}%</em></div>`;
    }).join('');
  }
  const uncertaintyBox = $('trust-uncertainty-box');
  if (uncertaintyBox) {
    const avgBand = Math.round(Object.values(trust.uncertainty || {}).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(trust.uncertainty || {}).length));
    uncertaintyBox.innerHTML = `<b>불확실성 폭 ±${avgBand}%</b><span>${trust.uncertaintyDrivers.length ? trust.uncertaintyDrivers.join(' / ') : '주요 누락 조건 없음'}</span>`;
  }
  const paperList = $('trust-paper-basis-list');
  const actionList = $('trust-action-list');
  if (paperList) paperList.innerHTML = trust.paperBasis.map(item => `<li>${item}</li>`).join('');
  if (actionList) actionList.innerHTML = (trust.actions.length ? trust.actions : ['현재 입력 기준에서 추가 액션 없음']).map(item => `<li>${item}</li>`).join('');
  const calibrationStatus = $('trust-calibration-status');
  if (calibrationStatus) {
    const c = trust.calibration || buildCalibrationModel();
    calibrationStatus.textContent = `보정 샘플 ${c.count}건 · 보정 신뢰도 ${c.confidence}% · 적용 항목 ${c.usableMetricCount}개`;
  }
  if (evidenceList) evidenceList.innerHTML = trust.evidence.map(item => `<li>${item}</li>`).join('');
  if (limitList) limitList.innerHTML = trust.limits.map(item => `<li>${item}</li>`).join('');
  if ($('trust-mf-fill')) $('trust-mf-fill').value = validation.fillTime || '';
  if ($('trust-mf-cool')) $('trust-mf-cool').value = validation.coolingTime || '';
  if ($('trust-mf-pressure')) $('trust-mf-pressure').value = validation.pressureDrop || '';
  if ($('trust-mf-shrink')) $('trust-mf-shrink').value = validation.maxShrinkage || '';
  if ($('trust-mf-warp-mm')) $('trust-mf-warp-mm').value = validation.warpMagnitude || '';
  if ($('trust-mf-warp')) $('trust-mf-warp').value = validation.warpMatch || '';
  if ($('trust-trial-result')) $('trust-trial-result').value = validation.trialResult || '';
  bindTrustValidationInputs();
}

function bindTrustValidationInputs() {
  const btn = $('trust-apply-validation');
  const resetBtn = $('trust-reset-calibration');
  if (btn && btn.dataset.bound !== '1') {
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const readNumber = (id) => {
        const el = $(id);
        const n = Number(el && el.value);
        return Number.isFinite(n) && el.value !== '' ? n : null;
      };
      App.stl.validationComparison = {
        fillTime: readNumber('trust-mf-fill'),
        coolingTime: readNumber('trust-mf-cool'),
        pressureDrop: readNumber('trust-mf-pressure'),
        maxShrinkage: readNumber('trust-mf-shrink'),
        warpMagnitude: readNumber('trust-mf-warp-mm'),
        warpMatch: $('trust-mf-warp')?.value || '',
        trialResult: $('trust-trial-result')?.value || ''
      };
      const sampleResult = addCalibrationSample({
        fillTime: App.stl.validationComparison.fillTime,
        coolingTime: App.stl.validationComparison.coolingTime,
        pressureDrop: App.stl.validationComparison.pressureDrop,
        maxShrinkage: App.stl.validationComparison.maxShrinkage,
        warpMagnitude: App.stl.validationComparison.warpMagnitude
      });
      if (sampleResult.saved && App.stl.result) {
        applyCalibrationToResult(App.stl.result);
        if (App.stl.result.defects) renderDefectPredictionSummary(App.stl.result.defects);
        if (App.stl.result.diagnostics) updateDiagnosticsPanel(App.stl.result.diagnostics);
      }
      renderTrustPanel();
      refreshMoldflowDashboard();
      showToast(sampleResult.saved ? `검증값 저장 및 자동 보정 적용 (${sampleResult.count}건)` : '검증값을 신뢰도에 반영했습니다.', 'ok');
    });
  }
  if (resetBtn && resetBtn.dataset.bound !== '1') {
    resetBtn.dataset.bound = '1';
    resetBtn.addEventListener('click', () => {
      clearCalibrationSamples();
      if (App.stl.result) {
        restoreCalibrationBase(App.stl.result);
        App.stl.result.validated = false;
        App.stl.result.calibration = buildCalibrationModel();
        if (App.stl.result.defects) renderDefectPredictionSummary(App.stl.result.defects);
        if (App.stl.result.diagnostics) updateDiagnosticsPanel(App.stl.result.diagnostics);
      }
      setEngineBadge(false);
      renderTrustPanel();
      refreshMoldflowDashboard();
      showToast('누적 보정 샘플을 초기화했습니다.', 'info');
    });
  }
}

function applyValidatedMetrics(m) {
  if (!m || !App.stl.result || !App.stl.result.defects) return;
  const d = App.stl.result.defects;
  if (m.shrinkage) {
    d.shrinkage = Object.assign({}, d.shrinkage, {
      avgShrinkage: m.shrinkage.avgShrinkage,
      maxShrinkage: m.shrinkage.maxShrinkage,
      p90Shrinkage: m.shrinkage.p90Shrinkage,
      riskLevel: m.shrinkage.riskLevel
    });
  }
  if (m.warpage) {
    d.warpage = Object.assign({}, d.warpage, {
      magnitude: m.warpage.magnitude,
      direction: m.warpage.direction,
      risk: m.warpage.risk
    });
  }
  renderDefectPredictionSummary(d);
  refreshTrustAfterSummary();
  setEngineBadge(true);
}

function renderDefectPredictionSummary(defects) {
  if (!defects) {
    const card = $('defect-summary-card-3d');
    if (card) card.style.display = 'none';
    return;
  }
  setEngineBadge(false);
  const sink = defects.sink;
  const shrinkage = defects.shrinkage;
  const warpage = defects.warpage;
  
  $('defect-summary-card-3d').style.display = 'block';
  
  const sinkRiskEl = $('defect-sink-risk');
  sinkRiskEl.textContent = `${sink.severity} (개수: ${sink.count}개, 면적: ${sink.area}㎟)`;
  sinkRiskEl.style.color = sink.severity === 'HIGH' ? '#ff4d6d' : (sink.severity === 'MEDIUM' ? '#ffd166' : '#00ffa3');

  const shrinkRiskEl = $('defect-shrink-risk');
  const combinedShrinkRank = Math.max(
    sink.severity === 'HIGH' ? 3 : sink.severity === 'MEDIUM' ? 2 : 1,
    shrinkage.riskLevel === 'HIGH' ? 3 : shrinkage.riskLevel === 'MEDIUM' ? 2 : 1
  );
  const combinedShrinkLabel = combinedShrinkRank >= 3 ? 'HIGH' : combinedShrinkRank === 2 ? 'MEDIUM' : 'LOW';
  shrinkRiskEl.textContent = `${combinedShrinkLabel} (후보: ${sink.count}개, 최대 수축: ${shrinkage.maxShrinkage.toFixed(2)}%, 평균: ${shrinkage.avgShrinkage.toFixed(2)}%)`;
  shrinkRiskEl.style.color = combinedShrinkRank >= 3 ? '#ff4d6d' : (combinedShrinkRank === 2 ? '#ffd166' : '#00ffa3');

  const warpRiskEl = $('defect-warp-risk');
  warpRiskEl.textContent = `${warpage.risk} (방향: ${warpage.direction}, 변위: ${warpage.magnitude.toFixed(2)}mm)`;
  warpRiskEl.style.color = warpage.risk === 'HIGH' ? '#ff4d6d' : (warpage.risk === 'MEDIUM' ? '#ffd166' : '#00ffa3');

  const critAreasEl = $('defect-critical-areas');
  let criticalText = '';
  if (sink.count > 0 || shrinkage.riskLevel !== 'LOW' || warpage.risk !== 'LOW') {
    criticalText = `수축 우려지점 ${sink.count}개소`;
    if (warpage.magnitude > 0.05) {
      criticalText += `, ${warpage.direction} 방향 최대 변위부`;
    }
  } else {
    criticalText = '눈에 띄는 집중 불량 영역 없음';
  }
  critAreasEl.textContent = criticalText;

  const recoActionsEl = $('defect-reco-actions');
  recoActionsEl.innerHTML = '';
  const actions = new Set();
  
  if (sink.recommendations) sink.recommendations.forEach(r => actions.add(r));
  if (shrinkage.recommendations) shrinkage.recommendations.forEach(r => actions.add(r));
  if (warpage.recommendations) warpage.recommendations.forEach(r => actions.add(r));
  
  if (actions.size === 0) {
    actions.add('현재 사출/금형 구조 설계 유지 권장');
  }
  actions.forEach(act => {
    const li = document.createElement('li');
    li.textContent = act;
    recoActionsEl.appendChild(li);
  });

  const confidence = Math.max(75, 100 - (sink.count * 1.5) - (warpage.score * 0.2));
  $('defect-confidence-score').textContent = `신뢰도: ${Math.round(confidence)}%`;
}

function refreshTrustAfterSummary() {
  try { renderTrustPanel(); } catch (e) {}
}

function renderMeshQualityPanel(quality) {
  const panel = $('mesh-quality-3d');
  if (!panel) return;
  const q = quality || App.stl.result?.meshQuality || App.stl.result?.mesh_quality ||
    (window.STLAnalyzer && typeof STLAnalyzer.getMeshQuality === 'function' ? STLAnalyzer.getMeshQuality() : null);
  if (!q) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'flex';
  const status = String(q.status || 'warning').toLowerCase();
  const statusText = status === 'pass' ? '메쉬 통과' : status === 'fail' || status === 'error' ? '수정 필요' : '검토 필요';
  const statusEl = $('mesh-quality-status');
  if (statusEl) {
    statusEl.textContent = statusText;
    statusEl.className = status;
  }
  const setText = (id, value) => {
    const el = $(id);
    if (el) el.textContent = value;
  };
  setText('mesh-quality-score', `${Number.isFinite(Number(q.score)) ? Math.round(Number(q.score)) : '-'} / 100`);
  setText('mesh-quality-triangles', Number.isFinite(Number(q.triangle_count)) ? Number(q.triangle_count).toLocaleString() : '-');
  setText('mesh-quality-vertices', Number.isFinite(Number(q.vertex_count)) ? Number(q.vertex_count).toLocaleString() : '-');
  setText('mesh-quality-watertight', q.watertight === true ? 'OK' : q.watertight === false ? '확인 필요' : '-');
  setText('mesh-quality-pitch', Number.isFinite(Number(q.voxel_pitch_mm)) ? `${Number(q.voxel_pitch_mm).toFixed(3)} mm` : '로컬 검사');
  setText('mesh-quality-detail', q.mesh_detail_label || getMeshDetailLabel(q.mesh_detail_preset || q.meshDetailPreset || getMeshDetailPresetName()));
  setText('mesh-quality-cells', Number.isFinite(Number(q.cells_on_min_dimension)) ? Number(q.cells_on_min_dimension).toFixed(1) : '-');
  setText('mesh-quality-degenerate', Number.isFinite(Number(q.degenerate_triangles)) ? Number(q.degenerate_triangles).toLocaleString() : '-');
  setText('mesh-quality-nonmanifold', Number.isFinite(Number(q.nonmanifold_edges)) ? Number(q.nonmanifold_edges).toLocaleString() : '-');
  const list = $('mesh-quality-actions');
  if (list) {
    const items = []
      .concat(Array.isArray(q.issues) ? q.issues : [])
      .concat(Array.isArray(q.recommendations) ? q.recommendations : [])
      .filter(Boolean);
    list.innerHTML = (items.length ? items.slice(0, 5) : ['메쉬 설정이 해석 가능한 상태입니다. 게이트와 공정 조건을 지정한 뒤 분석을 진행하십시오.'])
      .map(item => `<li>${escapeHtml(item)}</li>`)
      .join('');
  }
}

async function reRun3DAnalysis() {
  if (!App.stl.parsed) return;
  setStatus('busy', '3D 재분석 중');
  logToConsole(`[재해석] 설정값 변경에 따른 3D 형상 분석 재수행 중... (${App.stl.material}, ${App.stl.pullAxis}축)`, 'system');
  
  STLAnalyzer.clearGate();
  $('gate-info-3d').style.display = 'none';
  $('flow-controls').style.display = 'none';
  updateViewerAnalysisChart('draft');
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
  applyCalibrationToResult(result);
  App.stl.result = result;
  renderMeshQualityPanel(result.meshQuality || result.mesh_quality);

  // 대시보드 자동 갱신(비침습 훅: 로드 실패와 무관하게 안전)
  try { if (window.DimaDashboard) window.DimaDashboard.ingest(result); } catch (e) {}

  $('results-3d').style.display = 'flex';
  animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', result.score);
  renderMoldFeatures(result.moldFeatures);
  renderIssues('issues-list-3d', result.issues);
  
  if (result.defects) {
    renderDefectPredictionSummary(result.defects);
    refreshTrustAfterSummary();
  }

  
  // 최적 성형방향 추천 UI 반영
  if (result.recommendation) {
    const reco = result.recommendation;
    const bestScoreMap = reco.scoresMap[reco.bestDirection] || {};

    $('recommendation-info-3d').style.display = 'flex';
    $('reco-direction').textContent = `${reco.bestDirection} 방향 (권장)`;
    $('reco-confidence').textContent = `${reco.confidence}%`;
    $('reco-complexity').textContent = `${reco.complexityScore}점 (${reco.complexityLevel})`;
    
    $('reco-proj-area').textContent = `${(bestScoreMap.projectedArea / 100).toFixed(1)} ㎠`;
    $('reco-undercut-area').textContent = `${Math.round(bestScoreMap.undercutArea).toLocaleString()} ㎟`;
    $('reco-slides').textContent = `${bestScoreMap.slideCount} 개`;
    $('reco-lifters').textContent = `${bestScoreMap.lifterCount} 개`;

    if (App.stl.pullAxis === 'AUTO') {
      const cleanAxis = reco.bestDirection.replace(/[^XYZ]/g, '');
      const cleanFlip = reco.bestDirection.startsWith('-');
      
      App.stl.pullAxis = cleanAxis;
      App.stl.flipAxis = cleanFlip;

      document.querySelectorAll('.axis-btn').forEach(btn => {
        if (btn.getAttribute('data-axis') === cleanAxis) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      const flipBtn = $('btn-flip-axis');
      if (flipBtn) {
        flipBtn.classList.toggle('active', cleanFlip);
      }

      STLAnalyzer.setPullAxis(cleanAxis);
      STLAnalyzer.setFlipAxis(cleanFlip);
      STLAnalyzer.recolorGeometry();
      logToConsole(`[AUTO 엔진] 최적 성형방향인 ${reco.bestDirection} 축으로 추천 성형 방향이 자동 적용되었습니다.`, 'success');
    }
  } else {
    $('recommendation-info-3d').style.display = 'none';
  }

  if (result.diagnostics) {
    updateDiagnosticsPanel(result.diagnostics);
  }

  await STLAnalyzer.updateCoreHelpers(App.stl.showCores);
  STLAnalyzer.updatePartingLine(App.stl.showParting, parseInt($('parting-slider').value));
  setStatus('ready', '3D 분석 완료');
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
      stlData = await STLAnalyzer.parseSTP(buf, getMeshDetailPresetName());
    } else {
      stlData = STLAnalyzer.parseSTL(buf);
      stlData.metadata = Object.assign({}, stlData.metadata || {}, {
        meshDetailPreset: getMeshDetailPresetName(),
        meshDetailLabel: getMeshDetailLabel()
      });
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
                clearPrimaryOverlayButtons();
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
  renderMeshQualityPanel();
  await STLAnalyzer.updateCoreHelpers(App.stl.showCores);
    STLAnalyzer.updatePartingLine(App.stl.showParting, 50);

    // Analysis
    const result = await STLAnalyzer.analyze(stlData, App.stl.material, (pct, text) => {
      setProgress(pct);
      if (text) $('loading-text').textContent = text;
    });
    if (isSTP) {
      var _stpParsed = App.stl.parsed || {};
      var _stpSim = !!_stpParsed.isSimulated;
      result.issues.unshift({
        level: 'info',
        title: _stpSim ? 'STP 가상 분석 모드 활성화' : 'STP 정밀 메쉬 분석 완료',
        desc: _stpSim
          ? 'STP 파일에서 메타데이터를 추출해 가상 검증을 실행했습니다. 정밀 메쉬 기하 분석이 필요하면 STL로 변환 후 업로드해 주세요.'
          : 'STEP 형상을 실제 3D 메쉬로 테셀레이션하여 정밀 분석했습니다. 사출 유동·냉각 해석도 동일 메쉬로 수행됩니다.'
      });
    }
    applyCalibrationToResult(result);
  App.stl.result = result;
  renderMeshQualityPanel(result.meshQuality || result.mesh_quality);

    $('results-3d').style.display = 'flex';
    animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', result.score);
    renderMoldFeatures(result.moldFeatures);
    renderIssues('issues-list-3d', result.issues);

    // 통합 결함 예측 요약 (Defect Prediction Summary Card) 반영
    if (result.defects) {
      renderDefectPredictionSummary(result.defects);
      refreshTrustAfterSummary();
    }
    
    // 최적 성형방향 추천 UI 반영
    if (result.recommendation) {
      const reco = result.recommendation;
      const bestScoreMap = reco.scoresMap[reco.bestDirection] || {};

      $('recommendation-info-3d').style.display = 'flex';
      $('reco-direction').textContent = `${reco.bestDirection} 방향 (권장)`;
      $('reco-confidence').textContent = `${reco.confidence}%`;
      $('reco-complexity').textContent = `${reco.complexityScore}점 (${reco.complexityLevel})`;
      
      // 추가 요구사항 파라미터 매핑
      $('reco-proj-area').textContent = `${(bestScoreMap.projectedArea / 100).toFixed(1)} ㎠`;
      $('reco-undercut-area').textContent = `${Math.round(bestScoreMap.undercutArea).toLocaleString()} ㎟`;
      $('reco-slides').textContent = `${bestScoreMap.slideCount} 개`;
      $('reco-lifters').textContent = `${bestScoreMap.lifterCount} 개`;

      // 만약 AUTO 모드 상태라면 최적 추천 방향을 자동으로 모델 뷰어와 설정에 대입합니다.
      if (App.stl.pullAxis === 'AUTO') {
        const cleanAxis = reco.bestDirection.replace(/[^XYZ]/g, '');
        const cleanFlip = reco.bestDirection.startsWith('-');
        
        App.stl.pullAxis = cleanAxis;
        App.stl.flipAxis = cleanFlip;

        // UI 상태 동기화
        document.querySelectorAll('.axis-btn').forEach(btn => {
          if (btn.getAttribute('data-axis') === cleanAxis) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
        
        const flipBtn = $('btn-flip-axis');
        if (flipBtn) {
          flipBtn.classList.toggle('active', cleanFlip);
        }

        STLAnalyzer.setPullAxis(cleanAxis);
        STLAnalyzer.setFlipAxis(cleanFlip);
        STLAnalyzer.recolorGeometry();
        logToConsole(`[AUTO 엔진] 최적 성형방향인 ${reco.bestDirection} 축으로 추천 성형 방향이 자동 적용되었습니다.`, 'success');
      }
    } else {
      $('recommendation-info-3d').style.display = 'none';
    }

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

// Overlays (Draft, Flow, Shrinkage, Warpage)
const PRIMARY_OVERLAY_BUTTON_IDS = [
  'btn-draft-overlay',
  'btn-flow-overlay',
  'btn-shrink-overlay',
  'btn-sink-overlay',
  'btn-warp-overlay'
];

function clearPrimaryOverlayButtons() {
  PRIMARY_OVERLAY_BUTTON_IDS.forEach(id => {
    const el = $(id);
    if (el) el.classList.remove('active');
  });
}

function hidePrimaryLegends() {
  ['legend-draft','legend-flow','legend-shrinkage','legend-weld','legend-airtrap','legend-sink','legend-warp']
    .forEach(id => { const e = $(id); if (e) e.style.display = 'none'; });
}

$('btn-draft-overlay').addEventListener('click', function() {
  clearPrimaryOverlayButtons();
  this.classList.add('active');
  STLAnalyzer.toggleFlowOverlay(false);
  STLAnalyzer.toggleShrinkageOverlay(false);
  STLAnalyzer.toggleSinkOverlay(false);
  STLAnalyzer.toggleWarpOverlay(false);
  STLAnalyzer.toggleOverlay(true);
  const chk = $('tree-chk-draft'); if (chk) chk.checked = true;

  $('legend-draft').style.display = 'flex';
  $('legend-flow').style.display = 'none';
  $('legend-shrinkage').style.display = 'none';
  $('legend-weld').style.display = 'none';
  $('legend-airtrap').style.display = 'none';
  $('legend-sink').style.display = 'none';
  $('legend-warp').style.display = 'none';
  if (!App.stl.coolingEnabled) $('legend-cooling').style.display = 'none';
  $('flow-controls').style.display = 'none';
  updateViewerAnalysisChart('draft');
  logToConsole('해석 오버레이 변경: 구배각 검사(Draft Angle)', 'info');
});

$('btn-flow-overlay').addEventListener('click', function() {
  if (!STLAnalyzer.getGatePosition()) {
    showToast('게이트 위치를 먼저 지정해야 유동 분석이 가능합니다.', 'warn');
    $('btn-set-gate').click();
    return;
  }
  clearPrimaryOverlayButtons();
  this.classList.add('active');
  STLAnalyzer.toggleFlowOverlay(true);
  STLAnalyzer.toggleSinkOverlay(false);
  STLAnalyzer.toggleWarpOverlay(false);
  const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

  $('legend-draft').style.display = 'none';
  $('legend-flow').style.display = 'flex';
  $('legend-shrinkage').style.display = 'none';
  $('legend-weld').style.display = 'flex';
  $('legend-airtrap').style.display = 'flex';
  $('legend-sink').style.display = 'none';
  $('legend-warp').style.display = 'none';
  $('flow-controls').style.display = 'flex';
  updateViewerAnalysisChart('flow');
  // 충전을 켜면 완성된 충진 결과(전체 색상)를 안정적으로 바로 보여준다.
  // (자동 무한반복 재생은 0으로 뚝 끊겨 보여서 제거 — 재생 버튼으로 충진 과정을 애니메이션)
  stopFlowAnimation();
  flowAnimPct = 100;
  $('flow-slider').value = 100;
  const _tT = App.stl.fillingTime || 2.0;
  $('flow-time-display').textContent = `${_tT.toFixed(1)}s / ${_tT.toFixed(1)}s`;
  STLAnalyzer.setFlowAnimationTime(1.0);
  logToConsole('해석 오버레이 변경: 사출 유동 시뮬레이션(Moldflow)', 'info');
});

$('btn-shrink-overlay').addEventListener('click', function() {
  if (!App.stl.parsed) {
    showToast('3D 모델을 먼저 분석하세요.', 'warn');
    return;
  }
  const isActive = this.classList.contains('active');
  clearPrimaryOverlayButtons();

  if (!isActive) {
    this.classList.add('active');
    showToast('수축 위험 예측 계산 중...', 'info');
    STLAnalyzer.toggleShrinkageOverlay(true);
    STLAnalyzer.toggleSinkOverlay(false);
    STLAnalyzer.toggleWarpOverlay(false);
    const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

    $('legend-draft').style.display = 'none';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'flex';
    $('legend-weld').style.display = 'none';
    $('legend-airtrap').style.display = 'none';
    $('legend-sink').style.display = 'none';
    $('legend-warp').style.display = 'none';
    $('flow-controls').style.display = 'none';
    updateViewerAnalysisChart('shrinkage');
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
    $('legend-weld').style.display = 'none';
    $('legend-airtrap').style.display = 'none';
    $('legend-sink').style.display = 'none';
    $('legend-warp').style.display = 'none';
  }
});

$('btn-sink-overlay').addEventListener('click', function() {
  if (!App.stl.parsed) {
    showToast('3D 모델을 먼저 분석하세요.', 'warn');
    return;
  }
  const isActive = this.classList.contains('active');
  clearPrimaryOverlayButtons();

  if (!isActive) {
    this.classList.add('active');
    STLAnalyzer.toggleSinkOverlay(true);
    const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

    $('legend-draft').style.display = 'none';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'none';
    $('legend-weld').style.display = 'none';
    $('legend-airtrap').style.display = 'none';
    $('legend-sink').style.display = 'flex';
    $('legend-warp').style.display = 'none';
    $('flow-controls').style.display = 'none';
    showToast('수축 위험 분포 가시화', 'ok');
    logToConsole('해석 오버레이 변경: 수축 예측(Shrinkage)', 'info');
  } else {
    $('btn-draft-overlay').classList.add('active');
    STLAnalyzer.toggleSinkOverlay(false);
    STLAnalyzer.toggleOverlay(true);
    const chk = $('tree-chk-draft'); if (chk) chk.checked = true;

    $('legend-draft').style.display = 'flex';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'none';
    $('legend-weld').style.display = 'none';
    $('legend-airtrap').style.display = 'none';
    $('legend-sink').style.display = 'none';
    $('legend-warp').style.display = 'none';
  }
});

$('btn-warp-overlay').addEventListener('click', function() {
  if (!App.stl.parsed) {
    showToast('3D 모델을 먼저 분석하세요.', 'warn');
    return;
  }
  const isActive = this.classList.contains('active');
  clearPrimaryOverlayButtons();

  if (!isActive) {
    this.classList.add('active');
    STLAnalyzer.toggleWarpOverlay(true);
    const chk = $('tree-chk-draft'); if (chk) chk.checked = false;

    $('legend-draft').style.display = 'none';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'none';
    $('legend-weld').style.display = 'none';
    $('legend-airtrap').style.display = 'none';
    $('legend-sink').style.display = 'none';
    $('legend-warp').style.display = 'flex';
    $('flow-controls').style.display = 'none';
    updateViewerAnalysisChart('warpage');
    showToast('변형 방향 벡터 및 변형량 가시화', 'ok');
    logToConsole('해석 오버레이 변경: 변형 예측(Warpage)', 'info');
  } else {
    $('btn-draft-overlay').classList.add('active');
    STLAnalyzer.toggleWarpOverlay(false);
    STLAnalyzer.toggleOverlay(true);
    const chk = $('tree-chk-draft'); if (chk) chk.checked = true;

    $('legend-draft').style.display = 'flex';
    $('legend-flow').style.display = 'none';
    $('legend-shrinkage').style.display = 'none';
    $('legend-weld').style.display = 'none';
    $('legend-airtrap').style.display = 'none';
    $('legend-sink').style.display = 'none';
    $('legend-warp').style.display = 'none';
  }
});

$('btn-cooling-overlay').addEventListener('click', function() {
  if (!App.stl.parsed) {
    showToast('3D 모델을 먼저 분석하세요.', 'warn');
    return;
  }
  const isActive = this.classList.contains('active');

  if (!isActive) {
    this.classList.add('active');
    App.stl.coolingEnabled = true;
    STLAnalyzer.toggleCoolingOverlay(true);
    const plan = typeof STLAnalyzer.applyOptimalCoolingPlan === 'function'
      ? STLAnalyzer.applyOptimalCoolingPlan()
      : null;
    App.stl.analysisChartMode = 'cooling';
    updateCoolingOptimizationPanel(plan);

    $('legend-cooling').style.display = 'flex';

    showToast('최적 냉각 위치를 계산해 모델에 표시했습니다.', 'ok');
    logToConsole('해석 오버레이 추가: 냉각 분포와 최적 냉각 위치 추천', 'info');
    triggerPhysicalReanalysis();
  } else {
    App.stl.coolingEnabled = false;
    STLAnalyzer.toggleCoolingOverlay(false);
    this.classList.remove('active');
    $('legend-cooling').style.display = 'none';
    const panel = $('cooling-optimization-3d');
    if (panel) panel.style.display = 'none';
    if (App.stl.analysisChartMode === 'cooling') App.stl.analysisChartMode = 'draft';
    updateViewerAnalysisChart(App.stl.analysisChartMode || 'draft');
    logToConsole('냉각 해석 오버레이 비활성화.', 'info');
  }
});

function updateCoolingOptimizationPanel(plan) {
  const panel = $('cooling-optimization-3d');
  const summary = $('cooling-plan-summary');
  const list = $('cooling-channel-list');
  const chart = $('cooling-color-chart');
  if (!panel || !summary || !list || !chart) return;

  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '8px';
  const viewerChart = ensureViewerCoolingChart();

  if (!plan) {
    summary.textContent = '냉각 분포 데이터를 계산하지 못했습니다. 먼저 3D 분석을 완료하세요.';
    list.innerHTML = '';
    chart.innerHTML = renderCoolingChart(null);
    if (viewerChart && App.stl.analysisChartMode === 'cooling') {
      viewerChart.style.display = 'block';
      viewerChart.innerHTML = renderCoolingChart(null);
    } else if (viewerChart) {
      updateViewerAnalysisChart(App.stl.analysisChartMode || 'draft');
    }
    return;
  }

  summary.innerHTML = `<b>Moldflow Cooling Quality</b><br>파랑은 빠른 냉각, 초록은 균형, 빨강은 핫스팟/긴 냉각시간입니다. 평균 ${plan.avgCoolingTime.toFixed(1)}s, 최대 ${plan.maxCoolingTime.toFixed(1)}s`;
  list.innerHTML = plan.channels && plan.channels.length ? plan.channels.map(ch => {
    return `<div class="cooling-channel-item">
      <b>Cooling Line #${ch.id}</b>
      <span>Hot spot ${ch.score}% · Cooling time ${ch.coolingTime.toFixed(1)}s · Channel depth ${ch.depth.toFixed(1)}mm</span>
      <small>X ${ch.channel.x.toFixed(1)}, Y ${ch.channel.y.toFixed(1)}, Z ${ch.channel.z.toFixed(1)}</small>
    </div>`;
  }).join('') : '<div class="cooling-channel-item"><b>Cooling Line</b><span>핫스팟이 낮아 별도 채널 후보가 최소화되었습니다. 색상 분포만 확인하세요.</span></div>';

  chart.innerHTML = renderCoolingChart(plan);
  if (viewerChart && App.stl.analysisChartMode === 'cooling') {
    viewerChart.style.display = 'block';
    viewerChart.innerHTML = renderCoolingChart(plan);
  } else if (viewerChart) {
    updateViewerAnalysisChart(App.stl.analysisChartMode || 'draft');
  }
}

function renderCoolingChart(plan) {
  const bins = plan && plan.bins ? plan.bins : [0, 0, 0, 0, 0];
  const labels = plan && plan.labels ? plan.labels : ['Cold', 'Cool', 'Balanced', 'Warm', 'Hot'];
  const colors = plan && plan.colors ? plan.colors : ['#0033ff', '#00a3ff', '#00d46a', '#f2e600', '#ff3300'];
  const maxBin = Math.max.apply(null, bins.concat([1]));
  return `<div class="cooling-chart-title">Moldflow Color Scale / Cooling Time Distribution</div>
    <div class="cooling-spectrum" style="background:linear-gradient(90deg,${colors.join(',')})"></div>
    <div class="cooling-spectrum-labels"><span>Cold / Fast</span><span>Balanced</span><span>Hot / Slow</span></div>` +
    bins.map((v, i) => {
      const pct = Math.max(4, Math.round((v / maxBin) * 100));
      return `<div class="cooling-chart-bar">
        <span class="cooling-chip" style="background:${colors[i]}"></span>
        <div class="cooling-bar-track"><i style="width:${pct}%;background:${colors[i]}"></i></div>
        <em>${labels[i]} ${v}</em>
      </div>`;
    }).join('');
}

function updateViewerAnalysisChart(mode, plan) {
  const chart = ensureViewerCoolingChart();
  if (!chart) return;
  App.stl.analysisChartMode = mode || 'draft';
  chart.style.display = 'block';
  chart.innerHTML = mode === 'cooling' ? renderCoolingChart(plan) : renderAnalysisChart(mode);
}

function renderAnalysisChart(mode) {
  const r = App.stl.result || {};
  const stats = r.stats || {};
  const defects = r.defects || {};
  const diag = r.diagnostics || {};
  const weldCount = App.stl.weldStats?.weldCount || 0;
  const airCount = App.stl.airtrapStats?.airtrapCount || 0;

  const riskRank = (v) => v === 'HIGH' ? 3 : v === 'MEDIUM' ? 2 : 1;
  const safeNum = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const pct = (v) => Math.max(0, Math.min(100, safeNum(v)));
  const coolingOn = !!App.stl.coolingEnabled;
  const coolingGain = coolingOn ? 0.78 : 1.0;
  let title = 'Analysis Result Distribution';
  let subtitle = `Cooling ${coolingOn ? 'ON' : 'OFF'} | Blue = low / early, Green = balanced, Red = high / late`;
  let rows = [];

  if (mode === 'draft') {
    title = 'Draft Angle / Undercut Distribution';
    rows = [
      { label: 'Safe draft', value: pct(stats.okPct ?? (100 - (stats.undercutPct || 0) - (stats.marginalPct || 0))), color: '#0033ff' },
      { label: 'Caution', value: pct(stats.marginalPct || 0), color: '#f2e600' },
      { label: 'Undercut', value: pct(stats.undercutPct || 0), color: '#ff3300' }
    ];
  } else if (mode === 'flow') {
    title = 'Fill Time / Flow Quality Distribution';
    const pressure = safeNum(diag.estimatedPressureDrop);
    const fillTime = safeNum(diag.fillingTime ?? diag.fillTime);
    rows = [
      { label: 'Early fill', value: 34, color: '#0033ff' },
      { label: 'Middle fill', value: 28, color: '#00d46a' },
      { label: 'Late fill', value: Math.max(12, Math.min(42, 18 + fillTime * 2)), color: '#f2e600' },
      { label: 'Weld / air risk', value: Math.min(45, weldCount * 7 + airCount * 8), color: '#ff3300' },
      { label: 'Pressure load', value: Math.min(50, pressure), color: '#ff7a00' }
    ];
  } else if (mode === 'shrinkage') {
    title = 'Shrinkage Risk Distribution';
    const s = defects.shrinkage || {};
    const sink = defects.sink || {};
    const level = Math.max(riskRank(s.riskLevel), riskRank(sink.severity));
    rows = [
      { label: 'Nominal shrinkage', value: Math.max(20, 90 - level * 18), color: '#0033ff' },
      { label: 'Average shrinkage', value: Math.min(70, safeNum(s.avgShrinkage, 0.5) * 22 * coolingGain), color: '#00d46a' },
      { label: 'Max shrinkage', value: Math.min(90, safeNum(s.maxShrinkage, 0.8) * 28 * coolingGain), color: '#f2e600' },
      { label: 'Risk candidates', value: Math.min(80, safeNum(sink.count) * 6 * coolingGain), color: '#ff3300' }
    ];
  } else if (mode === 'warpage') {
    title = 'Warpage Result Distribution';
    const w = defects.warpage || {};
    const level = riskRank(w.risk);
    rows = [
      { label: 'Stable area', value: Math.max(18, 95 - level * 20), color: '#0033ff' },
      { label: 'Directional bias', value: Math.min(70, Math.abs(safeNum(w.score))), color: '#00d46a' },
      { label: 'Displacement', value: Math.min(80, safeNum(w.magnitude) * 160 * coolingGain), color: '#f2e600' },
      { label: 'High warpage risk', value: (level === 3 ? 65 : level === 2 ? 34 : 8) * coolingGain, color: '#ff3300' }
    ];
  }

  const maxVal = Math.max.apply(null, rows.map(row => row.value).concat([1]));
  return `<div class="cooling-chart-title">${title}</div>
    <div class="cooling-spectrum" style="background:linear-gradient(90deg,#0033ff,#00a3ff,#00d46a,#f2e600,#ff3300)"></div>
    <div class="cooling-spectrum-labels"><span>Low / Early</span><span>Balanced</span><span>High / Late</span></div>
    <div class="viewer-chart-note">${subtitle}</div>` +
    rows.map(row => {
      const width = Math.max(4, Math.round((row.value / maxVal) * 100));
      return `<div class="cooling-chart-bar">
        <span class="cooling-chip" style="background:${row.color}"></span>
        <div class="cooling-bar-track"><i style="width:${width}%;background:${row.color}"></i></div>
        <em>${row.label} ${Math.round(row.value)}</em>
      </div>`;
    }).join('');
}

function ensureViewerCoolingChart() {
  const host = $('canvas-3d');
  if (!host) return null;
  let chart = $('viewer-cooling-chart');
  if (!chart) {
    chart = document.createElement('div');
    chart.id = 'viewer-cooling-chart';
    chart.className = 'viewer-cooling-chart cooling-color-chart';
    host.appendChild(chart);
  }
  return chart;
}

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
  // 끝까지 채워진 상태에서 다시 재생하면 처음(0%)부터 시작.
  if (flowAnimPct >= 100) flowAnimPct = 0;
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

    // 끝까지 채우면 100%에서 정지(0으로 뚝 끊어 되돌아가지 않음).
    if (flowAnimPct >= 100) {
      flowAnimPct = 100;
      $('flow-slider').value = 100;
      $('flow-time-display').textContent = `${totalT.toFixed(1)}s / ${totalT.toFixed(1)}s`;
      STLAnalyzer.setFlowAnimationTime(1.0);
      stopFlowAnimation();
      return;
    }

    const val = Math.floor(flowAnimPct);
    $('flow-slider').value = val;
    $('flow-time-display').textContent = `${(flowAnimPct * totalT / 100).toFixed(1)}s / ${totalT.toFixed(1)}s`;
    // 정수 % 양자화 제거: 연속 float를 넘겨 유동 전면이 부드럽게(끊김 없이) 전진하도록
    STLAnalyzer.setFlowAnimationTime(flowAnimPct / 100);

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

async function handleViewerClick(e) {
  if (!STLAnalyzer.isGateSettingMode()) return;

  const result = await STLAnalyzer.onViewerClick(e);
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
      const flowRes = await STLAnalyzer.recalculateFlow();
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
  clearPrimaryOverlayButtons();
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
    slider.addEventListener('change', async () => {
      const val = parseInt(slider.value) / 100;
      if (!App.stl.gateVelocityRatios) App.stl.gateVelocityRatios = [];
      App.stl.gateVelocityRatios[idx] = val;
      
      // Update in STLAnalyzer
      const flowRes = await STLAnalyzer.setGateParams(idx, val, undefined);
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
  let airtrapCount = airTraps.length;
  let airtrapHighRiskCount = airTraps.filter(d => d.riskLevel === 'HIGH').length;
  let airtrapMedCount = airTraps.filter(d => d.riskLevel === 'MEDIUM').length;
  let airtrapLowCount = airTraps.filter(d => d.riskLevel === 'LOW').length;
  let airtrapSeverityScore = airtrapCount > 0
    ? Math.round((airtrapHighRiskCount * 100 + airtrapMedCount * 50 + airtrapLowCount * 10) / airtrapCount)
    : 0;

  App.stl.airtrapStats = {
    airtrapCount,
    airtrapHighRiskCount,
    airtrapSeverityScore
  };

  const airtrapCard = $('airtrap-info-3d');
  if (airtrapCard) {
    if (airtrapCount > 0) {
      airtrapCard.style.display = 'block';
      $('airtrap-count').textContent = `${airtrapCount} 개`;
      $('airtrap-high-risk').textContent = `${airtrapHighRiskCount} 개`;
      $('airtrap-severity-score').textContent = `${airtrapSeverityScore} 점`;
    } else {
      airtrapCard.style.display = 'none';
    }
  }

  if (airtrapCount > 0) {
    if (airtrapHighRiskCount > 0) {
      issues.push({
        level: 'error',
        title: `⚠ 고위험 에어 트랩 (${airtrapHighRiskCount}개 감지)`,
        desc: `충진 말기 공기 배출이 어려운 고위험 에어트랩이 감지되었습니다. 금형 코어 분할부(Parting)로 게이트를 이동하거나 에어 벤트 추가 설치를 권장합니다.`
      });
    } else {
      issues.push({
        level: 'warning',
        title: `⚠ 에어 트랩 위험 구간 (${airtrapCount}개 감지)`,
        desc: `충진 말기 가스가 갇힐 위험이 있습니다. 가스 배출구(Gas Vent) 또는 게이트 조정을 권장합니다.`
      });
    }
  }

  const weldLines = gateResult.defects.filter(d => d.type === 'weld_line');
  let weldCount = 0;
  let highRiskCount = 0;
  let weldSeverityScore = 0;

  if (weldLines.length > 0 && weldLines[0].weldDetails) {
    const details = weldLines[0].weldDetails;
    weldCount = details.length;
    details.forEach(d => {
      if (d.severity === 'HIGH') {
        highRiskCount++;
      }
    });
    const medCount = details.filter(d => d.severity === 'MEDIUM').length;
    const lowCount = details.filter(d => d.severity === 'LOW').length;
    weldSeverityScore = weldCount > 0 
      ? Math.round((highRiskCount * 100 + medCount * 50 + lowCount * 10) / weldCount)
      : 0;
  }

  App.stl.weldStats = {
    weldCount,
    highRiskCount,
    weldSeverityScore
  };

  const weldCard = $('weld-info-3d');
  if (weldCard) {
    if (weldCount > 0) {
      weldCard.style.display = 'block';
      $('weld-count').textContent = `${weldCount} 개`;
      $('weld-high-risk').textContent = `${highRiskCount} 개`;
      $('weld-severity-score').textContent = `${weldSeverityScore} 점`;
    } else {
      weldCard.style.display = 'none';
    }
  }

  if (weldCount > 0) {
    if (highRiskCount > 0) {
      issues.push({
        level: 'error',
        title: `⚠ 고위험 웰드라인 합류 (${highRiskCount}개 감지)`,
        desc: `유동 선단 만나는 각도 135도 이상의 고위험 웰드라인이 감지되었습니다. 취약 구조 방지를 위해 게이트 위치 변경을 검토해 주십시오.`
      });
    } else {
      issues.push({
        level: 'warning',
        title: `⚠ 웰드라인 합류 구간 예측 (${weldCount}개 감지)`,
        desc: `다중 게이트에서 유동이 만나는 지점에 웰드라인이 형성됩니다. 강도 저하 우려 지점으로 설계 검토를 권장합니다.`
      });
    }
  }
  
  // calculate score
  const errorCount = issues.filter(i => i.level === 'error').length;
  const warningCount = issues.filter(i => i.level === 'warning').length;
  const score = Math.max(0, 100 - errorCount * 18 - warningCount * 7);
  
  animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', score);
  renderIssues('issues-list-3d', issues);
}

$('btn-core-overlay').addEventListener('click', async function() {
  if (!App.stl.parsed) {
    showToast('3D 모델을 먼저 분석하세요.', 'warn');
    return;
  }
  App.stl.showCores = !App.stl.showCores;
  try {
    await STLAnalyzer.updateCoreHelpers(App.stl.showCores);
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
let _currentPartingMode = 'manual';

$('btn-parting-overlay').addEventListener('click', function() {
  App.stl.showParting = !App.stl.showParting;
  const sliderVal = parseInt($('parting-slider').value);
  STLAnalyzer.updatePartingLine(App.stl.showParting, sliderVal, _currentPartingMode);
  this.classList.toggle('active', App.stl.showParting);
  if (App.stl.showParting) {
    $('parting-controls').style.display = 'flex';
  } else {
    $('parting-controls').style.display = 'none';
  }
});

$('btn-parting-manual').addEventListener('click', function() {
  _currentPartingMode = 'manual';
  this.classList.add('active');
  $('btn-parting-auto').classList.remove('active');
  $('parting-slider-container').style.display = 'flex';
  if (App.stl.showParting) {
    const sliderVal = parseInt($('parting-slider').value);
    STLAnalyzer.updatePartingLine(true, sliderVal, 'manual');
  }
  showToast('수동 평면 파팅 모드 활성화', 'info');
});

$('btn-parting-auto').addEventListener('click', function() {
  _currentPartingMode = 'auto';
  this.classList.add('active');
  $('btn-parting-manual').classList.remove('active');
  $('parting-slider-container').style.display = 'none';
  if (App.stl.showParting) {
    STLAnalyzer.updatePartingLine(true, undefined, 'auto');
  }
  showToast('드래프트 경계 기반 3D 자동 파팅라인 활성화', 'ok');
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
    applyCalibrationToResult(result);
    App.stl.result = result;
    renderMeshQualityPanel(result.meshQuality || result.mesh_quality);
    
    animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', result.score);
    renderMoldFeatures(result.moldFeatures);
    renderIssues('issues-list-3d', result.issues);
    
    if (result.defects) {
      renderDefectPredictionSummary(result.defects);
      refreshTrustAfterSummary();
    }
    
    // 최적 성형방향 추천 UI 반영
    if (result.recommendation) {
      $('recommendation-info-3d').style.display = 'flex';
      $('reco-direction').textContent = `${result.recommendation.bestDirection} 방향 (권장)`;
      $('reco-confidence').textContent = `${result.recommendation.confidence}%`;
      $('reco-complexity').textContent = `${result.recommendation.complexityScore}점 (${result.recommendation.complexityLevel})`;
    } else {
      $('recommendation-info-3d').style.display = 'none';
    }

    await STLAnalyzer.updateCoreHelpers(App.stl.showCores);
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
  if (listId === 'issues-list-2d') {
    current2DIssues = issues;
  } else if (listId === 'issues-list-3d') {
    current3DIssues = issues;
  }
  applyIssuesFilter(listId);
}

function applyIssuesFilter(listId) {
  const filter = listId === 'issues-list-2d' ? current2DFilter : current3DFilter;
  const rawIssues = listId === 'issues-list-2d' ? current2DIssues : current3DIssues;
  
  // Filter the issues list
  const filteredIssues = rawIssues.filter(issue => {
    if (filter === 'all') return true;
    if (filter === 'error') return issue.level === 'error';
    if (filter === 'warning') return issue.level === 'warning';
    if (filter === 'ok-info') return issue.level === 'ok' || issue.level === 'info';
    return true;
  });

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

    filteredIssues.forEach(issue => {
      let title = issue.title.toUpperCase();
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
    filteredIssues.forEach((issue, idx) => {
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
      <div class="report-stat"><span class="stat-label">종합 점수</span><span class="stat-value">${r?.score ?? '-'} / 100</span></div>
      <div class="report-stat"><span class="stat-label">전체 엔티티</span><span class="stat-value">${r?.entityCount ?? '-'}개</span></div>
      <div class="report-stat"><span class="stat-label">레이어 수</span><span class="stat-value">${r?.layers?.length ?? 0}개</span></div>
      <div class="report-stat"><span class="stat-label">오류</span><span class="stat-value" style="color:#ff4d6d">${r?.issues ? r.issues.filter(i=>i.level==='error').length : 0}건</span></div>
      <div class="report-stat"><span class="stat-label">경고</span><span class="stat-value" style="color:#ffd166">${r?.issues ? r.issues.filter(i=>i.level==='warning').length : 0}건</span></div>
    </div>`;
  }

  if (hasS) {
    const r = App.stl.result;
    const fileName = App.stl.file?.name || '';
    const isSTP = fileName.toLowerCase().endsWith('.stp') || fileName.toLowerCase().endsWith('.step');
    const sinkRisk = r?.defects?.sink || {};
    const shrinkRisk = r?.defects?.shrinkage || {};
    const shrinkSinkLevel = sinkRisk.severity === 'HIGH' || shrinkRisk.riskLevel === 'HIGH' ? 'HIGH' : sinkRisk.severity === 'MEDIUM' || shrinkRisk.riskLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW';
    const shrinkSinkColor = shrinkSinkLevel === 'HIGH' ? '#ff4d6d' : shrinkSinkLevel === 'MEDIUM' ? '#ffd166' : '#00ffa3';
    html += `
    <div class="report-card">
      <h3>🧊 3D 사출성형 분석 결과 ${isSTP ? (App.stl.parsed && App.stl.parsed.isSimulated ? '(STP 가상 분석)' : '(STP 정밀 분석)') : ''}</h3>
      <div class="report-stat"><span class="stat-label">파일명</span><span class="stat-value">${App.stl.file?.name || '-'}</span></div>
      ${isSTP && r?.stats?.metadata ? `
      <div class="report-stat"><span class="stat-label">STP 모델명</span><span class="stat-value">${r.stats.metadata.productName || '-'}</span></div>
      <div class="report-stat"><span class="stat-label">STP 면(Face) 수</span><span class="stat-value">${r.stats.metadata.faceCount || 0}개</span></div>
      <div class="report-stat"><span class="stat-label">STP 솔리드 수</span><span class="stat-value">${r.stats.metadata.shellCount || 0}개</span></div>
      ` : ''}
      <div class="report-stat"><span class="stat-label">양산성 점수</span><span class="stat-value">${r?.score ?? '-'} / 100</span></div>
      <div class="report-stat"><span class="stat-label">설정 탈형 축</span><span class="stat-value">${App.stl.pullAxis || '-'} 축</span></div>
      <div class="report-stat"><span class="stat-label">적용 소재</span><span class="stat-value">${r?.stats?.material || '-'}</span></div>
      <div class="report-stat"><span class="stat-label">삼각 면 수</span><span class="stat-value">${r?.stats?.triCount ? r.stats.triCount.toLocaleString() : '-'}개</span></div>
      <div class="report-stat"><span class="stat-label">메쉬 설정 검증</span><span class="stat-value">${(r.meshQuality || r.mesh_quality) ? `${escapeHtml((r.meshQuality || r.mesh_quality).status || '-')} · ${(r.meshQuality || r.mesh_quality).score ?? '-'} / 100 · ${(r.meshQuality || r.mesh_quality).watertight === true ? 'Watertight OK' : 'Watertight 확인 필요'}` : '-'}</span></div>
      <div class="report-stat"><span class="stat-label">언더컷 비율</span><span class="stat-value" style="color:#ff4d6d">${r?.stats?.undercutPct !== undefined ? r.stats.undercutPct.toFixed(1) : '-'}%</span></div>
      <div class="report-stat report-shrink-sink"><span class="stat-label">수축 위험도 (Shrinkage Risk)</span><span class="stat-value" style="color:${shrinkSinkColor}">${shrinkSinkLevel} (후보: ${sinkRisk.count ?? 0}개, 최대 수축: ${shrinkRisk.maxShrinkage !== undefined ? shrinkRisk.maxShrinkage.toFixed(2) : '-'}%, 평균: ${shrinkRisk.avgShrinkage !== undefined ? shrinkRisk.avgShrinkage.toFixed(2) : '-'}%)</span></div>
      <div class="report-stat"><span class="stat-label">변형 위험도 (Warpage Risk)</span><span class="stat-value" style="color:${r?.defects?.warpage?.risk === 'HIGH' ? '#ff4d6d' : r?.defects?.warpage?.risk === 'MEDIUM' ? '#ffd166' : '#00ffa3'}">${r?.defects?.warpage?.risk || '-'} (점수: ${r?.defects?.warpage?.score ?? '-'}점, 방향: ${r?.defects?.warpage?.direction || '-'})</span></div>
      ${App.stl.weldStats ? `
      <div class="report-stat" style="border-top:1px dashed #3d4b66; margin-top:8px; padding-top:8px;"><span class="stat-label">웰드라인 개수 (Weld Count)</span><span class="stat-value" style="color:#fff">${App.stl.weldStats.weldCount ?? 0} 개</span></div>
      <div class="report-stat"><span class="stat-label">고위험 웰드라인 (High Risk)</span><span class="stat-value" style="color:#ff4d6d">${App.stl.weldStats.highRiskCount ?? 0} 개</span></div>
      <div class="report-stat"><span class="stat-label">웰드라인 위험도 점수</span><span class="stat-value" style="color:#ffd166">${App.stl.weldStats.weldSeverityScore ?? 0} 점</span></div>
      ` : ''}
      ${App.stl.airtrapStats ? `
      <div class="report-stat" style="border-top:1px dashed #3d4b66; margin-top:8px; padding-top:8px;"><span class="stat-label">에어트랩 개수 (Air Trap Count)</span><span class="stat-value" style="color:#fff">${App.stl.airtrapStats.airtrapCount ?? 0} 개</span></div>
      <div class="report-stat"><span class="stat-label">고위험 에어트랩 (High Risk)</span><span class="stat-value" style="color:#ff00ff">${App.stl.airtrapStats.airtrapHighRiskCount ?? 0} 개</span></div>
      <div class="report-stat"><span class="stat-label">에어트랩 위험도 점수</span><span class="stat-value" style="color:#ffd166">${App.stl.airtrapStats.airtrapSeverityScore ?? 0} 점</span></div>
      ` : ''}
      ${r?.diagnostics ? `
      <div class="report-stat" style="border-top:1px dashed #3d4b66; margin-top:8px; padding-top:8px;"><span class="stat-label">사출 온도 (Melt Temp)</span><span class="stat-value">${r.diagnostics.meltTemp ?? '-'} °C</span></div>
      <div class="report-stat"><span class="stat-label">금형 온도 (Mold Temp)</span><span class="stat-value">${r.diagnostics.moldTemp ?? '-'} °C</span></div>
      <div class="report-stat"><span class="stat-label">사출 유량 (Flow Rate)</span><span class="stat-value">${r.diagnostics.flowRate ?? '-'} cm³/s</span></div>
      <div class="report-stat"><span class="stat-label">추정 압력 강하 (ΔP)</span><span class="stat-value" style="color:#ffd166">${r.diagnostics.estimatedPressureDrop !== undefined ? r.diagnostics.estimatedPressureDrop.toFixed(1) : '-'} MPa</span></div>
      <div class="report-stat"><span class="stat-label">소재 취출 냉각 시간</span><span class="stat-value" style="color:#00ffa3">${r.diagnostics.maxCoolingTime !== undefined ? r.diagnostics.maxCoolingTime.toFixed(1) : '-'} 초</span></div>
      <div class="report-stat"><span class="stat-label">필요 형체력 (F_clamp)</span><span class="stat-value" style="color:#00d4ff">${r.diagnostics.clampingForce !== undefined ? r.diagnostics.clampingForce.toFixed(1) : '-'} Tons</span></div>
      ` : ''}
    </div>`;
  }

  if (hasS) {
    const trust = computeTrustModel();
    html += `
    <div class="report-card">
      <h3>해석 신뢰도 / 검증 필요 항목</h3>
      <div class="report-stat"><span class="stat-label">종합 신뢰도</span><span class="stat-value">${trust.overall}%</span></div>
      <div class="report-stat"><span class="stat-label">입력 데이터 품질</span><span class="stat-value">${trust.inputQuality}%</span></div>
      <div class="report-stat"><span class="stat-label">해석 등급</span><span class="stat-value">${trust.grade}</span></div>
      <div class="report-stat"><span class="stat-label">항목별 신뢰도</span><span class="stat-value">충전 ${trust.category.fill}% / 수축 ${trust.category.shrink}% / 냉각 ${trust.category.cooling}% / 변형 ${trust.category.warpage}% / 금형성 ${trust.category.tooling}%</span></div>
      <div class="report-stat"><span class="stat-label">불확실성 폭</span><span class="stat-value">충전 ±${trust.uncertainty.fill}% / 수축 ±${trust.uncertainty.shrink}% / 냉각 ±${trust.uncertainty.cooling}% / 변형 ±${trust.uncertainty.warpage}%</span></div>
      <div class="report-stat"><span class="stat-label">비교 검증</span><span class="stat-value">${trust.validation.hasValidation ? 'Moldflow/시사출 비교값 반영됨' : '비교값 미입력'}</span></div>
      <div class="report-stat"><span class="stat-label">논문 기반 보정</span><span class="stat-value">${trust.paperBasis.slice(0, 2).join('<br>')}</span></div>
      <div class="report-stat"><span class="stat-label">주요 근거</span><span class="stat-value">${trust.evidence.slice(0, 3).join('<br>')}</span></div>
      <div class="report-stat"><span class="stat-label">한계</span><span class="stat-value">${trust.limits.slice(0, 3).join('<br>')}</span></div>
    </div>`;
  }

  html += '</div>';
  body.innerHTML = html;
  if (hasS) {
    const r = App.stl.result || {};
    const sinkRisk = r?.defects?.sink || {};
    const shrinkRisk = r?.defects?.shrinkage || {};
    const shrinkSinkLevel = sinkRisk.severity === 'HIGH' || shrinkRisk.riskLevel === 'HIGH' ? 'HIGH' : sinkRisk.severity === 'MEDIUM' || shrinkRisk.riskLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW';
    const shrinkSinkColor = shrinkSinkLevel === 'HIGH' ? '#ff4d6d' : shrinkSinkLevel === 'MEDIUM' ? '#ffd166' : '#00ffa3';
    const card = body.querySelector('.report-card:last-child');
    const oldRows = Array.from(body.querySelectorAll('.report-stat')).filter(function (row) {
      if (row.classList.contains('report-shrink-sink')) return false;
      const txt = row.textContent || '';
      return txt.indexOf('Sink Risk') !== -1 || txt.indexOf('Shrinkage Risk') !== -1;
    });
    if (!oldRows.length && body.querySelector('.report-shrink-sink')) return;
    const anchor = oldRows[0] || (card ? card.querySelector('.report-stat:nth-last-of-type(1)') : null);
    const row = document.createElement('div');
    row.className = 'report-stat report-shrink-sink';
    row.innerHTML = `<span class="stat-label">수축 위험도 (Shrinkage Risk)</span><span class="stat-value" style="color:${shrinkSinkColor}">${shrinkSinkLevel} (후보: ${sinkRisk.count ?? 0}개, 최대 수축: ${shrinkRisk.maxShrinkage !== undefined ? shrinkRisk.maxShrinkage.toFixed(2) : '-'}%, 평균: ${shrinkRisk.avgShrinkage !== undefined ? shrinkRisk.avgShrinkage.toFixed(2) : '-'}%)</span>`;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(row, anchor);
    else if (card) card.appendChild(row);
    oldRows.forEach(function (oldRow) { oldRow.remove(); });
  }
}

// 발표/보고서용 3D 중심 리포트. 위의 레거시 리포트 함수를 실행 시점에서 덮어쓴다.
function buildReport() {
  const body = $('report-body');
  const r = App.stl.result;
  if (!r) {
    body.innerHTML = `<div class="report-empty"><div style="font-size:3rem">보고서</div><p>3D 모델 분석을 완료하면 리포트가 생성됩니다.</p></div>`;
    return;
  }

  const fileName = App.stl.file?.name || '';
  const isSTP = fileName.toLowerCase().endsWith('.stp') || fileName.toLowerCase().endsWith('.step');
  const sinkRisk = r?.defects?.sink || {};
  const shrinkRisk = r?.defects?.shrinkage || {};
  const warpRisk = r?.defects?.warpage || {};
  const trust = computeTrustModel();
  const calibration = trust.calibration || buildCalibrationModel();
  const meshQuality = r.meshQuality || r.mesh_quality || (window.STLAnalyzer && typeof STLAnalyzer.getMeshQuality === 'function' ? STLAnalyzer.getMeshQuality() : null);
  const shrinkLevel = sinkRisk.severity === 'HIGH' || shrinkRisk.riskLevel === 'HIGH' ? 'HIGH' : sinkRisk.severity === 'MEDIUM' || shrinkRisk.riskLevel === 'MEDIUM' ? 'MEDIUM' : 'LOW';
  const shrinkColor = shrinkLevel === 'HIGH' ? '#ff4d6d' : shrinkLevel === 'MEDIUM' ? '#ffd166' : '#00ffa3';
  const warpColor = warpRisk.risk === 'HIGH' ? '#ff4d6d' : warpRisk.risk === 'MEDIUM' ? '#ffd166' : '#00ffa3';
  const factorText = [
    `충전 ${safeDisplay(calibration.factors.fillTime, 2)}x`,
    `냉각 ${safeDisplay(calibration.factors.coolingTime, 2)}x`,
    `압력 ${safeDisplay(calibration.factors.pressureDrop, 2)}x`,
    `수축 ${safeDisplay(calibration.factors.maxShrinkage, 2)}x`,
    `변형 ${safeDisplay(calibration.factors.warpMagnitude, 2)}x`
  ].join(' / ');

  body.innerHTML = `
    <div class="report-grid">
      <div class="report-card">
        <h3>3D 사출성형 분석 결과 ${isSTP ? '(STEP 분석)' : ''}</h3>
        <div class="report-stat"><span class="stat-label">파일명</span><span class="stat-value">${escapeHtml(fileName || '-')}</span></div>
        <div class="report-stat"><span class="stat-label">양산성 점수</span><span class="stat-value">${r?.score ?? '-'} / 100</span></div>
        <div class="report-stat"><span class="stat-label">소재 / 성형 축</span><span class="stat-value">${escapeHtml(r?.stats?.material || App.stl.material || '-')} / ${escapeHtml(App.stl.pullAxis || '-')}축</span></div>
        <div class="report-stat"><span class="stat-label">메쉬 해상도</span><span class="stat-value">${r?.stats?.triCount ? r.stats.triCount.toLocaleString() : '-'} 면</span></div>
        <div class="report-stat"><span class="stat-label">메쉬 설정 검증</span><span class="stat-value">${meshQuality ? `${escapeHtml(meshQuality.status || '-')} · ${meshQuality.score ?? '-'} / 100 · ${meshQuality.watertight === true ? 'Watertight OK' : 'Watertight 확인 필요'}` : '-'}</span></div>
        <div class="report-stat"><span class="stat-label">언더컷 비율</span><span class="stat-value" style="color:#ff4d6d">${r?.stats?.undercutPct !== undefined ? r.stats.undercutPct.toFixed(1) : '-'}%</span></div>
        <div class="report-stat report-shrink-sink"><span class="stat-label">수축 위험도</span><span class="stat-value" style="color:${shrinkColor}">${shrinkLevel} (후보 ${sinkRisk.count ?? 0}개, 최대 ${shrinkRisk.maxShrinkage !== undefined ? shrinkRisk.maxShrinkage.toFixed(2) : '-'}%, 평균 ${shrinkRisk.avgShrinkage !== undefined ? shrinkRisk.avgShrinkage.toFixed(2) : '-'}%)</span></div>
        <div class="report-stat"><span class="stat-label">변형 위험도</span><span class="stat-value" style="color:${warpColor}">${warpRisk.risk || '-'} (점수 ${warpRisk.score ?? '-'}, 방향 ${warpRisk.direction || '-'}, 변형량 ${warpRisk.magnitude !== undefined ? warpRisk.magnitude.toFixed(2) : '-'}mm)</span></div>
        ${r?.diagnostics ? `
        <div class="report-stat" style="border-top:1px dashed #3d4b66; margin-top:8px; padding-top:8px;"><span class="stat-label">공정 조건</span><span class="stat-value">수지 ${r.diagnostics.meltTemp ?? '-'}°C / 금형 ${r.diagnostics.moldTemp ?? '-'}°C / 속도 ${r.diagnostics.flowRate ?? '-'} cm³/s</span></div>
        <div class="report-stat"><span class="stat-label">충전 / 냉각</span><span class="stat-value">${r.diagnostics.fillingTime !== undefined ? r.diagnostics.fillingTime.toFixed(2) : '-'}s / ${r.diagnostics.maxCoolingTime !== undefined ? r.diagnostics.maxCoolingTime.toFixed(1) : '-'}s</span></div>
        <div class="report-stat"><span class="stat-label">압력강하 / 형체력</span><span class="stat-value">${r.diagnostics.estimatedPressureDrop !== undefined ? r.diagnostics.estimatedPressureDrop.toFixed(1) : '-'} MPa / ${r.diagnostics.clampingForce !== undefined ? r.diagnostics.clampingForce.toFixed(1) : '-'} Tons</span></div>
        ` : ''}
      </div>

      <div class="report-card">
        <h3>신뢰도 및 검증 상태</h3>
        <div class="report-stat"><span class="stat-label">종합 신뢰도</span><span class="stat-value">${trust.overall}% · ${escapeHtml(trust.grade)}</span></div>
        <div class="report-stat"><span class="stat-label">입력 데이터 품질</span><span class="stat-value">${trust.inputQuality}%</span></div>
        <div class="report-stat"><span class="stat-label">항목별 신뢰도</span><span class="stat-value">충전 ${trust.category.fill}% / 수축 ${trust.category.shrink}% / 냉각 ${trust.category.cooling}% / 변형 ${trust.category.warpage}% / 금형성 ${trust.category.tooling}%</span></div>
        <div class="report-stat"><span class="stat-label">불확실성 폭</span><span class="stat-value">충전 ±${trust.uncertainty.fill}% / 수축 ±${trust.uncertainty.shrink}% / 냉각 ±${trust.uncertainty.cooling}% / 변형 ±${trust.uncertainty.warpage}%</span></div>
        <div class="report-stat"><span class="stat-label">누적 보정</span><span class="stat-value">샘플 ${calibration.count}건 · 보정 신뢰도 ${calibration.confidence}% · 적용 항목 ${calibration.usableMetricCount}개</span></div>
        <div class="report-stat"><span class="stat-label">보정계수</span><span class="stat-value">${factorText}</span></div>
        <div class="report-stat"><span class="stat-label">비교 검증</span><span class="stat-value">${trust.validation.hasValidation ? 'Moldflow/시사출 비교값 반영됨' : '비교값 미입력'}</span></div>
        <div class="report-stat"><span class="stat-label">주요 근거</span><span class="stat-value">${trust.evidence.slice(0, 4).map(escapeHtml).join('<br>')}</span></div>
        <div class="report-stat"><span class="stat-label">다음 검증 액션</span><span class="stat-value">${(trust.actions.length ? trust.actions : trust.limits).slice(0, 4).map(escapeHtml).join('<br>')}</span></div>
      </div>
    </div>`;
}

$('btn-export').addEventListener('click', () => {
  window.print();
});

/* ══════════════════════════════════════
   INIT
══════════════════════════════════════ */
setStatus('ready', '준비');
showToast('DIMA에 오신 것을 환영합니다. STL 또는 STEP 3D 모델을 업로드하세요.', 'info');
setTimeout(() => switchTab('3d'), 0);

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
