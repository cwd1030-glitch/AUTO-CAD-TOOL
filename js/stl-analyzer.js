/**
 * stl-analyzer.js
 * STL 파싱 + Three.js 3D 뷰어 + 구배각 오버레이 + 사출성형 분석
 */

const STLAnalyzer = (() => {
 
  let _scene, _camera, _renderer, _controls, _mesh;
  let _geometry = null;
  let _showOverlay = true;
  let _material = 'ABS';
  let _pullAxis = 'Z';
  let _flipAxis = false;
  let _coreHelpers = null;
  let _gimbalWidget = null;
  let _partingLineObj = null;
  let _partingHeightPct = 50;
  const CONTAINER_ID = 'canvas-3d';

  // Flow simulation and gate settings
  let _gatePositions = [];   // array of local-space Vector3
  let _gateNormals  = [];    // parallel array of face normals
  let _gateMarkers  = [];    // parallel array of THREE.Mesh markers
  let _defectMarkers = [];
  let _flowOverlayActive = false;
  let _flowDistances = null;
  let _maxFlowDistance = 0;
  let _isGateSettingMode = false;
  let _flowAnimationTime = 0.0;
  let _adjacencyGraph = null;

  const MATERIAL_DB = {
    ABS: { shrink: 0.005, minDraft: 1.0, ribRatio: 0.6, name: 'ABS' },
    PC:  { shrink: 0.006, minDraft: 1.5, ribRatio: 0.55, name: 'PC (폴리카보네이트)' },
    PP:  { shrink: 0.015, minDraft: 2.0, ribRatio: 0.5,  name: 'PP (폴리프로필렌)' },
    POM: { shrink: 0.020, minDraft: 0.5, ribRatio: 0.5,  name: 'POM (아세탈)' },
  };

  /* ──────────────────────────────────────
     1. STL/STP PARSER
  ────────────────────────────────────── */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (window.occtimportjs) { resolve(); return; }
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load library: ' + url));
      document.head.appendChild(script);
    });
  }

  async function parseSTP(buffer) {
    await loadScript('libs/occt-import-js.js');

    const occt = await window.occtimportjs({
      locateFile: (name) => 'libs/' + name
    });

    const uint8Array = new Uint8Array(buffer);
    const result = occt.ReadStepFile(uint8Array, null);

    if (!result || !result.success || !result.meshes || result.meshes.length === 0) {
      throw new Error('STEP 파일을 파싱할 수 없거나 유효한 3D 메쉬가 없습니다.');
    }

    const positions = [];
    const normals = [];

    result.meshes.forEach(meshData => {
      const posArr = meshData.attributes.position.array;
      const normArr = meshData.attributes.normal ? meshData.attributes.normal.array : null;
      const indexArr = meshData.index ? meshData.index.array : null;

      if (indexArr) {
        for (let i = 0; i < indexArr.length; i++) {
          const idx = indexArr[i];
          positions.push(posArr[idx * 3], posArr[idx * 3 + 1], posArr[idx * 3 + 2]);
          if (normArr) {
            normals.push(normArr[idx * 3], normArr[idx * 3 + 1], normArr[idx * 3 + 2]);
          } else {
            normals.push(0, 0, 0);
          }
        }
      } else {
        for (let i = 0; i < posArr.length; i++) {
          positions.push(posArr[i]);
          if (normArr) {
            normals.push(normArr[i]);
          } else {
            normals.push(0);
          }
        }
      }
    });

    const flatPositions = new Float32Array(positions);
    let flatNormals = new Float32Array(normals);

    const tempGeo = new THREE.BufferGeometry();
    tempGeo.setAttribute('position', new THREE.BufferAttribute(flatPositions, 3));
    if (normals.some(n => n !== 0)) {
      tempGeo.setAttribute('normal', new THREE.BufferAttribute(flatNormals, 3));
    } else {
      tempGeo.computeVertexNormals();
      flatNormals = tempGeo.attributes.normal.array;
    }

    const text = new TextDecoder().decode(uint8Array.slice(0, 50000));
    let productName = 'STEP Part';
    const nameMatch = text.match(/FILE_NAME\s*\(\s*'([^']+)'/i) || text.match(/PRODUCT\s*\(\s*'([^']+)'/i);
    if (nameMatch && nameMatch[1]) {
      productName = nameMatch[1].split(/[\\/]/).pop();
    }

    const faceCount = (text.match(/ADVANCED_FACE/g) || []).length || result.meshes.length;
    const shellCount = (text.match(/CLOSED_SHELL/g) || []).length || 1;

    return {
      positions: flatPositions,
      normals: flatNormals,
      triCount: flatPositions.length / 9,
      isSimulated: false,
      metadata: {
        productName,
        faceCount,
        shellCount
      }
    };
  }

  function parseSTL(buffer) {
    // Try binary first (ASCII check)
    const arr  = new Uint8Array(buffer);
    const text = new TextDecoder().decode(arr.slice(0, 80));
    if (text.trim().startsWith('solid') && !isBinarySTL(arr)) {
      return parseASCII(new TextDecoder().decode(arr));
    }
    return parseBinary(buffer);
  }

  function isBinarySTL(arr) {
    if (arr.length < 84) return false;
    const triCount = new DataView(arr.buffer).getUint32(80, true);
    const expected = 84 + triCount * 50;
    return Math.abs(arr.length - expected) < 10;
  }

  function parseBinary(buffer) {
    const view = new DataView(buffer);
    const triCount = view.getUint32(80, true);
    const positions = [], normals = [];
    let offset = 84;
    for (let i = 0; i < triCount; i++) {
      const nx = view.getFloat32(offset,    true);
      const ny = view.getFloat32(offset+4,  true);
      const nz = view.getFloat32(offset+8,  true);
      offset += 12;
      for (let v = 0; v < 3; v++) {
        positions.push(view.getFloat32(offset,   true),
                       view.getFloat32(offset+4, true),
                       view.getFloat32(offset+8, true));
        normals.push(nx, ny, nz);
        offset += 12;
      }
      offset += 2; // attribute
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), triCount };
  }

  function parseASCII(text) {
    const positions = [], normals = [];
    const facetRe  = /facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
    const vertexRe = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
    let fm, vm;
    while ((fm = facetRe.exec(text)) !== null) {
      const nx = parseFloat(fm[1]), ny = parseFloat(fm[2]), nz = parseFloat(fm[3]);
      for (let v = 0; v < 3; v++) {
        vm = vertexRe.exec(text);
        if (!vm) break;
        positions.push(parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3]));
        normals.push(nx, ny, nz);
      }
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), triCount: positions.length/9 };
  }

  /* ──────────────────────────────────────
     2. THREE.JS VIEWER INIT
  ────────────────────────────────────── */
  function initViewer() {
    const container = document.getElementById(CONTAINER_ID);
    const W = container.clientWidth, H = container.clientHeight;

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x080c18);
    _scene.fog = new THREE.FogExp2(0x080c18, 0.003);

    _camera = new THREE.PerspectiveCamera(45, W/H, 0.01, 10000);
    _camera.position.set(0, 0, 200);

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(window.devicePixelRatio);
    _renderer.setSize(W, H);
    _renderer.shadowMap.enabled = true;
    container.appendChild(_renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0x334466, 0.6);
    _scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dir1.position.set(1, 2, 3);
    _scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x004488, 0.4);
    dir2.position.set(-2, -1, -1);
    _scene.add(dir2);
    // Rim light
    const rim = new THREE.PointLight(0x00d4ff, 0.5, 5000);
    rim.position.set(-200, 200, -200);
    _scene.add(rim);

    // Grid
    const grid = new THREE.GridHelper(500, 30, 0x112244, 0x0a1a2e);
    _scene.add(grid);

    // Controls
    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.enableDamping = true;
    _controls.dampingFactor = 0.08;
    _controls.minDistance = 1;
    _controls.maxDistance = 5000;

    // Resize
    window.addEventListener('resize', () => {
      const W2 = container.clientWidth, H2 = container.clientHeight;
      _camera.aspect = W2/H2; _camera.updateProjectionMatrix();
      _renderer.setSize(W2, H2);
    });

    animate();
  }

  function animate() {
    requestAnimationFrame(animate);
    if (_mesh && _mesh.targetQuaternion) {
      const angle = _mesh.quaternion.angleTo(_mesh.targetQuaternion);
      if (angle > 0.001) {
        _mesh.quaternion.slerp(_mesh.targetQuaternion, 0.08);
      } else {
        _mesh.quaternion.copy(_mesh.targetQuaternion);
      }
    }
    _controls.update();
    _renderer.render(_scene, _camera);
  }

  /* ──────────────────────────────────────
     3. LOAD GEOMETRY + COLOR OVERLAY
  ────────────────────────────────────── */
  function loadGeometry(stlData) {
    if (_mesh) { _scene.remove(_mesh); _geometry && _geometry.dispose(); }
    clearGate();

    _geometry = new THREE.BufferGeometry();
    _geometry.setAttribute('position', new THREE.BufferAttribute(stlData.positions, 3));
    _geometry.setAttribute('normal',   new THREE.BufferAttribute(stlData.normals.slice(), 3));

    // Center model first to establish correct bounding box centers
    _geometry.computeBoundingBox();
    const box = _geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Vertex colors based on draft angle (passing positions for centroid check)
    const colors = computeDraftColors(stlData.positions, stlData.normals);
    _geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshPhongMaterial({
      vertexColors: _showOverlay,
      shininess: 60,
      specular: new THREE.Color(0x003355),
    });
    if (!_showOverlay) {
      mat.vertexColors = false;
      mat.color = new THREE.Color(0x1a8fd1);
    }

    _mesh = new THREE.Mesh(_geometry, mat);
    _mesh.targetQuaternion = new THREE.Quaternion();
    setPullAxis(_pullAxis);
    _mesh.quaternion.copy(_mesh.targetQuaternion);

    _mesh.position.sub(center);

    // Position grid at bottom of model
    const size = new THREE.Vector3();
    box.getSize(size);
    const gridObj = _scene.children.find(c => c instanceof THREE.GridHelper);
    if (gridObj) gridObj.position.y = -size.y / 2;

    // Adjust camera
    const radius = size.length();
    _camera.position.set(radius, radius*0.7, radius*1.2);
    _controls.target.set(0, 0, 0);
    _controls.update();

    // Add labeled coordinate axes gimbal next to model
    if (_gimbalWidget) _scene.remove(_gimbalWidget);
    const gimbalSize = Math.max(10, Math.min(20, radius * 0.03));
    _gimbalWidget = createLabeledAxes(gimbalSize);
    _gimbalWidget.position.set(-size.x * 0.5 - 10, -size.y/2, size.z * 0.5 + 10);
    _scene.add(_gimbalWidget);

    _scene.add(_mesh);
  }

  function computeDraftColors(positions, normals) {
    const colors = new Float32Array(normals.length);
    const sin1 = Math.sin(1 * Math.PI/180);
    const sin3 = Math.sin(3 * Math.PI/180);

    _geometry.computeBoundingBox();
    const box = _geometry.boundingBox;

    let minVal, maxVal;
    if (_pullAxis === 'X') {
      minVal = box.min.x; maxVal = box.max.x;
    } else if (_pullAxis === 'Y') {
      minVal = box.min.y; maxVal = box.max.y;
    } else {
      minVal = box.min.z; maxVal = box.max.z;
    }
    const partingH = minVal + (maxVal - minVal) * (_partingHeightPct / 100);

    for (let i = 0; i < normals.length; i += 3) {
      const nx = normals[i], ny = normals[i+1], nz = normals[i+2];
      const vx = positions[i], vy = positions[i+1], vz = positions[i+2];

      let dotVal = nz;
      let centerOffset = vz - partingH;
      if (_pullAxis === 'X') {
        dotVal = nx;
        centerOffset = vx - partingH;
      } else if (_pullAxis === 'Y') {
        dotVal = ny;
        centerOffset = vy - partingH;
      }
      
      if (_flipAxis) {
        dotVal = -dotVal;
        centerOffset = -centerOffset;
      }

      const absVal = Math.abs(dotVal);
      let r, g, b;

      // Actual Undercut (Backdraft): normal faces backwards relative to its side of the mold parting plane
      const isBackdraft = (centerOffset > 0 && dotVal < -0.15) || (centerOffset < 0 && dotVal > 0.15);

      if (isBackdraft) {
        // ACTUAL UNDERCUT (RED)
        r = 1.0; g = 0.15; b = 0.2;
      } else if (absVal > 0.98) {
        // Horizontal top/bottom (CYAN)
        r = 0.1; g = 0.7; b = 0.9;
      } else if (absVal < sin1) {
        // INSUFFICIENT DRAFT (YELLOW/ORANGE)
        r = 1.0; g = 0.75; b = 0.15;
      } else if (absVal < sin3) {
        // Marginal draft (YELLOW-GREEN)
        r = 0.8; g = 0.9; b = 0.1;
      } else {
        // Good draft (GREEN)
        r = 0.0; g = 0.9; b = 0.45;
      }

      colors[i] = r; colors[i+1] = g; colors[i+2] = b;
    }
    return colors;
  }

  function toggleOverlay(show) {
    _showOverlay = show;
    if (!_mesh) return;
    _mesh.material.vertexColors = show;
    if (!show) _mesh.material.color = new THREE.Color(0x1a8fd1);
    else _mesh.material.color = new THREE.Color(0xffffff);
    _mesh.material.needsUpdate = true;
  }

  function setWireframe(val) {
    if (_mesh) { _mesh.material.wireframe = val; _mesh.material.needsUpdate = true; }
  }

  function resetCamera() {
    if (!_geometry) return;
    _geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    _geometry.boundingBox.getSize(size);
    const r = size.length();
    _camera.position.set(r, r*0.7, r*1.2);
    _controls.target.set(0,0,0);
    _controls.update();
  }

  /* ──────────────────────────────────────
     4. ANALYSIS ENGINE
  ────────────────────────────────────── */
  function analyze(stlData, matKey) {
    const mat = MATERIAL_DB[matKey] || MATERIAL_DB.ABS;
    _material = matKey;
    const normals = stlData.normals;
    const pos = stlData.positions;
    const triCount = stlData.triCount;

    const sin1 = Math.sin(mat.minDraft * Math.PI/180);
    const sin3 = Math.sin(3 * Math.PI/180);

    // Bounding Box check
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (let i=0;i<pos.length;i+=3) {
      minX=Math.min(minX,pos[i]);   maxX=Math.max(maxX,pos[i]);
      minY=Math.min(minY,pos[i+1]); maxY=Math.max(maxY,pos[i+1]);
      minZ=Math.min(minZ,pos[i+2]); maxZ=Math.max(maxZ,pos[i+2]);
    }
    const dx=maxX-minX, dy=maxY-minY, dz=maxZ-minZ;
    const minDim = Math.min(dx,dy,dz);
    const maxDim = Math.max(dx,dy,dz);
    const thicknessRatio = minDim / maxDim;

    const centerX = minX + dx/2;
    const centerY = minY + dy/2;
    const centerZ = minZ + dz/2;

    let minVal, maxVal;
    if (_pullAxis === 'X') {
      minVal = minX; maxVal = maxX;
    } else if (_pullAxis === 'Y') {
      minVal = minY; maxVal = maxY;
    } else {
      minVal = minZ; maxVal = maxZ;
    }
    const partingH = minVal + (maxVal - minVal) * (_partingHeightPct / 100);

    let undercutFaces = 0, marginalFaces = 0, okFaces = 0, topFaces = 0;

    for (let i = 0; i < normals.length; i += 3) {
      const nx = normals[i], ny = normals[i+1], nz = normals[i+2];
      const vx = pos[i], vy = pos[i+1], vz = pos[i+2];

      let dotVal = nz;
      let centerOffset = vz - partingH;
      if (_pullAxis === 'X') {
        dotVal = nx;
        centerOffset = vx - partingH;
      } else if (_pullAxis === 'Y') {
        dotVal = ny;
        centerOffset = vy - partingH;
      }

      if (_flipAxis) {
        dotVal = -dotVal;
        centerOffset = -centerOffset;
      }

      const absnz = Math.abs(dotVal);
      
      const isBackdraft = (centerOffset > 0 && dotVal < -0.15) || (centerOffset < 0 && dotVal > 0.15);

      if (isBackdraft) {
        undercutFaces++;
      } else if (absnz > 0.98) {
        topFaces++;
      } else if (absnz < sin1) {
        marginalFaces++;
      } else {
        okFaces++;
      }
    }
    const total = undercutFaces + marginalFaces + okFaces;
    const undercutPct = total > 0 ? (undercutFaces/total*100) : 0;
    const marginalPct = total > 0 ? (marginalFaces/total*100) : 0;
    const okPct       = total > 0 ? (okFaces/total*100) : 0;
    const wallThickOK = minDim > 1.0;

    // Sink mark risk
    const shrinkRisk = mat.shrink > 0.01 ? 'HIGH' : mat.shrink > 0.006 ? 'MEDIUM' : 'LOW';

    // Build issues
    const issues = [];

    issues.push({
      level: undercutPct < 5 ? 'ok' : undercutPct < 20 ? 'warning' : 'error',
      title: `언더컷 위험 면 ${undercutPct.toFixed(1)}%`,
      desc: `탈형 불가능한 면이 ${undercutFaces}개 (${undercutPct.toFixed(1)}%) 감지되었습니다. ${undercutPct > 10 ? '슬라이드 코어 검토 필요.' : '허용 범위 이내입니다.'}`,
    });

    issues.push({
      level: marginalPct < 10 ? 'info' : 'warning',
      title: `구배 부족 면 ${marginalPct.toFixed(1)}%`,
      desc: `${mat.name} 기준 최소 구배각 ${mat.minDraft}° 미만 면이 ${marginalFaces}개입니다. 표면 품질 저하 가능성 있습니다.`,
    });

    issues.push({
      level: 'ok',
      title: `구배 양호 면 ${okPct.toFixed(1)}%`,
      desc: `${okFaces}개 면이 충분한 구배각을 보유하고 있습니다.`,
    });

    issues.push({
      level: thicknessRatio < 0.05 ? 'error' : thicknessRatio < 0.1 ? 'warning' : 'ok',
      title: `살두께 비율 ${(thicknessRatio*100).toFixed(1)}%`,
      desc: `최소 치수 ${minDim.toFixed(2)}mm / 최대 치수 ${maxDim.toFixed(2)}mm. ${mat.name} Rib 권장 두께: 벽두께의 ${(mat.ribRatio*100).toFixed(0)}%.`,
    });

    issues.push({
      level: shrinkRisk === 'HIGH' ? 'error' : shrinkRisk === 'MEDIUM' ? 'warning' : 'ok',
      title: `수축(Sink Mark) 위험도: ${shrinkRisk}`,
      desc: `${mat.name} 수축률 ${(mat.shrink*100).toFixed(1)}%. ${shrinkRisk !== 'LOW' ? 'Rib 두께 및 냉각 시간 재검토를 권장합니다.' : '수축 위험도가 낮습니다.'}`,
    });

    issues.push({
      level: 'info',
      title: `삼각형 면 ${triCount.toLocaleString()}개`,
      desc: `STL 모델 해상도: ${triCount < 1000 ? '낮음 (분석 정확도 제한)' : triCount < 50000 ? '보통' : '높음'}.`,
    });

    // Weld line prediction
    issues.push({
      level: undercutPct > 15 ? 'warning' : 'info',
      title: '웰드라인 예측',
      desc: `복잡도 기반 예측: 언더컷 비율 ${undercutPct.toFixed(0)}% → 웰드라인 발생 가능성 ${undercutPct > 20 ? '높음 🔴' : undercutPct > 8 ? '중간 🟡' : '낮음 🟢'}.`,
    });

    // Score
    const errorCount   = issues.filter(i=>i.level==='error').length;
    const warningCount = issues.filter(i=>i.level==='warning').length;
    const score = Math.max(0, 100 - errorCount*18 - warningCount*7);

    // Calculate core bounding boxes for UI reporting
    const moldFeatures = { slides: [], lifters: [] };
    const slideClusters = {};
    const lifterClusters = {};
    
    for (let i = 0; i < normals.length; i += 3) {
      const nx = normals[i], ny = normals[i+1], nz = normals[i+2];
      const vx = pos[i], vy = pos[i+1], vz = pos[i+2];
      let dotVal = nz;
      let centerOff = vz - centerZ;
      if (_pullAxis === 'X') { dotVal = nx; centerOff = vx - centerX; }
      else if (_pullAxis === 'Y') { dotVal = ny; centerOff = vy - centerY; }
      
      if (_flipAxis) {
        dotVal = -dotVal;
        centerOff = -centerOff;
      }
      
      if ((centerOff > 0 && dotVal < -0.15) || (centerOff < 0 && dotVal > 0.15)) {
        const toCenter = new THREE.Vector3(vx - centerX, vy - centerY, vz - centerZ);
        
        let pDir = '';
        if (_pullAxis === 'X') { pDir = Math.abs(ny) > Math.abs(nz) ? (ny > 0 ? '+Y':'-Y') : (nz > 0 ? '+Z':'-Z'); }
        else if (_pullAxis === 'Y') { pDir = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? '+X':'-X') : (nz > 0 ? '+Z':'-Z'); }
        else { pDir = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? '+X':'-X') : (ny > 0 ? '+Y':'-Y'); }
        
        if (toCenter.dot(new THREE.Vector3(nx, ny, nz)) > 0) {
          if (!slideClusters[pDir]) slideClusters[pDir] = [];
          slideClusters[pDir].push({x:vx, y:vy, z:vz});
        } else {
          if (!lifterClusters[pDir]) lifterClusters[pDir] = [];
          lifterClusters[pDir].push({x:vx, y:vy, z:vz});
        }
      }
    }

    // Filter out small clusters (under 30 points) to avoid noise/erroneous lifters/slides
    for (const dir in slideClusters) {
      if (slideClusters[dir].length < 30) {
        delete slideClusters[dir];
      }
    }
    for (const dir in lifterClusters) {
      if (lifterClusters[dir].length < 30) {
        delete lifterClusters[dir];
      }
    }
    
    Object.keys(slideClusters).forEach(dir => {
      let min = {x: Infinity, y: Infinity, z: Infinity}, max = {x: -Infinity, y: -Infinity, z: -Infinity};
      slideClusters[dir].forEach(p => {
        min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
      });
      moldFeatures.slides.push({ dir, center: { x: (min.x+max.x)/2, y: (min.y+max.y)/2, z: (min.z+max.z)/2 } });
    });
    
    Object.keys(lifterClusters).forEach(dir => {
      let min = {x: Infinity, y: Infinity, z: Infinity}, max = {x: -Infinity, y: -Infinity, z: -Infinity};
      lifterClusters[dir].forEach(p => {
        min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
        max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
      });
      moldFeatures.lifters.push({ dir, center: { x: (min.x+max.x)/2, y: (min.y+max.y)/2, z: (min.z+max.z)/2 } });
    });

    return {
      issues, score, moldFeatures,
      stats: { undercutPct, marginalPct, okPct, triCount, material: mat.name, shrinkRisk, isSimulated: stlData.isSimulated, metadata: stlData.metadata }
    };
  }

  function setFlipAxis(flip) {
    _flipAxis = flip;
    setPullAxis(_pullAxis);
  }

  function setPullAxis(axis) {
    _pullAxis = axis;
    if (!_mesh) return;

    if (!_mesh.targetQuaternion) {
      _mesh.targetQuaternion = new THREE.Quaternion();
    }

    const targetAxis = new THREE.Vector3(0, 1, 0);
    const sourceAxis = new THREE.Vector3();

    if (axis === 'X') {
      sourceAxis.set(1, 0, 0);
    } else if (axis === 'Y') {
      sourceAxis.set(0, 1, 0);
    } else {
      sourceAxis.set(0, 0, 1);
    }
    
    if (_flipAxis) {
      sourceAxis.negate();
    }

    _mesh.targetQuaternion.setFromUnitVectors(sourceAxis, targetAxis);
  }

  function recolorGeometry() {
    if (!_geometry || !_mesh) return;
    const positions = _geometry.attributes.position.array;
    let colors;
    if (_flowOverlayActive && _flowDistances) {
      colors = computeFlowColors(positions, _flowDistances, _maxFlowDistance, _flowAnimationTime);
    } else {
      const normals = _geometry.attributes.normal.array;
      colors = computeDraftColors(positions, normals);
    }
    _geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    _geometry.attributes.color.needsUpdate = true;
    _mesh.material.needsUpdate = true;

    if (_partingLineObj) {
      updatePartingLine(true);
    }
  }

  function updateCoreHelpers(visible) {
    if (_coreHelpers) {
      _mesh.remove(_coreHelpers);
      _coreHelpers = null;
    }

    if (!visible || !_geometry || !_mesh) return;

    const pos = _geometry.attributes.position.array;
    const norm = _geometry.attributes.normal.array;
    const mat = MATERIAL_DB[_material] || MATERIAL_DB.ABS;
    const sin1 = Math.sin(mat.minDraft * Math.PI/180);

    _geometry.computeBoundingBox();
    const box = _geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);

    let minVal, maxVal;
    if (_pullAxis === 'X') {
      minVal = box.min.x; maxVal = box.max.x;
    } else if (_pullAxis === 'Y') {
      minVal = box.min.y; maxVal = box.max.y;
    } else {
      minVal = box.min.z; maxVal = box.max.z;
    }
    const partingH = minVal + (maxVal - minVal) * (_partingHeightPct / 100);

    const slideClusters = {};
    const lifterClusters = {};

    for (let i = 0; i < norm.length; i += 3) {
      const nx = norm[i], ny = norm[i+1], nz = norm[i+2];
      const vx = pos[i], vy = pos[i+1], vz = pos[i+2];

      let dotVal = nz;
      let centerOffset = vz - partingH;
      if (_pullAxis === 'X') {
        dotVal = nx;
        centerOffset = vx - partingH;
      } else if (_pullAxis === 'Y') {
        dotVal = ny;
        centerOffset = vy - partingH;
      }
      
      if (_flipAxis) {
        dotVal = -dotVal;
        centerOffset = -centerOffset;
      }

      const isBackdraft = (centerOffset > 0 && dotVal < -0.15) || (centerOffset < 0 && dotVal > 0.15);

      if (isBackdraft) {
        const vx_val = pos[i], vy_val = pos[i+1], vz_val = pos[i+2];
        const toCenterVec = new THREE.Vector3(vx_val, vy_val, vz_val).sub(center);
        const normalVec = new THREE.Vector3(nx, ny, nz);
        
        let pDir = '';
        if (_pullAxis === 'X') { pDir = Math.abs(ny) > Math.abs(nz) ? (ny > 0 ? '+Y':'-Y') : (nz > 0 ? '+Z':'-Z'); }
        else if (_pullAxis === 'Y') { pDir = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? '+X':'-X') : (nz > 0 ? '+Z':'-Z'); }
        else { pDir = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? '+X':'-X') : (ny > 0 ? '+Y':'-Y'); }
        
        if (toCenterVec.dot(normalVec) > 0) {
          if (!slideClusters[pDir]) slideClusters[pDir] = [];
          slideClusters[pDir].push(vx_val, vy_val, vz_val);
        } else {
          if (!lifterClusters[pDir]) lifterClusters[pDir] = [];
          lifterClusters[pDir].push(vx_val, vy_val, vz_val);
        }
      }
    }

    // Filter out small clusters (under 30 points) to avoid noise/erroneous lifters/slides
    for (const dir in slideClusters) {
      if (slideClusters[dir].length < 30) {
        delete slideClusters[dir];
      }
    }
    for (const dir in lifterClusters) {
      if (lifterClusters[dir].length < 30) {
        delete lifterClusters[dir];
      }
    }

    _coreHelpers = new THREE.Group();
    
    const getDirVec = (dirStr) => {
        const v = new THREE.Vector3();
        if(dirStr==='+X') v.set(1,0,0);
        if(dirStr==='-X') v.set(-1,0,0);
        if(dirStr==='+Y') v.set(0,1,0);
        if(dirStr==='-Y') v.set(0,-1,0);
        if(dirStr==='+Z') v.set(0,0,1);
        if(dirStr==='-Z') v.set(0,0,-1);
        return v;
    };

    function drawCoreMechanicalUnit(positions, color, dirStr, isSlide, index) {
      if (positions.length === 0) return;

      let minX=Infinity, minY=Infinity, minZ=Infinity;
      let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
      for (let j = 0; j < positions.length; j += 3) {
        minX = Math.min(minX, positions[j]);   maxX = Math.max(maxX, positions[j]);
        minY = Math.min(minY, positions[j+1]); maxY = Math.max(maxY, positions[j+1]);
        minZ = Math.min(minZ, positions[j+2]); maxZ = Math.max(maxZ, positions[j+2]);
      }

      const dx = maxX - minX;
      const dy = maxY - minY;
      const dz = maxZ - minZ;

      const size = new THREE.Vector3();
      box.getSize(size);
      const avgModelDim = (size.x + size.y + size.z) / 3;

      if (isSlide) {
        const minSlideDim = avgModelDim * 0.15;
        const slideW = Math.max(minSlideDim, dx * 1.2);
        const slideH = Math.max(minSlideDim, dy * 1.2);
        const slideD = Math.max(minSlideDim, dz * 1.2);
        
        // SLIDER HEAD (Molding surface block)
        const headGeo = new THREE.BoxGeometry(slideW, slideH, slideD);
        const headMat = new THREE.MeshPhongMaterial({ color: color, transparent: true, opacity: 0.5, shininess: 90, depthWrite: false });
        const headMesh = new THREE.Mesh(headGeo, headMat);
        headMesh.name = `slide_${index}_head`;
        headMesh.position.set(minX + dx/2, minY + dy/2, minZ + dz/2);
        const edgeLine = new THREE.LineSegments(new THREE.EdgesGeometry(headGeo), new THREE.LineBasicMaterial({ color: color }));
        headMesh.add(edgeLine);
        _coreHelpers.add(headMesh);

        // SLIDER BODY (Block extending outward)
        const bodyLen = Math.max(avgModelDim * 0.4, (dx+dy+dz) * 0.8);
        // Align body with pull direction
        const bodyGeo = new THREE.BoxGeometry(Math.max(avgModelDim * 0.08, slideW * 0.6), slideH * 0.7, bodyLen);
        bodyGeo.translate(0, 0, bodyLen/2 + slideD/2);
        const bodyMat = new THREE.MeshPhongMaterial({ color: 0x223344, transparent: true, opacity: 0.85, shininess: 50 });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.name = `slide_${index}_body`;
        bodyMesh.position.copy(headMesh.position);
        
        // Rotate body to face arrowDir (which is the slide pulling direction)
        const arrowDir = getDirVec(dirStr);
        const lookDir = arrowDir.clone().normalize();
        bodyMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), lookDir);
        _coreHelpers.add(bodyMesh);

        // Base Rail Plate (under the slide)
        const railGeo = new THREE.BoxGeometry(slideW * 1.1, avgModelDim * 0.03, bodyLen + slideD);
        railGeo.translate(0, -slideH/2 - (avgModelDim * 0.015), bodyLen/2);
        const railMat = new THREE.MeshPhongMaterial({ color: 0x444455 });
        const railMesh = new THREE.Mesh(railGeo, railMat);
        railMesh.name = `slide_${index}_rail`;
        railMesh.position.copy(headMesh.position);
        railMesh.quaternion.copy(bodyMesh.quaternion);
        _coreHelpers.add(railMesh);

        // Stronger Direction arrow
        const arrowLength = bodyLen * 0.8;
        // Start arrow at the back of the body
        const arrowStart = headMesh.position.clone().add(lookDir.clone().multiplyScalar(slideD/2));
        const arrow = new THREE.ArrowHelper(lookDir, arrowStart, arrowLength, color, avgModelDim * 0.08, avgModelDim * 0.04);
        _coreHelpers.add(arrow);

        // Label
        const label = createTextSprite(`슬라이드 코어 #${index}`, color, avgModelDim * 0.12);
        label.position.copy(headMesh.position).add(new THREE.Vector3(0, slideH + (avgModelDim * 0.1), 0));
        _coreHelpers.add(label);

      } else {
        const minLiftDim = avgModelDim * 0.08;
        const liftW = Math.max(minLiftDim, dx * 1.2);
        const liftH = Math.max(minLiftDim, dy * 1.2);
        const liftD = Math.max(minLiftDim, dz * 1.2);

        // LIFTER head (Molding surface block)
        const coreGeo = new THREE.BoxGeometry(liftW, liftH, liftD);
        const coreMat = new THREE.MeshPhongMaterial({ color: color, transparent: true, opacity: 0.5, shininess: 90, depthWrite: false });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.name = `lifter_${index}_head`;
        coreMesh.position.set(minX + dx/2, minY + dy/2, minZ + dz/2);
        const edgeLine = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo), new THREE.LineBasicMaterial({ color: color }));
        coreMesh.add(edgeLine);
        _coreHelpers.add(coreMesh);

        // Calculate slant direction (project offset from center, slant by 12 degrees)
        const slantDir = new THREE.Vector3().copy(coreMesh.position).sub(center);
        slantDir.y = 0; // horizontal vector outwards
        slantDir.normalize().multiplyScalar(0.25); // xz offset for 10-15 degree slant
        slantDir.y = -0.96; // major vertical component downwards
        slantDir.normalize();

        // Slanted lifter rod (Rectangular bar) extending downwards
        const rodLength = Math.max(avgModelDim * 0.8, Math.abs(coreMesh.position.y - (-size.y/2)) + (avgModelDim * 0.2));
        const rodGeo = new THREE.BoxGeometry(liftW * 0.7, rodLength, liftD * 0.7);
        rodGeo.translate(0, -rodLength/2, 0); // extend down
        const rodMat = new THREE.MeshStandardMaterial({ color: 0x99aacc, metalness: 0.8, roughness: 0.2 });
        const rodMesh = new THREE.Mesh(rodGeo, rodMat);
        rodMesh.name = `lifter_${index}_rod`;
        rodMesh.position.copy(coreMesh.position);

        rodMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), slantDir);
        _coreHelpers.add(rodMesh);

        // Slider base foot/bushing
        const footGeo = new THREE.BoxGeometry(liftW * 1.5, avgModelDim * 0.05, liftD * 1.5);
        const footMat = new THREE.MeshPhongMaterial({ color: 0x33333b });
        const footMesh = new THREE.Mesh(footGeo, footMat);
        footMesh.name = `lifter_${index}_foot`;
        const footOffset = slantDir.clone().multiplyScalar(rodLength);
        footMesh.position.copy(coreMesh.position).add(footOffset);
        _coreHelpers.add(footMesh);

        // Slanted arrow showing diagonal ejection direction
        const ejectDir = new THREE.Vector3(-slantDir.x, -slantDir.y, -slantDir.z).normalize(); // upwards slant
        const arrowStart = footMesh.position.clone();
        const arrowLength = rodLength * 0.6;
        const arrow = new THREE.ArrowHelper(ejectDir, arrowStart, arrowLength, color, avgModelDim * 0.08, avgModelDim * 0.04);
        _coreHelpers.add(arrow);
        
        // Label
        const label = createTextSprite(`변형 코어 #${index}`, color, avgModelDim * 0.12);
        label.position.copy(coreMesh.position).add(new THREE.Vector3(0, liftH + (avgModelDim * 0.1), 0));
        _coreHelpers.add(label);
      }
    }

    let sIdx = 1;
    for (const dir in slideClusters) {
      drawCoreMechanicalUnit(slideClusters[dir], 0x00d4ff, dir, true, sIdx++);
    }
    
    let lIdx = 1;
    for (const dir in lifterClusters) {
      drawCoreMechanicalUnit(lifterClusters[dir], 0xff8800, dir, false, lIdx++);
    }

    _mesh.add(_coreHelpers);
  }

  function createTextSprite(text, colorStr, scale = 15, drawBox = true) {
    const canvas = document.createElement('canvas');
    canvas.width = drawBox ? 256 : 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    if (drawBox) {
      // Background box
      ctx.fillStyle = 'rgba(15, 20, 30, 0.85)';
      ctx.beginPath();
      ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
      ctx.fill();
      ctx.strokeStyle = typeof colorStr === 'number' ? '#' + colorStr.toString(16).padStart(6, '0') : colorStr;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    // Text
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = drawBox ? '#ffffff' : (typeof colorStr === 'number' ? '#' + colorStr.toString(16).padStart(6, '0') : colorStr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(scale * (drawBox ? 4 : 1), scale, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  function createLabeledAxes(size = 20) {
    const group = new THREE.Group();

    const createAxisCylinder = (dir, color) => {
      const geom = new THREE.CylinderGeometry(0.5, 0.5, size, 8);
      geom.translate(0, size / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color: color });
      const mesh = new THREE.Mesh(geom, mat);
      
      const up = new THREE.Vector3(0, 1, 0);
      mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      return mesh;
    };

    const xDir = new THREE.Vector3(1, 0, 0);
    const yDir = new THREE.Vector3(0, 1, 0);
    const zDir = new THREE.Vector3(0, 0, 1);

    const xAxis = createAxisCylinder(xDir, 0xff3333);
    const yAxis = createAxisCylinder(yDir, 0x33ff33);
    const zAxis = createAxisCylinder(zDir, 0x3333ff);

    group.add(xAxis);
    group.add(yAxis);
    group.add(zAxis);

    const createArrowHead = (dir, color, pos) => {
      const geom = new THREE.ConeGeometry(1.2, 4, 8);
      geom.translate(0, 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color: color });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      const up = new THREE.Vector3(0, 1, 0);
      mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      return mesh;
    };

    group.add(createArrowHead(xDir, 0xff3333, new THREE.Vector3(size, 0, 0)));
    group.add(createArrowHead(yDir, 0x33ff33, new THREE.Vector3(0, size, 0)));
    group.add(createArrowHead(zDir, 0x3333ff, new THREE.Vector3(0, 0, size)));

    const xLabel = createTextSprite('X', '#ff3333', 5, false);
    xLabel.position.set(size + 4, 0, 0);
    const yLabel = createTextSprite('Y', '#33ff33', 5, false);
    yLabel.position.set(0, size + 4, 0);
    const zLabel = createTextSprite('Z', '#3333ff', 5, false);
    zLabel.position.set(0, 0, size + 4);

    group.add(xLabel);
    group.add(yLabel);
    group.add(zLabel);

    return group;
  }

  function updatePartingLine(visible, heightPct) {
    if (_partingLineObj) {
      _mesh.remove(_partingLineObj);
      _partingLineObj = null;
    }

    if (!visible || !_geometry || !_mesh) return;

    if (heightPct !== undefined) {
      _partingHeightPct = heightPct;
    }

    const pos = _geometry.attributes.position.array;
    const partingPoints = [];
    const partingDists = [];

    _geometry.computeBoundingBox();
    const geoBox = _geometry.boundingBox;
    const geoCenter = new THREE.Vector3();
    geoBox.getCenter(geoCenter);
    const geoSize = new THREE.Vector3();
    geoBox.getSize(geoSize);

    let minVal, maxVal;
    if (_pullAxis === 'X') {
      minVal = geoBox.min.x;
      maxVal = geoBox.max.x;
    } else if (_pullAxis === 'Y') {
      minVal = geoBox.min.y;
      maxVal = geoBox.max.y;
    } else {
      minVal = geoBox.min.z;
      maxVal = geoBox.max.z;
    }

    // Determine target plane height from the percentage
    const H = minVal + (maxVal - minVal) * (_partingHeightPct / 100);

    const getVal = (v) => {
      if (_pullAxis === 'X') return v.x;
      if (_pullAxis === 'Y') return v.y;
      return v.z;
    };

    // Calculate cross-section intersection contour of the plane H with all triangles
    for (let i = 0; i < pos.length; i += 9) {
      const v1 = new THREE.Vector3(pos[i],   pos[i+1], pos[i+2]);
      const v2 = new THREE.Vector3(pos[i+3], pos[i+4], pos[i+5]);
      const v3 = new THREE.Vector3(pos[i+6], pos[i+7], pos[i+8]);

      const val1 = getVal(v1);
      const val2 = getVal(v2);
      const val3 = getVal(v3);

      const pts = [];

      const intersectEdge = (pA, pB, valA, valB, idxA, idxB) => {
        if ((valA < H && valB > H) || (valA > H && valB < H)) {
          const t = (H - valA) / (valB - valA);
          const p = new THREE.Vector3().lerpVectors(pA, pB, t);
          
          let dVal = undefined;
          if (_flowDistances) {
            const distA = _flowDistances[idxA];
            const distB = _flowDistances[idxB];
            if (distA !== undefined && distB !== undefined) {
              dVal = distA + t * (distB - distA);
            }
          }
          pts.push({ p, dVal });
        } else if (valA === H) {
          let dVal = _flowDistances ? _flowDistances[idxA] : undefined;
          pts.push({ p: pA.clone(), dVal });
        }
      };

      intersectEdge(v1, v2, val1, val2, i/3, i/3 + 1);
      intersectEdge(v2, v3, val2, val3, i/3 + 1, i/3 + 2);
      intersectEdge(v3, v1, val3, val1, i/3 + 2, i/3);

      // Deduplicate points that are extremely close
      const uniquePts = [];
      pts.forEach(item => {
        if (!uniquePts.some(up => up.p.distanceTo(item.p) < 0.001)) {
          uniquePts.push(item);
        }
      });

      if (uniquePts.length >= 2) {
        partingPoints.push(uniquePts[0].p.x, uniquePts[0].p.y, uniquePts[0].p.z);
        partingPoints.push(uniquePts[1].p.x, uniquePts[1].p.y, uniquePts[1].p.z);
        partingDists.push(uniquePts[0].dVal, uniquePts[1].dVal);
      }
    }

    _partingLineObj = new THREE.Group();

    if (partingPoints.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(partingPoints), 3));
      
      // Calculate dynamic color for parting line segments if flow is playing
      const lineColors = new Float32Array(partingPoints.length);
      const targetDist = _maxFlowDistance * _flowAnimationTime;
      const frontWidth = _maxFlowDistance * 0.05;

      for (let j = 0; j < partingDists.length; j++) {
        const d = partingDists[j];
        let r = 0.0, g = 0.8, b = 0.8; // Default cyan

        if (_flowOverlayActive && d !== undefined) {
          if (d <= targetDist) {
            const age = targetDist - d;
            if (age < frontWidth) {
              // Glowing flow front (white-yellow)
              r = 1.0; g = 1.0; b = 0.9;
            } else if (age < frontWidth * 3) {
              // Hot orange-yellow
              r = 1.0; g = 0.7; b = 0.0;
            } else {
              // Cooled solid color matching main overlay color
              r = 0.05; g = 0.35; b = 0.55; 
            }
          } else {
            // Unfilled: very dark blue/black
            r = 0.03; g = 0.05; b = 0.12;
          }
        }
        lineColors[j*3] = r;
        lineColors[j*3+1] = g;
        lineColors[j*3+2] = b;
      }
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

      // Solid parting line with glow
      const lineMat1 = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 3, transparent: true, opacity: 0.95 });
      const lineMesh1 = new THREE.LineSegments(lineGeo.clone(), lineMat1);
      _partingLineObj.add(lineMesh1);
      
      // Glowing edge effect
      const lineMat2 = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 6, transparent: true, opacity: 0.35, depthWrite: false });
      const lineMesh2 = new THREE.LineSegments(lineGeo.clone(), lineMat2);
      _partingLineObj.add(lineMesh2);
    }

    // Render translucent Parting Surface Plane at height H
    const planeSize = Math.max(geoSize.x, geoSize.y, geoSize.z) * 1.3;
    const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
    const planeMat = new THREE.MeshPhongMaterial({ color: 0x00ffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    
    if (_pullAxis === 'X') {
      planeMesh.rotation.y = Math.PI / 2;
      planeMesh.position.set(H, geoCenter.y, geoCenter.z);
    } else if (_pullAxis === 'Y') {
      planeMesh.rotation.x = Math.PI / 2;
      planeMesh.position.set(geoCenter.x, H, geoCenter.z);
    } else {
      planeMesh.position.set(geoCenter.x, geoCenter.y, H);
    }
    _partingLineObj.add(planeMesh);
    
    // Label positioned outside the model for visibility
    const label = createTextSprite('파팅 라인', '#00ffff');
    const labelOffset = Math.max(geoSize.x, geoSize.y, geoSize.z) * 0.55;
    if (_pullAxis === 'X') {
      label.position.set(H, geoCenter.y + labelOffset, geoCenter.z);
    } else if (_pullAxis === 'Y') {
      label.position.set(geoCenter.x + labelOffset, H, geoCenter.z);
    } else {
      label.position.set(geoCenter.x, geoCenter.y + labelOffset, H);
    }
    _partingLineObj.add(label);

    _mesh.add(_partingLineObj);
  }

  /* ── Flow Simulation Helper Functions ── */

  function clearGate() {
    _gatePositions = [];
    _gateNormals   = [];
    _gateMarkers.forEach(m => { if (_mesh) _mesh.remove(m); else _scene.remove(m); });
    _gateMarkers = [];
    clearDefectMarkers();
    _flowDistances = null;
    _adjacencyGraph = null;
    _maxFlowDistance = 0;
    _flowOverlayActive = false;
    _flowAnimationTime = 0;
  }

  function clearDefectMarkers() {
    _defectMarkers.forEach(m => _scene.remove(m));
    _defectMarkers = [];
  }

  function setGateSettingMode(active) {
    _isGateSettingMode = active;
  }

  function isGateSettingMode() {
    return _isGateSettingMode;
  }

  function getGatePosition() {
    return _gatePositions.length > 0 ? _gatePositions[0] : null;
  }

  function getGatePositions() {
    return _gatePositions;
  }

  function onViewerClick(event) {
    if (!_isGateSettingMode || !_mesh || !_renderer || !_camera) return null;

    const rect = _renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, _camera);

    // 기존 게이트 마커를 클릭하면 해당 게이트 제거
    if (_gateMarkers.length > 0) {
      const markerHits = raycaster.intersectObjects(_gateMarkers, true);
      if (markerHits.length > 0) {
        let hit = markerHits[0].object;
        while (hit.parent && _gateMarkers.indexOf(hit) < 0) hit = hit.parent;
        const idx = _gateMarkers.indexOf(hit);
        if (idx >= 0) {
          removeGateAt(idx);
          return { action: 'remove_gate', gateCount: _gatePositions.length };
        }
      }
    }

    // 빈 모델 표면 클릭 → 게이트 추가
    const intersects = raycaster.intersectObject(_mesh);
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const localPoint = _mesh.worldToLocal(intersect.point.clone());
      const posAttr = _geometry.attributes.position;
      const face = intersect.face;
      const vA = new THREE.Vector3().fromBufferAttribute(posAttr, face.a);
      const vB = new THREE.Vector3().fromBufferAttribute(posAttr, face.b);
      const vC = new THREE.Vector3().fromBufferAttribute(posAttr, face.c);
      const faceNormal = new THREE.Vector3()
        .crossVectors(new THREE.Vector3().subVectors(vB, vA), new THREE.Vector3().subVectors(vC, vA))
        .normalize();
      return addGatePosition(intersect.point, localPoint, faceNormal);
    }
    return null;
  }

  function createGateMarker(localPoint, localNormal, index) {
    if (!localPoint || !_mesh || !_geometry) return null;

    _geometry.computeBoundingBox();
    const modelSize = new THREE.Vector3();
    _geometry.boundingBox.getSize(modelSize);
    const avgDim = (modelSize.x + modelSize.y + modelSize.z) / 3;
    const coneRadius = Math.max(0.6, avgDim * 0.012);
    const coneHeight = coneRadius * 3.0;

    const palette = [0xffaa00, 0x00ccff, 0xff44bb, 0x44ff88, 0xff6600, 0xbbff00];
    const color   = palette[index % palette.length];

    const geom = new THREE.ConeGeometry(coneRadius, coneHeight, 16);
    geom.translate(0, coneHeight / 2, 0);
    const mat = new THREE.MeshPhongMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.4), shininess: 100 });
    const marker = new THREE.Mesh(geom, mat);
    marker.position.copy(localPoint);

    if (localNormal) {
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localNormal.clone().normalize());
    }

    // Ring
    const ringGeom = new THREE.RingGeometry(0.1, coneRadius * 1.5, 32);
    ringGeom.rotateX(-Math.PI / 2);
    marker.add(new THREE.Mesh(ringGeom, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })));

    // Glow
    marker.add(new THREE.Mesh(
      new THREE.SphereGeometry(coneRadius * 0.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
    ));

    // 번호 라벨
    const label = createTextSprite(`G${index + 1}`, `#${color.toString(16).padStart(6,'0')}`, avgDim * 0.09, false);
    label.position.set(0, coneHeight * 1.6, 0);
    marker.add(label);

    _mesh.add(marker);
    return marker;
  }

  function buildAdjacencyGraph(positions, epsilon) {
    const graph = {};
    const getKey = (x, y, z) => {
      const cx = Math.floor(x / epsilon);
      const cy = Math.floor(y / epsilon);
      const cz = Math.floor(z / epsilon);
      return `${cx},${cy},${cz}`;
    };

    const getVertKey = (x, y, z) => `${Math.round(x*1000)/1000},${Math.round(y*1000)/1000},${Math.round(z*1000)/1000}`;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i+1], z = positions[i+2];
      const vk = getVertKey(x, y, z);
      if (!graph[vk]) {
        graph[vk] = { x, y, z, neighbors: new Set(), cell: getKey(x, y, z) };
      }
    }

    for (let i = 0; i < positions.length; i += 9) {
      const vk1 = getVertKey(positions[i],   positions[i+1], positions[i+2]);
      const vk2 = getVertKey(positions[i+3], positions[i+4], positions[i+5]);
      const vk3 = getVertKey(positions[i+6], positions[i+7], positions[i+8]);

      graph[vk1].neighbors.add(vk2);
      graph[vk1].neighbors.add(vk3);

      graph[vk2].neighbors.add(vk1);
      graph[vk2].neighbors.add(vk3);

      graph[vk3].neighbors.add(vk1);
      graph[vk3].neighbors.add(vk2);
    }

    // Spatial hash grid to bridge gaps/disconnected shells within epsilon
    const grid = {};
    for (const vk in graph) {
      const v = graph[vk];
      if (!grid[v.cell]) grid[v.cell] = [];
      grid[v.cell].push(vk);
    }

    for (const cellKey in grid) {
      const cellVerts = grid[cellKey];
      const parts = cellKey.split(',').map(Number);
      const cx = parts[0], cy = parts[1], cz = parts[2];

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const neighCellKey = `${cx+dx},${cy+dy},${cz+dz}`;
            const neighVerts = grid[neighCellKey];
            if (!neighVerts) continue;

            for (let a = 0; a < cellVerts.length; a++) {
              const vA = graph[cellVerts[a]];
              for (let b = 0; b < neighVerts.length; b++) {
                if (cellVerts[a] === neighVerts[b]) continue;
                const vB = graph[neighVerts[b]];
                const distSq = (vA.x - vB.x)*(vA.x - vB.x) + (vA.y - vB.y)*(vA.y - vB.y) + (vA.z - vB.z)*(vA.z - vB.z);
                if (distSq < epsilon * epsilon) {
                  vA.neighbors.add(neighVerts[b]);
                  vB.neighbors.add(cellVerts[a]);
                }
              }
            }
          }
        }
      }
    }

    return graph;
  }

  function findClosestGraphNode(localPoint, graph) {
    let closestKey = null;
    let minDist = Infinity;
    for (const key in graph) {
      const pt = graph[key];
      const dx = pt.x - localPoint.x;
      const dy = pt.y - localPoint.y;
      const dz = pt.z - localPoint.z;
      const d = dx*dx + dy*dy + dz*dz;
      if (d < minDist) {
        minDist = d;
        closestKey = key;
      }
    }
    return closestKey;
  }

  class MinHeap {
    constructor(compare) {
      this.data = [];
      this.compare = compare;
    }
    push(val) {
      this.data.push(val);
      this.up(this.data.length - 1);
    }
    pop() {
      if (this.data.length === 0) return null;
      const top = this.data[0];
      const bottom = this.data.pop();
      if (this.data.length > 0) {
        this.data[0] = bottom;
        this.down(0);
      }
      return top;
    }
    up(i) {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.compare(this.data[i], this.data[p]) < 0) {
          const t = this.data[i]; this.data[i] = this.data[p]; this.data[p] = t;
          i = p;
        } else {
          break;
        }
      }
    }
    down(i) {
      const len = this.data.length;
      while ((i << 1) + 1 < len) {
        let left = (i << 1) + 1;
        let right = left + 1;
        let best = left;
        if (right < len && this.compare(this.data[right], this.data[left]) < 0) {
          best = right;
        }
        if (this.compare(this.data[best], this.data[i]) < 0) {
          const t = this.data[i]; this.data[i] = this.data[best]; this.data[best] = t;
          i = best;
        } else {
          break;
        }
      }
    }
  }

  // startKeys: 단일 키 또는 키 배열 (멀티 소스 다익스트라)
  function calculateFlowDistances(startKeys, graph) {
    const distances = {};
    for (const key in graph) {
      distances[key] = Infinity;
    }

    const heap = new MinHeap((a, b) => distances[a] - distances[b]);
    const visited = new Set();

    const keys = Array.isArray(startKeys) ? startKeys : [startKeys];
    for (const k of keys) {
      if (k && k in distances) {
        distances[k] = 0;
        heap.push(k);
      }
    }
    
    while (heap.data.length > 0) {
      const currKey = heap.pop();
      if (visited.has(currKey)) continue;
      visited.add(currKey);
      
      const currDist = distances[currKey];
      const node = graph[currKey];
      
      node.neighbors.forEach(neighKey => {
        const neighNode = graph[neighKey];
        const dx = neighNode.x - node.x;
        const dy = neighNode.y - node.y;
        const dz = neighNode.z - node.z;
        const edgeLength = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const newDist = currDist + edgeLength;
        
        if (neighKey in distances && newDist < distances[neighKey]) {
          distances[neighKey] = newDist;
          heap.push(neighKey);
        }
      });
    }
    return distances;
  }

  function predictDefects() {
    if (!_geometry || !_flowDistances || _gatePositions.length === 0) return [];
    const positions = _geometry.attributes.position.array;
    const defects = [];

    // 가장 멀리 충진되는 정점들 = 에어 트랩 후보
    const sortedVerts = [];
    for (let i = 0; i < positions.length; i += 9) {
      const d = _flowDistances[i/3];
      if (d !== Infinity && d < 999999) {
        sortedVerts.push({ pos: new THREE.Vector3(positions[i], positions[i+1], positions[i+2]), dist: d });
      }
    }
    sortedVerts.sort((a, b) => b.dist - a.dist);

    const furthest = [];
    for (const v of sortedVerts) {
      if (furthest.every(f => v.pos.distanceTo(f.pos) >= 25)) {
        furthest.push(v);
        if (furthest.length >= 2) break;
      }
    }
    furthest.forEach(f => defects.push({ type: 'air_trap', pos: f.pos, dist: f.dist }));

    // 웰드라인: 모든 게이트의 중심과 에어 트랩 중간 지점
    if (furthest.length > 0) {
      const gateCenter = new THREE.Vector3();
      _gatePositions.forEach(p => gateCenter.add(p));
      gateCenter.divideScalar(_gatePositions.length);

      const midPoint = new THREE.Vector3().addVectors(gateCenter, furthest[0].pos).multiplyScalar(0.5);
      let bestWeldVert = null, minDiff = Infinity;
      for (let i = 0; i < positions.length; i += 9) {
        const vPos = new THREE.Vector3(positions[i], positions[i+1], positions[i+2]);
        const distToMid = vPos.distanceTo(midPoint);
        if (distToMid < minDiff && distToMid > 4) { minDiff = distToMid; bestWeldVert = vPos; }
      }
      if (bestWeldVert) defects.push({ type: 'weld_line', pos: bestWeldVert });
    }

    return defects;
  }

  function createDefectMarkers(defects) {
    clearDefectMarkers();
    if (!_mesh) return;
    
    defects.forEach(def => {
      if (def.type === 'air_trap') {
        const geom = new THREE.SphereGeometry(2.2, 16, 16);
        const mat = new THREE.MeshPhongMaterial({ color: 0xff00ff, emissive: 0x550055 });
        const m = new THREE.Mesh(geom, mat);
        const worldPos = def.pos.clone();
        _mesh.localToWorld(worldPos);
        m.position.copy(worldPos);
        
        const label = createTextSprite('에어 트랩', '#ff00ff', 5);
        label.position.set(0, 6, 0);
        m.add(label);
        
        _scene.add(m);
        _defectMarkers.push(m);
      } else if (def.type === 'weld_line') {
        const geom = new THREE.SphereGeometry(2.0, 16, 16);
        const mat = new THREE.MeshPhongMaterial({ color: 0xffff00, emissive: 0x555500 });
        const m = new THREE.Mesh(geom, mat);
        const worldPos = def.pos.clone();
        _mesh.localToWorld(worldPos);
        m.position.copy(worldPos);
        
        const label = createTextSprite('웰드 라인', '#ffff00', 4);
        label.position.set(0, 6, 0);
        m.add(label);
        
        _scene.add(m);
        _defectMarkers.push(m);
      }
    });
  }

  function computeFlowColors(positions, distances, maxDist, animPct) {
    const colors = new Float32Array(positions.length);
    const targetDist = maxDist * animPct;
    
    // Scale flow limit relative to the model's bounding box diagonal
    let baseLimit = _material === 'PP' ? 180 : _material === 'ABS' ? 120 : _material === 'POM' ? 140 : 90;
    if (_geometry) {
      _geometry.computeBoundingBox();
      const s = new THREE.Vector3();
      _geometry.boundingBox.getSize(s);
      const diag = s.length();
      const scaleFactor = Math.max(0.3, diag / 100);
      baseLimit = baseLimit * scaleFactor;
    }
    const flowLimit = baseLimit;
    
    // Dynamic flowing wave/ripple from the gate
    const waveFreq = 0.3; // Spatial frequency of wave
    const waveSpeed = 35; // Speed of propagation
    
    // Base solid colors for materials when cooled
    let coolR = 0.12, coolG = 0.15, coolB = 0.2;
    if (_material === 'ABS') { coolR = 0.15; coolG = 0.17; coolB = 0.22; }
    else if (_material === 'PC') { coolR = 0.1; coolG = 0.38; coolB = 0.48; }
    else if (_material === 'PP') { coolR = 0.28; coolG = 0.26; coolB = 0.24; }
    else if (_material === 'POM') { coolR = 0.12; coolG = 0.14; coolB = 0.25; }

    const frontWidth = maxDist * 0.05; // Advancing flow front thickness

    for (let i = 0; i < positions.length; i += 3) {
      const d = distances[i/3];
      let r = 0.05, g = 0.08, b = 0.2; // Default background unfilled color
      
      if (d !== undefined && d !== Infinity && d <= targetDist) {
        const age = targetDist - d; // how long it has been filled
        const waveFactor = Math.sin(d * waveFreq - animPct * waveSpeed) * 0.08 + 0.92;

        if (age < frontWidth) {
          // Flow front: extremely hot glowing white-yellow
          const t = age / frontWidth;
          r = 1.0;
          g = 0.95 + t * 0.05;
          b = 0.6 + t * 0.3;
        } else if (age < frontWidth * 3) {
          // Melted zone (hot plastic): bright yellow to orange
          const t = (age - frontWidth) / (frontWidth * 2);
          r = 1.0;
          g = 0.95 - t * 0.5; // yellow to orange
          b = 0.3 - t * 0.3;
        } else if (age < frontWidth * 6) {
          // Warm flow: orange to deep red-purple
          const t = (age - frontWidth * 3) / (frontWidth * 3);
          r = 1.0 - t * 0.6;
          g = 0.45 - t * 0.4;
          b = 0.0 + t * 0.2;
        } else {
          // Cooled solid plastic with dynamic flowing waves
          const t = Math.min(1.0, (age - frontWidth * 6) / (maxDist * 0.3));
          // Fade from deep red-purple to the cool solid material color
          r = (0.4 * (1 - t) + coolR * t) * waveFactor;
          g = (0.05 * (1 - t) + coolG * t) * waveFactor;
          b = (0.2 * (1 - t) + coolB * t) * waveFactor;
        }
      } else {
        // Unfilled region — mark short-shot risk if beyond material flow limit
        if (maxDist > flowLimit && d !== undefined && d !== Infinity && d > flowLimit) {
          r = 0.55; g = 0.02; b = 0.25; // short shot risk — dark magenta
        }
      }
      
      colors[i] = r; colors[i+1] = g; colors[i+2] = b;
    }
    return colors;
  }

  /* 내부: 모든 게이트를 기준으로 유동 거리 재계산 */
  function _doFlowCalculation() {
    if (!_mesh || !_geometry || _gatePositions.length === 0) return null;

    const positions = _geometry.attributes.position.array;
    _geometry.computeBoundingBox();
    const modelSize = new THREE.Vector3();
    _geometry.boundingBox.getSize(modelSize);
    const diag = modelSize.length();
    const epsilon = Math.max(0.05, diag * 0.001);

    const graph = buildAdjacencyGraph(positions, epsilon);
    _adjacencyGraph = graph;

    const getVertKey = (x, y, z) => `${Math.round(x*1000)/1000},${Math.round(y*1000)/1000},${Math.round(z*1000)/1000}`;

    // 멀티 소스: 모든 게이트의 시작 키
    const startKeys = _gatePositions
      .map(gp => findClosestGraphNode(gp, graph))
      .filter(k => k !== null);

    const distances = startKeys.length > 0 ? calculateFlowDistances(startKeys, graph) : {};

    const vertexCount = positions.length / 3;
    _flowDistances = new Float32Array(vertexCount);
    let maxDist = 0;

    for (let i = 0; i < positions.length; i += 3) {
      const k = getVertKey(positions[i], positions[i+1], positions[i+2]);
      let d = distances[k];
      if (d === undefined || d === Infinity) d = Infinity;
      _flowDistances[i/3] = d;
      if (d !== Infinity && d > maxDist) maxDist = d;
    }
    _maxFlowDistance = maxDist;

    const defects = predictDefects();
    createDefectMarkers(defects);
    _flowAnimationTime = 0;
    recolorGeometry();

    return { maxFlowDistance: _maxFlowDistance, defects };
  }

  /* 게이트 추가 */
  function addGatePosition(worldPoint, localPoint, localNormal) {
    if (!_mesh) return null;
    if (!localPoint) localPoint = _mesh.worldToLocal(worldPoint.clone());
    if (!worldPoint)  worldPoint  = _mesh.localToWorld(localPoint.clone());

    _gatePositions.push(localPoint.clone());
    _gateNormals.push(localNormal ? localNormal.clone() : null);
    const idx = _gatePositions.length - 1;
    _gateMarkers.push(createGateMarker(localPoint, localNormal, idx));

    const res = _doFlowCalculation();
    if (!res) return null;

    return {
      action: 'add_gate',
      gateIndex: idx,
      gateCount: _gatePositions.length,
      worldCoords: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
      maxFlowDistance: res.maxFlowDistance,
      defects: res.defects
    };
  }

  /* 특정 인덱스 게이트 제거 */
  function removeGateAt(index) {
    if (index < 0 || index >= _gatePositions.length) return;

    // 마커 전부 제거 후 재생성 (번호 재정렬)
    _gateMarkers.forEach(m => { if (_mesh) _mesh.remove(m); });
    _gateMarkers = [];
    _gatePositions.splice(index, 1);
    _gateNormals.splice(index, 1);

    if (_gatePositions.length === 0) {
      clearGate();
    } else {
      _gatePositions.forEach((pos, i) => {
        _gateMarkers.push(createGateMarker(pos, _gateNormals[i], i));
      });
      _doFlowCalculation();
    }
  }

  /* 파팅라인 변경 등 외부에서 유동 재계산 요청 */
  function recalculateFlow() {
    if (_gatePositions.length === 0) return null;
    const res = _doFlowCalculation();
    if (!res) return null;
    const wp = _mesh ? _mesh.localToWorld(_gatePositions[0].clone()) : new THREE.Vector3();
    return {
      worldCoords: { x: wp.x, y: wp.y, z: wp.z },
      maxFlowDistance: res.maxFlowDistance,
      defects: res.defects,
      gateCount: _gatePositions.length
    };
  }

  function toggleFlowOverlay(active) {
    _flowOverlayActive = active;
    recolorGeometry();
  }

  function setFlowAnimationTime(pct) {
    _flowAnimationTime = pct;
    recolorGeometry();
  }

  function highlightCore(type, index) {
    if (!_coreHelpers) return;
    const targetPrefix = `${type}_${index}_`;
    _coreHelpers.traverse(child => {
      if (child.isMesh && child.name) {
        if (child.name.startsWith(targetPrefix)) {
          if (child.material) {
            child.material.opacity = 1.0;
            if (child.material.emissive) {
              child.material.emissive.setHex(0x666666);
            }
          }
        } else {
          if (child.material) {
            child.material.opacity = 0.15;
            if (child.material.emissive) {
              child.material.emissive.setHex(0x000000);
            }
          }
        }
      }
    });
  }

  function resetCoreHighlights() {
    if (!_coreHelpers) return;
    _coreHelpers.traverse(child => {
      if (child.isMesh && child.name) {
        if (child.material) {
          if (child.name.includes('_head')) {
            child.material.opacity = 0.5;
          } else {
            child.material.opacity = 0.85;
          }
          if (child.material.emissive) {
            child.material.emissive.setHex(0x000000);
          }
        }
      }
    });
  }

  /* ──────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────── */
  return { parseSTL, parseSTP, initViewer, loadGeometry, analyze, toggleOverlay, setWireframe, resetCamera, setPullAxis, setFlipAxis, recolorGeometry, updateCoreHelpers, updatePartingLine, setGateSettingMode, isGateSettingMode, onViewerClick, getGatePosition, getGatePositions, addGatePosition, removeGateAt, recalculateFlow, toggleFlowOverlay, setFlowAnimationTime, clearGate, highlightCore, resetCoreHighlights };

})();
