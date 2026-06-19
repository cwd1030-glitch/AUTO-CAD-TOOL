/**
 * DIMA Moldflow-inspired dashboard layer.
 * Reads the existing App.stl.result object and converts it into a production
 * readiness workflow: Fill, Pack, Cool, Warp, defects, process window, and DOE.
 */
(function () {
  'use strict';

  var lastSignature = '';
  var currentLang = localStorage.getItem('dima_lang') || 'ko';
  var currentTheme = localStorage.getItem('dima_theme') || 'black';
  var I18N = {
    ko: {
      dashboard: '대시보드',
      analysis3d: '3D 사출 분석',
      report: '리포트',
      ready: '준비',
      title: 'DIMA - 3D 사출물 검증기',
      emptyTitle: 'DIMA 3D 사출물 검증 대시보드',
      emptyDesc: '3D 분석을 실행하면 충전, 보압, 냉각, 변형, 결함 예측, DOE 권고가 표시됩니다.',
      emptyBody: '아직 3D 분석 결과가 없습니다.<br>3D 사출 분석에서 STL 또는 STEP 모델을 불러온 뒤 분석을 실행하세요.',
      dashTitle: '3D 사출물 검증기 - 생산 적합성 분석',
      dashDesc: '기준 워크플로우입니다. Fill / Pack / Cool / Warp 결과를 제조 판단용으로 요약했습니다.',
      view3d: '3D 화면',
      reportBtn: '리포트',
      overall: '종합 점수',
      overallSub: 'DIMA 종합 평가',
      dfm: '제조 적합도',
      dfmSub: '양산 준비도',
      toolingRisk: '금형 위험',
      toolingSub: '언더컷 / 슬라이드 / 리프터',
      reliability: '신뢰도',
      reliabilitySub: '표본 / 게이트 / 공정 입력',
      analysisScore: '분석 점수',
      processConditions: '공정 조건',
      processNote: '이 화면은 근사 엔지니어링 분석입니다. 최종 출시는 실제 소재 데이터, 사출기 용량, 시사출 결과로 확인해야 합니다.',
      sequenceTitle: 'Moldflow 유사 분석 시퀀스',
      defectTitle: '결함 예측',
      doeTitle: 'DOE / 파라미터 추천',
      guidanceTitle: 'AI 제조 권고',
      item: '항목',
      currentCondition: '현재 조건',
      sinkMark: '수축',
      shrinkage: '수축',
      warpage: '변형',
      weldAir: '웰드 / 에어트랩',
      sinkDesc: '국소 두께 집중, 냉각 편차, 수축 위험 후보: ',
      candidates: '개',
      shrinkDesc: '최대 ',
      avg: ', 평균 ',
      confidence: ', 신뢰도 ',
      warpScore: '점수 ',
      direction: ', 방향 ',
      weldLines: '웰드라인 ',
      airTraps: ', 에어트랩 ',
      gateDoe: '게이트 DOE',
      processWindow: '공정 윈도우',
      coolingBalance: '냉각 밸런스',
      securePressure: '압력 여유 확보',
      reduceSink: '수축 위험 저감',
      validateShrink: '수축 검증',
      stabilizeWarp: '변형 안정화',
      toolingComplexity: '금형 구조 관리',
      proceedValidation: '양산 검증 진행',
      low: '낮음',
      medium: '주의',
      high: '높음',
      toolSolid: '솔리드',
      toolMesh: '메쉬',
      toolDraft: '구배',
      toolFill: '충전',
      toolShrink: '수축',
      toolSink: '',
      toolWarp: '변형',
      toolCool: '냉각',
      toolGate: '게이트',
      toolCore: '코어',
      toolParting: '파팅',
      toolReset: '초기화',
      sectionImport: '모델 불러오기',
      sectionMaterial: '소재',
      sectionDirection: '금형 방향',
      sectionProcess: '공정 조건',
      sectionTree: '모델 트리',
      runAnalysis: '사출성형 분석 실행',
      exportPdf: 'PDF 내보내기'
    },
    en: {
      dashboard: 'Dashboard',
      analysis3d: '3D Molding Analysis',
      report: 'Report',
      ready: 'Ready',
      title: 'DIMA - 3D Injection Validator',
      emptyTitle: 'DIMA 3D Injection Validator Dashboard',
      emptyDesc: 'Run a 3D analysis to review fill, pack, cool, warp, defect prediction, and DOE guidance.',
      emptyBody: 'No 3D analysis result yet.<br>Import an STL or STEP model in 3D Molding Analysis and run analysis.',
      dashTitle: '3D Injection Validator - Production Readiness',
      dashDesc: 'based workflow. Fill / Pack / Cool / Warp results are summarized for manufacturing decisions.',
      view3d: '3D View',
      reportBtn: 'Report',
      overall: 'Overall',
      overallSub: 'DIMA overall score',
      dfm: 'DFM Readiness',
      dfmSub: 'manufacturing readiness',
      toolingRisk: 'Tooling Risk',
      toolingSub: 'undercut / slide / lifter',
      reliability: 'Reliability',
      reliabilitySub: 'sample / gate / process coverage',
      analysisScore: 'Analysis Score',
      processConditions: 'Process Conditions',
      processNote: 'This is an approximate engineering screen. Final release should be confirmed with material data, machine capacity, and molding trials.',
      sequenceTitle: 'Moldflow-like Analysis Sequence',
      defectTitle: 'Defect Prediction',
      doeTitle: 'DOE / Parameter Recommendation',
      guidanceTitle: 'AI Manufacturing Guidance',
      item: 'Item',
      currentCondition: 'Current Condition',
      sinkMark: 'Shrinkage',
      shrinkage: 'Shrinkage',
      warpage: 'Warpage',
      weldAir: 'Weld / Air Trap',
      sinkDesc: 'Local thick-mass, cooling imbalance, and shrinkage risk: ',
      candidates: ' candidates',
      shrinkDesc: 'Max ',
      avg: ', avg ',
      confidence: ', confidence ',
      warpScore: 'Score ',
      direction: ', direction ',
      weldLines: 'Weld lines ',
      airTraps: ', air traps ',
      gateDoe: 'Gate DOE',
      processWindow: 'Process Window',
      coolingBalance: 'Cooling Balance',
      securePressure: 'Secure pressure margin',
      reduceSink: 'Reduce shrinkage risk',
      validateShrink: 'Validate shrinkage',
      stabilizeWarp: 'Stabilize warpage',
      toolingComplexity: 'Manage tooling complexity',
      proceedValidation: 'Proceed to production validation',
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
      toolSolid: 'SOLID',
      toolMesh: 'MESH',
      toolDraft: 'DRAFT',
      toolFill: 'FILL',
      toolShrink: 'SHRINKAGE',
      toolSink: '',
      toolWarp: 'WARP',
      toolCool: 'COOL',
      toolGate: 'GATE',
      toolCore: 'CORE',
      toolParting: 'PARTING',
      toolReset: 'RESET',
      sectionImport: 'Model Import',
      sectionMaterial: 'Material',
      sectionDirection: 'Mold Direction',
      sectionProcess: 'Process Conditions',
      sectionTree: 'Model Tree',
      runAnalysis: 'Run Molding Analysis',
      exportPdf: 'Export PDF'
    }
  };

  function t(key) {
    return (I18N[currentLang] && I18N[currentLang][key]) || I18N.ko[key] || key;
  }

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
    return rank >= 3 ? t('high') : rank === 2 ? t('medium') : t('low');
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
    var reliability = num(shrinkage.confidence, num(sink.confidence, num(reco.confidence, gateCount > 0 ? 76 : 62)));
    reliability = clamp(Math.round(reliability), 0, 99);

    return {
      fileName: (window.App && window.App.stl && window.App.stl.file && window.App.stl.file.name) || (currentLang === 'ko' ? '분석 모델' : 'Analysis Model'),
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
      reliability: reliability,
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
    items.push(riskItem(t('sinkMark'), t('sinkDesc') + (m.sink.count || 0) + t('candidates') + t('avg') + num(m.shrinkage.avgShrinkage, 0).toFixed(2) + '%, max ' + num(m.shrinkage.maxShrinkage, 0).toFixed(2) + '%' + t('confidence') + (m.reliability || 0) + '%', Math.max(m.sinkRank, m.shrinkRank)));
    items.push(riskItem(t('warpage'), t('warpScore') + (m.warpage.score == null ? '-' : m.warpage.score) + t('direction') + (m.warpage.direction || '-'), m.warpRank));
    items.push(riskItem(t('weldAir'), t('weldLines') + m.weldCount + t('airTraps') + m.airCount, Math.max(m.weldCount > 2 ? 2 : 1, m.airCount > 2 ? 2 : 1)));
    return items.join("");
  }

  function buildDoe(m) {
    var ko = currentLang === 'ko';
    var pressureAction = ko
      ? (m.pressureRatio > 0.9 ? '압력 한계 위험' : m.pressureRatio > 0.75 ? '압력 여유 부족' : '압력 여유 양호')
      : (m.pressureRatio > 0.9 ? 'Pressure limit risk' : m.pressureRatio > 0.75 ? 'Pressure margin is narrow' : 'Pressure margin is acceptable');
    var coolingAction = ko
      ? (m.coolingTime > 35 ? '냉각 회로 우선 검토' : m.coolingTime > 22 ? '냉각 시간 최적화' : '사이클 타임 양호')
      : (m.coolingTime > 35 ? 'Cooling circuit review first' : m.coolingTime > 22 ? 'Cooling time optimization' : 'Cycle time is acceptable');
    var gateAction = ko
      ? (m.gateCount === 0 ? '게이트 위치 필요' : m.gateCount === 1 && m.flowDistance > 120 ? '추가 게이트 검토' : '게이트 조건 안정')
      : (m.gateCount === 0 ? 'Gate position required' : m.gateCount === 1 && m.flowDistance > 120 ? 'Evaluate additional gate' : 'Gate condition is stable');

    return [
      doeItem(t('gateDoe'), gateAction + (ko ? ': 유동거리, 웰드라인 위치, 에어트랩 후보를 비교하세요.' : ': compare flow distance, weld-line position, and air-trap candidates.'), ko ? '높음' : 'High'),
      doeItem(t('processWindow'), pressureAction + (ko ? ': 사출 속도, 수지 온도, 보압 프로파일을 함께 검토하세요.' : ': scan fill speed, melt temperature, and packing profile.'), ko ? '중간' : 'Med'),
      doeItem(t('coolingBalance'), coolingAction + (ko ? ': 두꺼운 영역, 핫스팟, 냉각 시간 기준으로 채널 거리/직경/병렬 밸런스를 조정하세요.' : ': adjust channel distance, diameter, and parallel balance from thick zones, hotspots, and cooling-time results.'), ko ? '중간' : 'Med')
    ].join("");
  }

  function buildRecommendations(m) {
    var list = [];
    var ko = currentLang === 'ko';
    if (m.pressureRatio > 0.85) {
      list.push(recItem(t('securePressure'), ko ? '압력을 올리기 전에 게이트 직경, 유동거리, 수지 온도를 먼저 검토하세요.' : 'Review gate diameter, flow distance, and melt temperature before increasing pressure.', 3));
    }
    if (m.sinkRank >= 2) {
      list.push(recItem(t('reduceSink'), ko ? '리브/보스 주변의 국소 질량을 줄이고 두꺼운 영역은 보압 유지 시간 DOE에 포함하세요.' : 'Reduce rib/boss mass and include packing hold-time DOE for thick regions.', m.sinkRank));
    }
    if (m.shrinkRank >= 2) {
      list.push(recItem(t('validateShrink'), ko ? 'p90/p95 수축 영역을 우선 확인한 뒤 소재 데이터와 보압 시험으로 검증하세요.' : 'Use p90/p95 shrinkage regions first, then confirm with material data and packing trials.', m.shrinkRank));
    }
    if (m.warpRank >= 2) {
      list.push(recItem(t('stabilizeWarp'), ko ? '냉각 불균형, 섬유/유동 방향, 게이트 위치, 취출 방향을 함께 검토하세요.' : 'Review cooling imbalance, fiber/flow direction, gate location, and ejection direction together.', m.warpRank));
    }
    if (m.coolingTime > 22 || m.sinkRank >= 2 || m.warpRank >= 2) {
      list.push(recItem(ko ? '논문 기반 냉각 검토' : 'Paper-Based Cooling Review', ko ? '자료 폴더의 냉각·수축 자료 기준: 두꺼운 부위에는 냉각라인을 우선 배치하고, 금형 표면 온도 편차를 줄여 수축과 휨을 함께 낮추세요.' : 'Based on local cooling and shrinkage references: prioritize cooling lines near thick sections and reduce mold-surface temperature variation to lower shrinkage and warpage together.', Math.max(m.sinkRank, m.warpRank, m.coolingTime > 35 ? 3 : 2)));
    }
    if (m.toolingRisk >= 2) {
      list.push(recItem(t('toolingComplexity'), ko ? ('언더컷 ' + m.undercutPct.toFixed(1) + '%, 슬라이드 ' + m.slides + '개, 리프터 ' + m.lifters + '개입니다. 취출 방향 ' + m.bestDirection + ' 기준으로 코어 구조를 확인하세요.') : ('Undercut ' + m.undercutPct.toFixed(1) + '%, slides ' + m.slides + ', lifters ' + m.lifters + '. Confirm core structure around pull direction ' + m.bestDirection + '.'), m.toolingRisk));
    }
    if (!list.length) {
      list.push(recItem(t('proceedValidation'), ko ? '주요 예측 위험이 낮습니다. 실제 소재 데이터와 시사출 결과로 최종 조건을 확인하세요.' : 'Major predicted risks are low. Confirm final conditions with real material data and molding trial results.', 1));
    }
    return list.join("");
  }

  function processTable(m) {
    var rows = [
      [currentLang === 'ko' ? '소재' : 'Material', m.material],
      [currentLang === 'ko' ? '수지 온도' : 'Melt Temp', m.meltTemp == null ? '-' : m.meltTemp + ' C'],
      [currentLang === 'ko' ? '금형 온도' : 'Mold Temp', m.moldTemp == null ? '-' : m.moldTemp + ' C'],
      [currentLang === 'ko' ? '사출 속도' : 'Flow Rate', m.flowRate == null ? '-' : m.flowRate + ' cm3/s'],
      [currentLang === 'ko' ? '충전 시간' : 'Fill Time', m.fillTime ? m.fillTime.toFixed(2) + ' s' : '-'],
      [currentLang === 'ko' ? '압력 강하' : 'Pressure Drop', m.pressure ? m.pressure.toFixed(1) + ' MPa / ' + m.pressureLimit + ' MPa' : '-'],
      [currentLang === 'ko' ? '형체력' : 'Clamp Force', m.clamp == null ? '-' : m.clamp.toFixed(1) + ' tons'],
      [currentLang === 'ko' ? '냉각 시간' : 'Cooling Time', m.coolingTime ? m.coolingTime.toFixed(1) + ' s' : '-'],
      [currentLang === 'ko' ? '게이트 직경' : 'Gate Diameter', m.gateSize == null ? '-' : m.gateSize.toFixed(1) + ' mm']
    ];
    return '<table class="mf-process-table"><thead><tr><th>' + t('item') + '</th><th>' + t('currentCondition') + '</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') +
      '</tbody></table>';
  }

  function renderEmpty() {
    return '<div class="mf-shell"><div class="mf-dashboard">' +
      '<div class="mf-topbar"><div class="mf-title"><h1>' + t('emptyTitle') + '</h1>' +
      '<p>' + t('emptyDesc') + '</p></div></div>' +
      '<div class="mf-card"><div class="mf-empty">' + t('emptyBody') + '</div></div>' +
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
      '<div class="mf-title"><h1>' + t('dashTitle') + '</h1>' +
      '<p>' + esc(m.fileName) + ' ' + t('dashDesc') + '</p></div>' +
      '<div class="mf-actions"><button class="mf-btn" id="mf-go-3d">' + t('view3d') + '</button><button class="mf-btn primary" id="mf-go-report">' + t('reportBtn') + '</button></div>' +
      '</div>' +
      '<div class="mf-kpis">' +
      kpi(t('overall'), m.score + ' / 100', t('overallSub'), scoreColor) +
      kpi(t('dfm'), m.dfmScore + ' / 100', t('dfmSub'), m.dfmScore >= 80 ? 'var(--mf-green)' : m.dfmScore >= 60 ? 'var(--mf-yellow)' : 'var(--mf-red)') +
      kpi(t('toolingRisk'), severityLabel(m.toolingRisk), t('toolingSub'), severityColor(m.toolingRisk)) +
      kpi(t('reliability'), m.reliability + '%', t('reliabilitySub'), m.reliability >= 80 ? 'var(--mf-green)' : m.reliability >= 65 ? 'var(--mf-yellow)' : 'var(--mf-red)') +
      '</div>' +
      '<div class="mf-grid">' +
      '<section class="mf-card"><div class="mf-card-head"><h2>' + t('analysisScore') + '</h2><span class="mf-status-pill">CAE Summary</span></div><div class="mf-card-body">' +
      '<div class="mf-score-layout"><div class="mf-gauge" style="--score:' + m.score + '"><div><strong>' + m.score + '</strong><span>Overall</span></div></div>' +
      '<div class="mf-bars">' + bar('Fill', m.fillScore) + bar('Pack', m.packScore) + bar('Cool', m.coolScore) + bar('Warp', m.warpScore) + bar('DFM', m.dfmScore) + '</div></div>' +
      '</div></section>' +
      '<section class="mf-card"><div class="mf-card-head"><h2>' + t('processConditions') + '</h2><span class="mf-status-pill">Process Window</span></div><div class="mf-card-body">' + processTable(m) +
      '<div class="mf-note">' + t('processNote') + '</div></div></section>' +
      '<section class="mf-card mf-span-2"><div class="mf-card-head"><h2>' + t('sequenceTitle') + '</h2><span class="mf-status-pill">Fill / Pack / Cool / Warp</span></div><div class="mf-card-body"><div class="mf-sequence">' +
      step('01 FILL', currentLang === 'ko' ? '충전 예측' : 'Fill prediction', (currentLang === 'ko' ? '압력 여유 ' : 'pressure margin ') + Math.round((1 - m.pressureRatio) * 100) + '%, ' + (currentLang === 'ko' ? '최대 유동거리 ' : 'max flow distance ') + Math.round(m.flowDistance) + ' mm', m.fillScore) +
      step('02 PACK', currentLang === 'ko' ? '보압 / 수축' : 'Packing / shrinkage', (currentLang === 'ko' ? '수축 위험 ' : 'shrinkage risk ') + severityLabel(Math.max(m.shrinkRank, m.sinkRank)) + ', ' + (currentLang === 'ko' ? '최대 수축률 ' : 'max shrinkage ') + num(m.shrinkage.maxShrinkage, 0).toFixed(2) + '%', m.packScore) +
      step('03 COOL', currentLang === 'ko' ? '냉각 효율' : 'Cooling efficiency', (currentLang === 'ko' ? '냉각 시간 ' : 'cooling time ') + (m.coolingTime ? m.coolingTime.toFixed(1) : '-') + ' s, ' + (currentLang === 'ko' ? '수축 위험 ' : 'shrinkage risk ') + severityLabel(Math.max(m.sinkRank, m.shrinkRank)), m.coolScore) +
      step('04 WARP', currentLang === 'ko' ? '변형 예측' : 'Warpage prediction', (currentLang === 'ko' ? '변형 위험 ' : 'warp risk ') + severityLabel(m.warpRank) + ', ' + (currentLang === 'ko' ? '취출 방향 ' : 'pull direction ') + m.bestDirection, m.warpScore) +
      '</div></div></section>' +
      '<section class="mf-card"><div class="mf-card-head"><h2>' + t('defectTitle') + '</h2><span class="mf-status-pill">Defect Finder</span></div><div class="mf-card-body"><div class="mf-risk-list">' + buildRisks(m) + '</div></div></section>' +
      '<section class="mf-card"><div class="mf-card-head"><h2>' + t('doeTitle') + '</h2><span class="mf-status-pill">Optimizer</span></div><div class="mf-card-body"><div class="mf-doe-list">' + buildDoe(m) + '</div></div></section>' +
      '<section class="mf-card mf-span-2"><div class="mf-card-head"><h2>' + t('guidanceTitle') + '</h2><span class="mf-status-pill">Action Plan</span></div><div class="mf-card-body"><div class="mf-rec-list">' + buildRecommendations(m) + '</div></div></section>' +
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

  function applyTheme() {
    document.documentElement.dataset.theme = currentTheme;
    document.body.dataset.theme = currentTheme;
  }

  function installUserControls() {
    var host = document.querySelector('.header-right-actions');
    if (!host || byId('dima-user-controls')) return;
    var wrap = document.createElement('div');
    wrap.id = 'dima-user-controls';
    wrap.className = 'dima-user-controls';
    wrap.innerHTML =
      '<div class="dima-switch-group" data-switch="lang" aria-label="언어 선택">' +
      '<span class="dima-switch-label">언어</span>' +
      '<div class="dima-segment">' +
      '<span class="dima-switch-thumb" aria-hidden="true"></span>' +
      '<button type="button" data-lang="ko">한국어</button>' +
      '<button type="button" data-lang="en">EN</button>' +
      '</div>' +
      '</div>' +
      '<div class="dima-switch-group" data-switch="theme" aria-label="테마 선택">' +
      '<span class="dima-switch-label">화면</span>' +
      '<div class="dima-segment">' +
      '<span class="dima-switch-thumb" aria-hidden="true"></span>' +
      '<button type="button" data-theme="black">블랙</button>' +
      '<button type="button" data-theme="white">화이트</button>' +
      '</div>' +
      '</div>';
    host.insertBefore(wrap, host.firstChild);

    wrap.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || target.tagName !== 'BUTTON') return;
      if (target.dataset.lang) {
        currentLang = target.dataset.lang;
        localStorage.setItem('dima_lang', currentLang);
        patchLabels();
        renderDashboard();
      }
      if (target.dataset.theme) {
        currentTheme = target.dataset.theme;
        localStorage.setItem('dima_theme', currentTheme);
        applyTheme();
        updateControlState();
      }
    });
    updateControlState();
  }

  function updateControlState() {
    var langKo = document.querySelector('#dima-user-controls [data-lang="ko"]');
    var langEn = document.querySelector('#dima-user-controls [data-lang="en"]');
    var themeBlack = document.querySelector('#dima-user-controls [data-theme="black"]');
    var themeWhite = document.querySelector('#dima-user-controls [data-theme="white"]');
    if (langKo) langKo.textContent = currentLang === 'ko' ? '한국어' : 'Korean';
    if (langEn) langEn.textContent = currentLang === 'ko' ? '영어' : 'English';
    if (themeBlack) themeBlack.textContent = currentLang === 'ko' ? '블랙' : 'Black';
    if (themeWhite) themeWhite.textContent = currentLang === 'ko' ? '화이트' : 'White';
    document.querySelectorAll('#dima-user-controls .dima-switch-label').forEach(function (label) {
      var group = label.closest('.dima-switch-group');
      if (!group) return;
      if (group.dataset.switch === 'lang') label.textContent = currentLang === 'ko' ? '언어' : 'Lang';
      if (group.dataset.switch === 'theme') label.textContent = currentLang === 'ko' ? '화면' : 'View';
    });
    document.querySelectorAll('#dima-user-controls [data-lang]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.lang === currentLang);
    });
    document.querySelectorAll('#dima-user-controls [data-theme]').forEach(function (button) {
      button.classList.toggle('active', button.dataset.theme === currentTheme);
    });
    var langGroup = document.querySelector('#dima-user-controls [data-switch="lang"]');
    var themeGroup = document.querySelector('#dima-user-controls [data-switch="theme"]');
    if (langGroup) langGroup.dataset.value = currentLang;
    if (themeGroup) themeGroup.dataset.value = currentTheme;
  }

  function patchLabels() {
    var labels = [
      ['tab-dashboard', t('dashboard')],
      ['tab-3d', t('analysis3d')],
      ['tab-report', t('report')]
    ];
    labels.forEach(function (item) {
      var el = byId(item[0]);
      if (el) el.textContent = item[1];
    });
    var status = byId("status-text");
    if (status && (/[?]/.test(status.textContent || '') || /Ready|준비/.test(status.textContent || ''))) status.textContent = t('ready');
    document.title = t('title');
    var tab2d = byId("tab-2d");
    var content2d = byId("content-2d");
    if (tab2d) tab2d.hidden = true;
    if (content2d) {
      content2d.hidden = true;
      content2d.classList.remove("active");
    }

    var tools = [
      ['btn-solid', t('toolSolid'), currentLang === 'ko' ? '솔리드 보기' : 'Solid view'],
      ['btn-wireframe', t('toolMesh'), currentLang === 'ko' ? '메쉬 / 와이어 보기' : 'Fine mesh / wireframe view'],
      ['btn-draft-overlay', t('toolDraft'), currentLang === 'ko' ? '구배각 분석' : 'Draft angle analysis'],
      ['btn-flow-overlay', t('toolFill'), currentLang === 'ko' ? '자동 게이트 및 충전 분석' : 'Auto gate and fill analysis'],
      ['btn-shrink-overlay', t('toolShrink'), currentLang === 'ko' ? '수축 예측' : 'Shrinkage prediction'],
      ['btn-warp-overlay', t('toolWarp'), currentLang === 'ko' ? '변형 예측' : 'Warpage prediction'],
      ['btn-cooling-overlay', t('toolCool'), currentLang === 'ko' ? '냉각 분포' : 'Cooling distribution'],
      ['btn-set-gate', t('toolGate'), currentLang === 'ko' ? '수동 게이트 지정' : 'Manual gate placement'],
      ['btn-core-overlay', t('toolCore'), currentLang === 'ko' ? '코어 가이드' : 'Core guidance'],
      ['btn-parting-overlay', t('toolParting'), currentLang === 'ko' ? '파팅 라인' : 'Parting line'],
      ['btn-reset-cam', t('toolReset'), currentLang === 'ko' ? '화면 초기화' : 'Reset view']
    ];
    tools.forEach(function (item) {
      var el = byId(item[0]);
      if (!el) return;
      el.textContent = item[1];
      el.title = item[2];
    });
    var sinkTool = byId('btn-sink-overlay');
    if (sinkTool) {
      sinkTool.hidden = true;
      sinkTool.setAttribute('aria-hidden', 'true');
      sinkTool.tabIndex = -1;
      sinkTool.style.setProperty('display', 'none', 'important');
      sinkTool.textContent = '';
      sinkTool.title = '';
    }

    var sectionTitles = document.querySelectorAll("#content-3d .cad-model-tree-panel .panel-header h3");
    var names = [t('sectionImport'), t('sectionMaterial'), t('sectionDirection'), t('sectionProcess'), t('sectionTree')];
    sectionTitles.forEach(function (title, index) {
      if (names[index]) title.textContent = names[index];
    });
    var analyze = byId("btn-analyze-3d");
    if (analyze) analyze.textContent = t('runAnalysis');
    updateControlState();
  }

  function installHooks() {
    document.querySelectorAll('.nav-tab[data-tab="dashboard"]').forEach(function (button) {
      button.addEventListener('click', function () {
        setTimeout(renderDashboard, 60);
        setTimeout(renderDashboard, 160);
      });
    });
    var reportButton = byId('btn-export');
    if (reportButton) reportButton.textContent = t('exportPdf');

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
    applyTheme();
    installUserControls();
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
