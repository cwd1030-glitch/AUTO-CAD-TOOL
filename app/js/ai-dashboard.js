/**
 * ai-dashboard.js  (DIMA Phase 1 — 추가 모듈)
 * 엔지니어링 대시보드 + AI 엔지니어(Gemini) 패널.
 * 기존 분석 로직(App.stl.result)을 그대로 읽어 카드로 표시한다.
 * - 핵심 파일(main.js/stl-analyzer.js/css)은 수정하지 않는다.
 * - AI Review는 DIMA JSON만 전송. STL/STEP/Mesh는 절대 전송하지 않는다.
 */
(function () {
  'use strict';

  var LS_KEY = 'dima_gemini_api_key';
  var MODEL = 'gemini-2.5-flash';
  var RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  var RANK_LABEL = ['LOW', 'MEDIUM', 'HIGH'];

  /* ── 안전 헬퍼 ── */
  function res() { try { return (typeof App !== 'undefined' && App.stl) ? App.stl.result : null; } catch (e) { return null; } }
  function gateCount() {
    try { if (typeof STLAnalyzer !== 'undefined' && STLAnalyzer.getGatePositions) return STLAnalyzer.getGatePositions().length; } catch (e) {}
    return 0;
  }
  function domInt(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var m = (el.textContent || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }
  function maxRank() { var a = Array.prototype.slice.call(arguments); var r = 0; a.forEach(function (s) { var v = RANK[(s || 'LOW').toUpperCase()] || 0; if (v > r) r = v; }); return r; }
  function riskColor(rank) { return rank >= 2 ? 'var(--dima-red,#ff4d6d)' : rank === 1 ? 'var(--dima-yellow,#ffd166)' : 'var(--dima-green,#00ffa3)'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  /* ── DIMA 결과 → 엔지니어링 지표 ── */
  function metrics() {
    var r = res();
    if (!r) return null;
    var d = r.defects || {};
    var sink = (d.sink && d.sink.severity) || 'LOW';
    var shrink = (d.shrinkage && d.shrinkage.riskLevel) || 'LOW';
    var warp = (d.warpage && d.warpage.risk) || 'LOW';
    var slides = (r.moldFeatures && r.moldFeatures.slides ? r.moldFeatures.slides.length : 0);
    var lifters = (r.moldFeatures && r.moldFeatures.lifters ? r.moldFeatures.lifters.length : 0);
    var undercutPct = (r.stats && r.stats.undercutPct) || 0;
    var rec = r.recommendation || {};
    var weld = domInt('weld-count');
    var air = domInt('airtrap-count');

    // DFM 점수 (휴리스틱)
    var dfm = 100;
    dfm -= sink === 'HIGH' ? 15 : sink === 'MEDIUM' ? 8 : 0;
    dfm -= shrink === 'HIGH' ? 15 : shrink === 'MEDIUM' ? 8 : 0;
    dfm -= warp === 'HIGH' ? 12 : warp === 'MEDIUM' ? 5 : 0;
    dfm -= Math.min(20, undercutPct * 0.6);
    dfm = Math.max(0, Math.round(dfm));

    // 금형 가공 난이도
    var tdScore = slides * 2 + lifters * 3 + (undercutPct > 15 ? 2 : 0);
    var toolingRank = tdScore >= 5 ? 2 : tdScore >= 2 ? 1 : 0;

    // 생산 리스크
    var prodRank = maxRank(sink, shrink, warp);

    // 비용 영향
    var costRank = Math.max(toolingRank, prodRank, (rec.complexityScore || 0) > 120 ? 2 : (rec.complexityScore || 0) > 60 ? 1 : 0);

    return {
      overall: (typeof r.score === 'number' ? r.score : '--'),
      dfm: dfm,
      complexityLabel: rec.complexityLevel || '—',
      complexityScore: rec.complexityScore != null ? rec.complexityScore : '—',
      bestDir: rec.bestDirection || '—',
      confidence: rec.confidence != null ? rec.confidence : '—',
      prodRank: prodRank, toolingRank: toolingRank, costRank: costRank,
      slides: slides, lifters: lifters, undercutPct: undercutPct,
      sink: sink, shrink: shrink, warp: warp, weld: weld, air: air,
      material: (r.stats && r.stats.material) || ((typeof App !== 'undefined' && App.stl && App.stl.material) || 'ABS'),
      gates: gateCount(),
      flowLength: Math.round((r.diagnostics && r.diagnostics.maxFlowDistance) || 0)
    };
  }

  /* ── Gemini 전송용 JSON (이 데이터만 전송) ── */
  function buildDimaJson() {
    var m = metrics();
    if (!m) return null;
    var r = res() || {};
    return {
      material: m.material,
      score: typeof m.overall === 'number' ? m.overall : null,
      slides: m.slides,
      lifters: m.lifters,
      sinkRisk: m.sink,
      shrinkageRisk: m.shrink,
      warpageRisk: m.warp,
      weldCount: m.weld,
      airTrapCount: m.air,
      gateType: (r.recommendation && r.recommendation.gateType) || 'Side Gate',
      gateCount: m.gates,
      flowLength: m.flowLength,
      undercutPct: Math.round(m.undercutPct),
      pullDirection: m.bestDir
    };
  }

  /* ── 카드 HTML ── */
  function card(label, value, sub, color) {
    return '<div class="dima-card">' +
      '<div class="dima-card-label">' + esc(label) + '</div>' +
      '<div class="dima-card-value"' + (color ? ' style="color:' + color + '"' : '') + '>' + esc(value) + '</div>' +
      (sub ? '<div class="dima-card-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }
  function riskCard(label, rank) {
    return card(label, RANK_LABEL[rank], null, riskColor(rank));
  }

  function renderOverview() {
    var m = metrics();
    if (!m) return emptyState();
    return '<div class="dima-cards">' +
      card('Overall Score', m.overall + (typeof m.overall === 'number' ? ' / 100' : ''), '종합 양산성', m.overall >= 80 ? 'var(--dima-green,#00ffa3)' : m.overall >= 60 ? 'var(--dima-yellow,#ffd166)' : 'var(--dima-red,#ff4d6d)') +
      card('DFM Score', m.dfm + ' / 100', '제조 적합성', m.dfm >= 80 ? 'var(--dima-green,#00ffa3)' : m.dfm >= 60 ? 'var(--dima-yellow,#ffd166)' : 'var(--dima-red,#ff4d6d)') +
      card('Mold Complexity', m.complexityLabel, '점수 ' + m.complexityScore) +
      riskCard('Production Risk', m.prodRank) +
      riskCard('Cost Impact', m.costRank) +
      riskCard('Tooling Difficulty', m.toolingRank) +
      '</div>' +
      '<div class="dima-meta">소재 <b>' + esc(m.material) + '</b> · 권장 탈형 <b>' + esc(m.bestDir) + '</b> (신뢰도 ' + esc(m.confidence) + '%) · 게이트 <b>' + m.gates + '</b>개</div>';
  }

  function renderDFM() {
    var m = metrics();
    if (!m) return emptyState();
    return '<div class="dima-cards">' +
      riskCard('Shrinkage / Sink', Math.max(RANK[m.sink] || 0, RANK[m.shrink] || 0)) +
      riskCard('Warpage', RANK[m.warp]) +
      card('Undercut', m.undercutPct.toFixed(1) + '%', '언더컷 면적 비율') +
      card('Weld Line', m.weld + '개', '수지 회합부') +
      card('Air Trap', m.air + '개', '가스 정체') +
      '</div>';
  }

  function renderMold() {
    var m = metrics();
    if (!m) return emptyState();
    return '<div class="dima-cards">' +
      card('Slides', m.slides + '개', '슬라이드 코어') +
      card('Lifters', m.lifters + '개', '경사 코어') +
      card('Pull Direction', m.bestDir, '자동 추천 (AUTO)') +
      card('Complexity', m.complexityLabel, '점수 ' + m.complexityScore) +
      riskCard('Tooling Difficulty', m.toolingRank) +
      riskCard('Cost Impact', m.costRank) +
      '</div>';
  }

  function renderFlow() {
    var m = metrics();
    if (!m) return emptyState();
    return '<div class="dima-cards">' +
      card('Gates', m.gates + '개', '주입구') +
      card('Flow Length', m.flowLength + ' mm', '최대 유동거리') +
      card('Weld Line', m.weld + '개', '유동 회합') +
      card('Air Trap', m.air + '개', '가스 정체') +
      '</div>' +
      '<div class="dima-meta">게이트를 지정하면 유동·웰드라인 정밀도가 향상됩니다.</div>';
  }

  function emptyState() {
    return '<div class="dima-empty">📊 3D 모델을 분석하면 엔지니어링 지표가 여기에 표시됩니다.</div>';
  }

  /* ── AI Review (Multi-Agent Panel) ── */
  function renderAITab() {
    return '' +
      '<div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; margin-bottom: 12px;">' +
      '  <div style="font-size:0.75rem; font-weight:bold; color:#00d4ff; margin-bottom: 6px;">🤖 AI 검토 토론 위원회</div>' +
      '  <div style="font-size:0.7rem; color:#7a8fb0; line-height:1.5;">ChatGPT, Gemini, Claude가 제품 구조성, 가공 난이도, 사출 조건 및 수축/변형 방지 대책을 교차 토론하여 하나의 완성된 종합 성형 평가 의견을 제공합니다.</div>' +
      '</div>' +
      '<div class="dima-ai-note" style="font-size:0.7rem; color:#b0c4de; margin-bottom:10px; line-height:1.6;">※ AI API 연동 키는 우측 상단의 톱니바퀴(⚙️) 아이콘을 눌러 관리자 모드에서 설정해주십시오.</div>' +
      '<button id="dima-ai-run" class="dima-btn-primary">🤖 3대 AI 협력 토론 리뷰 실행</button>' +
      '<div id="dima-ai-out" class="dima-ai-out"></div>';
  }

  function runAIReview() {
    var out = document.getElementById('dima-ai-out');
    var oKey = '', gKey = '', cKey = '';
    try {
      oKey = localStorage.getItem('dima_openai_api_key') || '';
      gKey = localStorage.getItem('dima_gemini_api_key') || '';
      cKey = localStorage.getItem('dima_claude_api_key') || '';
    } catch (e) {}
    
    if (!oKey || !gKey || !cKey) {
      out.innerHTML = '<div class="dima-ai-err" style="background:rgba(255,77,109,0.1); color:#ff8fa3; padding:14px; border-radius:8px; font-size:0.8rem; line-height:1.6;">⚠️ ChatGPT, Gemini, Claude API 키가 관리자 모드에서 설정되어 있지 않습니다.<br/><span style="font-size:0.75rem; color:#cfe0f5;">우측 상단의 ⚙️ 아이콘을 클릭하여 설정해 주십시오.</span></div>';
      return;
    }

    var dima = buildDimaJson();
    if (!dima) {
      out.innerHTML = '<div class="dima-ai-err">⚠️ 먼저 3D 모델을 분석하세요.</div>';
      return;
    }

    out.innerHTML = '<div class="dima-ai-loading" style="background:rgba(0,212,255,0.08); color:#7dd3fc; padding:14px; border-radius:8px; font-size:0.8rem; line-height:1.6;">🤖 3대 AI (ChatGPT, Gemini, Claude) 토론 및 검토 위원회 가동 중...<br/><span style="font-size:0.7rem; color:#a5f3fc; margin-top:6px; display:block; line-height:1.4;">• Claude: 금형 설계/코어 가공성 검토 중...<br/>• ChatGPT: 사출 성형/공정 파라미터 검토 중...<br/>• Gemini: 최종 종합 및 팀장 보고서 작성 중...</span></div>';

    fetch('/api/multi-ai-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dima_data: dima,
        openai_key: oKey,
        gemini_key: gKey,
        claude_key: cKey
      })
    })
    .then(function (r) { return r.json(); })
    .then(function (resp) {
      if (resp.status !== 'success') {
        throw new Error(resp.message || '토론 리뷰 요청 실패');
      }
      renderAIResult(resp.ai_review, JSON.stringify(resp.ai_review));
    })
    .catch(function (err) {
      out.innerHTML = '<div class="dima-ai-err" style="background:rgba(255,77,109,0.1); color:#ff8fa3; padding:14px; border-radius:8px; font-size:0.8rem; line-height:1.6;">❌ AI 협업 토론 실패: ' + esc(err.message) + '<br/><span style="color:#a0a5b5; font-size:0.7rem;">API 키 유효성, 네트워크 상태 또는 로컬 서버 상태를 확인하세요.</span></div>';
    });
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) {}
    var m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    return null;
  }

  function ratingColor(r) {
    r = (r || '').toUpperCase();
    return r === 'GOOD' ? 'var(--dima-green,#00ffa3)' : r === 'CRITICAL' ? 'var(--dima-red,#ff4d6d)' : 'var(--dima-yellow,#ffd166)';
  }

  function renderAIResult(d, raw) {
    var out = document.getElementById('dima-ai-out');
    if (!d) { out.innerHTML = '<div class="dima-ai-err">응답 파싱 실패. 원문:<pre>' + esc(raw) + '</pre></div>'; return; }
    var h = '';
    h += '<div class="dima-cards">' +
      card('Overall Rating', d.overallRating || '—', null, ratingColor(d.overallRating)) +
      card('Mold Difficulty', d.moldDifficulty || '—', null) +
      card('Cost Impact', d.costImpact || '—', null) +
      card('Recommended Gate', d.recommendedGate || '—', '게이트 권장') +
      '</div>';
      
    if (d.summary) h += '<div class="dima-ai-summary" style="margin-top:12px; background:rgba(0,212,255,0.06); border-left:3px solid #00d4ff; padding:10px 12px; border-radius:0 8px 8px 0; font-size:0.82rem; line-height:1.7;"><b>📋 팀장 종합 의견 (Gemini):</b><br/>' + esc(d.summary) + '</div>';
    
    if (d.claudeOpinion) {
      h += '<div class="dima-ai-summary" style="margin-top:8px; background:rgba(217,119,6,0.06); border-left:3px solid #d97706; padding:10px 12px; border-radius:0 8px 8px 0; font-size:0.82rem; line-height:1.7;"><b>⚙️ 금형 설계 전문가 의견 (Claude):</b><br/>' + esc(d.claudeOpinion) + '</div>';
    }
    
    if (d.chatgptOpinion) {
      h += '<div class="dima-ai-summary" style="margin-top:8px; background:rgba(16,185,129,0.06); border-left:3px solid #10b981; padding:10px 12px; border-radius:0 8px 8px 0; font-size:0.82rem; line-height:1.7;"><b>⚡ 사출 성형 공정가 의견 (ChatGPT):</b><br/>' + esc(d.chatgptOpinion) + '</div>';
    }

    if (d.topIssues && d.topIssues.length) {
      h += '<div style="font-size:0.8rem; font-weight:bold; color:#ffd166; margin-top:16px; margin-bottom:8px;">🛠️ 핵심 개선대책 및 권고안</div>';
      h += '<div class="dima-ai-issues">';
      d.topIssues.forEach(function (it, i) {
        h += '<div class="dima-ai-issue">' +
          '<div class="dima-ai-issue-h">' + (i + 1) + '. ' + esc(it.issue || '') + '</div>' +
          (it.cause ? '<div class="dima-ai-issue-c"><b>원인:</b> ' + esc(it.cause) + '</div>' : '') +
          (it.recommendation ? '<div class="dima-ai-issue-r"><b>개선:</b> ' + esc(it.recommendation) + '</div>' : '') +
          '</div>';
      });
      h += '</div>';
    }
    out.innerHTML = h;
  }

  /* ── 탭 라우팅 ── */
  var TABS = [
    { id: 'overview', label: 'Overview', fn: renderOverview },
    { id: 'dfm', label: 'DFM', fn: renderDFM },
    { id: 'mold', label: 'Mold', fn: renderMold },
    { id: 'flow', label: 'Flow', fn: renderFlow },
    { id: 'ai', label: 'AI Review', fn: renderAITab }
  ];
  var current = 'overview';

  function renderTab() {
    var body = document.getElementById('dima-dash-body');
    if (!body) return;
    var t = TABS.filter(function (x) { return x.id === current; })[0] || TABS[0];
    body.innerHTML = t.fn();
    if (current === 'ai') wireAI();
  }
  function wireAI() {
    var save = document.getElementById('dima-ai-savekeys');
    if (save) {
      save.onclick = function () {
        var o = (document.getElementById('dima-ai-key-openai').value || '').trim();
        var g = (document.getElementById('dima-ai-key-gemini').value || '').trim();
        var c = (document.getElementById('dima-ai-key-claude').value || '').trim();
        try {
          localStorage.setItem('dima_openai_api_key', o);
          localStorage.setItem('dima_gemini_api_key', g);
          localStorage.setItem('dima_claude_api_key', c);
        } catch (e) {}
        save.textContent = '모든 키 저장됨 ✓';
        setTimeout(function () { save.textContent = 'API Key 모두 저장'; }, 1500);
      };
    }
    var run = document.getElementById('dima-ai-run');
    if (run) run.onclick = runAIReview;
  }

  /* ── 패널/스타일 주입 ── */
  /* ── 패널/스타일 주입 ── */
  function injectStyles() {
    if (document.getElementById('dima-dash-style')) return;
    var css = ''
      + '#dima-dash-toggle{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:9000;background:linear-gradient(135deg,#0055ff,#00d4ff);color:#fff;border:none;border-radius:8px 0 0 8px;padding:12px 8px;cursor:pointer;font-size:.74rem;font-weight:700;writing-mode:vertical-rl;letter-spacing:1px;box-shadow:-2px 0 10px rgba(0,0,0,.4)}'
      + '#dima-dash{position:fixed;top:0;right:-460px;width:440px;max-width:92vw;height:100vh;z-index:9001;background:#0e1525;border-left:1px solid rgba(0,212,255,.2);box-shadow:-8px 0 28px rgba(0,0,0,.55);transition:right .25s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;color:#e8f0fe;font-family:"Malgun Gothic","Noto Sans KR",sans-serif}'
      + '#dima-dash.open{right:0}'
      + '.dima-dash-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}'
      + '.dima-dash-head h3{margin:0;font-size:.95rem;color:#00d4ff;font-weight:700}'
      + '.dima-dash-close{background:none;border:none;color:#7a8fb0;font-size:1.2rem;cursor:pointer}'
      + '.dima-dash-tabs{display:flex;gap:4px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06);flex-wrap:wrap}'
      + '.dima-dash-tab{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#a8b6cf;border-radius:6px;padding:6px 11px;font-size:.76rem;cursor:pointer}'
      + '.dima-dash-tab.active{background:rgba(0,212,255,.16);border-color:rgba(0,212,255,.5);color:#00d4ff;font-weight:700}'
      + '#dima-dash-body{flex:1;overflow:auto;padding:16px}'
      + '.dima-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}'
      + '.dima-card{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px}'
      + '.dima-card-label{font-size:.68rem;color:#7a8fb0;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}'
      + '.dima-card-value{font-size:1.25rem;font-weight:800;color:#e8f0fe;line-height:1.1}'
      + '.dima-card-sub{font-size:.68rem;color:#677a99;margin-top:4px}'
      + '.dima-meta{margin-top:14px;font-size:.74rem;color:#8aa0c0;line-height:1.7}'
      + '.dima-empty{padding:40px 16px;text-align:center;color:#677a99;font-size:.85rem}'
      + '.dima-ai-keyrow{display:flex;gap:6px;margin-bottom:8px}'
      + '#dima-ai-key{flex:1;background:#0a0f1c;border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#e8f0fe;padding:8px 10px;font-size:.78rem}'
      + '.dima-btn-ghost{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#cfe0f5;border-radius:6px;padding:0 12px;cursor:pointer;font-size:.76rem}'
      + '.dima-ai-note{font-size:.7rem;color:#7a8fb0;margin-bottom:10px;line-height:1.6}'
      + '.dima-btn-primary{width:100%;background:linear-gradient(135deg,#0055ff,#00d4ff);border:none;color:#fff;font-weight:700;border-radius:8px;padding:11px;cursor:pointer;font-size:.85rem}'
      + '.dima-ai-out{margin-top:14px}'
      + '.dima-ai-loading,.dima-ai-err{padding:14px;border-radius:8px;font-size:.8rem;line-height:1.6}'
      + '.dima-ai-loading{background:rgba(0,212,255,.08);color:#7dd3fc}'
      + '.dima-ai-err{background:rgba(255,77,109,.1);color:#ff8fa3}'
      + '.dima-ai-summary{margin-top:12px;background:rgba(0,212,255,.06);border-left:3px solid #00d4ff;padding:10px 12px;border-radius:0 8px 8px 0;font-size:.82rem;line-height:1.7}'
      + '.dima-ai-issues{margin-top:12px;display:flex;flex-direction:column;gap:8px}'
      + '.dima-ai-issue{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 12px;font-size:.78rem;line-height:1.6}'
      + '.dima-ai-issue-h{font-weight:700;color:#ffd166;margin-bottom:4px}'
      + '.dima-ai-issue-c,.dima-ai-issue-r{color:#b8c6de}'
      + '.dima-ai-out pre{white-space:pre-wrap;font-size:.7rem;color:#9fb2cf}'
      + '.dima-admin-modal-overlay{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.65);backdrop-filter:blur(3px);z-index:10000;display:flex;align-items:center;justify-content:center}'
      + '.dima-admin-modal{background:#0e1525;border:1px solid rgba(0,212,255,0.25);border-radius:10px;width:380px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.55);color:#e8f0fe;display:flex;flex-direction:column;overflow:hidden}'
      + '.dima-admin-modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}'
      + '.dima-admin-modal-head h3{margin:0;font-size:.88rem;color:#00d4ff;font-weight:700}'
      + '.dima-admin-modal-body{padding:14px;display:flex;flex-direction:column;gap:10px}'
      + '.dima-admin-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.25)}';
    var st = document.createElement('style');
    st.id = 'dima-dash-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function showAdminModal() {
    if (document.getElementById('dima-admin-overlay')) return;
    var gKey = '', oKey = '', cKey = '';
    try {
      gKey = localStorage.getItem('dima_gemini_api_key') || '';
      oKey = localStorage.getItem('dima_openai_api_key') || '';
      cKey = localStorage.getItem('dima_claude_api_key') || '';
    } catch (e) {}

    var overlay = document.createElement('div');
    overlay.id = 'dima-admin-overlay';
    overlay.className = 'dima-admin-modal-overlay';
    overlay.innerHTML =
      '<div class="dima-admin-modal">' +
      '  <div class="dima-admin-modal-head">' +
      '    <h3>⚙ DIMA 관리자 모드 (API 키 설정)</h3>' +
      '    <button style="background:none; border:none; color:#7a8fb0; font-size:1.1rem; cursor:pointer;" id="dima-admin-modal-close">✕</button>' +
      '  </div>' +
      '  <div class="dima-admin-modal-body">' +
      '    <div style="font-size:0.72rem; color:#8aa0c0; line-height:1.5; margin-bottom:4px;">※ 본 설정은 3대 AI 협업 토론 리뷰 기능 수행을 위해 필요한 각 서비스의 API 키 저장소입니다. 키 값은 로컬 브라우저 보안 영역에만 안전하게 저장됩니다.</div>' +
      '    <div style="display:flex; flex-direction:column; gap:4px;">' +
      '      <label style="font-size:0.7rem; font-weight:bold; color:#a8b6cf;">ChatGPT (OpenAI) API Key</label>' +
      '      <input id="admin-key-openai" type="password" placeholder="sk-..." value="' + esc(oKey) + '" style="background:#0a0f1c; border:1px solid rgba(255,255,255,0.12); border-radius:6px; color:#e8f0fe; padding:8px 10px; font-size:0.78rem;" />' +
      '    </div>' +
      '    <div style="display:flex; flex-direction:column; gap:4px;">' +
      '      <label style="font-size:0.7rem; font-weight:bold; color:#a8b6cf;">Gemini (Google) API Key</label>' +
      '      <input id="admin-key-gemini" type="password" placeholder="AIzaSy..." value="' + esc(gKey) + '" style="background:#0a0f1c; border:1px solid rgba(255,255,255,0.12); border-radius:6px; color:#e8f0fe; padding:8px 10px; font-size:0.78rem;" />' +
      '    </div>' +
      '    <div style="display:flex; flex-direction:column; gap:4px;">' +
      '      <label style="font-size:0.7rem; font-weight:bold; color:#a8b6cf;">Claude (Anthropic) API Key</label>' +
      '      <input id="admin-key-claude" type="password" placeholder="sk-ant-..." value="' + esc(cKey) + '" style="background:#0a0f1c; border:1px solid rgba(255,255,255,0.12); border-radius:6px; color:#e8f0fe; padding:8px 10px; font-size:0.78rem;" />' +
      '    </div>' +
      '  </div>' +
      '  <div class="dima-admin-modal-foot">' +
      '    <button id="dima-admin-save" class="dima-btn-primary" style="width:auto; padding:6px 20px; font-size:0.8rem;">저장</button>' +
      '    <button id="dima-admin-cancel" class="dima-btn-ghost" style="padding:6px 16px; font-size:0.8rem;">닫기</button>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(overlay);

    var closeBtn = document.getElementById('dima-admin-modal-close');
    var cancelBtn = document.getElementById('dima-admin-cancel');
    var saveBtn = document.getElementById('dima-admin-save');

    var close = function() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    closeBtn.onclick = close;
    cancelBtn.onclick = close;

    saveBtn.onclick = function() {
      var o = (document.getElementById('admin-key-openai').value || '').trim();
      var g = (document.getElementById('admin-key-gemini').value || '').trim();
      var c = (document.getElementById('admin-key-claude').value || '').trim();
      try {
        localStorage.setItem('dima_openai_api_key', o);
        localStorage.setItem('dima_gemini_api_key', g);
        localStorage.setItem('dima_claude_api_key', c);
      } catch (e) {}
      
      saveBtn.textContent = '저장 완료 ✓';
      saveBtn.style.background = '#00ffa3';
      saveBtn.style.color = '#0e1525';
      
      setTimeout(function() {
        close();
      }, 800);
    };
  }

  function injectPanel() {
    if (document.getElementById('dima-dash')) return;

    var toggle = document.createElement('button');
    toggle.id = 'dima-dash-toggle';
    toggle.textContent = '📊 엔지니어링 · AI';
    document.body.appendChild(toggle);

    var panel = document.createElement('div');
    panel.id = 'dima-dash';
    panel.innerHTML =
      '<div class="dima-dash-head"><h3>📊 Engineering Dashboard</h3>' +
      '<div style="display:flex; gap:10px; align-items:center;">' +
      '  <button id="dima-admin-btn" style="background:none; border:none; color:#7a8fb0; font-size:1.0rem; cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center;" title="관리자 설정">⚙</button>' +
      '  <button class="dima-dash-close" id="dima-dash-close">✕</button>' +
      '</div></div>' +
      '<div class="dima-dash-tabs" id="dima-dash-tabs"></div>' +
      '<div id="dima-dash-body"></div>';
    document.body.appendChild(panel);

    var adminBtn = document.getElementById('dima-admin-btn');
    if (adminBtn) {
      adminBtn.onclick = showAdminModal;
    }

    var tabsEl = document.getElementById('dima-dash-tabs');
    TABS.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'dima-dash-tab' + (t.id === current ? ' active' : '');
      b.textContent = t.label;
      b.onclick = function () {
        current = t.id;
        Array.prototype.forEach.call(tabsEl.children, function (c) { c.classList.remove('active'); });
        b.classList.add('active');
        renderTab();
      };
      tabsEl.appendChild(b);
    });

    function open() { panel.classList.add('open'); renderTab(); }
    function close() { panel.classList.remove('open'); }
    toggle.onclick = function () { panel.classList.contains('open') ? close() : open(); };
    document.getElementById('dima-dash-close').onclick = close;
  }

  function init() {
    try { injectStyles(); injectPanel(); } catch (e) { /* 패널 실패가 본 프로그램을 막지 않도록 */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
