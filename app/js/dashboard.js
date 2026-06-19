/**
 * dashboard.js — DIMA 통합 대시보드 (UI/UX 리뉴얼 1차 통합)
 * 기존 탭 시스템(.nav-tab[data-tab] → #content-*)에 비침습적으로 통합.
 * window.App 은 const 선언이라 신뢰 불가하므로, main.js 가 ingest(result)로
 * 넘겨주는 최신 결과를 직접 캐싱해 사용한다. 외부 라이브러리 의존 없음. 모바일 반응형.
 */
(function () {
  'use strict';

  var _lastResult = null; // main.js ingest(result) 캐시

  function injectStyles() {
    if (document.getElementById('dbx-styles')) return;
    var css = `
    #content-dashboard { padding: 0; overflow:auto; }
    .dbx-wrap { padding: 20px 22px 40px; max-width: 1180px; margin: 0 auto; color: #e6ebf5; font-family: 'Outfit', system-ui, sans-serif; }
    .dbx-head { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:18px; }
    .dbx-title { font-size:1.18rem; font-weight:700; letter-spacing:-0.01em; }
    .dbx-title small { display:block; font-size:0.72rem; font-weight:400; color:#8b96ad; margin-top:2px; }
    .dbx-refresh { font-size:0.74rem; color:#00d4ff; background:rgba(0,212,255,0.08); border:1px solid rgba(0,212,255,0.28); border-radius:6px; padding:6px 12px; cursor:pointer; }
    .dbx-refresh:hover { background:rgba(0,212,255,0.16); }
    .dbx-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:18px; }
    .dbx-kpi { background:linear-gradient(160deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015)); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px 16px; }
    .dbx-kpi .v { font-size:1.7rem; font-weight:700; line-height:1.1; }
    .dbx-kpi .l { font-size:0.72rem; color:#9aa6bd; margin-top:6px; }
    .dbx-kpi.warn .v { color:#ffd166; } .dbx-kpi.risk .v { color:#ff6b6b; } .dbx-kpi.ok .v { color:#34d399; }
    .dbx-grid { display:grid; grid-template-columns:1.1fr 1fr; gap:16px; }
    .dbx-card { background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; }
    .dbx-card h3 { font-size:0.86rem; font-weight:700; margin:0 0 14px; color:#cfd8ea; }
    .dbx-score-row { display:flex; align-items:center; gap:20px; }
    .dbx-gauge { flex:0 0 auto; }
    .dbx-eval { flex:1; display:flex; flex-direction:column; gap:9px; }
    .dbx-bar-row { display:flex; align-items:center; gap:10px; font-size:0.76rem; }
    .dbx-bar-row .nm { width:60px; color:#9aa6bd; flex:0 0 auto; }
    .dbx-bar-track { flex:1; height:8px; background:rgba(255,255,255,0.07); border-radius:5px; overflow:hidden; }
    .dbx-bar-fill { height:100%; border-radius:5px; background:linear-gradient(90deg,#00d4ff,#34d399); }
    .dbx-bar-row .sc { width:34px; text-align:right; font-variant-numeric:tabular-nums; color:#cfd8ea; }
    .dbx-defects { display:flex; align-items:center; gap:18px; }
    .dbx-legend { display:flex; flex-direction:column; gap:8px; font-size:0.78rem; }
    .dbx-legend .li { display:flex; align-items:center; gap:8px; }
    .dbx-legend .dot { width:10px; height:10px; border-radius:3px; flex:0 0 auto; }
    .dbx-risk-list { display:flex; flex-direction:column; gap:10px; }
    .dbx-risk { display:flex; gap:12px; align-items:flex-start; padding:11px 13px; border-radius:10px; background:rgba(255,107,107,0.06); border:1px solid rgba(255,107,107,0.22); }
    .dbx-risk.mid { background:rgba(255,209,102,0.06); border-color:rgba(255,209,102,0.22); }
    .dbx-risk .ic { font-size:1.05rem; }
    .dbx-risk .tx b { font-size:0.82rem; } .dbx-risk .tx p { margin:3px 0 0; font-size:0.74rem; color:#9aa6bd; }
    .dbx-empty { color:#8b96ad; font-size:0.82rem; padding:24px 4px; text-align:center; }
    .dbx-span2 { grid-column:1 / -1; }
    @media (max-width: 820px) {
      .dbx-kpis { grid-template-columns:repeat(2,1fr); }
      .dbx-grid { grid-template-columns:1fr; }
      .dbx-wrap { padding:14px 14px 40px; }
      .dbx-score-row { flex-direction:column; align-items:stretch; }
    }`;
    var s = document.createElement('style');
    s.id = 'dbx-styles'; s.textContent = css; document.head.appendChild(s);
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function sevRank(s) { s = (s || '').toUpperCase(); return s === 'HIGH' ? 3 : s === 'MEDIUM' ? 2 : s === 'LOW' ? 1 : 0; }
  function sevToScore(s) { var n = sevRank(s); return n === 3 ? 40 : n === 2 ? 70 : n === 1 ? 90 : 100; }

  function collectMetrics() {
    var m = { score: null, evals: [], risks: [], hasAnalysis: false,
              sinkCount: 0, warpCount: 0, shrinkCount: 0, totalDefect: 0, cycleTime: 0, parts: [] };
    try {
      var r = _lastResult || (window.App && window.App.stl && window.App.stl.result) || null;
      if (r) {
        m.hasAnalysis = true;
        if (typeof r.score === 'number') m.score = Math.round(r.score);
        var d = r.defects || {};
        var sink = d.sink || {}, warp = d.warpage || {}, shrink = d.shrinkage || {};
        var shrinkSinkSeverity = (sink.severity === 'HIGH' || shrink.riskLevel === 'HIGH') ? 'HIGH'
          : (sink.severity === 'MEDIUM' || shrink.riskLevel === 'MEDIUM') ? 'MEDIUM'
          : 'LOW';
        m.sinkCount = sink.count || 0; m.warpCount = warp.count || 0; m.shrinkCount = shrink.count || 0;
        m.totalDefect = m.sinkCount + m.warpCount;
        m.parts = [
          { label: 'Shrinkage / Sink', value: m.sinkCount || sevRank(shrinkSinkSeverity), sev: sevRank(shrinkSinkSeverity), color: '#ff6b6b' },
          { label: 'Warpage',   value: m.warpCount, sev: sevRank(warp.severity), color: '#3b82f6' }
        ];
        if (m.totalDefect === 0) m.parts.forEach(function (p) { p.value = p.sev; });
        m.evals = [
          { name: 'Shrink/Sink', score: sevToScore(shrinkSinkSeverity) },
          { name: 'Warp', score: sevToScore(warp.severity) }
        ];
        if (r.stats && typeof r.stats.undercutPct === 'number') {
          m.evals.push({ name: 'Undercut', score: Math.max(0, Math.min(100, Math.round(100 - r.stats.undercutPct * 2))) });
        }
        if (Array.isArray(r.issues)) {
          r.issues.forEach(function (is) {
            var lv = (is.level || '').toLowerCase();
            if (lv === 'error' || lv === 'danger' || lv === 'warning' || lv === 'warn') {
              m.risks.push({ title: is.title || '위험 항목', desc: is.desc || '', mid: (lv === 'warning' || lv === 'warn') });
            }
          });
        }
      }
      try { if (window.STLAnalyzer && typeof window.STLAnalyzer.getCycleTime === 'function') m.cycleTime = window.STLAnalyzer.getCycleTime() || 0; } catch (e) {}
    } catch (e) {}
    return m;
  }

  function gaugeSVG(score) {
    var s = (score == null) ? 0 : score;
    var col = s >= 80 ? '#34d399' : s >= 60 ? '#ffd166' : '#ff6b6b';
    var R = 46, C = 2 * Math.PI * R, off = C * (1 - s / 100);
    var label = (score == null) ? '–' : score;
    return '<svg width="120" height="120" viewBox="0 0 120 120">' +
      '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"/>' +
      '<circle cx="60" cy="60" r="' + R + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="58" text-anchor="middle" fill="#e6ebf5" font-size="26" font-weight="700">' + label + '</text>' +
      '<text x="60" y="76" text-anchor="middle" fill="#8b96ad" font-size="11">종합점수</text></svg>';
  }

  function donutSVG(parts) {
    var total = parts.reduce(function (a, p) { return a + p.value; }, 0) || 1;
    var R = 42, C = 2 * Math.PI * R, acc = 0;
    var segs = parts.map(function (p) {
      var len = C * (p.value / total), gap = C - len, dash = len.toFixed(1) + ' ' + gap.toFixed(1);
      var rot = (acc / total) * 360 - 90; acc += p.value;
      return '<circle cx="55" cy="55" r="' + R + '" fill="none" stroke="' + p.color + '" stroke-width="14" stroke-dasharray="' + dash + '" transform="rotate(' + rot.toFixed(1) + ' 55 55)"/>';
    }).join('');
    return '<svg width="110" height="110" viewBox="0 0 110 110"><circle cx="55" cy="55" r="' + R + '" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="14"/>' + segs + '</svg>';
  }

  function render() {
    var host = document.getElementById('content-dashboard');
    if (!host) return;
    injectStyles();
    var m = collectMetrics();
    var wrap = el('div', 'dbx-wrap');

    var head = el('div', 'dbx-head');
    head.appendChild(el('div', 'dbx-title', '검증 대시보드<small>최근 분석 결과 기반 요약 · DFM 위험 한눈에 보기</small>'));
    var btn = el('button', 'dbx-refresh', '↻ 새로고침');
    btn.addEventListener('click', render);
    head.appendChild(btn);
    wrap.appendChild(head);

    var kpis = el('div', 'dbx-kpis');
    var totalDefect = m.totalDefect;
    function kpi(v, l, cls) { var k = el('div', 'dbx-kpi ' + (cls || '')); k.appendChild(el('div', 'v', v)); k.appendChild(el('div', 'l', l)); return k; }
    kpis.appendChild(kpi(m.hasAnalysis ? '1' : '0', '검증 완료 모델', 'ok'));
    kpis.appendChild(kpi(String(totalDefect), '예측 불량 건수', totalDefect > 0 ? 'risk' : 'ok'));
    kpis.appendChild(kpi(String(m.risks.length), '위험/주의 항목', m.risks.length > 0 ? 'warn' : 'ok'));
    kpis.appendChild(kpi(m.cycleTime ? m.cycleTime.toFixed(1) + 's' : '—', '예상 사이클 타임'));
    wrap.appendChild(kpis);

    if (!m.hasAnalysis) {
      var emptyCard = el('div', 'dbx-card');
      emptyCard.appendChild(el('div', 'dbx-empty', '📋 아직 분석 결과가 없습니다.<br>[🧊 3D 사출 분석] 탭에서 모델을 분석하면 이 대시보드가 자동으로 채워집니다.'));
      wrap.appendChild(emptyCard);
      host.innerHTML = ''; host.appendChild(wrap); return;
    }

    var grid = el('div', 'dbx-grid');

    var scoreCard = el('div', 'dbx-card');
    scoreCard.appendChild(el('h3', null, '종합 평가 / 항목별 점수'));
    var row = el('div', 'dbx-score-row');
    row.appendChild(el('div', 'dbx-gauge', gaugeSVG(m.score)));
    var evalBox = el('div', 'dbx-eval');
    var evals = m.evals.length ? m.evals : [{ name: '두께', score: m.score || 0 }, { name: 'Draft', score: m.score || 0 }, { name: 'Gate', score: m.score || 0 }];
    evals.forEach(function (ev) {
      var r2 = el('div', 'dbx-bar-row');
      r2.appendChild(el('span', 'nm', ev.name));
      var track = el('div', 'dbx-bar-track');
      var fill = el('div', 'dbx-bar-fill'); fill.style.width = ev.score + '%';
      if (ev.score < 60) fill.style.background = 'linear-gradient(90deg,#ff6b6b,#ffd166)';
      track.appendChild(fill); r2.appendChild(track);
      r2.appendChild(el('span', 'sc', ev.score));
      evalBox.appendChild(r2);
    });
    row.appendChild(evalBox); scoreCard.appendChild(row); grid.appendChild(scoreCard);

    var defCard = el('div', 'dbx-card');
    defCard.appendChild(el('h3', null, '불량 유형 분석'));
    var parts = m.parts;
    var anyDef = parts.some(function (p) { return p.value > 0; });
    if (anyDef) {
      var dfl = el('div', 'dbx-defects');
      dfl.appendChild(el('div', null, donutSVG(parts)));
      var legend = el('div', 'dbx-legend');
      var totD = parts.reduce(function (a, p) { return a + p.value; }, 0) || 1;
      parts.forEach(function (p) {
        var li = el('div', 'li');
        li.appendChild(el('span', 'dot', '')); li.lastChild.style.background = p.color;
        li.appendChild(el('span', null, p.label + ' — ' + p.value + ' (' + Math.round(p.value / totD * 100) + '%)'));
        legend.appendChild(li);
      });
      dfl.appendChild(legend); defCard.appendChild(dfl);
    } else {
      defCard.appendChild(el('div', 'dbx-empty', '예측된 불량이 없습니다 ✓'));
    }
    grid.appendChild(defCard);

    var riskCard = el('div', 'dbx-card dbx-span2');
    riskCard.appendChild(el('h3', null, '위험 / 주의 항목'));
    if (m.risks.length) {
      var list = el('div', 'dbx-risk-list');
      m.risks.slice(0, 8).forEach(function (rk) {
        var r3 = el('div', 'dbx-risk' + (rk.mid ? ' mid' : ''));
        r3.appendChild(el('div', 'ic', rk.mid ? '⚠️' : '⛔'));
        var tx = el('div', 'tx');
        tx.appendChild(el('b', null, rk.title));
        if (rk.desc) tx.appendChild(el('p', null, rk.desc));
        r3.appendChild(tx); list.appendChild(r3);
      });
      riskCard.appendChild(list);
    } else {
      riskCard.appendChild(el('div', 'dbx-empty', '위험/주의 항목이 없습니다 ✓'));
    }
    grid.appendChild(riskCard);

    wrap.appendChild(grid);
    host.innerHTML = ''; host.appendChild(wrap);
  }

  function bindTab() {
    document.querySelectorAll('.nav-tab[data-tab="dashboard"]').forEach(function (b) {
      b.addEventListener('click', function () { setTimeout(render, 30); });
    });
  }

  function init() { injectStyles(); bindTab(); render(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.DimaDashboard = {
    refresh: render,
    ingest: function (result) { try { if (result) _lastResult = result; } catch (e) {} try { render(); } catch (e) {} }
  };
})();
