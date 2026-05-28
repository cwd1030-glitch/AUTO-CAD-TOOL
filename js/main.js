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
  stl: { file: null, parsed: null, result: null, material: 'ABS', pullAxis: 'Z', flipAxis: false, showCores: false, showParting: false },
  threeInit: false,
};

/* ══════════════════════════════════════
   HELPERS
══════════════════════════════════════ */
function $(id) { return document.getElementById(id); }

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

  if (id === 'report') buildReport();
}

/* ══════════════════════════════════════
   2D MODULE
══════════════════════════════════════ */
const zone2d  = $('upload-zone-2d');
const input2d = $('file-input-2d');

zone2d.addEventListener('click', () => input2d.click());
zone2d.addEventListener('dragover',  e => { e.preventDefault(); zone2d.classList.add('drag-over'); });
zone2d.addEventListener('dragleave', () => zone2d.classList.remove('drag-over'));
zone2d.addEventListener('drop', e => {
  e.preventDefault();
  zone2d.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handle2DFile(f);
});
input2d.addEventListener('change', () => { if (input2d.files[0]) handle2DFile(input2d.files[0]); });

function handle2DFile(file) {
  if (!file.name.toLowerCase().endsWith('.dxf')) {
    showToast('DXF 파일만 지원됩니다.', 'error'); return;
  }
  App.dxf.file = file;
  $('file-info-2d').style.display = 'flex';
  $('file-info-2d').innerHTML = `📄 <span>${file.name}</span>&nbsp;(${(file.size/1024).toFixed(1)} KB)`;
  $('btn-analyze-2d').style.display = 'flex';
  showToast('DXF 파일이 로드되었습니다.', 'ok');
}

$('btn-analyze-2d').addEventListener('click', run2DAnalysis);

async function run2DAnalysis() {
  if (!App.dxf.file) return;
  showLoading('DXF 파싱 중...');
  setStatus('busy', '분석 중');

  await fakeProgress([
    [20, 400, 'DXF 엔티티 추출 중...'],
    [50, 500, '레이어 검증 중...'],
    [75, 400, '제도 규칙 검사 중...'],
    [90, 300, '결과 생성 중...'],
  ]);

  try {
    const text = await App.dxf.file.text();
    const parsed = DXFAnalyzer.parse(text);
    App.dxf.parsed = parsed;

    const result = DXFAnalyzer.analyze(parsed);
    App.dxf.result = result;

    // Init canvas
    const canvas = $('canvas-2d');
    const wrap   = $('viewer-2d-wrap');
    canvas.width  = wrap.clientWidth  || 800;
    canvas.height = wrap.clientHeight || 600;

    $('placeholder-2d').style.display = 'none';
    canvas.style.display = 'block';
    $('toolbar-2d').style.display = 'flex';

    DXFAnalyzer.initCanvas(canvas, parsed);
    initCanvasInteraction(canvas);

    // Show results
    $('results-2d').style.display = 'flex';
    animateScore('score-num-2d', 'ring-fill-2d', 'score-grade-2d', result.score);
    renderIssues('issues-list-2d', result.issues);

    setProgress(100);
    await new Promise(r => setTimeout(r, 200));
    hideLoading();
    setStatus('ready', '분석 완료');
    showToast(`분석 완료 — 점수: ${result.score}/100`, result.score >= 80 ? 'ok' : result.score >= 60 ? 'warn' : 'error');
  } catch (err) {
    hideLoading();
    setStatus('error', '오류');
    showToast('DXF 파싱 오류: ' + err.message, 'error');
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
const zone3d  = $('upload-zone-3d');
const input3d = $('file-input-3d');

zone3d.addEventListener('click', () => input3d.click());
zone3d.addEventListener('dragover',  e => { e.preventDefault(); zone3d.classList.add('drag-over'); });
zone3d.addEventListener('dragleave', () => zone3d.classList.remove('drag-over'));
zone3d.addEventListener('drop', e => {
  e.preventDefault();
  zone3d.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) handle3DFile(f);
});
input3d.addEventListener('change', () => { if (input3d.files[0]) handle3DFile(input3d.files[0]); });

function handle3DFile(file) {
  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.stl') && !ext.endsWith('.stp') && !ext.endsWith('.step')) {
    showToast('STL 또는 STP/STEP 파일만 지원됩니다.', 'error'); return;
  }
  App.stl.file = file;
  $('file-info-3d').style.display = 'flex';
  $('file-info-3d').innerHTML = `📄 <span>${file.name}</span>&nbsp;(${(file.size/1024).toFixed(1)} KB)`;
  $('material-section').style.display = 'flex';
  $('axis-section').style.display = 'flex';
  $('btn-analyze-3d').style.display = 'flex';
  showToast('3D 파일이 로드되었습니다.', 'ok');
}

// Material selection
document.querySelectorAll('.mat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    App.stl.material = btn.dataset.mat;
    if (App.stl.parsed) {
      reRun3DAnalysis();
    }
  });
});

  const btnFlipAxis = $('btn-flip-axis');
  if (btnFlipAxis) {
    btnFlipAxis.addEventListener('click', function() {
      App.stl.flipAxis = !App.stl.flipAxis;
      if (App.stl.flipAxis) {
        this.classList.add('active');
        this.style.backgroundColor = 'var(--primary-color)';
        this.style.color = '#121214';
      } else {
        this.classList.remove('active');
        this.style.backgroundColor = 'transparent';
        this.style.color = 'var(--primary-color)';
      }
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
    if (App.stl.parsed) {
      reRun3DAnalysis();
    }
  });
});

async function reRun3DAnalysis() {
  if (!App.stl.parsed) return;
  setStatus('busy', '3D 재분석 중');
  
  STLAnalyzer.clearGate();
  $('gate-info-3d').style.display = 'none';
  $('flow-controls').style.display = 'none';
  $('legend-draft').style.display = 'flex';
  $('legend-flow').style.display = 'none';
  $('btn-draft-overlay').classList.add('active');
  $('btn-flow-overlay').classList.remove('active');
  $('btn-set-gate').classList.remove('active');
  STLAnalyzer.setGateSettingMode(false);
  resetFlowAnimation();
  App.stl.baseIssues = null;

  STLAnalyzer.setPullAxis(App.stl.pullAxis);
  STLAnalyzer.recolorGeometry();

  const result = STLAnalyzer.analyze(App.stl.parsed, App.stl.material);
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

  STLAnalyzer.updateCoreHelpers(App.stl.showCores);
  STLAnalyzer.updatePartingLine(App.stl.showParting, parseInt($('parting-slider').value));
  setStatus('ready', '3D 분석 완료');
  showToast(`탈형 축/소재 재분석 완료`, 'ok');
}

$('btn-analyze-3d').addEventListener('click', run3DAnalysis);

async function run3DAnalysis() {
  if (!App.stl.file) return;
  const isSTP = App.stl.file.name.toLowerCase().endsWith('.stp') || App.stl.file.name.toLowerCase().endsWith('.step');
  showLoading(isSTP ? 'STP 파일 로드 중...' : 'STL 파일 로드 중...');
  setStatus('busy', '3D 분석 중');

  await fakeProgress([
    [15, 300, isSTP ? 'STP 메시 구조 해석 중...' : 'STL 메시 파싱 중...'],
    [35, 600, isSTP ? '기하학적 피처 추출 중...' : '법선 벡터 분석 중...'],
    [55, 500, isSTP ? '구배각 시뮬레이션 중...' : '구배각 계산 중...'],
    [70, 400, isSTP ? '살두께 편차 추정 중...' : '살두께 추정 중...'],
    [85, 400, isSTP ? '사출성형성 종합 평가 중...' : '사출성형성 평가 중...'],
    [95, 300, '3D 뷰어 렌더링 중...'],
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
      container.addEventListener('click', handleViewerClick);
    } else {
      container.style.display = 'block';
    }

    $('placeholder-3d').style.display = 'none';
    $('toolbar-3d').style.display = 'flex';

    // Reset gate/flow UI states
    $('gate-info-3d').style.display = 'none';
    $('flow-controls').style.display = 'none';
    $('parting-controls').style.display = 'none';
    $('parting-slider').value = 50;
    $('parting-val-display').textContent = '50%';
    $('legend-draft').style.display = 'flex';
    $('legend-flow').style.display = 'none';
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    $('btn-draft-overlay').classList.add('active');
    $('btn-solid').classList.add('active');
    STLAnalyzer.setGateSettingMode(false);
    resetFlowAnimation();
    App.stl.baseIssues = null;

    STLAnalyzer.setPullAxis(App.stl.pullAxis);
    STLAnalyzer.loadGeometry(stlData);
    STLAnalyzer.updateCoreHelpers(App.stl.showCores);
    STLAnalyzer.updatePartingLine(App.stl.showParting, 50);

    // Analysis
    const result = STLAnalyzer.analyze(stlData, App.stl.material);
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

    setProgress(100);
    await new Promise(r => setTimeout(r, 200));
    hideLoading();
    setStatus('ready', '3D 분석 완료');
    showToast(`사출성형 분석 완료 — 양산성 점수: ${result.score}/100`, result.score >= 80 ? 'ok' : result.score >= 60 ? 'warn' : 'error');
  } catch (err) {
    hideLoading();
    setStatus('error', '오류');
    showToast((isSTP ? 'STP' : 'STL') + ' 분석 오류: ' + err.message, 'error');
    console.error(err);
  }
}

// Toolbar buttons
let _wireframe = false;
let _overlay = true;

$('btn-wireframe').addEventListener('click', () => {
  _wireframe = true;
  STLAnalyzer.setWireframe(true);
  $('btn-wireframe').classList.add('active');
  $('btn-solid').classList.remove('active');
});
$('btn-solid').addEventListener('click', () => {
  _wireframe = false;
  STLAnalyzer.setWireframe(false);
  $('btn-solid').classList.add('active');
  $('btn-wireframe').classList.remove('active');
});
$('btn-draft-overlay').addEventListener('click', function() {
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  this.classList.add('active');
  STLAnalyzer.toggleFlowOverlay(false);
  STLAnalyzer.toggleOverlay(true);
  $('legend-draft').style.display = 'flex';
  $('legend-flow').style.display = 'none';
  $('flow-controls').style.display = 'none';
});

$('btn-flow-overlay').addEventListener('click', function() {
  if (!STLAnalyzer.getGatePosition()) {
    showToast('게이트 위치를 먼저 지정해야 유동 분석이 가능합니다.', 'warn');
    // auto switch to gate setting mode
    $('btn-set-gate').click();
    return;
  }
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  this.classList.add('active');
  STLAnalyzer.toggleFlowOverlay(true);
  $('legend-draft').style.display = 'none';
  $('legend-flow').style.display = 'flex';
  $('flow-controls').style.display = 'flex';
});

$('btn-set-gate').addEventListener('click', function() {
  const isSetting = !STLAnalyzer.isGateSettingMode();
  STLAnalyzer.setGateSettingMode(isSetting);
  this.classList.toggle('active', isSetting);
  if (isSetting) {
    showToast('모델 표면을 클릭하여 주입구(Gate)를 지정하세요.', 'info');
    $('gate-info-3d').style.display = 'flex';
  } else {
    if (!STLAnalyzer.getGatePosition()) {
      $('gate-info-3d').style.display = 'none';
    }
  }
});

// Flow Simulation Animation Controls
let flowAnimPct = 0;
let flowPlaying = false;
let flowAnimTimer = null;
let flowSpeedMultiplier = 1.0;

function resetFlowAnimation() {
  stopFlowAnimation();
  flowAnimPct = 0;
  $('flow-slider').value = 0;
  $('flow-time-display').textContent = `0.0s / 2.0s`;
  STLAnalyzer.setFlowAnimationTime(0);
}

function startFlowAnimation() {
  if (flowPlaying) return;
  flowPlaying = true;
  $('btn-play-flow').style.display = 'none';
  $('btn-pause-flow').style.display = 'flex';
  
  flowAnimTimer = setInterval(() => {
    flowAnimPct += 2 * flowSpeedMultiplier;
    if (flowAnimPct > 100) {
      flowAnimPct = 0;
    }
    const val = Math.floor(flowAnimPct);
    $('flow-slider').value = val;
    $('flow-time-display').textContent = `${(val * 2.0 / 100).toFixed(1)}s / 2.0s`;
    STLAnalyzer.setFlowAnimationTime(val / 100);
  }, 50);
}

function stopFlowAnimation() {
  flowPlaying = false;
  $('btn-play-flow').style.display = 'flex';
  $('btn-pause-flow').style.display = 'none';
  if (flowAnimTimer) {
    clearInterval(flowAnimTimer);
    flowAnimTimer = null;
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
  $('flow-time-display').textContent = `${(flowAnimPct * 2.0 / 100).toFixed(1)}s / 2.0s`;
  STLAnalyzer.setFlowAnimationTime(flowAnimPct / 100);
});

function handleViewerClick(e) {
  if (!STLAnalyzer.isGateSettingMode()) return;

  const result = STLAnalyzer.onViewerClick(e);
  if (!result) return;

  if (result.action === 'remove_gate') {
    if (result.gateCount === 0) {
      // 게이트 전부 제거 → 드래프트 뷰로 복귀
      $('gate-info-3d').style.display = 'none';
      $('flow-controls').style.display = 'none';
      reRun3DAnalysis();
      showToast('모든 게이트가 제거되었습니다.', 'info');
    } else {
      // 남은 게이트로 유동 재계산
      const flowRes = STLAnalyzer.recalculateFlow();
      if (flowRes) {
        updateGateInfoPanel(flowRes);
        updateAnalysisIssuesWithGate(flowRes);
      }
      showToast(`게이트 제거 (남은 게이트: ${result.gateCount}개)`, 'info');
      resetFlowAnimation();
      startFlowAnimation();
    }
    return;
  }

  // action === 'add_gate'
  showToast(`게이트 G${result.gateIndex + 1} 설정 완료 (총 ${result.gateCount}개)`, 'ok');
  updateGateInfoPanel(result);
  updateAnalysisIssuesWithGate(result);

  STLAnalyzer.toggleFlowOverlay(true);
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  $('btn-flow-overlay').classList.add('active');
  $('legend-draft').style.display = 'none';
  $('legend-flow').style.display = 'flex';
  $('flow-controls').style.display = 'flex';

  resetFlowAnimation();
  startFlowAnimation();
}

function updateGateInfoPanel(result) {
  $('gate-info-3d').style.display = 'flex';
  const count = result.gateCount || STLAnalyzer.getGatePositions().length;
  if (count > 1) {
    $('gate-coords').textContent = `게이트 ${count}개 설정됨 (마커 클릭으로 개별 제거)`;
  } else if (result.worldCoords) {
    $('gate-coords').textContent = `X: ${result.worldCoords.x.toFixed(1)}, Y: ${result.worldCoords.y.toFixed(1)}, Z: ${result.worldCoords.z.toFixed(1)}`;
  }
  $('gate-flow-status').innerHTML = `최대 유동 거리: <span style="color:var(--cyan); font-weight:bold;">${(result.maxFlowDistance || 0).toFixed(1)}mm</span>`;
}

function updateAnalysisIssuesWithGate(gateResult) {
  if (!App.stl.result) return;
  if (!App.stl.baseIssues) {
    App.stl.baseIssues = [...App.stl.result.issues];
  }
  
  const issues = [...App.stl.baseIssues];
  const matKey = App.stl.material;
  const mat = { ABS: 120, PC: 95, PP: 180, POM: 140 }[matKey] || 120;
  const maxDist = gateResult.maxFlowDistance;
  
  if (maxDist > mat) {
    issues.unshift({
      level: 'error',
      title: '미성형 (Short Shot) 위험 매우 높음',
      desc: `게이트 기준 최장 유동 거리(${maxDist.toFixed(1)}mm)가 현재 소재(${matKey}) 유동 한계(${mat}mm)를 초과합니다. 주입구를 중앙으로 옮기거나 추가 설정이 필요합니다.`
    });
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
      title: `에어 트랩 위험 구간 ${airTraps.length}곳 감지`,
      desc: `충진이 마지막에 끝나는 지점(핑크색 구체 표시) 근처에 가스 배출구(Gas Vent) 배치를 권장합니다.`
    });
  }
  
  const weldLines = gateResult.defects.filter(d => d.type === 'weld_line');
  if (weldLines.length > 0) {
    issues.push({
      level: 'info',
      title: `웰드라인 발생 구간 예측`,
      desc: `수지 합류부(노란색 구체 표시)에 웰드라인 흔적이 생길 수 있어 강도 설계 검토를 권장합니다.`
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
  App.stl.showCores = !App.stl.showCores;
  STLAnalyzer.updateCoreHelpers(App.stl.showCores);
  this.classList.toggle('active', App.stl.showCores);
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

function updateAnalysisOnPartingChange() {
  if (!App.stl.parsed) return;
  const result = STLAnalyzer.analyze(App.stl.parsed, App.stl.material);
  App.stl.result = result;
  
  animateScore('score-num-3d', 'ring-fill-3d', 'score-grade-3d', result.score);
  renderMoldFeatures(result.moldFeatures);
  renderIssues('issues-list-3d', result.issues);
  STLAnalyzer.updateCoreHelpers(App.stl.showCores);
}

$('btn-reset-cam').addEventListener('click', () => STLAnalyzer.resetCamera());

/* ══════════════════════════════════════
   RESULTS RENDERING
══════════════════════════════════════ */
function animateScore(numId, ringId, gradeId, score) {
  const ring  = $(ringId);
  const circ  = 263.9; // 2π * 42
  const offset = circ - (score / 100) * circ;
  ring.style.strokeDashoffset = offset;

  // Color by score
  let color, grade;
  if (score >= 85) { color = '#00ffa3'; grade = '✅ 합격 (PASS)'; }
  else if (score >= 70) { color = '#00d4ff'; grade = '🟡 주의 (REVIEW)'; }
  else if (score >= 50) { color = '#ffd166'; grade = '⚠️ 경고 (WARN)'; }
  else                  { color = '#ff4d6d'; grade = '❌ 불합격 (FAIL)'; }

  ring.style.stroke = color;
  ring.style.filter = `drop-shadow(0 0 6px ${color})`;
  $(gradeId).textContent = grade;
  $(gradeId).style.background = color + '22';
  $(gradeId).style.color = color;

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
  
  if (!features || (features.slides.length === 0 && features.lifters.length === 0)) {
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
