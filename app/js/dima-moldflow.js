/**
 * DIMA Moldflow-inspired dashboard layer.
 * Reads the existing App.stl.result object and converts it into a production
 * readiness workflow: Fill, Pack, Cool, Warp, defects, process window, and DOE.
 */
(function () {
  'use strict';

  var lastSignature = '';

  function byId(id) {
    return document.getElementById(id);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function num(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function result() {
    try {
      return window.App && window.App.stl ? window.App.stl.result : null;
    } catch (e) {
      return null;
    }
  }

  function severityRank(value) {
    value = String(value || 'LOW').toUpperCase();
    if (value === 'HIGH' || value === 'CRITICAL') return 3;
    if (value === 'MEDIUM' || value === 'WARNING') return 2;
    if (value === 'LOW' || value === 'GOOD') return 1;
    return 0;
  }

  function severityLabel(rank) {
    return rank >= 3 ? 'HIGH' : rank === 2 ? 'MEDIUM' : 'LOW';
  }

  function severityColor(rank) {
    return rank >= 3 ? 'var(--mf-red)' : rank === 2 ? 'var(--mf-yellow)' : 'var(--mf-green)';
  }

  function qualityScoreFromSeverity(value) {
    var rank = severityRank(value);
    if (rank >= 3) return 45;
    if (rank === 2) return 70;
    return 91;
  }

  function getGateCount() {
    try {
      if (window.STLAnalyzer && typeof window.STLAnalyzer.getGatePositions === 'function') {
        return window.STLAnalyzer.getGatePositions().length;
      }
    } catch (e) {}
    return 0;
  }

  function readTextInt(id) {
    var el = byId(id);
    if (!el) return 0;
    var match = (el.textContent || '').match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  }

  function metrics() {
    var r = result();
    if (!r) return null;

    var defects = r.defects || {};
    var sink = defects.sink || {};
    var shrinkage = defects.shrinkage || {};
    var warpage = defects.warpage || {};
    var diag = r.diagnostics || {};
    var stats = r.stats || {};
    var reco = r.recommendation || {};
    var mold = r.moldFeatures || {};

    var score = clamp(Math.round(num(r.score, 0)), 0, 100);
    var sinkRank = severityRank(sink.severity);
    var shrinkRank = severityRank(shrinkage.riskLevel);
    var warpRank = severityRank(warpage.risk);
    var weldCount = readTextInt('weld-count');
    var airCount = readTextInt('airtrap-count');
    var undercutPct = num(stats.undercutPct, 0);
    var pressure = num(diag.estimatedPressureDrop, 0);
    var pressureLimit = num(diag.pressureLimit, 100);
    var coolingTime = num(diag.maxCoolingTime, 0);
    var fillTime = num(diag.fillingTime, num(window.App && window.App.stl && window.App.stl.fillingTime, 0));
    var flowDistance = num(diag.maxFlowDistance, 0);
    var slides = Array.isArray(mold.slides) ? mold.slides.length : 0;
    var lifters = Array.isArray(mold.lifters) ? mold.lifters.length : 0;
    var gateCount = getGateCount();
    var pressureRatio = pressureLimit > 0 ? clamp(pressure / pressureLimit, 0, 2) : 0;

    var fillScore = clamp(Math.round(100 - pressureRatio * 32 - (gateCount === 0 ? 12 : 0) - Math.min(18, flowDistance / 80)), 0, 100);
    var packScore = clamp(Math.round(qualityScoreFromSeverity(shrinkage.riskLevel) - Math.min(18, pressureRatio * 10)), 0, 100);
    var coolScore = clamp(Math.round(100 - Math.min(42, coolingTime * 0.8) - (sinkRank >= 2 ? 10 : 0)), 0, 100);
    var warpScore = qualityScoreFromSeverity(warpage.risk);
    var dfmScore = clamp(Math.round((fillScore + packScore + coolScore + warpScore + score) / 5 - Math.min(16, undercutPct * 0.45)), 0, 100);
    var productionRisk = Math.max(sinkRank, shrinkRank, warpRank, weldCount > 2 ? 2 : 0, airCount > 2 ? 2 : 0);
    var toolingRisk = slides + lifters >= 4 || undercutPct > 18 ? 3 : slides + lifters >= 2 || undercutPct > 8 ? 2 : 1;
    var costRisk = Math.max(productionRisk, toolingRisk, coolingTime > 35 ? 2 : 1);

    return {
      fileName: (window.App && window.App.stl && window.App.stl.file && window.App.stl.file.name) || '분석 모델',
      material: stats.material || (window.App && window.App.stl && window.App.stl.material) || 'ABS',
      score: score,
      dfmScore: dfmScore,
      fillScore: fillScore,
      packScore: packScore,
      coolScore: coolScore,
      warpScore: warpScore,
      sink: sink,
      shrinkage: shrinkage,
      warpage: warpage,
      sinkRank: sinkRank,
      shrinkRank: shrinkRank,
      warpRank: warpRank,
      weldCount: weldCount,
      airCount: airCount,
      slides: slides,
      lifters: lifters,
      gateCount: gateCount,
      undercutPct: undercutPct,
      pressure: pressure,
      pressureLimit: pressureLimit,
      pressureRatio: pressureRatio,
      coolingTime: coolingTime,
      fillTime: fillTime,
      flowDistance: flowDistance,
      meltTemp: diag.meltTemp,
      moldTemp: diag.moldTemp,
      flowRate: diag.flowRate,
      clamp: diag.clampingForce,
      gateSize: diag.suggestedGates && diag.suggestedGates.length ? diag.suggestedGates[0].diameter : null,
      bestDirection: reco.bestDirection || reco.direction || (window.App && window.App.stl && window.App.stl.pullAxis) || 'Z',
      confidence: reco.confidence,
      productionRisk: productionRisk,
      toolingRisk: toolingRisk,
      costRisk: costRisk,
      issues: Array.isArray(r.issues) ? r.issues : []
    };
  }

  function kpi(label, value, sub, color) {
    return '<div class="mf-kpi">' +
      '<div class="label">' + esc(label) + '</div>' +
      '<div class="value"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(value) + '</div>' +
      '<div class="sub">' + esc(sub || '') + '</div>' +
      '</div>';
  }

  function bar(label, score) {
    var color = score >= 80 ? 'linear-gradient(90deg,var(--mf-blue),var(--mf-green))' :
      score >= 60 ? 'linear-gradient(90deg,var(--mf-yellow),var(--mf-green))' :
      'linear-gradient(90deg,var(--mf-red),var(--mf-yellow))';
    return '<div class="mf-bar-row">' +
      '<div class="mf-bar-label">' + esc(label) + '</div>' +
      '<div class="mf-bar-track"><div class="mf-bar-fill" style="--w:' + clamp(score, 0, 100) + '%;background:' + color + '"></div></div>' +
      '<div class="mf-bar-score">' + Math.round(score) + '</div>' +
      '</div>';
  }

  function step(tag, title, body, score) {
    var rank = score >= 80 ? 1 : score >= 60 ? 2 : 3;
    return '<div class="mf-step">' +
      '<div class="tag" style="color:' + severityColor(rank) + '">' + esc(tag) + '</div>' +
      '<strong>' + esc(title) + '</strong>' +
      '<p>' + esc(body) + '</p>' +
      '</div>';
  }

  function riskItem(title, desc, rank) {
    return '<div class="mf-risk-item" style="--risk-color:' + severityColor(rank) + '">' +
      '<span class="mf-risk-dot"></span>' +
      '<div><b>' + esc(title) + '</b><p>' + esc(desc) + '</p></div>' +
      '<span class="mf-badge">' + severityLabel(rank) + '</span>' +
      '</div>';
  }

  function doeItem(title, desc, impact) {
    return '<div class="mf-doe-item">' +
      '<span class="mf-risk-dot" style="background:var(--mf-purple)"></span>' +
      '<div><b>' + esc(title) + '</b><p>' + esc(desc) + '</p></div>' +
      '<span class="mf-badge" style="background:var(--mf-purple)">' + esc(impact) + '</span>' +
      '</div>';
  }

  function recItem(title, desc, rank) {
    return '<div class="mf-rec-item">' +
      '<span class="mf-risk-dot" style="background:' + severityColor(rank) + '"></span>' +
      '<div><b>' + esc(title) + '</b><p>' + esc(desc) + '</p></div>' +
      '</div>';
  }

  function buildRisks(m) {
    var items = [];
    items.push(riskItem('Sink Mark', '두께 집중부와 냉각 편차 기반 예측: ' + (m.sink.count || 0) + '개 후보', m.sinkRank));
    items.push(riskItem('Shrinkage', '예상 최대 수축률 ' + num(m.shrinkage.maxShrinkage, 0).toFixed(2) + '%, 평균 ' + num(m.shrinkage.avgShrinkage, 0).toFixed(2) + '%', m.shrinkRank));
    items.push(riskItem('Warpage', '변형 점수 ' + (m.warpage.score == null ? '-' : m.warpage.score) + ', 지배 방향 ' + (m.warpage.direction || '-'), m.warpRank));
    items.push(riskItem('Weld / Air Trap', '웰드라인 ' + m.weldCount + '개, 에어트랩 ' + m.airCount + '개 후보', Math.max(m.weldCount > 2 ? 2 : 1, m.airCount > 2 ? 2 : 1)));
    return items.join('');
  }

  function buildDoe(m) {
    var pressureAction = m.pressureRatio > 0.9 ? '사출압 한계 초과 위험' : m.pressureRatio > 0.75 ? '압력 여유 부족' : '압력 여유 양호';
    var coolingAction = m.coolingTime > 35 ? '냉각 회로 개선 우선' : m.coolingTime > 22 ? '냉각 시간 최적화' : '사이클 단축 가능';
    var gateAction = m.gateCount === 0 ? '게이트 지정 필요' : m.gateCount === 1 && m.flowDistance > 120 ? '게이트 추가 후보' : '게이트 조건 유지';

    return [
      doeItem('Gate DOE', gateAction + ': 유동거리, 웰드라인 위치, 에어트랩 후보를 동시에 비교합니다.', 'High'),
      doeItem('Process Window', pressureAction + ': 사출 속도, 수지 온도, 보압 전환점을 3수준으로 탐색합니다.', 'Med'),
      doeItem('Cooling Balance', coolingAction + ': 핫스팟과 취출 냉각 시간을 기준으로 채널 거리/직경을 조정합니다.', 'Med')
    ].join('');
  }

  function buildRecommendations(m) {
    var list = [];
    if (m.pressureRatio > 0.85) {
      list.push(recItem('압력 여유 확보', '게이트 단면 확대, 유동거리 단축, 수지 온도 상향 범위를 먼저 검토하세요.', 3));
    }
    if (m.sinkRank >= 2) {
      list.push(recItem('싱크 후보 저감', '리브 루트 두께를 기준 두께의 50~60%로 낮추고 보압 유지 시간을 DOE에 포함하세요.', m.sinkRank));
    }
    if (m.warpRank >= 2) {
      list.push(recItem('변형 안정화', '냉각 밸런스와 섬유/유동 방향 편차를 함께 보고 게이트 위치를 재평가하세요.', m.warpRank));
    }
    if (m.toolingRisk >= 2) {
      list.push(recItem('금형 구조 난이도 관리', '언더컷 ' + m.undercutPct.toFixed(1) + '%, 슬라이드 ' + m.slides + '개, 리프터 ' + m.lifters + '개입니다. 파팅 방향 ' + m.bestDirection + ' 기준으로 코어 구조를 확정하세요.', m.toolingRisk));
    }
    if (!list.length) {
      list.push(recItem('양산 검증 단계 진입', '주요 위험이 낮습니다. 실제 소재 데이터와 사출기 용량을 반영한 최종 조건 검증으로 넘어가도 좋습니다.', 1));
    }
    return list.join('');
  }

  function processTable(m) {
    var rows = [
      ['Material', m.material],
      ['Melt Temp', m.meltTemp == null ? '-' : m.meltTemp + ' °C'],
      ['Mold Temp', m.moldTemp == null ? '-' : m.moldTemp + ' °C'],
      ['Flow Rate', m.flowRate == null ? '-' : m.flowRate + ' cm³/s'],
      ['Fill Time', m.fillTime ? m.fillTime.toFixed(2) + ' s' : '-'],
      ['Pressure Drop', m.pressure ? m.pressure.toFixed(1) + ' MPa / ' + m.pressureLimit + ' MPa' : '-'],
      ['Clamp Force', m.clamp == null ? '-' : m.clamp.toFixed(1) + ' tons'],
      ['Cooling Time', m.coolingTime ? m.coolingTime.toFixed(1) + ' s' : '-'],
      ['Gate Diameter', m.gateSize == null ? '-' : m.gateSize.toFixed(1) + ' mm']
    ];
    return '<table class="mf-process-table"><thead><tr><th>항목</th><th>현재 조건</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') +
      '</tbody></table>';
  }

  function renderEmpty() {
    return '<div class="mf-shell"><div class="mf-dashboard">' +
      '<div class="mf-topbar"><div class="mf-title"><h1>DIMA 사출물 검증 대시보드</h1>' +
      '<p>3D 모델을 분석하면 충전, 보압, 냉각, 변형, 결함 예측, DOE 추천이 이 화면에 표시됩니다.</p></div></div>' +
      '<div class="mf-card"><div class="mf-empty">아직 3D 분석 결과가 없습니다.<br>상단의 3D 사출 분석 탭에서 STL 또는 STEP 모델을 불러온 뒤 분석을 실행하세요.</div></div>' +
      '</div></div>';
  }

  function renderDashboard() {
    var host = byId('content-dashboard');
    if (!host) return;
    var m = metrics();
    if (!m) {
      host.innerHTML = renderEmpty();
      return;
    }

    var scoreColor = m.score >= 80 ? 'var(--mf-green)' : m.score >= 60 ? 'var(--mf-yellow)' : 'var(--mf-red)';
    host.innerHTML =
      '<div class="mf-shell"><div class="mf-dashboard">' +
      '<div class="mf-topbar">' +
      '<div class="mf-title"><h1>3D 사출물 검증기 - 생산 적합성 분석</h1>' +
      '<p>' + esc(m.fileName) + ' 기준. Moldflow 공개 기능을 참고해 Fill/Pack/Cool/Warp 중심의 제조성 판단 흐름으로 구성했습니다.</p></div>' +
      '<div class="mf-actions"><button class="mf-btn" id="mf-go-3d">3D 화면</button><button class="mf-btn primary" id="mf-go-report">리포트</button></div>' +
      '</div>' +
      '<div class="mf-kpis">' +
      kpi('Overall', m.score + ' / 100', '기존 DIMA 종합 점수', scoreColor) +
      kpi('DFM Readiness', m.dfmScore + ' / 100', '생산 적합성 추정', m.dfmScore >= 80 ? 'var(--mf-green)' : m.dfmScore >= 60 ? 'var(--mf-yellow)' : 'var(--mf-red)') +
      kpi('Tooling Risk', severityLabel(m.toolingRisk), '언더컷/슬라이드/리프터', severityColor(m.toolingRisk)) +
      kpi('Cost Impact', severityLabel(m.costRisk), '냉각 시간과 구조 난이도', severityColor(m.costRisk)) +
      '</div>' +
      '<div class="mf-grid">' +
      '<section class="mf-card"><div class="mf-card-head"><h2>분석 점수</h2><span class="mf-status-pill">CAE Summary</span></div><div class="mf-card-body">' +
      '<div class="mf-score-layout"><div class="mf-gauge" style="--score:' + m.score + '"><div><strong>' + m.score + '</strong><span>Overall</span></div></div>' +
      '<div class="mf-bars">' + bar('Fill', m.fillScore) + bar('Pack', m.packScore) + bar('Cool', m.coolScore) + bar('Warp', m.warpScore) + bar('DFM', m.dfmScore) + '</div></div>' +
      '</div></section>' +
      '<section class="mf-card"><div class="mf-card-head"><h2>공정 조건</h2><span class="mf-status-pill">Process Window</span></div><div class="mf-card-body">' + processTable(m) +
      '<div class="mf-note">압력, 냉각, 게이트 조건은 현 분석값 기반의 근사 진단입니다. 실제 양산 조건에서는 소재 PVT/점도 데이터와 사출기 응답을 함께 보정해야 합니다.</div></div></section>' +
      '<section class="mf-card mf-span-2"><div class="mf-card-head"><h2>Moldflow 유사 분석 시퀀스</h2><span class="mf-status-pill">Fill · Pack · Cool · Warp</span></div><div class="mf-card-body"><div class="mf-sequence">' +
      step('01 FILL', '충전성 예측', '압력 여유 ' + Math.round((1 - m.pressureRatio) * 100) + '%, 최대 유동거리 ' + Math.round(m.flowDistance) + ' mm', m.fillScore) +
      step('02 PACK', '보압/수축 판단', '수축 위험 ' + severityLabel(m.shrinkRank) + ', 최대 수축 ' + num(m.shrinkage.maxShrinkage, 0).toFixed(2) + '%', m.packScore) +
      step('03 COOL', '냉각 효율', '예상 취출 냉각 ' + (m.coolingTime ? m.coolingTime.toFixed(1) : '-') + '초, 싱크 위험 ' + severityLabel(m.sinkRank), m.coolScore) +
      step('04 WARP', '변형 예측', '변형 위험 ' + severityLabel(m.warpRank) + ', 권장 취출 방향 ' + m.bestDirection, m.warpScore) +
      '</div></div></section>' +
      '<section class="mf-card"><div class="mf-card-head"><h2>결함 예측</h2><span class="mf-status-pill">Defect Finder</span></div><div class="mf-card-body"><div class="mf-risk-list">' + buildRisks(m) + '</div></div></section>' +
      '<section class="mf-card"><div class="mf-card-head"><h2>DOE/파라메트릭 추천</h2><span class="mf-status-pill">Optimizer</span></div><div class="mf-card-body"><div class="mf-doe-list">' + buildDoe(m) + '</div></div></section>' +
      '<section class="mf-card mf-span-2"><div class="mf-card-head"><h2>AI 제조성 권고</h2><span class="mf-status-pill">Action Plan</span></div><div class="mf-card-body"><div class="mf-rec-list">' + buildRecommendations(m) + '</div></div></section>' +
      '</div></div></div>';

    var go3d = byId('mf-go-3d');
    var goReport = byId('mf-go-report');
    if (go3d) go3d.onclick = function () { switchTo('3d'); };
    if (goReport) goReport.onclick = function () { switchTo('report'); };
  }

  function switchTo(id) {
    var tab = document.querySelector('.nav-tab[data-tab="' + id + '"]');
    if (tab) tab.click();
  }

  function patchLabels() {
    var labels = [
      ['tab-dashboard', '대시보드'],
      ['tab-2d', '2D 도면 검증'],
      ['tab-3d', '3D 사출 분석'],
      ['tab-report', '통합 리포트']
    ];
    labels.forEach(function (item) {
      var el = byId(item[0]);
      if (el) el.textContent = item[1];
    });
    var status = byId('status-text');
    if (status && /[?]/.test(status.textContent || '')) status.textContent = '준비';
    document.title = 'DIMA - 3D 사출물 검증기';
  }

  function installHooks() {
    document.querySelectorAll('.nav-tab[data-tab="dashboard"]').forEach(function (button) {
      button.addEventListener('click', function () {
        setTimeout(renderDashboard, 60);
        setTimeout(renderDashboard, 160);
      });
    });
    var reportButton = byId('btn-export');
    if (reportButton) reportButton.textContent = 'PDF 내보내기';

    var previousDashboard = window.DimaDashboard;
    window.DimaDashboard = Object.assign({}, previousDashboard || {}, {
      refresh: renderDashboard,
      ingest: function (value) {
        try {
          if (value && window.App && window.App.stl) window.App.stl.result = value;
        } catch (e) {}
        renderDashboard();
      }
    });
    window.DimaMoldflowDashboard = {
      refresh: renderDashboard,
      metrics: metrics
    };
  }

  function refreshWhenChanged() {
    var r = result();
    var signature = r ? JSON.stringify({
      score: r.score,
      defects: r.defects,
      diagnostics: r.diagnostics,
      stats: r.stats,
      recommendation: r.recommendation
    }) : 'empty';
    if (signature !== lastSignature) {
      lastSignature = signature;
      if (!window.App || window.App.currentTab === 'dashboard') renderDashboard();
    }
  }

  function init() {
    patchLabels();
    installHooks();
    renderDashboard();
    setInterval(refreshWhenChanged, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
