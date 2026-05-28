/**
 * dxf-analyzer.js
 * DXF 파싱 + Canvas 렌더링 + Rule Engine
 */

const DXFAnalyzer = (() => {

  /* ──────────────────────────────────────
     1. PARSER
  ────────────────────────────────────── */
  function parse(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const entities = [];
    const layers = new Set();
    let i = 0;
    let inEntities = false;
    let cur = null;
    const SUPPORTED = new Set(['LINE','CIRCLE','ARC','LWPOLYLINE','TEXT','MTEXT','POINT','ELLIPSE']);

    function flush() { if (cur) { entities.push(cur); cur = null; } }

    while (i < lines.length - 1) {
      const code = parseInt(lines[i].trim(), 10);
      const val  = lines[i + 1].trim();
      i += 2;

      if (code === 0) {
        flush();
        if (val === 'ENTITIES') { inEntities = true; continue; }
        if (val === 'ENDSEC')   { inEntities = false; continue; }
        if (inEntities && SUPPORTED.has(val)) {
          cur = { type: val, layer: '0', pts: [], r: 0, sa: 0, ea: Math.PI*2, txt: '' };
        }
        continue;
      }
      if (!cur || !inEntities) continue;

      switch (code) {
        case 8:  cur.layer = val; layers.add(val); break;
        case 10: cur.pts.push({ x: parseFloat(val), y: 0 }); break;
        case 20: if (cur.pts.length) cur.pts[cur.pts.length-1].y = parseFloat(val); break;
        case 11: cur.x2 = parseFloat(val); break;
        case 21: cur.y2 = parseFloat(val); break;
        case 40: cur.r  = parseFloat(val); break;
        case 50: cur.sa = parseFloat(val) * Math.PI / 180; break;
        case 51: cur.ea = parseFloat(val) * Math.PI / 180; break;
        case 1:
        case 3:  cur.txt += val; break;
        case 70: cur.flags = parseInt(val, 10); break;
      }
    }
    flush();
    return { entities, layers: [...layers] };
  }

  /* ──────────────────────────────────────
     2. LAYER COLOR MAP
  ────────────────────────────────────── */
  const LAYER_COLORS = {
    '0':          '#e8f0fe',
    'CENTER':     '#ff6b6b',
    'HIDDEN':     '#ffd166',
    'DIMENSION':  '#a8dadc',
    'HATCH':      '#c77dff',
    'TEXT':       '#06d6a0',
    'OUTLINE':    '#00d4ff',
    'BORDER':     '#90e0ef',
    'DEFPOINTS':  '#555',
  };
  function layerColor(name) {
    const up = name.toUpperCase();
    for (const [k, v] of Object.entries(LAYER_COLORS)) {
      if (up.includes(k)) return v;
    }
    // hash fallback
    const h = [...name].reduce((a,c)=>a+c.charCodeAt(0),0);
    const hue = (h * 47) % 360;
    return `hsl(${hue},70%,65%)`;
  }

  /* ──────────────────────────────────────
     3. CANVAS RENDERER
  ────────────────────────────────────── */
  let _view = { offX: 0, offY: 0, scale: 1 };
  let _parsed = null;
  let _canvas = null;

  function initCanvas(canvas, parsed) {
    _canvas = canvas;
    _parsed = parsed;
    fitView();
  }

  function fitView() {
    if (!_parsed || !_canvas) return;
    const { entities } = _parsed;
    if (!entities.length) return;

    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    entities.forEach(e => {
      e.pts.forEach(p => {
        minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x);
        minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y);
      });
      if (e.type==='CIRCLE'||e.type==='ARC') {
        const cx=e.pts[0]?.x||0, cy=e.pts[0]?.y||0;
        minX=Math.min(minX,cx-e.r); maxX=Math.max(maxX,cx+e.r);
        minY=Math.min(minY,cy-e.r); maxY=Math.max(maxY,cy+e.r);
      }
      if (e.x2 !== undefined) { minX=Math.min(minX,e.x2); maxX=Math.max(maxX,e.x2); }
      if (e.y2 !== undefined) { minY=Math.min(minY,e.y2); maxY=Math.max(maxY,e.y2); }
    });

    if (!isFinite(minX)) { minX=0;maxX=100;minY=0;maxY=100; }

    const W = _canvas.width, H = _canvas.height;
    const dw = maxX-minX||1, dh = maxY-minY||1;
    const margin = 0.88;
    _view.scale = Math.min(W/dw, H/dh) * margin;
    _view.offX  = (W - dw*_view.scale)/2 - minX*_view.scale;
    _view.offY  = (H - dh*_view.scale)/2 - minY*_view.scale;
    draw();
  }

  function toScreen(x, y) {
    return { sx: x*_view.scale + _view.offX,
             sy: _canvas.height - (y*_view.scale + _view.offY) };
  }

  function draw() {
    if (!_canvas || !_parsed) return;
    const ctx = _canvas.getContext('2d');
    const W = _canvas.width, H = _canvas.height;

    // background
    ctx.fillStyle = '#080c18';
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const step = 50;
    for (let x=0; x<W; x+=step) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y=0; y<H; y+=step) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    _parsed.entities.forEach(e => drawEntity(ctx, e));
  }

  function drawEntity(ctx, e) {
    const color = layerColor(e.layer);
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = 1.2;

    if (e.type === 'LINE') {
      if (!e.pts[0] || e.x2===undefined) return;
      const p1 = toScreen(e.pts[0].x, e.pts[0].y);
      const p2 = toScreen(e.x2, e.y2||0);
      ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();

    } else if (e.type === 'CIRCLE') {
      if (!e.pts[0]) return;
      const c = toScreen(e.pts[0].x, e.pts[0].y);
      const r = e.r * _view.scale;
      ctx.beginPath(); ctx.arc(c.sx, c.sy, r, 0, Math.PI*2); ctx.stroke();

    } else if (e.type === 'ARC') {
      if (!e.pts[0]) return;
      const c = toScreen(e.pts[0].x, e.pts[0].y);
      const r = e.r * _view.scale;
      ctx.beginPath();
      ctx.arc(c.sx, c.sy, r, -e.ea, -e.sa, true);
      ctx.stroke();

    } else if (e.type === 'LWPOLYLINE') {
      if (e.pts.length < 2) return;
      ctx.beginPath();
      e.pts.forEach((p,i) => {
        const s = toScreen(p.x, p.y);
        i === 0 ? ctx.moveTo(s.sx, s.sy) : ctx.lineTo(s.sx, s.sy);
      });
      if (e.flags & 1) ctx.closePath(); // closed polyline
      ctx.stroke();

    } else if (e.type === 'POINT') {
      if (!e.pts[0]) return;
      const p = toScreen(e.pts[0].x, e.pts[0].y);
      ctx.beginPath(); ctx.arc(p.sx, p.sy, 3, 0, Math.PI*2); ctx.fill();

    } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
      if (!e.pts[0] || !e.txt) return;
      const p = toScreen(e.pts[0].x, e.pts[0].y);
      ctx.font = `${Math.max(8, e.r*_view.scale||10)}px Outfit, sans-serif`;
      ctx.fillText(e.txt.substring(0,30), p.sx, p.sy);
    }
  }

  function pan(dx, dy) {
    _view.offX += dx; _view.offY += dy; draw();
  }
  function zoom(factor, cx, cy) {
    const before = { x: (cx - _view.offX)/_view.scale, y: (_canvas.height - cy - _view.offY)/_view.scale };
    _view.scale *= factor;
    _view.offX = cx - before.x*_view.scale;
    _view.offY = _canvas.height - cy - before.y*_view.scale;
    draw();
  }

  /* ──────────────────────────────────────
     4. RULE ENGINE
  ────────────────────────────────────── */
  function analyze(parsed) {
    const { entities, layers } = parsed;
    const issues = [];
    const UP = l => l.toUpperCase();

    const hasCenterLayer  = layers.some(l => UP(l).includes('CENTER'));
    const hasHiddenLayer  = layers.some(l => UP(l).includes('HIDDEN') || UP(l).includes('HIDE'));
    const hasDimLayer     = layers.some(l => UP(l).includes('DIM') || UP(l).includes('DIMENSION'));
    const hasHatchLayer   = layers.some(l => UP(l).includes('HATCH'));
    const textEntities    = entities.filter(e => e.type==='TEXT'||e.type==='MTEXT');
    const lineEntities    = entities.filter(e => e.type==='LINE');
    const circleEntities  = entities.filter(e => e.type==='CIRCLE');

    // Check 1: Center layer
    if (!hasCenterLayer) {
      issues.push({ level:'warning', title:'중심선 레이어 없음', desc:'CENTER 레이어가 발견되지 않았습니다. 원형 피처에 중심선을 추가하세요.' });
    } else {
      issues.push({ level:'ok', title:'중심선 레이어 정상', desc:'CENTER 레이어가 올바르게 사용되고 있습니다.' });
    }

    // Check 2: Hidden layer
    if (!hasHiddenLayer) {
      issues.push({ level:'warning', title:'숨은선 레이어 없음', desc:'HIDDEN 레이어가 발견되지 않았습니다. 비가시부 형상에 숨은선이 필요할 수 있습니다.' });
    } else {
      issues.push({ level:'ok', title:'숨은선 레이어 정상', desc:'HIDDEN 레이어가 사용되고 있습니다.' });
    }

    // Check 3: Dimension layer
    if (!hasDimLayer) {
      issues.push({ level:'error', title:'치수 레이어 없음', desc:'DIMENSION 레이어가 없습니다. 치수 기입 누락 가능성이 높습니다.' });
    } else {
      issues.push({ level:'ok', title:'치수 레이어 확인', desc:'치수(DIMENSION) 레이어가 존재합니다.' });
    }

    // Check 4: Text entities (dimensions)
    if (textEntities.length === 0) {
      issues.push({ level:'error', title:'치수 텍스트 없음', desc:'도면에 치수 텍스트(TEXT/MTEXT)가 없습니다. 치수 기입이 누락된 것 같습니다.' });
    } else {
      issues.push({ level:'info', title:`치수 텍스트 ${textEntities.length}개 확인`, desc:`${textEntities.length}개의 텍스트 엔티티가 발견되었습니다.` });
    }

    // Check 5: Circle without center line
    if (circleEntities.length > 0 && !hasCenterLayer) {
      issues.push({ level:'warning', title:`원형 피처 ${circleEntities.length}개 — 중심선 부재`, desc:'원(Circle) 형상에 중심선이 없습니다. 제도 규칙상 중심선이 필요합니다.' });
    }

    // Check 6: Entity count
    const total = entities.length;
    if (total < 5) {
      issues.push({ level:'warning', title:'엔티티 수 부족', desc:`총 ${total}개의 엔티티만 발견되었습니다. 도면이 불완전할 수 있습니다.` });
    } else {
      issues.push({ level:'info', title:`전체 엔티티 ${total}개`, desc:`라인 ${lineEntities.length}개, 원 ${circleEntities.length}개, 텍스트 ${textEntities.length}개 포함.` });
    }

    // Check 7: Layer count
    if (layers.length < 2) {
      issues.push({ level:'warning', title:'레이어 구분 부족', desc:'레이어가 1개뿐입니다. 요소별 레이어 분리를 권장합니다.' });
    } else {
      issues.push({ level:'ok', title:`레이어 ${layers.length}개 사용`, desc:'레이어가 분리되어 관리되고 있습니다.' });
    }

    // Check 8: Hatch
    if (!hasHatchLayer && layers.length > 2) {
      issues.push({ level:'info', title:'해칭 레이어 없음', desc:'단면도가 있다면 HATCH 레이어에서 해칭을 확인해주세요.' });
    }

    // Score
    const errorCount   = issues.filter(i=>i.level==='error').length;
    const warningCount = issues.filter(i=>i.level==='warning').length;
    const score = Math.max(0, 100 - errorCount*20 - warningCount*8);

    return { issues, score, layers, entityCount: total };
  }

  /* ──────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────── */
  return { parse, initCanvas, fitView, pan, zoom, draw, analyze };

})();
