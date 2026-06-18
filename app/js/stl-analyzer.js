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
  let _cameraTargetPos = null;
  let _pullArrow = null;

  // Flow simulation and gate settings
  let _gatePositions = [];   // array of local-space Vector3
  let _gateNormals  = [];    // parallel array of face normals
  let _gateMarkers  = [];    // parallel array of THREE.Mesh markers
  let _defectMarkers = [];
  let _lastDefects = [];
  let _flowOverlayActive = false;
  let _shrinkageOverlayActive = false;
  let _sinkOverlayActive = false;
  let _warpOverlayActive = false;
  let _warpArrow = null;

  let _flowDistances = null;
  let _vertexTemperatures = null;
  let _vertexDisplacements = null;
  let _vertexSinkRisk = null;
  let _cycleTime = 0.0;
  let _hotSpots = [];
  let _coolingOverlayActive = false;
  let _vertexThickness = null;
  let _maxFlowDistance = 0;
  let _isGateSettingMode = false;
  let _draggedGateIndex = -1;
  let _draggedGateOrigPos = null;
  let _gateVelocityRatios = [];
  let _gatePressureRatios = [];
  let _onGateRepositionedCallback = null;
  let _onRightClickModelCallback = null;
  let _flowAnimationTime = 0.0;
  let _adjacencyGraph = null;

  // Undercut detection cache
  let _undercutCache = null;

  let _meltTemp = 230;
  let _moldTemp = 50;
  let _flowRate = 50;
  let _runnerType = 'cold';
  let _pressureLimit = 100;

  const MATERIAL_DB = {
    ABS: { shrink: 0.005, linearShrinkage: 0.005, volumetricShrinkage: 0.015, flowShrinkage: 0.005, crossFlowShrinkage: 0.006, minDraft: 1.0, ribRatio: 0.6, name: 'ABS', alpha: 0.08, Tm: 230, Tw: 50, Te: 90, TmMin: 200, TmMax: 280, TwMin: 40, TwMax: 90 },
    PC:  { shrink: 0.006, linearShrinkage: 0.006, volumetricShrinkage: 0.018, flowShrinkage: 0.006, crossFlowShrinkage: 0.007, minDraft: 1.5, ribRatio: 0.55, name: 'PC', alpha: 0.12, Tm: 290, Tw: 80, Te: 130, TmMin: 280, TmMax: 320, TwMin: 70, TwMax: 120 },
    'PC+ABS': { shrink: 0.0055, linearShrinkage: 0.0055, volumetricShrinkage: 0.016, flowShrinkage: 0.0055, crossFlowShrinkage: 0.0062, minDraft: 1.2, ribRatio: 0.55, name: 'PC+ABS', alpha: 0.10, Tm: 260, Tw: 65, Te: 110, TmMin: 240, TmMax: 290, TwMin: 50, TwMax: 90 },
    PP:  { shrink: 0.015, linearShrinkage: 0.015, volumetricShrinkage: 0.045, flowShrinkage: 0.015, crossFlowShrinkage: 0.017, minDraft: 2.0, ribRatio: 0.5,  name: 'PP', alpha: 0.07, Tm: 220, Tw: 40, Te: 80, TmMin: 200, TmMax: 260, TwMin: 20, TwMax: 80 },
    PBT: { shrink: 0.018, linearShrinkage: 0.018, volumetricShrinkage: 0.054, flowShrinkage: 0.018, crossFlowShrinkage: 0.020, minDraft: 1.5, ribRatio: 0.5,  name: 'PBT', alpha: 0.08, Tm: 250, Tw: 60, Te: 110, TmMin: 230, TmMax: 270, TwMin: 40, TwMax: 90 },
    'PBT GF30': { shrink: 0.004, linearShrinkage: 0.004, volumetricShrinkage: 0.012, flowShrinkage: 0.003, crossFlowShrinkage: 0.006, minDraft: 1.0, ribRatio: 0.45, name: 'PBT GF30', alpha: 0.09, Tm: 260, Tw: 80, Te: 120, TmMin: 240, TmMax: 280, TwMin: 60, TwMax: 100 },
    PA6: { shrink: 0.013, linearShrinkage: 0.013, volumetricShrinkage: 0.039, flowShrinkage: 0.013, crossFlowShrinkage: 0.015, minDraft: 1.5, ribRatio: 0.5,  name: 'PA6', alpha: 0.07, Tm: 240, Tw: 80, Te: 110, TmMin: 220, TmMax: 280, TwMin: 50, TwMax: 100 },
    PA66: { shrink: 0.015, linearShrinkage: 0.015, volumetricShrinkage: 0.045, flowShrinkage: 0.015, crossFlowShrinkage: 0.018, minDraft: 1.5, ribRatio: 0.5,  name: 'PA66', alpha: 0.07, Tm: 280, Tw: 80, Te: 120, TmMin: 260, TmMax: 300, TwMin: 60, TwMax: 110 },
    'PA66 GF30': { shrink: 0.005, linearShrinkage: 0.005, volumetricShrinkage: 0.015, flowShrinkage: 0.004, crossFlowShrinkage: 0.008, minDraft: 1.0, ribRatio: 0.45, name: 'PA66 GF30', alpha: 0.08, Tm: 290, Tw: 90, Te: 130, TmMin: 270, TmMax: 310, TwMin: 70, TwMax: 120 },
    'PA66 GF50': { shrink: 0.003, linearShrinkage: 0.003, volumetricShrinkage: 0.009, flowShrinkage: 0.002, crossFlowShrinkage: 0.005, minDraft: 0.8, ribRatio: 0.4, name: 'PA66 GF50', alpha: 0.09, Tm: 300, Tw: 100, Te: 140, TmMin: 280, TmMax: 320, TwMin: 80, TwMax: 130 },
    LCP: { shrink: 0.001, linearShrinkage: 0.001, volumetricShrinkage: 0.003, flowShrinkage: 0.001, crossFlowShrinkage: 0.004, minDraft: 0.5, ribRatio: 0.4,  name: 'LCP', alpha: 0.11, Tm: 340, Tw: 110, Te: 160, TmMin: 320, TmMax: 360, TwMin: 80, TwMax: 150 },
    POM: { shrink: 0.020, linearShrinkage: 0.020, volumetricShrinkage: 0.060, flowShrinkage: 0.020, crossFlowShrinkage: 0.022, minDraft: 0.5, ribRatio: 0.5,  name: 'POM', alpha: 0.09, Tm: 200, Tw: 70, Te: 100, TmMin: 190, TmMax: 230, TwMin: 60, TwMax: 120 },
    PMMA: { shrink: 0.005, linearShrinkage: 0.005, volumetricShrinkage: 0.015, flowShrinkage: 0.005, crossFlowShrinkage: 0.006, minDraft: 1.5, ribRatio: 0.55, name: 'PMMA', alpha: 0.08, Tm: 220, Tw: 60, Te: 90, TmMin: 200, TmMax: 250, TwMin: 40, TwMax: 80 },
    FORTRON: { shrink: 0.005, linearShrinkage: 0.005, volumetricShrinkage: 0.015, flowShrinkage: 0.005, crossFlowShrinkage: 0.006, minDraft: 1.5, ribRatio: 0.5, name: 'FORTRON', alpha: 0.10, Tm: 310, Tw: 130, Te: 150, TmMin: 300, TmMax: 340, TwMin: 120, TwMax: 160 },
    TPU: { shrink: 0.012, linearShrinkage: 0.012, volumetricShrinkage: 0.036, flowShrinkage: 0.012, crossFlowShrinkage: 0.014, minDraft: 2.0, ribRatio: 0.6,  name: 'TPU', alpha: 0.05, Tm: 210, Tw: 30, Te: 60, TmMin: 190, TmMax: 230, TwMin: 15, TwMax: 50 },
    TPE: { shrink: 0.014, linearShrinkage: 0.014, volumetricShrinkage: 0.042, flowShrinkage: 0.014, crossFlowShrinkage: 0.016, minDraft: 2.0, ribRatio: 0.6,  name: 'TPE', alpha: 0.06, Tm: 200, Tw: 30, Te: 60, TmMin: 180, TmMax: 220, TwMin: 15, TwMax: 50 },
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
    // SharedArrayBuffer 하드 차단 제거: occt-import-js는 단일 스레드(WASM)로도 동작한다.
    // (Electron/로컬 서버 환경에서 COOP/COEP가 없어도 STEP 파싱이 가능하도록 허용)
    try {
      await loadScript('libs/occt-import-js.js');
    } catch (e) {
      throw new Error('WASM 라이브러리(occt-import-js) 로드 실패: ' + e.message);
    }

    let occt;
    try {
      occt = await window.occtimportjs({
        locateFile: (name) => 'libs/' + name
      });
    } catch (e) {
      throw new Error('WASM 엔진 초기화 실패: ' + e.message);
    }

    const uint8Array = new Uint8Array(buffer);
    let result;
    try {
      result = occt.ReadStepFile(uint8Array, null);
    } catch (e) {
      throw new Error('STEP 파일 파싱 중 오류: ' + e.message);
    }

    if (!result || !result.success) {
      throw new Error('STEP 파일을 파싱할 수 없습니다. AP214/AP242 형식인지 확인해 주세요.');
    }
    if (!result.meshes || result.meshes.length === 0) {
      throw new Error('STEP 파일에서 유효한 3D 메쉬를 찾을 수 없습니다. 파일이 비어있거나 2D 도면일 수 있습니다.');
    }

    const positions = [];
    const normals = [];

    result.meshes.forEach(meshData => {
      // 일부 STP 파트는 position 데이터 없이 반환될 수 있음 (어노테이션, 축 등)
      if (!meshData || !meshData.attributes || !meshData.attributes.position) return;
      const posArr = meshData.attributes.position.array;
      if (!posArr || posArr.length === 0) return;

      const normArr = (meshData.attributes.normal && meshData.attributes.normal.array)
        ? meshData.attributes.normal.array : null;
      const indexArr = (meshData.index && meshData.index.array)
        ? meshData.index.array : null;

      if (indexArr) {
        for (let i = 0; i < indexArr.length; i++) {
          const idx = indexArr[i];
          if (idx * 3 + 2 >= posArr.length) continue; // 범위 초과 방지
          positions.push(posArr[idx * 3], posArr[idx * 3 + 1], posArr[idx * 3 + 2]);
          if (normArr && idx * 3 + 2 < normArr.length) {
            normals.push(normArr[idx * 3], normArr[idx * 3 + 1], normArr[idx * 3 + 2]);
          } else {
            normals.push(0, 0, 0);
          }
        }
      } else {
        for (let i = 0; i + 2 < posArr.length; i += 3) {
          positions.push(posArr[i], posArr[i + 1], posArr[i + 2]);
          if (normArr && i + 2 < normArr.length) {
            normals.push(normArr[i], normArr[i + 1], normArr[i + 2]);
          } else {
            normals.push(0, 0, 0);
          }
        }
      }
    });

    if (positions.length === 0) {
      throw new Error('STEP 파일에서 정점 데이터를 추출하지 못했습니다. 파일 형식이 지원되지 않거나 모델이 비어있습니다.');
    }

    const flatPositions = new Float32Array(positions);
    let flatNormals = new Float32Array(normals);

    const tempGeo = new THREE.BufferGeometry();
    tempGeo.setAttribute('position', new THREE.BufferAttribute(flatPositions, 3));
    if (normals.some(n => n !== 0)) {
      tempGeo.setAttribute('normal', new THREE.BufferAttribute(flatNormals, 3));
    } else {
      tempGeo.computeVertexNormals();
      flatNormals = tempGeo.attributes.normal ? tempGeo.attributes.normal.array : new Float32Array(flatPositions.length);
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
    if (buffer.byteLength < 84) {
      throw new Error("STL 파일의 크기가 너무 작습니다. (헤더 84바이트 미만)");
    }
    const view = new DataView(buffer);
    const triCount = view.getUint32(80, true);
    const positions = [], normals = [];
    let offset = 84;
    
    // 안전한 루프 처리를 위해 버퍼 크기 한도 체크
    const actualCount = Math.min(triCount, Math.floor((buffer.byteLength - 84) / 50));
    if (actualCount <= 0) {
      throw new Error("유효한 3D 기하 데이터를 읽을 수 없습니다. 파일이 손상되었습니다.");
    }

    for (let i = 0; i < actualCount; i++) {
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
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), triCount: actualCount };
  }

  function parseASCII(text) {
    const positions = [], normals = [];
    const facetRe  = /facet normal\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
    const vertexRe = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g;
    let fm, vm;
    while ((fm = facetRe.exec(text)) !== null) {
      const nx = parseFloat(fm[1]), ny = parseFloat(fm[2]), nz = parseFloat(fm[3]);
      let validFacet = true;
      const tempPts = [];
      for (let v = 0; v < 3; v++) {
        vm = vertexRe.exec(text);
        if (!vm) {
          validFacet = false;
          break;
        }
        tempPts.push(parseFloat(vm[1]), parseFloat(vm[2]), parseFloat(vm[3]));
      }
      if (validFacet) {
        for (let _p=0;_p<tempPts.length;_p++) positions.push(tempPts[_p]);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      } else {
        break;
      }
    }
    const triCount = positions.length / 9;
    if (triCount <= 0) {
      throw new Error("ASCII STL 파싱 실패: 유효한 삼각형 단면을 찾을 수 없습니다.");
    }
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), triCount };
  }

  /* ──────────────────────────────────────
     2. THREE.JS VIEWER INIT
  ────────────────────────────────────── */
  function initViewer() {
    const container = document.getElementById(CONTAINER_ID);
    const W = container.clientWidth, H = container.clientHeight;

    _scene = new THREE.Scene();
    // Glassmorphism theme: Use transparent background to blend with CSS
    _scene.fog = new THREE.FogExp2(0x080c18, 0.0015);

    _camera = new THREE.PerspectiveCamera(45, W/H, 0.01, 10000);
    _camera.position.set(0, 0, 200);

    _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    _renderer.setClearColor(0x000000, 0); // Make background transparent
    _renderer.setPixelRatio(window.devicePixelRatio);
    _renderer.setSize(W, H);
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(_renderer.domElement);

    // Lights - Premium Dark Theme Setup
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    _scene.add(ambient);
    
    const dir1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dir1.position.set(100, 200, 300);
    dir1.castShadow = true;
    dir1.shadow.mapSize.width = 2048;
    dir1.shadow.mapSize.height = 2048;
    dir1.shadow.bias = -0.0001;
    _scene.add(dir1);
    
    const dir2 = new THREE.DirectionalLight(0x00d4ff, 0.8);
    dir2.position.set(-200, -100, -100);
    _scene.add(dir2);
    
    // Rim light for depth
    const rim = new THREE.PointLight(0x00ffa3, 0.5, 5000);
    rim.position.set(-200, 200, -200);
    _scene.add(rim);

    // Grid - Cyberpunk/Dark mode grid
    const grid = new THREE.GridHelper(500, 50, 0x00d4ff, 0x1a233a);
    grid.material.opacity = 0.4;
    grid.material.transparent = true;
    _scene.add(grid);

    // Controls
    _controls = new THREE.OrbitControls(_camera, _renderer.domElement);
    _controls.enableDamping = true;
    _controls.dampingFactor = 0.08;
    _controls.minDistance = 1;
    _controls.maxDistance = 5000;

    // Gimbal interaction
    let startX = 0, startY = 0;
    _renderer.domElement.addEventListener('mousedown', (event) => {
      startX = event.clientX;
      startY = event.clientY;
    });
    _renderer.domElement.addEventListener('click', (event) => {
      if (!_gimbalWidget) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.sqrt(dx * dx + dy * dy) >= 15) return; // Dragged

      const rect = _renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, _camera);
      const hits = raycaster.intersectObjects(_gimbalWidget.children, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && (!obj.name || !obj.name.startsWith('gimbal_'))) {
          obj = obj.parent;
        }
        if (obj && obj.name) {
          const axis = obj.name.split('_')[1];
          const btn = document.querySelector(`.axis-btn[data-axis="${axis}"]`);
          if (btn) {
            btn.click();
          }
        }
      }
    });

    // Left-click Gate Repositioning & Right-click menu
    let dragStartX = 0, dragStartY = 0;
    let rightClickStartX = 0, rightClickStartY = 0;

    _renderer.domElement.addEventListener('pointerdown', (event) => {
      if (event.button === 0) { // Left click
        dragStartX = event.clientX;
        dragStartY = event.clientY;

        if (!_mesh || !_camera) return;
        const rect = _renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, _camera);

        // If we are already moving/dragging a gate, clicking again places it on the geometry
        if (_draggedGateIndex !== -1) {
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

            _gatePositions[_draggedGateIndex].copy(localPoint);
            _gateNormals[_draggedGateIndex] = faceNormal.clone();

            const marker = _gateMarkers[_draggedGateIndex];
            marker.position.copy(localPoint);
            marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), faceNormal.clone().negate().normalize());
          }
          _controls.enabled = true;
          const flowRes = recalculateFlow();
          if (_onGateRepositionedCallback) {
            _onGateRepositionedCallback(flowRes);
          }
          _draggedGateIndex = -1;
          event.stopPropagation();
          return;
        }

        // Try to pick up a gate marker
        if (_gateMarkers.length > 0) {
          const markerHits = raycaster.intersectObjects(_gateMarkers, true);
          if (markerHits.length > 0) {
            let hit = markerHits[0].object;
            while (hit.parent && _gateMarkers.indexOf(hit) < 0) hit = hit.parent;
            const idx = _gateMarkers.indexOf(hit);
            if (idx >= 0) {
              _draggedGateIndex = idx;
              _draggedGateOrigPos = _gatePositions[idx].clone();
              _controls.enabled = false; // Stop camera rotation
            }
          }
        }
      } else if (event.button === 2) { // Right click
        rightClickStartX = event.clientX;
        rightClickStartY = event.clientY;
      }
    });

    _renderer.domElement.addEventListener('pointermove', (event) => {
      if (_draggedGateIndex !== -1 && _mesh && _camera) {
        const rect = _renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, _camera);

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

          _gatePositions[_draggedGateIndex].copy(localPoint);
          _gateNormals[_draggedGateIndex] = faceNormal.clone();

          const marker = _gateMarkers[_draggedGateIndex];
          marker.position.copy(localPoint);
          marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), faceNormal.clone().negate().normalize());
        }
      }
    });

    const onPointerUp = (event) => {
      if (_draggedGateIndex !== -1) {
        const dx = event.clientX - dragStartX;
        const dy = event.clientY - dragStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        _controls.enabled = true;

        if (dist > 5) {
          // Real drag: gate moved to new position, recalculate flow
          const flowRes = recalculateFlow();
          if (_onGateRepositionedCallback) {
            _onGateRepositionedCallback(flowRes);
          }
        } else {
          // Simple click: restore gate to original position before pickup
          const marker = _gateMarkers[_draggedGateIndex];
          const origNorm = _gateNormals[_draggedGateIndex];
          if (marker && _draggedGateOrigPos) {
            _gatePositions[_draggedGateIndex].copy(_draggedGateOrigPos);
            marker.position.copy(_draggedGateOrigPos);
            if (origNorm) {
              marker.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                origNorm.clone().negate().normalize()
              );
            }
          }
        }
        _draggedGateIndex = -1;
        _draggedGateOrigPos = null;
      }
    };
    _renderer.domElement.addEventListener('pointerup', onPointerUp);
    _renderer.domElement.addEventListener('pointercancel', onPointerUp);

    _renderer.domElement.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      
      const dx = event.clientX - rightClickStartX;
      const dy = event.clientY - rightClickStartY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 10 && _mesh && _camera) {
        const rect = _renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, _camera);

        if (_gateMarkers.length > 0) {
          const markerHits = raycaster.intersectObjects(_gateMarkers, true);
          if (markerHits.length > 0) {
            let hit = markerHits[0].object;
            while (hit.parent && _gateMarkers.indexOf(hit) < 0) hit = hit.parent;
            const idx = _gateMarkers.indexOf(hit);
            if (idx >= 0) {
              if (_onRightClickModelCallback) {
                _onRightClickModelCallback({
                  action: 'delete_gate',
                  gateIndex: idx,
                  clientX: event.clientX,
                  clientY: event.clientY
                });
              }
              return;
            }
          }
        }

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

          if (_onRightClickModelCallback) {
            _onRightClickModelCallback({
              action: 'add_gate',
              clientX: event.clientX,
              clientY: event.clientY,
              worldPoint: intersect.point,
              localPoint: localPoint,
              faceNormal: faceNormal
            });
          }
        }
      }
    });

    // Resize
    window.addEventListener('resize', () => {
      const W2 = container.clientWidth, H2 = container.clientHeight;
      _camera.aspect = W2/H2; _camera.updateProjectionMatrix();
      _renderer.setSize(W2, H2);
    });

    animate();
  }

  function resizeViewer() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container || !_renderer || !_camera) return;
    const W2 = container.clientWidth, H2 = container.clientHeight;
    _camera.aspect = W2/H2; _camera.updateProjectionMatrix();
    _renderer.setSize(W2, H2);
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
      if (_gimbalWidget) {
        _gimbalWidget.quaternion.copy(_mesh.quaternion);
      }
      updatePullArrow();
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
    _undercutCache = null; // Clear cache on new model load

    _geometry = new THREE.BufferGeometry();
    _geometry.setAttribute('position', new THREE.BufferAttribute(stlData.positions, 3));
    _geometry.setAttribute('normal',   new THREE.BufferAttribute(stlData.normals.slice(), 3));

    // Center model first to establish correct bounding box centers
    _geometry.computeBoundingBox();
    const box = _geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);

    _vertexThickness = null;
    computeWallThickness();

    // Vertex colors based on draft angle (passing positions for centroid check)
    const colors = computeDraftColors(stlData.positions, stlData.normals);
    _geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: _showOverlay,
      roughness: 0.35,
      metalness: 0.15,
    });
    if (!_showOverlay) {
      mat.vertexColors = false;
      mat.color = new THREE.Color(0x1a8fd1);
    }
    mat.side = THREE.DoubleSide; // Ensure both sides render for thin walls

    _mesh = new THREE.Mesh(_geometry, mat);

    // 메시 와이어프레임 외곽선 오버레이 추가 (신뢰감 부여 및 CAD 감성 극대화)
    const wireframeGeo = new THREE.WireframeGeometry(_geometry);
    const wireframeMat = new THREE.LineBasicMaterial({
      color: 0x00d4ff, // Cyan wireframe for dark theme
      transparent: true,
      opacity: 0.12,
      depthWrite: false
    });
    const wireframe = new THREE.LineSegments(wireframeGeo, wireframeMat);
    wireframe.name = 'mesh_wireframe_overlay';
    _mesh.add(wireframe);

    _mesh.targetQuaternion = new THREE.Quaternion();
    setPullAxis(_pullAxis);
    _mesh.quaternion.copy(_mesh.targetQuaternion);

    _mesh.position.sub(center);

    // Position grid at bottom of model
    const size = new THREE.Vector3();
    box.getSize(size);
    const gridObj = _scene.children.find(c => c instanceof THREE.GridHelper);
    if (gridObj) gridObj.position.y = -size.y / 2;

    // Adjust camera — precise auto-fit so the model is centered & fully framed
    const radius = size.length();
    resizeViewer();        // sync camera aspect to live container before fitting
    frameModelInView();

    // Add labeled coordinate axes gimbal next to model
    if (_gimbalWidget) _scene.remove(_gimbalWidget);
    const gimbalSize = Math.max(10, Math.min(20, radius * 0.03));
    _gimbalWidget = createLabeledAxes(gimbalSize);
    _gimbalWidget.position.set(-size.x * 0.5 - 10, -size.y/2, size.z * 0.5 + 10);
    _scene.add(_gimbalWidget);
    updateGimbalHighlight();

    if (_pullArrow) {
      _scene.remove(_pullArrow);
      _pullArrow = null;
    }
    updatePullArrow();

    _scene.add(_mesh);
  }

  // 3.1 Ray-Triangle Intersection (Moller-Trumbore Algorithm - Highly Optimized with Static Cache)
  const _edge1 = new THREE.Vector3();
  const _edge2 = new THREE.Vector3();
  const _h = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _q = new THREE.Vector3();

  function rayTriangleIntersect(orig, dir, v0, v1, v2) {
    const EPSILON = 0.000001;
    _edge1.subVectors(v1, v0);
    _edge2.subVectors(v2, v0);
    _h.crossVectors(dir, _edge2);
    const a = _edge1.dot(_h);
    
    if (a > -EPSILON && a < EPSILON) return null; // Parallel
    
    const f = 1.0 / a;
    _s.subVectors(orig, v0);
    const u = f * _s.dot(_h);
    
    if (u < 0.0 || u > 1.0) return null;
    
    _q.crossVectors(_s, _edge1);
    const v = f * dir.dot(_q);
    
    if (v < 0.0 || u + v > 1.0) return null;
    
    const t = f * _edge2.dot(_q);
    if (t > EPSILON) return t;
    return null;
  }

  // 3.2.1 주 축에 수직인 수평 방향 정의
  function getHorizontalDirs(pullAxis) {
    if (pullAxis === 'X') {
      return [
        { dir: new THREE.Vector3(0, 1, 0), name: '+Y' },
        { dir: new THREE.Vector3(0, -1, 0), name: '-Y' },
        { dir: new THREE.Vector3(0, 0, 1), name: '+Z' },
        { dir: new THREE.Vector3(0, 0, -1), name: '-Z' }
      ];
    } else if (pullAxis === 'Y') {
      return [
        { dir: new THREE.Vector3(1, 0, 0), name: '+X' },
        { dir: new THREE.Vector3(-1, 0, 0), name: '-X' },
        { dir: new THREE.Vector3(0, 0, 1), name: '+Z' },
        { dir: new THREE.Vector3(0, 0, -1), name: '-Z' }
      ];
    } else {
      return [
        { dir: new THREE.Vector3(1, 0, 0), name: '+X' },
        { dir: new THREE.Vector3(-1, 0, 0), name: '-X' },
        { dir: new THREE.Vector3(0, 1, 0), name: '+Y' },
        { dir: new THREE.Vector3(0, -1, 0), name: '-Y' }
      ];
    }
  }

  // 3.2.2 물리적 간섭 기반의 언더컷 판별 및 슬라이드/경사코어 방향 판별 함수
  async function getPhysicalUndercuts(pos, normals, partingH, pullAxis, flipAxis, onProgress) {
    // 캐시 키 검사
    if (_undercutCache && 
        _undercutCache.partingH === partingH && 
        _undercutCache.pullAxis === pullAxis && 
        _undercutCache.flipAxis === flipAxis && 
        _undercutCache.isUndercutMap.length === (pos.length / 9)) {
      return { 
        isUndercutMap: _undercutCache.isUndercutMap, 
        slideDirections: _undercutCache.slideDirections 
      };
    }

    const triCount = pos.length / 9;
    const isUndercutMap = new Uint8Array(triCount);
    const slideDirections = new Array(triCount).fill(null);

    const pullDir = new THREE.Vector3();
    if (pullAxis === 'X') pullDir.set(1, 0, 0);
    else if (pullAxis === 'Y') pullDir.set(0, 1, 0);
    else pullDir.set(0, 0, 1);

    if (flipAxis) {
      pullDir.negate();
    }

    const axisKey = pullAxis.toLowerCase();

    // 전체 바운딩 박스를 계산하여 간섭 최소 거리 기준값 설정
    let minVal = Infinity, maxVal = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const idx = i * 3;
      const val = pos[idx + (pullAxis === 'X' ? 0 : pullAxis === 'Y' ? 1 : 2)];
      if (val < minVal) minVal = val;
      if (val > maxVal) maxVal = val;
    }
    const maxDim = maxVal - minVal;
    const minDistTolerance = Math.max(0.1, maxDim * 0.005); // 최소 0.1mm 오차 허용

    // 1. 모든 삼각형 데이터 로딩 및 인덱싱 (바운딩 박스 precompute 추가)
    const triangles = [];
    for (let i = 0; i < triCount; i++) {
      const idx = i * 9;
      const v0 = new THREE.Vector3(pos[idx],     pos[idx+1], pos[idx+2]);
      const v1 = new THREE.Vector3(pos[idx+3],   pos[idx+4], pos[idx+5]);
      const v2 = new THREE.Vector3(pos[idx+6],   pos[idx+7], pos[idx+8]);
      
      const centroid = new THREE.Vector3(
        (v0.x + v1.x + v2.x) / 3,
        (v0.y + v1.y + v2.y) / 3,
        (v0.z + v1.z + v2.z) / 3
      );
      const nx = normals[idx], ny = normals[idx+1], nz = normals[idx+2];
      const normal = new THREE.Vector3(nx, ny, nz);
      
      const minX = Math.min(v0.x, v1.x, v2.x);
      const maxX = Math.max(v0.x, v1.x, v2.x);
      const minY = Math.min(v0.y, v1.y, v2.y);
      const maxY = Math.max(v0.y, v1.y, v2.y);
      const minZ = Math.min(v0.z, v1.z, v2.z);
      const maxZ = Math.max(v0.z, v1.z, v2.z);

      triangles.push({ v0, v1, v2, centroid, normal, idx, minX, maxX, minY, maxY, minZ, maxZ });
    }

    // 2. 1차 백드래프트 후보 선별
    const candidates = [];
    for (let i = 0; i < triCount; i++) {
      const tri = triangles[i];
      let dotVal = tri.normal.dot(pullDir);
      let centerOffset = tri.centroid[axisKey] - partingH;

      if (flipAxis) {
        dotVal = -dotVal;
        centerOffset = -centerOffset;
      }

      const absDot = Math.abs(dotVal);
      // 단순 수직 리브 벽면을 제외하기 위해 absDot < 0.70 적용 및 엄격한 백드래프트 임계치 dotVal < -0.35 / > 0.35 지정
      const isBackdraft = ((centerOffset > 0 && dotVal < -0.35) || (centerOffset < 0 && dotVal > 0.35)) && absDot < 0.70;
      
      if (isBackdraft) {
        candidates.push(tri);
      }
    }

    // 수평 4방향 벡터 준비
    const horizDirs = getHorizontalDirs(pullAxis);

    // 3. 2차 Ray-casting 검증 (물리적 간섭이 있는 경우만 진짜 언더컷)
    let lastYieldTime = performance.now();
    for (let c = 0; c < candidates.length; c++) {
      const now = performance.now();
      // Yield to the browser main thread if more than 24ms has elapsed to keep UI responsive
      if (now - lastYieldTime > 24) {
        lastYieldTime = now;
        if (onProgress) {
          const pct = Math.round(20 + (c / candidates.length) * 60);
          onProgress(pct, `물리적 언더컷/코어 분석 중 (${c}/${candidates.length})...`);
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      const cand = candidates[c];
      let centerOffset = cand.centroid[axisKey] - partingH;
      if (flipAxis) centerOffset = -centerOffset;

      const rayDir = (centerOffset > 0) ? pullDir.clone() : pullDir.clone().negate();
      // 가짜 교차를 원천 차단하기 위해 법선 방향으로 0.1mm 띄워 Ray Bias 적용
      const rayOrigin = cand.centroid.clone().add(cand.normal.clone().multiplyScalar(0.1));
      
      let isBlocked = false;
      const sign = (centerOffset > 0) ? 1 : -1;
      const originVal = rayOrigin[axisKey];

      // Define perpendicular axes for fast 2D AABB filtering
      let axisP1, axisP2;
      let minKeyP1, maxKeyP1, minKeyP2, maxKeyP2, minKeyAxis, maxKeyAxis;
      if (pullAxis === 'X') {
        axisP1 = 'y'; axisP2 = 'z';
        minKeyP1 = 'minY'; maxKeyP1 = 'maxY';
        minKeyP2 = 'minZ'; maxKeyP2 = 'maxZ';
        minKeyAxis = 'minX'; maxKeyAxis = 'maxX';
      } else if (pullAxis === 'Y') {
        axisP1 = 'x'; axisP2 = 'z';
        minKeyP1 = 'minX'; maxKeyP1 = 'maxX';
        minKeyP2 = 'minZ'; maxKeyP2 = 'maxZ';
        minKeyAxis = 'minY'; maxKeyAxis = 'maxY';
      } else {
        axisP1 = 'x'; axisP2 = 'y';
        minKeyP1 = 'minX'; maxKeyP1 = 'maxX';
        minKeyP2 = 'minY'; maxKeyP2 = 'maxY';
        minKeyAxis = 'minZ'; maxKeyAxis = 'maxZ';
      }
      const rx = rayOrigin[axisP1];
      const ry = rayOrigin[axisP2];

      for (let t = 0; t < triCount; t++) {
        const tri = triangles[t];

        // 자기 자신 및 직전/직후 인접 삼각형 무시
        if (Math.abs(tri.idx - cand.idx) < 9) continue;

        // Pre-computed 2D bounding box check in the plane perpendicular to pull axis
        if (rx < tri[minKeyP1] - 0.2 || rx > tri[maxKeyP1] + 0.2 || ry < tri[minKeyP2] - 0.2 || ry > tri[maxKeyP2] + 0.2) continue;

        // 탈형 경로 반대쪽에 위치한 삼각형 필터링
        if (sign > 0) {
          if (tri.centroid[axisKey] < originVal - 0.1) continue;
        } else {
          if (tri.centroid[axisKey] > originVal + 0.1) continue;
        }

        // Bounding Box 축방향 빠른 필터링
        if (sign > 0 && tri[maxKeyAxis] < originVal) continue;
        if (sign < 0 && tri[minKeyAxis] > originVal) continue;

        // Moller-Trumbore로 정밀 교차 판정
        const dist = rayTriangleIntersect(rayOrigin, rayDir, tri.v0, tri.v1, tri.v2);
        if (dist !== null && dist > minDistTolerance) {
          isBlocked = true;
          break; // 장애물 발견되면 즉시 종료
        }
      }

      if (isBlocked) {
        const candIdx = cand.idx / 9;
        isUndercutMap[candIdx] = 1;

        // 4. 수평 가시성 검사 (슬라이드 작동 가능 방향 탐색)
        let validExitDir = null;
        
        for (let d = 0; d < horizDirs.length; d++) {
          const hDir = horizDirs[d].dir;
          const hName = horizDirs[d].name;
          const hAxisKey = (hName.includes('X') ? 'x' : hName.includes('Y') ? 'y' : 'z');
          const isHPositive = hName.startsWith('+');
          const hOriginVal = rayOrigin[hAxisKey];
          
          let isHBlocked = false;

          let hAxisP1, hAxisP2;
          let hMinKeyP1, hMaxKeyP1, hMinKeyP2, hMaxKeyP2, hMinKeyAxis, hMaxKeyAxis;
          if (hAxisKey === 'x') {
            hAxisP1 = 'y'; hAxisP2 = 'z';
            hMinKeyP1 = 'minY'; hMaxKeyP1 = 'maxY';
            hMinKeyP2 = 'minZ'; hMaxKeyP2 = 'maxZ';
            hMinKeyAxis = 'minX'; hMaxKeyAxis = 'maxX';
          } else if (hAxisKey === 'y') {
            hAxisP1 = 'x'; hAxisP2 = 'z';
            hMinKeyP1 = 'minX'; hMaxKeyP1 = 'maxX';
            hMinKeyP2 = 'minZ'; hMaxKeyP2 = 'maxZ';
            hMinKeyAxis = 'minY'; hMaxKeyAxis = 'maxY';
          } else {
            hAxisP1 = 'x'; hAxisP2 = 'y';
            hMinKeyP1 = 'minX'; hMaxKeyP1 = 'maxX';
            hMinKeyP2 = 'minY'; hMaxKeyP2 = 'maxY';
            hMinKeyAxis = 'minZ'; hMaxKeyAxis = 'maxZ';
          }
          const hrx = rayOrigin[hAxisP1];
          const hry = rayOrigin[hAxisP2];
          
          for (let t = 0; t < triCount; t++) {
            const tri = triangles[t];
            if (Math.abs(tri.idx - cand.idx) < 9) continue;
            
            // Pre-computed 2D bounding box check in the plane perpendicular to slide direction
            if (hrx < tri[hMinKeyP1] - 0.2 || hrx > tri[hMaxKeyP1] + 0.2 || hry < tri[hMinKeyP2] - 0.2 || hry > tri[hMaxKeyP2] + 0.2) continue;

            // 수평 경로 반대쪽 필터링
            if (isHPositive) {
              if (tri.centroid[hAxisKey] < hOriginVal - 0.1) continue;
            } else {
              if (tri.centroid[hAxisKey] > hOriginVal + 0.1) continue;
            }
            
            if (isHPositive && tri[hMaxKeyAxis] < hOriginVal) continue;
            if (!isHPositive && tri[hMinKeyAxis] > hOriginVal) continue;
            
            const dist = rayTriangleIntersect(rayOrigin, hDir, tri.v0, tri.v1, tri.v2);
            if (dist !== null && dist > minDistTolerance) {
              isHBlocked = true;
              break;
            }
          }
          
          if (!isHBlocked) {
            validExitDir = hName;
            break;
          }
        }
        
        slideDirections[candIdx] = validExitDir;
      }
    }

    // 결과 캐시 저장
    _undercutCache = {
      partingH,
      pullAxis,
      flipAxis,
      isUndercutMap,
      slideDirections
    };

    return { isUndercutMap, slideDirections };
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

    // analyze()가 먼저 실행되면 _undercutCache에 결과가 있음.
    // computeDraftColors는 동기 함수이므로 async인 getPhysicalUndercuts를 await할 수 없어 캐시를 직접 사용.
    // 캐시가 없으면 구배각만으로 색상 표시(언더컷 표시 생략).
    const isUndercutMap = (_undercutCache &&
      _undercutCache.pullAxis === _pullAxis &&
      _undercutCache.flipAxis === _flipAxis &&
      _undercutCache.isUndercutMap)
      ? _undercutCache.isUndercutMap
      : null;

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

      // 정점 인덱스로부터 해당 삼각형의 인덱스(i/9)를 구함
      const triIdx = Math.floor(i / 9);
      const isPhysicalUndercut = isUndercutMap ? isUndercutMap[triIdx] === 1 : false;

      if (isPhysicalUndercut) {
        // ACTUAL UNDERCUT (RED / MAX SEVERITY)
        const c = getRainbowColor(1.0); r = c.r; g = c.g; b = c.b;
      } else if (absVal > 0.98) {
        // Horizontal top/bottom (BLUE / SAFE)
        const c = getRainbowColor(0.0); r = c.r; g = c.g; b = c.b;
      } else if (absVal < sin1) {
        // INSUFFICIENT DRAFT (ORANGE-RED / WARNING)
        const c = getRainbowColor(0.8); r = c.r; g = c.g; b = c.b;
      } else if (absVal < sin3) {
        // Marginal draft (YELLOW-GREEN / CAUTION)
        const c = getRainbowColor(0.5); r = c.r; g = c.g; b = c.b;
      } else {
        // Good draft (BLUE / SAFE)
        const c = getRainbowColor(0.0); r = c.r; g = c.g; b = c.b;
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

  /* Precise fit-to-view: centers the (origin-centered) model and frames it fully,
     accounting for both vertical & horizontal FOV so it never clips on any aspect. */
  function frameModelInView() {
    if (!_geometry || !_camera || !_controls) return;
    _geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    _geometry.boundingBox.getSize(size);
    const sphereR = Math.max(size.length() / 2, 0.001);
    const fov = THREE.MathUtils.degToRad(_camera.fov);
    // guard against hidden/zero-size container (aspect would be 0/NaN -> broken framing)
    const aspect = (isFinite(_camera.aspect) && _camera.aspect > 0) ? _camera.aspect : 1.6;
    const fitH = sphereR / Math.sin(fov / 2);
    const fitW = sphereR / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    const dist = Math.max(fitH, fitW) * 1.25; // 25% breathing room
    const dir = new THREE.Vector3(1, 0.7, 1.2).normalize();
    _camera.position.copy(dir.multiplyScalar(dist));
    _camera.near = Math.max(0.01, dist - sphereR * 4);
    _camera.far = dist + sphereR * 6;
    _camera.updateProjectionMatrix();
    _controls.target.set(0, 0, 0);
    _controls.update();
  }

  function resetCamera() {
    frameModelInView();
  }

  function groupPointsIntoFeatures(points, cellSize) {
    const cells = {};
    for (let i = 0; i < points.length; i += 3) {
      const x = points[i], y = points[i+1], z = points[i+2];
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const cz = Math.floor(z / cellSize);
      const key = `${cx},${cy},${cz}`;
      if (!cells[key]) cells[key] = [];
      cells[key].push(x, y, z);
    }

    const visited = new Set();
    const components = [];

    const getNeighbors = (key) => {
      const parts = key.split(',');
      const cx = parseInt(parts[0]), cy = parseInt(parts[1]), cz = parseInt(parts[2]);
      const neighbors = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nk = `${cx+dx},${cy+dy},${cz+dz}`;
            if (cells[nk]) neighbors.push(nk);
          }
        }
      }
      return neighbors;
    };

    for (const key in cells) {
      if (visited.has(key)) continue;
      const componentPoints = [];
      const queue = [key];
      visited.add(key);

      while (queue.length > 0) {
        const curr = queue.shift();
        var _cc=cells[curr]; for (let _p=0;_p<_cc.length;_p++) componentPoints.push(_cc[_p]);
        
        const neighbors = getNeighbors(curr);
        neighbors.forEach(n => {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        });
      }
      components.push(componentPoints);
    }

    return components;
  }

  function processCoreClusters(clusters, cSize, avgDim, isSlideType) {
    let finalFeatures = [];
    for (const dir in clusters) {
      if (clusters[dir].length < 30) continue; // Skip very small noise clusters
      
      const features = groupPointsIntoFeatures(clusters[dir], cSize);
      features.forEach(featPoints => {
        // [5. 리프터 생성 조건 강화 및 노이즈 필터링]
        // 포인트 개수 기본 15개에서 강화: 슬라이드는 최소 30개, 리프터는 최소 50개 이상만 인정
        const minPointCount = isSlideType ? 30 : 50;
        if (featPoints.length < minPointCount) return;
        
        // Bounding box filter
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let j = 0; j < featPoints.length; j += 3) {
          minX = Math.min(minX, featPoints[j]);   maxX = Math.max(maxX, featPoints[j]);
          minY = Math.min(minY, featPoints[j+1]); maxY = Math.max(maxY, featPoints[j+1]);
          minZ = Math.min(minZ, featPoints[j+2]); maxZ = Math.max(maxZ, featPoints[j+2]);
        }
        const fdx = maxX - minX;
        const fdy = maxY - minY;
        const fdz = maxZ - minZ;
        const maxFeatureDim = Math.max(fdx, fdy, fdz);
        const volume = fdx * fdy * fdz;
        
        // [5. 리프터 생성 조건 강화]
        // 모델 크기 대비 최소 가치 기준값: 슬라이드는 7%, 리프터는 9% 이상만 허용하여 노이즈 과다 생성 차단
        const minRatio = isSlideType ? 0.07 : 0.09;
        if (maxFeatureDim < avgDim * minRatio) return;
        
        finalFeatures.push({
          dir,
          points: featPoints,
          center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
          dims: { dx: fdx, dy: fdy, dz: fdz },
          volume: volume
        });
      });
    }

    // [3. 슬라이드/리프터 그룹화 로직 추가]
    // 동일 방향을 향하면서 매우 인접한(중심 거리가 avgDim * 0.25 이내인) 특징점 클러스터들을 하나로 병합
    let mergedFeatures = [];
    const mergeThreshold = avgDim * 0.25;

    for (let i = 0; i < finalFeatures.length; i++) {
      let merged = false;
      for (let j = 0; j < mergedFeatures.length; j++) {
        if (finalFeatures[i].dir === mergedFeatures[j].dir) {
          const c1 = finalFeatures[i].center;
          const c2 = mergedFeatures[j].center;
          const dist = Math.sqrt(Math.pow(c1.x - c2.x, 2) + Math.pow(c1.y - c2.y, 2) + Math.pow(c1.z - c2.z, 2));
          
          if (dist < mergeThreshold) {
            // 인접 클러스터 병합 수행
            mergedFeatures[j].points = mergedFeatures[j].points.concat(finalFeatures[i].points);
            // 바운딩 박스 재계산
            const pt = mergedFeatures[j].points;
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
            for (let k = 0; k < pt.length; k += 3) {
              minX = Math.min(minX, pt[k]);   maxX = Math.max(maxX, pt[k]);
              minY = Math.min(minY, pt[k+1]); maxY = Math.max(maxY, pt[k+1]);
              minZ = Math.min(minZ, pt[k+2]); maxZ = Math.max(maxZ, pt[k+2]);
            }
            mergedFeatures[j].center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
            mergedFeatures[j].dims = { dx: maxX - minX, dy: maxY - minY, dz: maxZ - minZ };
            mergedFeatures[j].volume = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
            merged = true;
            break;
          }
        }
      }
      if (!merged) {
        mergedFeatures.push(finalFeatures[i]);
      }
    }
    
    // 크기순 내림차순 정렬
    mergedFeatures.sort((a, b) => b.volume - a.volume);
    
    return mergedFeatures;
  }

  /* ──────────────────────────────────────
     4. ANALYSIS ENGINE
  ────────────────────────────────────── */
  async function analyze(stlData, matKey, onProgress) {
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
    const avgDim = (dx + dy + dz) / 3;
    const thicknessRatio = minDim / maxDim;

    // 메쉬의 삼각형 요소를 순회하여 정밀 표면적 계산 (Heron / Cross Product)
    let totalArea = 0;
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const edge1 = new THREE.Vector3();
    const edge2 = new THREE.Vector3();
    const cross = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 9) {
      vA.set(pos[i],     pos[i+1], pos[i+2]);
      vB.set(pos[i+3],   pos[i+4], pos[i+5]);
      vC.set(pos[i+6],   pos[i+7], pos[i+8]);
      edge1.subVectors(vB, vA);
      edge2.subVectors(vC, vA);
      cross.crossVectors(edge1, edge2);
      totalArea += cross.length() * 0.5;
    }

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

    const evalPullAxis = _pullAxis === 'AUTO' ? 'Z' : _pullAxis;

    // 물리적 간섭(Ray-casting) 기반 진짜 언더컷 맵 도출
    const { isUndercutMap, slideDirections } = await getPhysicalUndercuts(pos, normals, partingH, evalPullAxis, _flipAxis, onProgress);

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
      
      // 해당 삼각형이 물리적 언더컷인지 판별
      const triIdx = Math.floor(i / 9);
      const isPhysicalUndercut = isUndercutMap[triIdx] === 1;

      if (isPhysicalUndercut) {
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

    if (_meltTemp < mat.TmMin) {
      issues.push({
        level: 'warning',
        title: `수지 온도(Melt Temp) 낮음 (${_meltTemp}℃)`,
        desc: `수지 권장 사출 온도(${mat.TmMin}~${mat.TmMax}℃)보다 낮아, 고점도로 인해 미성형(Short Shot) 위험이 발생할 수 있습니다.`
      });
    } else if (_meltTemp > mat.TmMax) {
      issues.push({
        level: 'warning',
        title: `수지 온도(Melt Temp) 높음 (${_meltTemp}℃)`,
        desc: `수지 권장 사출 온도(${mat.TmMin}~${mat.TmMax}℃)보다 높아, 탄화 및 플래시(Flash) 불량이 우려됩니다.`
      });
    }

    if (_moldTemp < mat.TwMin) {
      issues.push({
        level: 'warning',
        title: `금형 온도(Mold Temp) 낮음 (${_moldTemp}℃)`,
        desc: `수지 권장 금형 온도(${mat.TwMin}~${mat.TwMax}℃)보다 낮아 표면 상태(웰드라인, 광택)가 불리해질 수 있습니다.`
      });
    } else if (_moldTemp > mat.TwMax) {
      issues.push({
        level: 'warning',
        title: `금형 온도(Mold Temp) 높음 (${_moldTemp}℃)`,
        desc: `수지 권장 금형 온도(${mat.TwMin}~${mat.TwMax}℃)보다 높아 냉각 속도가 지연되고 취출 시 수축 변형 우려가 있습니다.`
      });
    }

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

    if (!_adjacencyGraph) {
      _geometry.computeBoundingBox();
      const modelSize = new THREE.Vector3();
      _geometry.boundingBox.getSize(modelSize);
      const diag = modelSize.length();
      const epsilon = Math.max(0.05, diag * 0.001);
      _adjacencyGraph = buildAdjacencyGraph(pos, epsilon);
    }
    if (!_vertexThickness) {
      computeWallThickness();
    }
    const sinkRes = predictSinkMarks(_adjacencyGraph);
    const shrinkRes = predictShrinkage(_adjacencyGraph);
    const warpRes = predictWarpage(_adjacencyGraph, shrinkRes);

    issues.push({
      level: sinkRes.severity === 'HIGH' ? 'error' : sinkRes.severity === 'MEDIUM' ? 'warning' : 'ok',
      title: `싱크마크 위험도 (Sink Risk): ${sinkRes.severity}`,
      desc: `예측 싱크마크 개수: ${sinkRes.count}개, 총 예측 면적: ${sinkRes.area}㎟. ${sinkRes.severity === 'HIGH' ? 'Rib 두께 감소 및 보스 코어아웃(Core Out) 설계 변경을 권장합니다.' : '수축/함몰 우려가 적은 편입니다.'}`
    });

    issues.push({
      level: shrinkRes.riskLevel === 'HIGH' ? 'error' : shrinkRes.riskLevel === 'MEDIUM' ? 'warning' : 'ok',
      title: `재질 수축 위험도 (Shrinkage Risk): ${shrinkRes.riskLevel}`,
      desc: `최대 수축률: ${shrinkRes.maxShrinkage.toFixed(2)}%, 평균 수축률: ${shrinkRes.avgShrinkage.toFixed(2)}%. 보압 압력 및 보압 시간 최적화를 권장합니다.`
    });

    issues.push({
      level: warpRes.risk === 'HIGH' ? 'error' : warpRes.risk === 'MEDIUM' ? 'warning' : 'ok',
      title: `제품 변형 위험도 (Warpage Risk): ${warpRes.risk} (점수: ${warpRes.score}점)`,
      desc: `예상 변형 방향: ${warpRes.direction}, 변형 변위량: ${warpRes.magnitude.toFixed(2)}mm. ${warpRes.risk === 'HIGH' ? '냉각 채널 추가 설계 및 리브/보스 구조 최적화를 권장합니다.' : '변형 위험이 보통 이하입니다.'}`
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

    // 사이드 게이트(Side Gate) 치수 설계 규칙 접목
    const nCoeff = (matKey === 'FORTRON') ? 0.8 : 0.7; // 수지상수 (FORTRON/PA: 0.8, PC/ABS/POM/PP: 0.7)
    const gateD = minDim * nCoeff;
    const gateW = (nCoeff * Math.sqrt(totalArea)) / 30;
    
    issues.push({
      level: 'ok',
      title: `권장 사이드 게이트(Side Gate) 설계 치수`,
      desc: `두께 ${minDim.toFixed(1)}mm 및 표면적 ${totalArea.toFixed(0)}㎟ 기준 (수지상수: ${nCoeff}): 권장 게이트 깊이(d) = ${gateD.toFixed(2)}mm, 권장 폭(W) = ${gateW.toFixed(2)}mm.`
    });

    // 수지별 적정 가스 벤트(Gas Vent) 틈새 규격 가이드 접목
    let ventMin = 0.02, ventMax = 0.03, burrLimit = 0.04;
    if (matKey === 'FORTRON') { ventMin = 0.010; ventMax = 0.015; burrLimit = 0.02; }
    else if (matKey === 'PC') { ventMin = 0.030; ventMax = 0.040; burrLimit = 0.05; }
    else if (matKey === 'PP' || matKey === 'POM') { ventMin = 0.010; ventMax = 0.020; burrLimit = 0.03; }

    issues.push({
      level: 'info',
      title: `${matKey} 권장 가스 벤트(Air Vent) 깊이`,
      desc: `가스 배출 효율과 Burr 차단을 위한 최적 틈새: ${ventMin.toFixed(3)} ~ ${ventMax.toFixed(3)}mm (임계치 초과 ${burrLimit.toFixed(2)}mm 이상 시 Burr/Flash 우려).`
    });

    // Material-specific engineering guidelines
    if (matKey === 'FORTRON') {
      issues.push({
        level: 'warning',
        title: 'FORTRON 고온 성형 가스 및 부식 경고',
        desc: 'PPS(FORTRON) 수지는 고온 사출 시 부식성 가스(H2S, SO2, Cl-)가 방출됩니다. 금형 부식 방지를 위해 SUS420J2 금형강 사용 및 CrN(질화크롬) 표면 처리를 적극 권장합니다.'
      });
      issues.push({
        level: 'info',
        title: 'FORTRON 온도 및 예비건조 조건',
        desc: '실린더 300~340℃, 금형 130~160℃를 준수하십시오. 120℃ 이하 시 충진 불량 및 광택 저하가 발생하며, 140℃에서 3시간 이상 예비 건조하여 수분을 엄격히 제어해야 은조(Silver Streak)를 방지합니다.'
      });
    } else if (matKey === 'POM') {
      issues.push({
        level: 'warning',
        title: 'POM 수지 열분해 가스 경고',
        desc: 'POM은 실린더 온도 과열(220℃ 이상) 또는 장시간 체류 시 포름알데히드 가스로 분해되어 흑조, 흑점, 변색 불량을 유발하므로 온도 및 유동 배기를 주기적으로 체크해야 합니다.'
      });
    } else if (matKey === 'PC') {
      issues.push({
        level: 'warning',
        title: 'PC 수지 가수분해 주의 (건조 필수)',
        desc: 'PC 수지는 수분이 존재할 경우 고온 사출 시 가수분해되어 강도가 급감합니다. 120℃ 제습 건조기에서 10시간 이상 충분히 예비 건조하여 흡수율을 제어해야 합니다.'
      });
    }

    // Ejection & Ejector Pin design guidelines
    issues.push({
      level: 'info',
      title: '취출 금형 구조 가이드 (밀핀 백화 방지)',
      desc: '이형 및 취출 시 리브(Rib) 부위는 사각 밀핀을 사용하거나 본살과 걸치도록 하고, 보스(Boss) 부위는 슬리브(Sleeve) 구조 밀핀을 채택하여 변형 및 백화 불량을 예방해야 합니다.'
    });

    // Score
    const errorCount   = issues.filter(i=>i.level==='error').length;
    const warningCount = issues.filter(i=>i.level==='warning').length;
    const score = Math.max(0, 100 - errorCount*18 - warningCount*7);

    // Calculate core bounding boxes for UI reporting
    const moldFeatures = { slides: [], lifters: [] };
    const slideClusters = {};
    const lifterClusters = {};
    
    for (let i = 0; i < pos.length; i += 9) {
      const nx = normals[i], ny = normals[i+1], nz = normals[i+2];
      const vx = pos[i], vy = pos[i+1], vz = pos[i+2];
      
      const triIdx = Math.floor(i / 9);
      const isPhysicalUndercut = isUndercutMap[triIdx] === 1;
      
      if (isPhysicalUndercut) {
        const exitDir = slideDirections[triIdx];
        
        let pDir = '';
        if (_pullAxis === 'X') { pDir = Math.abs(ny) > Math.abs(nz) ? (ny > 0 ? '+Y':'-Y') : (nz > 0 ? '+Z':'-Z'); }
        else if (_pullAxis === 'Y') { pDir = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? '+X':'-X') : (nz > 0 ? '+Z':'-Z'); }
        else { pDir = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? '+X':'-X') : (ny > 0 ? '+Y':'-Y'); }
        
        if (exitDir !== null) {
          // 수평 탈출 경로가 존재하므로 슬라이드 코어로 판정
          const sDir = exitDir;
          if (!slideClusters[sDir]) slideClusters[sDir] = [];
          slideClusters[sDir].push(vx, vy, vz);
        } else {
          // [개선된 경사 코어 (리프터) 판정 로직]
          // 1. Parting Plane 및 Core Side 판별
          // 하판(Core Side)은 발취 방향의 반대(또는 flip 상태에 따라 하단) 소속이어야 함.
          let isCoreSide = false;
          let val = (_pullAxis === 'X') ? vx : ((_pullAxis === 'Y') ? vy : vz);
          
          if (_flipAxis) {
            // 발취 방향이 마이너스이면 하판(Core Side)은 플러스 영역
            isCoreSide = (val > partingH);
          } else {
            // 발취 방향이 플러스이면 하판(Core Side)은 마이너스 영역
            isCoreSide = (val < partingH);
          }

          if (isCoreSide) {
            // 2. 내부 포켓 및 외부 형상 제외 필터링
            // 외부 형상(Cavity Side 외벽의 단차 등)을 걸러내기 위해 법선 방향과 가상 투사 거리를 통해 
            // 주변 형상 벽에 둘러싸인 내부 포켓 구조(Pocket/Hollow)인지 체크
            const pullDirVec = new THREE.Vector3();
            if (_pullAxis === 'X') pullDirVec.set(1, 0, 0);
            else if (_pullAxis === 'Y') pullDirVec.set(0, 1, 0);
            else pullDirVec.set(0, 0, 1);
            if (_flipAxis) pullDirVec.negate();

            const triCentroid = new THREE.Vector3(
              (pos[triIdx*9] + pos[triIdx*9+3] + pos[triIdx*9+6]) / 3,
              (pos[triIdx*9+1] + pos[triIdx*9+4] + pos[triIdx*9+7]) / 3,
              (pos[triIdx*9+2] + pos[triIdx*9+5] + pos[triIdx*9+8]) / 3
            );
            const triNormal = new THREE.Vector3(nx, ny, nz);

            // 3. 리프터 스트로크 계산 및 기하 조건 검증
            // 언더컷 벽면 깊이(d) 측정
            let maxTravel = 0.0;
            // 법선 역방향으로 레이를 쏘아 마주보는 제품 반대쪽 살두께 또는 포켓 벽과의 거리(D) 측정
            const testDir = triNormal.clone().negate().normalize();
            const biasOrigin = triCentroid.clone().add(triNormal.clone().multiplyScalar(0.1));
            
            // 경량화된 충돌 레이캐스팅으로 리브 폭/포켓 깊이(d) 측정
            let minDistToOpposite = Infinity;
            for (let t = 0; t < pos.length / 9; t++) {
              if (Math.abs(t * 9 - triIdx * 9) < 9) continue;
              const tv0 = new THREE.Vector3(pos[t*9], pos[t*9+1], pos[t*9+2]);
              const tv1 = new THREE.Vector3(pos[t*9+3], pos[t*9+4], pos[t*9+5]);
              const tv2 = new THREE.Vector3(pos[t*9+6], pos[t*9+7], pos[t*9+8]);
              
              const dist = rayTriangleIntersect(biasOrigin, testDir, tv0, tv1, tv2);
              if (dist !== null && dist < minDistToOpposite) {
                minDistToOpposite = dist;
              }
            }

            // 언더컷 돌출(걸림) 깊이량 추정 (만일 맞은편 벽이 감지되면 그 내부 포켓 폭)
            const undercutDepth = (minDistToOpposite !== Infinity) ? Math.max(1.0, minDistToOpposite * 0.5) : 3.0;
            const theta = 12 * Math.PI / 180; // 리프터 기본 슬라이딩 작동 경사각 12도
            const strokeRequired = undercutDepth / Math.tan(theta);

            // 내부 포켓 구조 필터: 주변에 제품 내벽이나 본살 구조가 최소 1곳 이상 레이캐스팅상 마주보고 있으며,
            // 최소 작동 스트로크가 2.0mm 이상 보장될 때만 리프터 기구로 판정
            const isInnerPocket = (minDistToOpposite !== Infinity && minDistToOpposite < (avgDim * 0.5));
            const isStrokeValid = strokeRequired >= 2.0;

            if (isInnerPocket && isStrokeValid) {
              if (!lifterClusters[pDir]) lifterClusters[pDir] = [];
              lifterClusters[pDir].push(vx, vy, vz);
            }
          }
        }
      }
    }

    const cSize = Math.max(5.0, Math.min(avgDim * 0.12, 25.0));

    const finalSlides = processCoreClusters(slideClusters, cSize, avgDim, true);
    const finalLifters = processCoreClusters(lifterClusters, cSize, avgDim, false);

    finalSlides.forEach(feat => {
      moldFeatures.slides.push({ dir: feat.dir, center: feat.center });
    });
    finalLifters.forEach(feat => {
      moldFeatures.lifters.push({ dir: feat.dir, center: feat.center });
    });

    const diagnostics = _getDiagnostics(minDim, maxDim, totalArea, matKey, mat);

    // [최적 사출 성형방향 추천 시스템 (Auto-Pull Engine)]
    // 방향 목록: +X, -X, +Y, -Y, +Z, -Z
    const evalDirections = [
      { axis: 'X', flip: false, label: '+X', pullDir: new THREE.Vector3(1, 0, 0) },
      { axis: 'X', flip: true,  label: '-X', pullDir: new THREE.Vector3(-1, 0, 0) },
      { axis: 'Y', flip: false, label: '+Y', pullDir: new THREE.Vector3(0, 1, 0) },
      { axis: 'Y', flip: true,  label: '-Y', pullDir: new THREE.Vector3(0, -1, 0) },
      { axis: 'Z', flip: false, label: '+Z', pullDir: new THREE.Vector3(0, 0, 1) },
      { axis: 'Z', flip: true,  label: '-Z', pullDir: new THREE.Vector3(0, 0, -1) }
    ];

    let bestScore = Infinity;
    let bestDirLabel = '';
    let directionScores = {};

    // 병렬 가속 연산 (Promise.all)
    const runEvalTasks = evalDirections.map(async (d) => {
      let minV, maxV;
      if (d.axis === 'X') { minV = minX; maxV = maxX; }
      else if (d.axis === 'Y') { minV = minY; maxV = maxY; }
      else { minV = minZ; maxV = maxZ; }
      const pHeight = minV + (maxV - minV) * (_partingHeightPct / 100);

      // 6개 방향 각각에 대해 언더컷 판독 시뮬레이션
      const { isUndercutMap: evalMap, slideDirections: evalSlidesMap } = await getPhysicalUndercuts(pos, normals, pHeight, d.axis, d.flip);

      let uCount = 0;
      let uArea = 0;
      let okDraftCount = 0;
      const sClusters = {};
      const lClusters = {};

      const vA = new THREE.Vector3();
      const vB = new THREE.Vector3();
      const vC = new THREE.Vector3();
      const edge1 = new THREE.Vector3();
      const edge2 = new THREE.Vector3();
      const cross = new THREE.Vector3();

      // Bounding Box on the projection plane perpendicular to d.pullDir to find Projected Area
      let projMinU = Infinity, projMaxU = -Infinity;
      let projMinV = Infinity, projMaxV = -Infinity;
      let pAxisU, pAxisV;
      if (d.axis === 'X') { pAxisU = 'y'; pAxisV = 'z'; }
      else if (d.axis === 'Y') { pAxisU = 'x'; pAxisV = 'z'; }
      else { pAxisU = 'x'; pAxisV = 'y'; }

      for (let i = 0; i < pos.length; i += 9) {
        const nx = normals[i], ny = normals[i+1], nz = normals[i+2];
        const vx = pos[i], vy = pos[i+1], vz = pos[i+2];
        const triIdx = Math.floor(i / 9);

        // Projected area bounding box accumulation
        const pu = pos[i];
        const pv = pos[i + (pAxisV === 'y' ? 1 : 2)];
        if (pu < projMinU) projMinU = pu;
        if (pu > projMaxU) projMaxU = pu;
        if (pv < projMinV) projMinV = pv;
        if (pv > projMaxV) projMaxV = pv;

        // Draft Angle Quality Calculation
        const nVec = new THREE.Vector3(nx, ny, nz);
        const dotVal = nVec.dot(d.pullDir);
        if (Math.abs(dotVal) >= sin1) {
          okDraftCount++;
        }
        
        if (evalMap[triIdx] === 1) {
          uCount++;
          // 정밀 면적 산출
          const pIdx = triIdx * 9;
          vA.set(pos[pIdx],     pos[pIdx+1], pos[pIdx+2]);
          vB.set(pos[pIdx+3],   pos[pIdx+4], pos[pIdx+5]);
          vC.set(pos[pIdx+6],   pos[pIdx+7], pos[pIdx+8]);
          edge1.subVectors(vB, vA);
          edge2.subVectors(vC, vA);
          cross.crossVectors(edge1, edge2);
          uArea += cross.length() * 0.5;

          const exitDir = evalSlidesMap[triIdx];
          let pDir = '';
          if (d.axis === 'X') { pDir = Math.abs(ny) > Math.abs(nz) ? (ny > 0 ? '+Y':'-Y') : (nz > 0 ? '+Z':'-Z'); }
          else if (d.axis === 'Y') { pDir = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? '+X':'-X') : (nz > 0 ? '+Z':'-Z'); }
          else { pDir = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? '+X':'-X') : (ny > 0 ? '+Y':'-Y'); }

          if (exitDir !== null) {
            if (!sClusters[exitDir]) sClusters[exitDir] = [];
            sClusters[exitDir].push(vx, vy, vz);
          } else {
            if (!lClusters[pDir]) lClusters[pDir] = [];
            lClusters[pDir].push(vx, vy, vz);
          }
        }
      }

      const evalSlidesList = processCoreClusters(sClusters, cSize, avgDim, true);
      const evalLiftersList = processCoreClusters(lClusters, cSize, avgDim, false);

      const sCount = evalSlidesList.length;
      const lCount = evalLiftersList.length;

      // Draft Quality (양호 구배각 면적 비율 0~100)
      const draftQualityPct = triCount > 0 ? (okDraftCount / triCount) * 100 : 100;

      // Projected Area (투영 단면적 in mm2)
      const projArea = (projMaxU - projMinU) * (projMaxV - projMinV);

      // Tool Complexity Score 계산식:
      // (UndercutArea * 1) + (SlideCount * 50) + (LifterCount * 80) + ((100 - DraftQuality) * 2)
      const dScore = (uArea * 1.0) + (sCount * 50.0) + (lCount * 80.0) + ((100.0 - draftQualityPct) * 2.0);

      return {
        label: d.label,
        score: dScore,
        undercutCount: uCount,
        undercutArea: uArea,
        slideCount: sCount,
        lifterCount: lCount,
        projectedArea: projArea,
        draftQuality: draftQualityPct
      };
    });

    const evaluatedResults = await Promise.all(runEvalTasks);
    
    evaluatedResults.forEach(res => {
      directionScores[res.label] = res;
      if (res.score < bestScore) {
        bestScore = res.score;
        bestDirLabel = res.label;
      }
    });

    // 신뢰도(Confidence Score) 산정: 
    // 최고 점수와 최저 점수의 분포 격차를 활용하여 백분율 계산 (모든 방향이 최선이면 100)
    let maxEvalScore = -Infinity;
    for (const k in directionScores) {
      if (directionScores[k].score > maxEvalScore) maxEvalScore = directionScores[k].score;
    }
    const scoreDiff = maxEvalScore - bestScore;
    const confidence = scoreDiff === 0 ? 100 : Math.min(100, Math.round((scoreDiff / (maxEvalScore + 1)) * 100));

    // 복잡도 단계 산출
    let compLevel = '낮음 🟢';
    if (bestScore > 150) compLevel = '매우 높음 🔴';
    else if (bestScore > 80) compLevel = '높음 🟡';
    else if (bestScore > 30) compLevel = '보통 🔵';

    const recommendation = {
      bestDirection: bestDirLabel,
      confidence: confidence,
      complexityScore: Math.round(bestScore),
      complexityLevel: compLevel,
      scoresMap: directionScores
    };

    // Defect Predictions
    return {
      issues, score, moldFeatures, diagnostics, recommendation,
      defects: { sink: sinkRes, shrinkage: shrinkRes, warpage: warpRes },
      stats: { undercutPct, marginalPct, okPct, triCount, material: mat.name, shrinkRisk, isSimulated: stlData.isSimulated, metadata: stlData.metadata }
    };
  }


  function setFlipAxis(flip) {
    _flipAxis = flip;
    setPullAxis(_pullAxis);
  }

  function updateGimbalHighlight() {
    if (!_gimbalWidget) return;
    _gimbalWidget.traverse(child => {
      if (child.isMesh || child.isSprite) {
        const isSelected = child.name === `gimbal_${_pullAxis}`;
        if (child.isMesh) {
          if (child.material) {
            child.material.transparent = true;
            if (isSelected) {
              child.material.opacity = 1.0;
              if (child.geometry.type === 'CylinderGeometry') {
                child.scale.set(2.0, 1.0, 2.0);
              } else if (child.geometry.type === 'ConeGeometry') {
                child.scale.set(1.6, 1.6, 1.6);
              }
            } else {
              child.material.opacity = 0.25;
              child.scale.set(1.0, 1.0, 1.0);
            }
            child.material.needsUpdate = true;
          }
        } else if (child.isSprite) {
          if (child.material) {
            if (isSelected) {
              child.material.opacity = 1.0;
              child.scale.set(8, 8, 1);
            } else {
              child.material.opacity = 0.25;
              child.scale.set(5, 5, 1);
            }
            child.material.needsUpdate = true;
          }
        }
      }
    });
  }

  function setPullAxis(axis) {
    _pullAxis = axis;
    if (!_mesh || !_geometry) return;

    if (!_mesh.targetQuaternion) {
      _mesh.targetQuaternion = new THREE.Quaternion();
    }

    const autoRotateChk = document.getElementById('chk-auto-rotate');
    const autoRotate = autoRotateChk ? autoRotateChk.checked : true;

    if (autoRotate) {
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
    } else {
      _mesh.targetQuaternion.set(0, 0, 0, 1);
    }

    updateGimbalHighlight();
    updatePullArrow();
  }

  function updatePullArrow() {
    if (!_mesh || !_geometry) return;
    
    _geometry.computeBoundingBox();
    const box = _geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    const radius = size.length();
    
    if (!_pullArrow) {
      const dir = new THREE.Vector3(0, 1, 0);
      const origin = new THREE.Vector3(0, 0, 0);
      const length = radius * 0.4;
      const hex = 0x00d4ff;
      _pullArrow = new THREE.ArrowHelper(dir, origin, length, hex, radius * 0.08, radius * 0.04);
      _scene.add(_pullArrow);
    }
    
    const dir = new THREE.Vector3();
    if (_pullAxis === 'X') {
      dir.set(1, 0, 0);
    } else if (_pullAxis === 'Y') {
      dir.set(0, 1, 0);
    } else {
      dir.set(0, 0, 1);
    }
    if (_flipAxis) {
      dir.negate();
    }
    
    const autoRotateChk = document.getElementById('chk-auto-rotate');
    const autoRotate = autoRotateChk ? autoRotateChk.checked : true;
    
    if (autoRotate) {
      _pullArrow.setDirection(new THREE.Vector3(0, 1, 0));
      _pullArrow.position.set(0, size.y * 0.5 + radius * 0.15, 0);
    } else {
      _pullArrow.setDirection(dir);
      const pos = dir.clone().multiplyScalar(radius * 0.55);
      _pullArrow.position.copy(pos);
    }
  }

  function recolorGeometry() {
    if (!_geometry || !_mesh) return;
    const positions = _geometry.attributes.position.array;
    const normals   = _geometry.attributes.normal.array;
    let colors;
    if (_shrinkageOverlayActive) {
      colors = computeShrinkagePredictColors(positions, normals);
    } else if (_sinkOverlayActive) {
      colors = computeSinkColors(positions, normals);
    } else if (_warpOverlayActive) {
      colors = computeWarpageColors(positions, normals);
    } else if (_flowOverlayActive && _flowDistances) {
      colors = computeFlowColors(positions, _flowDistances, _maxFlowDistance, _flowAnimationTime);
    } else if (_coolingOverlayActive && _vertexTemperatures) {
      colors = computeCoolingColors(positions, _vertexTemperatures);
    } else {
      colors = computeDraftColors(positions, normals);
    }
    _geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    _geometry.attributes.color.needsUpdate = true;

    // Ensure vertex colors are enabled whenever an overlay is active
    if (!_mesh.material.vertexColors) {
      _mesh.material.vertexColors = true;
      _mesh.material.color = new THREE.Color(0xffffff);
    }
    _mesh.material.needsUpdate = true;

    if (_partingLineObj) {
      updatePartingLine(true);
    }

    updateWarpArrow();
  }


  async function updateCoreHelpers(visible) {
    if (_coreHelpers) {
      if (_mesh) _mesh.remove(_coreHelpers);
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

    // 물리적 간섭(Ray-casting) 기반 진짜 언더컷 맵 도출
    const { isUndercutMap, slideDirections } = await getPhysicalUndercuts(pos, norm, partingH, _pullAxis, _flipAxis);

    const slideClusters = {};
    const lifterClusters = {};

    for (let i = 0; i < pos.length; i += 9) {
      const nx = norm[i], ny = norm[i+1], nz = norm[i+2];
      const vx = pos[i], vy = pos[i+1], vz = pos[i+2];

      const triIdx = Math.floor(i / 9);
      const isPhysicalUndercut = isUndercutMap[triIdx] === 1;

      if (isPhysicalUndercut) {
        const vx_val = pos[i], vy_val = pos[i+1], vz_val = pos[i+2];
        const exitDir = slideDirections[triIdx];
        
        let pDir = '';
        if (_pullAxis === 'X') { pDir = Math.abs(ny) > Math.abs(nz) ? (ny > 0 ? '+Y':'-Y') : (nz > 0 ? '+Z':'-Z'); }
        else if (_pullAxis === 'Y') { pDir = Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? '+X':'-X') : (nz > 0 ? '+Z':'-Z'); }
        else { pDir = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? '+X':'-X') : (ny > 0 ? '+Y':'-Y'); }
        
        if (exitDir !== null) {
          // 수평 탈출 경로가 존재하므로 슬라이드 코어로 판정
          const sDir = exitDir;
          if (!slideClusters[sDir]) slideClusters[sDir] = [];
          slideClusters[sDir].push(vx_val, vy_val, vz_val);
        } else {
          // [개선된 경사 코어 (리프터) 판정 및 시각화 매칭 필터]
          let isCoreSide = false;
          let val = (_pullAxis === 'X') ? vx : ((_pullAxis === 'Y') ? vy : vz);
          
          if (_flipAxis) {
            isCoreSide = (val > partingH);
          } else {
            isCoreSide = (val < partingH);
          }

          if (isCoreSide) {
            const pullDirVec = new THREE.Vector3();
            if (_pullAxis === 'X') pullDirVec.set(1, 0, 0);
            else if (_pullAxis === 'Y') pullDirVec.set(0, 1, 0);
            else pullDirVec.set(0, 0, 1);
            if (_flipAxis) pullDirVec.negate();

            const triCentroid = new THREE.Vector3(
              (pos[triIdx*9] + pos[triIdx*9+3] + pos[triIdx*9+6]) / 3,
              (pos[triIdx*9+1] + pos[triIdx*9+4] + pos[triIdx*9+7]) / 3,
              (pos[triIdx*9+2] + pos[triIdx*9+5] + pos[triIdx*9+8]) / 3
            );
            const triNormal = new THREE.Vector3(nx, ny, nz);

            const testDir = triNormal.clone().negate().normalize();
            const biasOrigin = triCentroid.clone().add(triNormal.clone().multiplyScalar(0.1));
            
            let minDistToOpposite = Infinity;
            for (let t = 0; t < pos.length / 9; t++) {
              if (Math.abs(t * 9 - triIdx * 9) < 9) continue;
              const tv0 = new THREE.Vector3(pos[t*9], pos[t*9+1], pos[t*9+2]);
              const tv1 = new THREE.Vector3(pos[t*9+3], pos[t*9+4], pos[t*9+5]);
              const tv2 = new THREE.Vector3(pos[t*9+6], pos[t*9+7], pos[t*9+8]);
              
              const dist = rayTriangleIntersect(biasOrigin, testDir, tv0, tv1, tv2);
              if (dist !== null && dist < minDistToOpposite) {
                minDistToOpposite = dist;
              }
            }

            const modelSize = new THREE.Vector3();
            box.getSize(modelSize);
            const avgDim = (modelSize.x + modelSize.y + modelSize.z) / 3;

            const undercutDepth = (minDistToOpposite !== Infinity) ? Math.max(1.0, minDistToOpposite * 0.5) : 3.0;
            const theta = 12 * Math.PI / 180;
            const strokeRequired = undercutDepth / Math.tan(theta);

            const isInnerPocket = (minDistToOpposite !== Infinity && minDistToOpposite < (avgDim * 0.5));
            const isStrokeValid = strokeRequired >= 2.0;

            if (isInnerPocket && isStrokeValid) {
              if (!lifterClusters[pDir]) lifterClusters[pDir] = [];
              lifterClusters[pDir].push(vx_val, vy_val, vz_val);
            }
          }
        }
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

      let fMinX=Infinity, fMinY=Infinity, fMinZ=Infinity;
      let fMaxX=-Infinity, fMaxY=-Infinity, fMaxZ=-Infinity;
      for (let j = 0; j < positions.length; j += 3) {
        fMinX = Math.min(fMinX, positions[j]);   fMaxX = Math.max(fMaxX, positions[j]);
        fMinY = Math.min(fMinY, positions[j+1]); fMaxY = Math.max(fMaxY, positions[j+1]);
        fMinZ = Math.min(fMinZ, positions[j+2]); fMaxZ = Math.max(fMaxZ, positions[j+2]);
      }

      const fdx = fMaxX - fMinX;
      const fdy = fMaxY - fMinY;
      const fdz = fMaxZ - fMinZ;

      const fcx = fMinX + fdx / 2;
      const fcy = fMinY + fdy / 2;
      const fcz = fMinZ + fdz / 2;

      const modelSize = new THREE.Vector3();
      box.getSize(modelSize);
      const avgModelDim = (modelSize.x + modelSize.y + modelSize.z) / 3;

      const margin = Math.max(0.5, Math.min(fdx, fdy, fdz) * 0.05);
      const pullDir = getDirVec(dirStr);

      const pullAxisDir = new THREE.Vector3();
      if (_pullAxis === 'X') pullAxisDir.set(_flipAxis ? -1 : 1, 0, 0);
      else if (_pullAxis === 'Y') pullAxisDir.set(0, _flipAxis ? -1 : 1, 0);
      else pullAxisDir.set(0, 0, _flipAxis ? -1 : 1);

      if (isSlide) {
        const headW = fdx + margin;
        const headH = fdy + margin;
        const headD = fdz + margin;

        const headGeo = new THREE.BoxGeometry(headW, headH, headD);
        const headMat = new THREE.MeshPhongMaterial({
          color: color, transparent: true, opacity: 0.35,
          shininess: 90, depthWrite: false
        });
        const headMesh = new THREE.Mesh(headGeo, headMat);
        headMesh.name = `slide_${index}_head`;
        headMesh.position.set(fcx, fcy, fcz);
        headMesh.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(headGeo),
          new THREE.LineBasicMaterial({ color: color, linewidth: 2 })
        ));
        _coreHelpers.add(headMesh);

        const featureAvg = (fdx + fdy + fdz) / 3;
        const bodyLen = Math.max(featureAvg * 1.5, avgModelDim * 0.25);
        const bodyThick = Math.max(headW, headH, headD) * 0.5;
        const bodyWidth = bodyThick * 0.8;
        const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyThick, bodyLen);
        bodyGeo.translate(0, 0, bodyLen / 2);

        const bodyMat = new THREE.MeshPhongMaterial({
          color: 0x334455, transparent: true, opacity: 0.7, shininess: 50
        });
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.name = `slide_${index}_body`;
        bodyMesh.position.copy(headMesh.position);

        bodyMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pullDir.clone().normalize());
        _coreHelpers.add(bodyMesh);

        const arrowLen = bodyLen * 0.7;
        const arrowStart = headMesh.position.clone();
        const arrow = new THREE.ArrowHelper(
          pullDir.clone().normalize(), arrowStart,
          arrowLen, color, featureAvg * 0.2, featureAvg * 0.1
        );
        _coreHelpers.add(arrow);

        const label = createTextSprite(`슬라이드 #${index}`, color, avgModelDim * 0.1);
        const labelUp = pullAxisDir.clone().multiplyScalar(Math.max(headH, headW, headD) * 0.8);
        label.position.copy(headMesh.position).add(labelUp);
        _coreHelpers.add(label);

      } else {
        const headW = fdx + margin;
        const headH = fdy + margin;
        const headD = fdz + margin;

        const coreGeo = new THREE.BoxGeometry(headW, headH, headD);
        const coreMat = new THREE.MeshPhongMaterial({
          color: color, transparent: true, opacity: 0.35,
          shininess: 90, depthWrite: false
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);
        coreMesh.name = `lifter_${index}_head`;
        coreMesh.position.set(fcx, fcy, fcz);
        coreMesh.add(new THREE.LineSegments(
          new THREE.EdgesGeometry(coreGeo),
          new THREE.LineBasicMaterial({ color: color, linewidth: 2 })
        ));
        _coreHelpers.add(coreMesh);

        const moldBaseDir = pullAxisDir.clone().negate();
        const lateralOffset = new THREE.Vector3(fcx, fcy, fcz).sub(center);
        if (_pullAxis === 'X') lateralOffset.x = 0;
        else if (_pullAxis === 'Y') lateralOffset.y = 0;
        else lateralOffset.z = 0;

        if (lateralOffset.length() > 0.001) {
          lateralOffset.normalize().multiplyScalar(0.22);
        }

        const slantDir = moldBaseDir.clone().add(lateralOffset).normalize();

        let distToBase;
        if (_pullAxis === 'X') distToBase = Math.abs(fcx - (_flipAxis ? box.max.x : box.min.x));
        else if (_pullAxis === 'Y') distToBase = Math.abs(fcy - (_flipAxis ? box.max.y : box.min.y));
        else distToBase = Math.abs(fcz - (_flipAxis ? box.max.z : box.min.z));

        const rodLength = Math.max(distToBase + avgModelDim * 0.15, avgModelDim * 0.4);
        const rodThick = Math.max(headW, headD) * 0.5;

        const rodGeo = new THREE.BoxGeometry(rodThick, rodLength, rodThick);
        rodGeo.translate(0, -rodLength / 2, 0);
        const rodMat = new THREE.MeshStandardMaterial({
          color: 0x99aacc, metalness: 0.7, roughness: 0.3
        });
        const rodMesh = new THREE.Mesh(rodGeo, rodMat);
        rodMesh.name = `lifter_${index}_rod`;
        rodMesh.position.copy(coreMesh.position);

        rodMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), slantDir);
        _coreHelpers.add(rodMesh);

        const ejectDir = slantDir.clone().negate();
        const arrowLen = rodLength * 0.45;
        const featureAvg = (fdx + fdy + fdz) / 3;
        const arrow = new THREE.ArrowHelper(
          ejectDir, coreMesh.position.clone(),
          arrowLen, color, featureAvg * 0.2, featureAvg * 0.1
        );
        _coreHelpers.add(arrow);

        // Label
        const label = createTextSprite(`변형코어 #${index}`, color, avgModelDim * 0.1);
        const labelUp = pullAxisDir.clone().multiplyScalar(Math.max(headH, headW, headD) * 0.8);
        label.position.copy(coreMesh.position).add(labelUp);
        _coreHelpers.add(label);
      }
    }

    const size = new THREE.Vector3();
    box.getSize(size);
    const avgDim = (size.x + size.y + size.z) / 3;
    const cSize = Math.max(5.0, Math.min(avgDim * 0.12, 25.0));

    const finalSlides = processCoreClusters(slideClusters, cSize, avgDim, true);
    const finalLifters = processCoreClusters(lifterClusters, cSize, avgDim, false);

    let sIdx = 1;
    finalSlides.forEach(feat => {
      drawCoreMechanicalUnit(feat.points, 0x00d4ff, feat.dir, true, sIdx++);
    });
    
    let lIdx = 1;
    finalLifters.forEach(feat => {
      drawCoreMechanicalUnit(feat.points, 0xff8800, feat.dir, false, lIdx++);
    });

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

    const createAxisCylinder = (dir, color, name) => {
      const geom = new THREE.CylinderGeometry(0.5, 0.5, size, 8);
      geom.translate(0, size / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color: color });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = name;
      
      const up = new THREE.Vector3(0, 1, 0);
      mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      return mesh;
    };

    const xDir = new THREE.Vector3(1, 0, 0);
    const yDir = new THREE.Vector3(0, 1, 0);
    const zDir = new THREE.Vector3(0, 0, 1);

    const xAxis = createAxisCylinder(xDir, 0xff3333, 'gimbal_X');
    const yAxis = createAxisCylinder(yDir, 0x33ff33, 'gimbal_Y');
    const zAxis = createAxisCylinder(zDir, 0x3333ff, 'gimbal_Z');

    group.add(xAxis);
    group.add(yAxis);
    group.add(zAxis);

    const createArrowHead = (dir, color, pos, name) => {
      const geom = new THREE.ConeGeometry(1.2, 4, 8);
      geom.translate(0, 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color: color });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      mesh.name = name;
      const up = new THREE.Vector3(0, 1, 0);
      mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      return mesh;
    };

    group.add(createArrowHead(xDir, 0xff3333, new THREE.Vector3(size, 0, 0), 'gimbal_X'));
    group.add(createArrowHead(yDir, 0x33ff33, new THREE.Vector3(0, size, 0), 'gimbal_Y'));
    group.add(createArrowHead(zDir, 0x3333ff, new THREE.Vector3(0, 0, size), 'gimbal_Z'));

    const xLabel = createTextSprite('X', '#ff3333', 5, false);
    xLabel.position.set(size + 4, 0, 0);
    xLabel.name = 'gimbal_X';
    const yLabel = createTextSprite('Y', '#33ff33', 5, false);
    yLabel.position.set(0, size + 4, 0);
    yLabel.name = 'gimbal_Y';
    const zLabel = createTextSprite('Z', '#3333ff', 5, false);
    zLabel.position.set(0, 0, size + 4);
    zLabel.name = 'gimbal_Z';

    group.add(xLabel);
    group.add(yLabel);
    group.add(zLabel);

    return group;
  }

  // 모드 상태를 보관하기 위한 전역 변수
  let _partingMode = 'manual';

  function updatePartingLine(visible, heightPct, mode) {
    if (_partingLineObj) {
      _mesh.remove(_partingLineObj);
      _partingLineObj = null;
    }

    if (!visible || !_geometry || !_mesh) return;

    if (heightPct !== undefined) {
      _partingHeightPct = heightPct;
    }
    if (mode !== undefined) {
      _partingMode = mode;
    }

    const pos = _geometry.attributes.position.array;
    const norm = _geometry.attributes.normal.array;
    const triCount = pos.length / 9;

    _geometry.computeBoundingBox();
    const geoBox = _geometry.boundingBox;
    const geoCenter = new THREE.Vector3();
    geoBox.getCenter(geoCenter);
    const geoSize = new THREE.Vector3();
    geoBox.getSize(geoSize);

    const partingPoints = [];
    const partingDists = [];

    const pullDir = new THREE.Vector3();
    if (_pullAxis === 'X') pullDir.set(1, 0, 0);
    else if (_pullAxis === 'Y') pullDir.set(0, 1, 0);
    else pullDir.set(0, 0, 1);
    if (_flipAxis) pullDir.negate();

    if (_partingMode === 'auto') {
      // [Auto Parting Line: 드래프트 부호 부호 반전 모서리 추출]
      // 1단계: 각 삼각형의 드래프트 방향 부호 구함 (양수: Cavity, 음수: Core)
      const dotVals = new Float32Array(triCount);
      for (let t = 0; t < triCount; t++) {
        const nx = norm[t*9], ny = norm[t*9+1], nz = norm[t*9+2];
        const nVec = new THREE.Vector3(nx, ny, nz);
        dotVals[t] = nVec.dot(pullDir);
      }

      // 2단계: 공유 에지 맵 빌드하여 구배 양음 반전 에지 추출
      const edgeMap = {};
      const getEdgeKey = (pA, pB) => {
        const coords = [
          Math.round(pA.x * 100) / 100, Math.round(pA.y * 100) / 100, Math.round(pA.z * 100) / 100,
          Math.round(pB.x * 100) / 100, Math.round(pB.y * 100) / 100, Math.round(pB.z * 100) / 100
        ];
        // 정렬하여 에지 방향 독립적인 고유 키 형성
        const pts = [coords.slice(0, 3), coords.slice(3, 6)];
        pts.sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : (a[1] !== b[1] ? a[1] - b[1] : a[2] - b[2]));
        return `${pts[0][0]},${pts[0][1]},${pts[0][2]}_${pts[1][0]},${pts[1][1]},${pts[1][2]}`;
      };

      for (let t = 0; t < triCount; t++) {
        const idx = t * 9;
        const v0 = new THREE.Vector3(pos[idx], pos[idx+1], pos[idx+2]);
        const v1 = new THREE.Vector3(pos[idx+3], pos[idx+4], pos[idx+5]);
        const v2 = new THREE.Vector3(pos[idx+6], pos[idx+7], pos[idx+8]);

        const edges = [
          { pA: v0, pB: v1 },
          { pA: v1, pB: v2 },
          { pA: v2, pB: v0 }
        ];

        edges.forEach(e => {
          const key = getEdgeKey(e.pA, e.pB);
          if (!edgeMap[key]) {
            edgeMap[key] = { pA: e.pA, pB: e.pB, triIndices: [] };
          }
          edgeMap[key].triIndices.push(t);
        });
      }

      // 3단계: 공유하는 두 삼각형의 구배 부호가 반전되는 경계 에지만 선별하여 파팅라인 구성
      for (const key in edgeMap) {
        const edge = edgeMap[key];
        if (edge.triIndices.length === 2) {
          const tA = edge.triIndices[0];
          const tB = edge.triIndices[1];
          const sA = Math.sign(dotVals[tA]);
          const sB = Math.sign(dotVals[tB]);
          
          // 구배 각도가 양수(Cavity)와 음수(Core)로 나뉘는 공유 모서리 에지
          if ((sA > 0 && sB < 0) || (sA < 0 && sB > 0) || sA === 0 || sB === 0) {
            partingPoints.push(edge.pA.x, edge.pA.y, edge.pA.z);
            partingPoints.push(edge.pB.x, edge.pB.y, edge.pB.z);
            partingDists.push(undefined, undefined);
          }
        }
      }
    } else {
      // [수동 평면 투영 절단선 파팅라인 계산]
      let minVal, maxVal;
      if (_pullAxis === 'X') {
        minVal = geoBox.min.x; maxVal = geoBox.max.x;
      } else if (_pullAxis === 'Y') {
        minVal = geoBox.min.y; maxVal = geoBox.max.y;
      } else {
        minVal = geoBox.min.z; maxVal = geoBox.max.z;
      }
      const H = minVal + (maxVal - minVal) * (_partingHeightPct / 100);

      const getVal = (v) => {
        if (_pullAxis === 'X') return v.x;
        if (_pullAxis === 'Y') return v.y;
        return v.z;
      };

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

        const uniquePts = [];
        const EPSILON = 0.0001;
        pts.forEach(item => {
          if (!uniquePts.some(up => up.p.distanceTo(item.p) < EPSILON)) {
            uniquePts.push(item);
          }
        });

        if (uniquePts.length === 2) {
          partingPoints.push(uniquePts[0].p.x, uniquePts[0].p.y, uniquePts[0].p.z);
          partingPoints.push(uniquePts[1].p.x, uniquePts[1].p.y, uniquePts[1].p.z);
          partingDists.push(uniquePts[0].dVal, uniquePts[1].dVal);
        } else if (uniquePts.length > 2) {
          uniquePts.sort((a, b) => {
            if (_pullAxis === 'X') return a.p.y !== b.p.y ? a.p.y - b.p.y : a.p.z - b.p.z;
            if (_pullAxis === 'Y') return a.p.x !== b.p.x ? a.p.x - b.p.x : a.p.z - b.p.z;
            return a.p.x !== b.p.x ? a.p.x - b.p.x : a.p.y - b.p.y;
          });
          partingPoints.push(uniquePts[0].p.x, uniquePts[0].p.y, uniquePts[0].p.z);
          partingPoints.push(uniquePts[uniquePts.length - 1].p.x, uniquePts[uniquePts.length - 1].p.y, uniquePts[uniquePts.length - 1].p.z);
          partingDists.push(uniquePts[0].dVal, uniquePts[uniquePts.length - 1].dVal);
        }
      }
    }

    _partingLineObj = new THREE.Group();

    if (partingPoints.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(partingPoints), 3));
      
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
              r = 1.0; g = 1.0; b = 0.9;
            } else if (age < frontWidth * 3) {
              r = 1.0; g = 0.7; b = 0.0;
            } else {
              r = 0.05; g = 0.35; b = 0.55; 
            }
          } else {
            r = 0.03; g = 0.05; b = 0.12;
          }
        }
        lineColors[j*3] = r;
        lineColors[j*3+1] = g;
        lineColors[j*3+2] = b;
      }
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

      // 3D 자동 파팅선일 때 파란색 계열, 평면일 때 밝은 청록색 계열로 구분 시각화
      const coreColor = _partingMode === 'auto' ? 0x0055ff : 0x00ffff;

      const lineMat1 = new THREE.LineBasicMaterial({ 
        vertexColors: _partingMode === 'manual' && _flowOverlayActive, 
        color: (_partingMode === 'auto' || !_flowOverlayActive) ? coreColor : undefined,
        linewidth: 4, 
        transparent: true, 
        opacity: 0.95 
      });
      const lineMesh1 = new THREE.LineSegments(lineGeo.clone(), lineMat1);
      _partingLineObj.add(lineMesh1);
      
      const lineMat2 = new THREE.LineBasicMaterial({ 
        vertexColors: _partingMode === 'manual' && _flowOverlayActive, 
        color: (_partingMode === 'auto' || !_flowOverlayActive) ? coreColor : undefined,
        linewidth: 8, 
        transparent: true, 
        opacity: 0.35, 
        depthWrite: false 
      });
      const lineMesh2 = new THREE.LineSegments(lineGeo.clone(), lineMat2);
      _partingLineObj.add(lineMesh2);
    }

    // [수동 평면 모드일 때만 반투명 절단 평면 렌더링]
    if (_partingMode === 'manual') {
      const planeSize = Math.max(geoSize.x, geoSize.y, geoSize.z) * 1.3;
      const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
      const planeMat = new THREE.MeshPhongMaterial({ color: 0x00ffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
      const planeMesh = new THREE.Mesh(planeGeo, planeMat);
      
      let minVal;
      if (_pullAxis === 'X') {
        minVal = geoBox.min.x;
        planeMesh.rotation.y = Math.PI / 2;
        planeMesh.position.set(minVal + (geoBox.max.x - minVal) * (_partingHeightPct / 100), geoCenter.y, geoCenter.z);
      } else if (_pullAxis === 'Y') {
        minVal = geoBox.min.y;
        planeMesh.rotation.x = Math.PI / 2;
        planeMesh.position.set(geoCenter.x, minVal + (geoBox.max.y - minVal) * (_partingHeightPct / 100), geoCenter.z);
      } else {
        minVal = geoBox.min.z;
        planeMesh.position.set(geoCenter.x, geoCenter.y, minVal + (geoBox.max.z - minVal) * (_partingHeightPct / 100));
      }
      _partingLineObj.add(planeMesh);
    }
    
    // Label positioned outside the model for visibility
    const labelTitle = _partingMode === 'auto' ? '3D 자동 파팅라인' : '파팅 라인 평면';
    const labelColor = _partingMode === 'auto' ? '#0055ff' : '#00ffff';
    const label = createTextSprite(labelTitle, labelColor);
    const labelOffset = Math.max(geoSize.x, geoSize.y, geoSize.z) * 0.55;
    
    let H_val = geoCenter.z;
    if (_partingMode === 'manual') {
      let minVal, maxVal;
      if (_pullAxis === 'X') { minVal = geoBox.min.x; maxVal = geoBox.max.x; }
      else if (_pullAxis === 'Y') { minVal = geoBox.min.y; maxVal = geoBox.max.y; }
      else { minVal = geoBox.min.z; maxVal = geoBox.max.z; }
      H_val = minVal + (maxVal - minVal) * (_partingHeightPct / 100);
    }

    if (_pullAxis === 'X') {
      label.position.set(H_val, geoCenter.y + labelOffset, geoCenter.z);
    } else if (_pullAxis === 'Y') {
      label.position.set(geoCenter.x + labelOffset, H_val, geoCenter.z);
    } else {
      label.position.set(geoCenter.x, geoCenter.y + labelOffset, H_val);
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
    _defectMarkers.forEach(m => {
      if (m.parent) {
        m.parent.remove(m);
      } else {
        _scene.remove(m);
      }
    });
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
    geom.translate(0, -coneHeight / 2, 0);
    const mat = new THREE.MeshPhongMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.4), shininess: 100 });
    const marker = new THREE.Mesh(geom, mat);
    marker.position.copy(localPoint);

    if (localNormal) {
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localNormal.clone().negate().normalize());
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
    label.position.set(0, -coneHeight * 1.6, 0);
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
        graph[vk] = { x, y, z, neighbors: new Set(), cell: getKey(x, y, z), vertIdx: i / 3 };
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
    const parents = {};
    for (const key in graph) {
      distances[key] = Infinity;
      parents[key] = null;
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
        const geomDist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        let resistance = 1.0;
        if (_vertexThickness) {
          const tNode = _vertexThickness[node.vertIdx] || 2.0;
          const tNeigh = _vertexThickness[neighNode.vertIdx] || 2.0;
          const avgThickness = Math.max(0.2, (tNode + tNeigh) / 2);
          
          const mat = MATERIAL_DB[_material] || MATERIAL_DB.ABS;
          const tempDiff = mat.Tm - _meltTemp;
          const viscRatio = Math.exp(6.0 * (tempDiff / mat.Tm));
          
          resistance = Math.pow(2.0 / avgThickness, 1.5) * Math.sqrt(viscRatio);
          resistance = Math.max(0.1, Math.min(100.0, resistance));
        }
        
        const newDist = currDist + geomDist * resistance;
        
        if (neighKey in distances && newDist < distances[neighKey]) {
          distances[neighKey] = newDist;
          parents[neighKey] = currKey;
          heap.push(neighKey);
        }
      });
    }
    return { distances, parents };
  }

  function computeWeldLineSegments(graph, gateDistancesList, positions, normals, weldDetails = []) {
    const segments = [];
    if (gateDistancesList.length < 2) return segments;

    const getVertKey = (x, y, z) => `${Math.round(x*1000)/1000},${Math.round(y*1000)/1000},${Math.round(z*1000)/1000}`;
    const offsetVal = 0.5;

    const getFlowDirection = (nodeKey, gateIdx) => {
      const parents = gateDistancesList[gateIdx].parents;
      const node = graph[nodeKey];
      if (!node) return new THREE.Vector3();
      
      const pKey = parents[nodeKey];
      if (pKey && graph[pKey]) {
        const parentNode = graph[pKey];
        return new THREE.Vector3(node.x - parentNode.x, node.y - parentNode.y, node.z - parentNode.z).normalize();
      }
      const gatePos = _gatePositions[gateIdx];
      if (gatePos) {
        return new THREE.Vector3(node.x - gatePos.x, node.y - gatePos.y, node.z - gatePos.z).normalize();
      }
      return new THREE.Vector3();
    };

    for (let i = 0; i < positions.length; i += 9) {
      const pA = new THREE.Vector3(positions[i],   positions[i+1], positions[i+2]);
      const pB = new THREE.Vector3(positions[i+3], positions[i+4], positions[i+5]);
      const pC = new THREE.Vector3(positions[i+6], positions[i+7], positions[i+8]);

      const nA = new THREE.Vector3(normals[i],   normals[i+1], normals[i+2]);
      const nB = new THREE.Vector3(normals[i+3], normals[i+4], normals[i+5]);
      const nC = new THREE.Vector3(normals[i+6], normals[i+7], normals[i+8]);

      const kA = getVertKey(pA.x, pA.y, pA.z);
      const kB = getVertKey(pB.x, pB.y, pB.z);
      const kC = getVertKey(pC.x, pC.y, pC.z);

      let gA = -1, dA = Infinity;
      let gB = -1, dB = Infinity;
      let gC = -1, dC = Infinity;

      for (let g = 0; g < gateDistancesList.length; g++) {
        const dists = gateDistancesList[g].arrivals;
        const distA = dists[kA] !== undefined ? dists[kA] : Infinity;
        const distB = dists[kB] !== undefined ? dists[kB] : Infinity;
        const distC = dists[kC] !== undefined ? dists[kC] : Infinity;

        if (distA < dA) { dA = distA; gA = g; }
        if (distB < dB) { dB = distB; gB = g; }
        if (distC < dC) { dC = distC; gC = g; }
      }

      if (dA === Infinity || dB === Infinity || dC === Infinity) continue;
      if (gA === gB && gB === gC) continue;

      const getCrossingPoint = (pU, pV, nU, nV, kU, kV, gU, gV) => {
        const distsU = gateDistancesList[gU].arrivals;
        const distsV = gateDistancesList[gV].arrivals;

        const dU_gU = distsU[kU] || 0;
        const dU_gV = distsV[kU] || 0;
        const dV_gU = distsU[kV] || 0;
        const dV_gV = distsV[kV] || 0;

        const valU = dU_gU - dU_gV;
        const valV = dV_gU - dV_gV;

        const denom = valV - valU;
        if (Math.abs(denom) < 0.0001) return null;

        const t = Math.max(0, Math.min(1, -valU / denom));
        const p = new THREE.Vector3().lerpVectors(pU, pV, t);
        const n = new THREE.Vector3().lerpVectors(nU, nV, t).normalize();
        p.add(n.multiplyScalar(offsetVal));
        return p;
      };

      const crossings = [];
      if (gA !== gB) {
        const p = getCrossingPoint(pA, pB, nA, nB, kA, kB, gA, gB);
        if (p) crossings.push(p);
      }
      if (gB !== gC) {
        const p = getCrossingPoint(pB, pC, nB, nC, kB, kC, gB, gC);
        if (p) crossings.push(p);
      }
      if (gC !== gA) {
        const p = getCrossingPoint(pC, pA, nC, nA, kC, kA, gC, gA);
        if (p) crossings.push(p);
      }

      if (crossings.length >= 2) {
        segments.push(crossings[0], crossings[1]);

        const uniqueGates = Array.from(new Set([gA, gB, gC].filter(g => g !== -1)));
        let angle = 180;
        if (uniqueGates.length >= 2) {
          const dir0 = getFlowDirection(kA, uniqueGates[0]);
          const dir1 = getFlowDirection(kB, uniqueGates[1]);
          if (dir0.lengthSq() > 0.1 && dir1.lengthSq() > 0.1) {
            const dot = Math.max(-1.0, Math.min(1.0, dir0.dot(dir1)));
            angle = Math.acos(dot) * (180 / Math.PI);
          }
        }

        let severity = 'LOW';
        if (angle >= 135) severity = 'HIGH';
        else if (angle >= 75) severity = 'MEDIUM';

        weldDetails.push({
          start: crossings[0].clone(),
          end: crossings[1].clone(),
          angle: angle,
          severity: severity,
          length: crossings[0].distanceTo(crossings[1])
        });
      }
    }
    return segments;
  }

  function _getDiagnostics(minDim, maxDim, totalArea, matKey, mat) {
    if (!mat) mat = MATERIAL_DB[matKey] || MATERIAL_DB.ABS;
    const meltMin = mat.TmMin;
    const meltMax = mat.TmMax;
    const moldMin = mat.TwMin;
    const moldMax = mat.TwMax;

    let meltStatus = 'ok';
    if (_meltTemp < meltMin || _meltTemp > meltMax) {
      meltStatus = 'warning';
    }
    let moldStatus = 'ok';
    if (_moldTemp < moldMin || _moldTemp > moldMax) {
      moldStatus = 'warning';
    }

    const tempDiff = mat.Tm - _meltTemp;
    const viscRatio = Math.exp(6.0 * (tempDiff / mat.Tm));

    const flowLength = (_gatePositions.length > 0 && _maxFlowDistance > 0) ? _maxFlowDistance : (maxDim * 0.7);
    const tNom = Math.max(0.8, Math.min(8.0, minDim));

    let deltaPMultiplier = 1.0;
    let coolingTimeMultiplier = 1.0;
    let gateRatio = 0.6;
    let minGate = 0.8;
    let maxGate = 2.5;

    if (_runnerType === 'cold') {
      deltaPMultiplier = 1.25;
      coolingTimeMultiplier = 1.30;
      gateRatio = 0.6;
      minGate = 0.8;
      maxGate = 2.5;
    } else if (_runnerType === 'hot') {
      deltaPMultiplier = 1.0;
      coolingTimeMultiplier = 1.0;
      gateRatio = 0.4;
      minGate = 0.6;
      maxGate = 1.6;
    }

    let deltaP = 0.065 * viscRatio * (_flowRate / 50.0) * Math.pow(flowLength / tNom, 1.7) * deltaPMultiplier;
    deltaP = Math.max(5.0, Math.min(150.0, deltaP));

    let wX = maxDim, wY = minDim;
    if (_geometry) {
      _geometry.computeBoundingBox();
      const size = new THREE.Vector3();
      _geometry.boundingBox.getSize(size);
      if (_pullAxis === 'X') { wX = size.y; wY = size.z; }
      else if (_pullAxis === 'Y') { wX = size.x; wY = size.z; }
      else { wX = size.x; wY = size.y; }
    }
    const projArea = (wX * wY) * 0.01; 
    const avgCavityPressure = deltaP * 0.35; 
    let clampForce = projArea * avgCavityPressure * 0.10197 * 1.15;
    clampForce = Math.max(1.0, clampForce);

    const nominalThickness = Math.min(6.0, Math.max(1.0, minDim));
    const coolingTime = calculateCoolingTime(nominalThickness, matKey) * coolingTimeMultiplier;

    const suggestedGates = [];
    if (_gatePositions.length > 0 && _adjacencyGraph && _vertexThickness) {
      _gatePositions.forEach((gp, idx) => {
        const nodeKey = findClosestGraphNode(gp, _adjacencyGraph);
        if (nodeKey && _adjacencyGraph[nodeKey]) {
          const tLocal = _vertexThickness[_adjacencyGraph[nodeKey].vertIdx] || minDim;
          const dGate = Math.max(minGate, Math.min(maxGate, tLocal * gateRatio));
          suggestedGates.push({ index: idx, diameter: dGate });
        } else {
          suggestedGates.push({ index: idx, diameter: minDim * gateRatio });
        }
      });
    } else {
      _gatePositions.forEach((gp, idx) => {
        suggestedGates.push({ index: idx, diameter: minDim * gateRatio });
      });
    }

    const volume = totalArea * tNom * 0.001; 
    const fillingTime = Math.max(0.1, Math.min(10.0, volume / _flowRate));

    return {
      meltTemp: _meltTemp,
      moldTemp: _moldTemp,
      flowRate: _flowRate,
      pressureLimit: _pressureLimit,
      meltTempStatus: meltStatus,
      moldTempStatus: moldStatus,
      optimalMeltRange: [meltMin, meltMax],
      optimalMoldRange: [moldMin, moldMax],
      viscosityRatio: viscRatio,
      estimatedPressureDrop: deltaP,
      clampingForce: clampForce,
      projectedArea: projArea,
      maxCoolingTime: coolingTime,
      suggestedGates: suggestedGates,
      fillingTime: fillingTime
    };
  }

  function setPhysicalParams(meltTemp, moldTemp, flowRate, pressureLimit) {
    if (meltTemp !== undefined) _meltTemp = meltTemp;
    if (moldTemp !== undefined) _moldTemp = moldTemp;
    if (flowRate !== undefined) _flowRate = flowRate;
    if (pressureLimit !== undefined) _pressureLimit = pressureLimit;
  }

  function calculateCoolingTime(thickness, materialKey) {
    const mat = MATERIAL_DB[materialKey] || MATERIAL_DB.ABS;
    const Tm = _meltTemp;
    const Tw = _moldTemp;
    const Te = mat.Te;
    const alpha = mat.alpha; 

    if (thickness <= 0.1) return 0;
    const tempRatio = (4.0 / Math.PI) * ((Tm - Tw) / (Te - Tw));
    if (tempRatio <= 0) return 1.0;
    
    const tc = (Math.pow(thickness, 2) / (Math.PI * Math.PI * alpha)) * Math.log(tempRatio);
    return Math.max(0.5, tc);
  }

  function predictDefects(graph, gateDistancesList) {
    if (!_geometry || !_flowDistances || _gatePositions.length === 0) return [];
    const positions = _geometry.attributes.position.array;
    const normals   = _geometry.attributes.normal.array;
    const defects   = [];

    _geometry.computeBoundingBox();
    const modelCenter = new THREE.Vector3();
    _geometry.boundingBox.getCenter(modelCenter);

    // ── 1. 에어 트랩: 미도달 영역 우선 탐지 ──
    const unreachable = [];
    for (let i = 0; i < positions.length; i += 9) {
      const d = _flowDistances[i / 3];
      if (d === Infinity || d === undefined || d > 999999) {
        unreachable.push({
          pos: new THREE.Vector3(positions[i], positions[i+1], positions[i+2]),
          normal: new THREE.Vector3(normals[i], normals[i+1], normals[i+2])
        });
      }
    }
    const airTrapClusters = [];
    for (const v of unreachable) {
      if (airTrapClusters.every(c => v.pos.distanceTo(c.pos) >= 15)) {
        airTrapClusters.push(v);
        if (airTrapClusters.length >= 5) break;
      }
    }
    airTrapClusters.forEach(v => defects.push({
      type: 'air_trap',
      pos: v.pos,
      normal: v.normal,
      dist: Infinity,
      riskLevel: 'HIGH',
      score: 100
    }));

    // Bounding Box metrics for venting difficulty
    const size = new THREE.Vector3();
    _geometry.boundingBox.getSize(size);
    const minV = _pullAxis === 'X' ? _geometry.boundingBox.min.x : _pullAxis === 'Y' ? _geometry.boundingBox.min.y : _geometry.boundingBox.min.z;
    const maxV = _pullAxis === 'X' ? _geometry.boundingBox.max.x : _pullAxis === 'Y' ? _geometry.boundingBox.max.y : _geometry.boundingBox.max.z;
    const partingH = minV + (maxV - minV) * (_partingHeightPct / 100);
    const axisKey = _pullAxis === 'X' ? 'x' : _pullAxis === 'Y' ? 'y' : 'z';
    const maxDim = Math.max(size.x, size.y, size.z) || 1.0;

    // ── 2. 에어 트랩: 미도달 없으면 오목한 심층 충진 구간 탐지 ──
    if (airTrapClusters.length === 0) {
      const threshold = _maxFlowDistance * 0.72;
      const candidates = [];
      for (let i = 0; i < positions.length; i += 9) {
        const d = _flowDistances[i / 3];
        if (d !== undefined && d !== Infinity && d > threshold) {
          const vPos = new THREE.Vector3(positions[i], positions[i+1], positions[i+2]);
          const nx = normals[i], ny = normals[i+1], nz = normals[i+2];
          const toCenter = modelCenter.clone().sub(vPos).normalize();
          const concavity = toCenter.dot(new THREE.Vector3(nx, ny, nz));
          if (concavity > 0.25) {
            candidates.push({ pos: vPos, normal: new THREE.Vector3(nx, ny, nz), dist: d });
          }
        }
      }
      candidates.sort((a, b) => b.dist - a.dist);
      const distinct = [];
      for (const v of candidates) {
        if (distinct.every(d => v.pos.distanceTo(d.pos) >= 15)) {
          distinct.push(v);
          if (distinct.length >= 6) break;
        }
      }
      distinct.forEach(v => {
        const fillRatio = _maxFlowDistance > 0 ? (v.dist / _maxFlowDistance) : 1.0;
        const distToParting = Math.abs(v.pos[axisKey] - partingH);
        const ventingFactor = distToParting / maxDim;

        // Enclosed space check (local maximum)
        const nodeKey = findClosestGraphNode(v.pos, graph);
        let convergenceCount = 0;
        let neighborCount = 0;
        if (nodeKey && graph[nodeKey]) {
          const nodeTime = _flowDistances[graph[nodeKey].vertIdx];
          graph[nodeKey].neighbors.forEach(neighKey => {
            const neighNode = graph[neighKey];
            if (neighNode) {
              const neighTime = _flowDistances[neighNode.vertIdx];
              if (neighTime !== Infinity && neighTime < nodeTime) {
                convergenceCount++;
              }
              neighborCount++;
            }
          });
        }
        const isEnclosed = neighborCount > 0 && (convergenceCount / neighborCount) > 0.7;

        let rScore = 20;
        if (fillRatio > 0.85) rScore += 30;
        if (ventingFactor > 0.25) rScore += 20;
        if (isEnclosed) rScore += 30;

        let riskLevel = 'LOW';
        if (rScore >= 70) riskLevel = 'HIGH';
        else if (rScore >= 40) riskLevel = 'MEDIUM';

        defects.push({
          type: 'air_trap',
          pos: v.pos,
          normal: v.normal,
          dist: v.dist,
          riskLevel,
          score: rScore
        });
      });
    }

    // ── 3. 웰드라인: 게이트 2개 이상일 때만 ──
    if (_gatePositions.length >= 2) {
      const gateCenter = new THREE.Vector3();
      _gatePositions.forEach(p => gateCenter.add(p));
      gateCenter.divideScalar(_gatePositions.length);

      let bestWeldVert = null, minScore = Infinity;
      for (let i = 0; i < positions.length; i += 9) {
        const d = _flowDistances[i / 3];
        if (d !== undefined && d !== Infinity && d < 999999) {
          const vPos = new THREE.Vector3(positions[i], positions[i+1], positions[i+2]);
          const distToCenter = vPos.distanceTo(gateCenter);
          const score = distToCenter - d * 0.6;
          if (score < minScore && distToCenter > 5) {
            minScore = score;
            bestWeldVert = vPos;
          }
        }
      }
      
      const weldDetails = [];
      const segments = (graph && gateDistancesList) ? computeWeldLineSegments(graph, gateDistancesList, positions, normals, weldDetails) : [];
      if (bestWeldVert) {
        defects.push({ type: 'weld_line', pos: bestWeldVert, segments, weldDetails });
      }
    }

    // ── 4. 수축 (Sink Mark) 위험 영역 탐지 ──
    if (_vertexThickness) {
      let maxThick = 0;
      for (let i = 0; i < _vertexThickness.length; i++) {
        if (_vertexThickness[i] > maxThick) maxThick = _vertexThickness[i];
      }
      if (maxThick > 1.5) {
        const threshold = maxThick * 0.82;
        const candidates = [];
        for (let i = 0; i < positions.length; i += 9) {
          const t = _vertexThickness[i / 3];
          if (t >= threshold) {
            candidates.push({
              pos: new THREE.Vector3(positions[i], positions[i+1], positions[i+2]),
              normal: new THREE.Vector3(normals[i], normals[i+1], normals[i+2]),
              thickness: t
            });
          }
        }
        candidates.sort((a, b) => b.thickness - a.thickness);
        const distinct = [];
        for (const c of candidates) {
          if (distinct.every(d => c.pos.distanceTo(d.pos) >= 20)) {
            distinct.push(c);
            if (distinct.length >= 2) break;
          }
        }
        distinct.forEach(d => {
          const tc = calculateCoolingTime(d.thickness, _material);
          defects.push({ type: 'shrinkage', pos: d.pos, normal: d.normal, thickness: d.thickness, coolingTime: tc });
        });
      }
    }

    return defects;
  }

  function createDefectMarkers(defects) {
    clearDefectMarkers();
    if (!_mesh) return;
    
    _geometry.computeBoundingBox();
    const modelSize = new THREE.Vector3();
    _geometry.boundingBox.getSize(modelSize);
    const avgDim = (modelSize.x + modelSize.y + modelSize.z) / 3;

    defects.forEach(def => {
      if (def.type === 'air_trap') {
        const sphereRadius = Math.max(2.0, avgDim * 0.025);
        const geom = new THREE.SphereGeometry(sphereRadius, 16, 16);
        const mat = new THREE.MeshPhongMaterial({
          color: 0xff00ff,
          emissive: 0x440044,
          transparent: true,
          opacity: 0.85
        });
        const m = new THREE.Mesh(geom, mat);
        
        m.position.copy(def.pos); // 로컬 좌표로 메시에 부착 → 회전/센터링에도 모델에 고정

        const labelText = `에어 트랩 (${def.riskLevel || 'LOW'})`;
        const labelColor = def.riskLevel === 'HIGH' ? '#ff00ff' : def.riskLevel === 'MEDIUM' ? '#ffd166' : '#00ffa3';
        const label = createTextSprite(labelText, labelColor, 4);
        label.position.set(0, sphereRadius * 1.5, 0);
        m.add(label);

        _mesh.add(m);
        _defectMarkers.push(m);
      } else if (def.type === 'weld_line') {
        if (def.segments && def.segments.length > 0) {
          const geom = new THREE.BufferGeometry().setFromPoints(def.segments);
          const mat = new THREE.LineBasicMaterial({
            color: 0xff0000,
            linewidth: 3,
            depthWrite: false
          });
          const lineSegments = new THREE.LineSegments(geom, mat);
          _mesh.add(lineSegments);
          _defectMarkers.push(lineSegments);

          const center = new THREE.Vector3();
          def.segments.forEach(p => center.add(p));
          center.divideScalar(def.segments.length);

          const label = createTextSprite('웰드 라인', '#ff0000', 4);
          label.position.copy(center).add(new THREE.Vector3(0, 4, 0));
          _mesh.add(label);
          _defectMarkers.push(label);
        } else {
          const geom = new THREE.SphereGeometry(2.0, 16, 16);
          const mat = new THREE.MeshPhongMaterial({ color: 0xff0000, emissive: 0x550000 });
          const m = new THREE.Mesh(geom, mat);
          m.position.copy(def.pos); // 로컬 좌표로 메시에 부착

          const label = createTextSprite('웰드 라인', '#ffff00', 4);
          label.position.set(0, 6, 0);
          m.add(label);

          _mesh.add(m);
          _defectMarkers.push(m);
        }
      } else if (def.type === 'shrinkage') {
        const normal = def.normal || new THREE.Vector3(0, 1, 0);
        const ringRadius = Math.max(3.5, avgDim * 0.045);
        
        const geom = new THREE.RingGeometry(ringRadius * 0.8, ringRadius, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff3300, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
        const m = new THREE.Mesh(geom, mat);
        
        const localNormal = normal.clone().normalize();
        const localPos = def.pos.clone().add(localNormal.clone().multiplyScalar(0.5));
        m.position.copy(localPos); // 로컬 좌표로 메시에 부착
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNormal);

        const label = createTextSprite(`수축 (${def.thickness.toFixed(1)}mm / 냉각:${def.coolingTime ? def.coolingTime.toFixed(1) + 's' : '-'})`, '#ff3300', 4.5);
        label.position.set(0, ringRadius * 1.25, 0);
        m.add(label);

        _mesh.add(m);
        _defectMarkers.push(m);
      }
    });
  }

  function getRainbowColor(t) {
    let r = 0, g = 0, b = 0;
    const val = Math.max(0.0, Math.min(1.0, t));
    if (val < 0.2) {
      const s = val / 0.2;
      r = 0.0; g = s; b = 1.0;
    } else if (val < 0.4) {
      const s = (val - 0.2) / 0.2;
      r = 0.0; g = 1.0; b = 1.0 - s;
    } else if (val < 0.6) {
      const s = (val - 0.4) / 0.2;
      r = s; g = 1.0; b = 0.0;
    } else if (val < 0.8) {
      const s = (val - 0.6) / 0.2;
      r = 1.0; g = 1.0 - s * 0.5; b = 0.0;
    } else {
      const s = (val - 0.8) / 0.2;
      r = 1.0; g = 0.5 - s * 0.5; b = 0.0;
    }
    return { r, g, b };
  }

  /* Moldflow 표준 색상 스펙트럼: Blue→Cyan→Green→Yellow→Orange→Red
     t=0 (게이트/최초충진) → t=1 (최후충진/미성형 위험) */
  function computeFlowColors(positions, distances, maxDist, animPct) {
    const colors = new Float32Array(positions.length);
    const targetDist = maxDist * animPct;
    const frontWidth = Math.max(maxDist * 0.04, 0.5);

    for (let i = 0; i < positions.length; i += 3) {
      const d = distances[i / 3];
      let r, g, b;

      const filled = d !== undefined && d !== Infinity && d < 999999 && d <= targetDist;

      if (!filled) {
        // 미충진 영역: 밝은 반투명 느낌의 회색 (Moldflow 스타일 캐비티 표현)
        r = 0.93; g = 0.93; b = 0.95;
      } else {
        const t = maxDist > 0 ? Math.min(1.0, d / maxDist) : 0;
        const color = getRainbowColor(t);
        r = color.r; g = color.g; b = color.b;

        // 유동 전면(Flow Front) 발광 효과: 하얀 빛
        const distToFront = targetDist - d;
        if (distToFront < frontWidth && animPct > 0.005 && animPct < 0.995) {
          const glow = 1.0 - distToFront / frontWidth;
          r = r + (1.0 - r) * glow * 0.88;
          g = g + (1.0 - g) * glow * 0.88;
          b = b + (1.0 - b) * glow * 0.88;
        }
      }

      colors[i] = r; colors[i + 1] = g; colors[i + 2] = b;
    }
    return colors;
  }

  /* 수축 위험 예측: 대향 법선 간의 거리 = 벽 두께 추정 */
  function computeWallThickness() {
    if (!_geometry) return;
    const positions = _geometry.attributes.position.array;
    const normals   = _geometry.attributes.normal.array;

    _geometry.computeBoundingBox();
    const geoSize = new THREE.Vector3();
    _geometry.boundingBox.getSize(geoSize);
    const diag = geoSize.length();

    // 공간 해시 그리드 구성
    const cellSize = Math.max(diag * 0.05, 0.1);
    const grid = {};
    for (let i = 0; i < positions.length; i += 3) {
      const cx = Math.floor(positions[i]     / cellSize);
      const cy = Math.floor(positions[i + 1] / cellSize);
      const cz = Math.floor(positions[i + 2] / cellSize);
      const key = `${cx},${cy},${cz}`;
      if (!grid[key]) grid[key] = [];
      grid[key].push(i);
    }

    _vertexThickness = new Float32Array(positions.length / 3);

    for (let i = 0; i < positions.length; i += 3) {
      const vx = positions[i], vy = positions[i + 1], vz = positions[i + 2];
      const nx = normals[i],   ny = normals[i + 1],   nz = normals[i + 2];
      const cx = Math.floor(vx / cellSize);
      const cy = Math.floor(vy / cellSize);
      const cz = Math.floor(vz / cellSize);

      let minDist = Infinity;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            const key = `${cx+dx},${cy+dy},${cz+dz}`;
            const verts = grid[key];
            if (!verts) continue;
            for (const j of verts) {
              if (j === i) continue;
              const ox = positions[j], oy = positions[j + 1], oz = positions[j + 2];
              const onx = normals[j], ony = normals[j + 1], onz = normals[j + 2];
              // 대향 법선: 내부 양측 벽면 탐지
              const dotN = nx * onx + ny * ony + nz * onz;
              if (dotN < -0.45) {
                const dist = Math.sqrt((vx-ox)**2 + (vy-oy)**2 + (vz-oz)**2);
                if (dist > 0.02 && dist < minDist) minDist = dist;
              }
            }
          }
        }
      }
      _vertexThickness[i / 3] = minDist === Infinity ? 0 : minDist;
    }
  }

  function computeShrinkageColors(positions, normals) {
    const colors = new Float32Array(positions.length);
    const mat = MATERIAL_DB[_material] || MATERIAL_DB.ABS;

    if (!_vertexThickness) {
      computeWallThickness();
    }

    // 최대 두께 정규화
    let maxThick = 0;
    for (let i = 0; i < _vertexThickness.length; i++) {
      if (_vertexThickness[i] > maxThick) maxThick = _vertexThickness[i];
    }
    if (maxThick < 0.001) maxThick = 1;

    // 소재 수축률 가중치 (ABS 0.5% 기준)
    const shrinkWeight = Math.min(3.0, mat.shrink / 0.005);

    for (let i = 0; i < positions.length; i += 3) {
      const thickness = _vertexThickness[i / 3];
      let r, g, b;

      if (thickness < 0.01) {
        // 대향면 없음 = 외부 표면, 낮은 위험 (녹색)
        r = 0.0; g = 0.72; b = 0.3;
      } else {
        const t = Math.min(1.0, (thickness / maxThick) * shrinkWeight);
        if (t < 0.33) {
          // Green (낮은 수축 위험)
          const s = t / 0.33;
          r = s * 0.4; g = 0.85; b = 0.0;
        } else if (t < 0.66) {
          // Yellow (중간 위험)
          const s = (t - 0.33) / 0.33;
          r = 0.4 + s * 0.6; g = 0.85 - s * 0.25; b = 0.0;
        } else {
          // Red (수축 위험 높음)
          const s = (t - 0.66) / 0.34;
          r = 1.0; g = 0.6 - s * 0.6; b = 0.0;
        }
      }
      colors[i] = r; colors[i + 1] = g; colors[i + 2] = b;
    }
    return colors;
  }

  /* STP(occt 테셀레이션) 메쉬를 바이너리 STL ArrayBuffer로 변환.
     백엔드 복셀 솔버(trimesh)는 STEP를 직접 읽지 못하므로, 클라이언트에서 이미
     테셀레이션된 정점 배열을 표준 바이너리 STL로 만들어 전송한다. */
  function buildBinarySTLFromPositions(positions) {
    const triCount = Math.floor(positions.length / 9);
    const buffer = new ArrayBuffer(84 + triCount * 50);
    const view = new DataView(buffer);
    view.setUint32(80, triCount, true); // 80바이트 헤더(0) 다음에 삼각형 개수
    let offset = 84;
    for (let t = 0; t < triCount; t++) {
      const i = t * 9;
      const ax = positions[i],     ay = positions[i + 1], az = positions[i + 2];
      const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
      // 면 법선 = (b-a) x (c-a) 정규화
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      view.setFloat32(offset,      nx, true); view.setFloat32(offset + 4,  ny, true); view.setFloat32(offset + 8,  nz, true);
      view.setFloat32(offset + 12, ax, true); view.setFloat32(offset + 16, ay, true); view.setFloat32(offset + 20, az, true);
      view.setFloat32(offset + 24, bx, true); view.setFloat32(offset + 28, by, true); view.setFloat32(offset + 32, bz, true);
      view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
    return buffer;
  }

  /* 내부: 모든 게이트를 기준으로 유동 거리 재계산 (Python 백엔드 우선 호출, 에러 시 로컬 다익스트라 폴백) */
  async function _doFlowCalculation() {
    if (!_mesh || !_geometry || _gatePositions.length === 0) return null;

    const positions = _geometry.attributes.position.array;
    _geometry.computeBoundingBox();
    const modelSize = new THREE.Vector3();
    _geometry.boundingBox.getSize(modelSize);
    const diag = modelSize.length();
    const epsilon = Math.max(0.05, diag * 0.001);

    const graph = buildAdjacencyGraph(positions, epsilon);
    _adjacencyGraph = graph;

    try {
      // 1. ArrayBuffer로 STL 파일 바이너리 취득
      if (typeof App !== 'undefined' && App.stl && App.stl.file) {
        // STEP/STP은 백엔드 trimesh가 직접 읽지 못하므로, 클라이언트에서 이미
        // 테셀레이션된 메쉬(_geometry)를 바이너리 STL로 변환해 전송한다.
        const _fname = (App.stl.file.name || '').toLowerCase();
        const _isSTPModel = _fname.endsWith('.stp') || _fname.endsWith('.step');
        let arrayBuffer;
        if (_isSTPModel && _geometry && _geometry.attributes && _geometry.attributes.position) {
          arrayBuffer = buildBinarySTLFromPositions(_geometry.attributes.position.array);
        } else {
          arrayBuffer = await App.stl.file.arrayBuffer();
        }

        // 2. 게이트 좌표 전송용 파라미터 빌드
        const gatesData = _gatePositions.map((gp, gIdx) => {
          return {
            id: gIdx + 1,
            coord: [gp.x, gp.y, gp.z],
            speed_factor: _gateVelocityRatios[gIdx] !== undefined ? _gateVelocityRatios[gIdx] : 1.0,
            pressure_factor: _gatePressureRatios[gIdx] !== undefined ? _gatePressureRatios[gIdx] : 1.0,
            time_delay: 0.0,
            trigger_voxel: null
          };
        });

        const gatesStr = encodeURIComponent(JSON.stringify(gatesData));
        // 복셀 해상도는 모델 크기에 비례하여 동적 조정 (평균 치수의 0.8% ~ 1.5% 수준)
        const resolution = Math.max(0.3, Math.min(2.5, diag * 0.008));

        const coolingEnabled = (typeof App !== 'undefined' && App.stl && App.stl.coolingEnabled) || false;
        const coolantTemp = document.getElementById('slide-mold-temp') ? parseFloat(document.getElementById('slide-mold-temp').value) : 25.0;
        const meltTemp = document.getElementById('slide-melt-temp') ? parseFloat(document.getElementById('slide-melt-temp').value) : 230.0;

        const res = await fetch(`/solve-flow-python?gates=${gatesStr}&resolution=${resolution}&cooling_enabled=${coolingEnabled}&coolant_temp=${coolantTemp}&melt_temp=${meltTemp}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream'
          },
          body: arrayBuffer
        });

        if (!res.ok) {
          throw new Error(await res.text());
        }

        const data = await res.json();
        if (data.status === "error") {
          throw new Error(data.message);
        }

        // 3. 복셀 해석 결과(정점별 충진 시각) 매핑
        _flowDistances = new Float32Array(data.vertex_fill_times);
        _vertexTemperatures = data.vertex_temperatures ? new Float32Array(data.vertex_temperatures) : null;
        _vertexDisplacements = data.vertex_displacements ? data.vertex_displacements : null;
        _vertexSinkRisk = data.vertex_sink_risk ? new Float32Array(data.vertex_sink_risk) : null;
        _cycleTime = data.cycle_time || 0.0;
        _hotSpots = data.hot_spots || [];
        
        let maxDist = 0;
        for (let i = 0; i < _flowDistances.length; i++) {
          if (_flowDistances[i] !== -1.0 && _flowDistances[i] > maxDist) {
            maxDist = _flowDistances[i];
          }
        }
        _maxFlowDistance = maxDist;

        // 웰드라인 매핑 (백엔드 좌표를 Three.js 뷰어의 웰드라인 세그먼트로 변환)
        const segments = [];
        const weldDetails = [];
        if (data.weld_lines && data.weld_lines.length > 0) {
          data.weld_lines.forEach(wl => {
            const p = new THREE.Vector3(wl[0], wl[1], wl[2]);
            segments.push(
              p.clone().add(new THREE.Vector3(-0.8, 0, 0)),
              p.clone().add(new THREE.Vector3(0.8, 0, 0))
            );
            weldDetails.push({
              start: p,
              end: p,
              angle: 180,
              severity: 'HIGH',
              length: 1.6
            });
          });
        }

        const defects = [
          { type: 'weld_line', pos: _gatePositions[0].clone(), segments, weldDetails }
        ];

        // 에어 트랩 및 수축 등 추가 결함 탐지 (로컬 분석 함수 호출 조합)
        const localDefects = predictDefects(graph, []);
        // weld_line을 제외한 에어트랩/수축만 결합
        localDefects.forEach(d => {
          if (d.type !== 'weld_line') defects.push(d);
        });

        createDefectMarkers(defects);
        _lastDefects = defects;
        _flowAnimationTime = 0;
        recolorGeometry();

        const minDim = Math.min(modelSize.x, modelSize.y, modelSize.z);
        const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
        const totalArea = (positions.length / 9) * 10;
        const diagnostics = _getDiagnostics(minDim, maxDim, totalArea, _material);

        return { maxFlowDistance: _maxFlowDistance, defects, diagnostics };
      }
    } catch (err) {
      console.warn("Python Voxel Solver 실패 (로컬 다익스트라로 폴백):", err);
    }

    return _doFlowCalculationFallback();
  }

  /* 로컬 다익스트라(Dijkstra) 기반 폴백 해석 로직 */
  function _doFlowCalculationFallback() {
    const positions = _geometry.attributes.position.array;
    _geometry.computeBoundingBox();
    const modelSize = new THREE.Vector3();
    _geometry.boundingBox.getSize(modelSize);
    const graph = _adjacencyGraph;

    const getVertKey = (x, y, z) => `${Math.round(x*1000)/1000},${Math.round(y*1000)/1000},${Math.round(z*1000)/1000}`;

    const vertexCount = positions.length / 3;
    _flowDistances = new Float32Array(vertexCount).fill(Infinity);
    let maxDist = 0;

    const gateArrivalsList = [];
    _gatePositions.forEach((gp, gIdx) => {
      const startKey = findClosestGraphNode(gp, graph);
      if (startKey) {
        const flowRes = calculateFlowDistances(startKey, graph);
        const dists = flowRes.distances;
        const parents = flowRes.parents;
        const wVal = _gateVelocityRatios[gIdx] !== undefined ? _gateVelocityRatios[gIdx] : 1.0;
        
        const arrivals = {};
        for (const key in dists) {
          const d = dists[key];
          arrivals[key] = (d !== Infinity && wVal > 0) ? (d / wVal) : Infinity;
        }
        gateArrivalsList.push({ arrivals, parents });
      }
    });

    for (let i = 0; i < positions.length; i += 3) {
      const k = getVertKey(positions[i], positions[i+1], positions[i+2]);
      let minArrival = Infinity;
      
      gateArrivalsList.forEach(item => {
        const arrival = item.arrivals[k];
        if (arrival !== undefined && arrival < minArrival) {
          minArrival = arrival;
        }
      });

      _flowDistances[i/3] = minArrival;
      if (minArrival !== Infinity && minArrival > maxDist) {
        maxDist = minArrival;
      }
    }
    _maxFlowDistance = maxDist;

    const defects = predictDefects(graph, gateArrivalsList);
    createDefectMarkers(defects);
    _lastDefects = defects;
    _flowAnimationTime = 0;
    recolorGeometry();

    const minDim = Math.min(modelSize.x, modelSize.y, modelSize.z);
    const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
    const totalArea = (positions.length / 9) * 10;
    const diagnostics = _getDiagnostics(minDim, maxDim, totalArea, _material);

    return { maxFlowDistance: _maxFlowDistance, defects, diagnostics };
  }

  /* 게이트 추가 */
  async function addGatePosition(worldPoint, localPoint, localNormal) {
    if (!_mesh) return null;
    if (!localPoint) localPoint = _mesh.worldToLocal(worldPoint.clone());
    if (!worldPoint)  worldPoint  = _mesh.localToWorld(localPoint.clone());

    _gatePositions.push(localPoint.clone());
    _gateNormals.push(localNormal ? localNormal.clone() : null);
    const idx = _gatePositions.length - 1;
    _gateMarkers.push(createGateMarker(localPoint, localNormal, idx));

    const res = await _doFlowCalculation();
    if (!res) return null;

    return {
      action: 'add_gate',
      gateIndex: idx,
      gateCount: _gatePositions.length,
      worldCoords: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
      maxFlowDistance: res.maxFlowDistance,
      defects: res.defects,
      diagnostics: res.diagnostics
    };
  }

  /* 특정 인덱스 게이트 제거 */
  async function removeGateAt(index) {
    if (index < 0 || index >= _gatePositions.length) return;

    _gateMarkers.forEach(m => { if (_mesh) _mesh.remove(m); else _scene.remove(m); });
    _gateMarkers = [];
    _gatePositions.splice(index, 1);
    _gateNormals.splice(index, 1);

    if (_gatePositions.length === 0) {
      clearGate();
    } else {
      _gatePositions.forEach((pos, i) => {
        _gateMarkers.push(createGateMarker(pos, _gateNormals[i], i));
      });
      await _doFlowCalculation();
    }
  }

  /* 파팅라인 변경 등 외부에서 유동 재계산 요청 */
  async function recalculateFlow() {
    if (_gatePositions.length === 0) return null;
    const res = await _doFlowCalculation();
    if (!res) return null;
    const wp = _mesh ? _mesh.localToWorld(_gatePositions[0].clone()) : new THREE.Vector3();
    return {
      worldCoords: { x: wp.x, y: wp.y, z: wp.z },
      maxFlowDistance: res.maxFlowDistance,
      defects: res.defects,
      gateCount: _gatePositions.length,
      diagnostics: res.diagnostics
    };
  }

  function toggleFlowOverlay(active) {
    _flowOverlayActive = active;
    if (active) _shrinkageOverlayActive = false;
    recolorGeometry();
  }

  function toggleShrinkageOverlay(active) {
    _shrinkageOverlayActive = active;
    if (active) _flowOverlayActive = false;
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

  function getCanvas() {
    return _renderer ? _renderer.domElement : null;
  }

  function onGateRepositioned(cb) {
    _onGateRepositionedCallback = cb;
  }

  function onRightClickModel(cb) {
    _onRightClickModelCallback = cb;
  }

  function setRunnerType(type) {
    if (type === 'cold' || type === 'hot') {
      _runnerType = type;
    }
  }

  function setGateParams(index, velocityRatio, pressureRatio) {
    if (index >= 0 && index < _gatePositions.length) {
      if (velocityRatio !== undefined) _gateVelocityRatios[index] = velocityRatio;
      if (pressureRatio !== undefined) _gatePressureRatios[index] = pressureRatio;
      return recalculateFlow();
    }
    return null;
  }

  /* ──────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────── */
  function predictSinkMarks(graph) {
    if (!_geometry || !_vertexThickness || !graph) return { count: 0, area: 0, severity: 'LOW', details: [], recommendations: [] };
    const details = [];
    const recos = new Set();
    let highCount = 0, medCount = 0, lowCount = 0;
    
    let totalThick = 0;
    const keys = Object.keys(graph);
    keys.forEach(k => {
      totalThick += _vertexThickness[graph[k].vertIdx];
    });
    const avgThick = keys.length > 0 ? totalThick / keys.length : 1;
    
    keys.forEach(key => {
      const node = graph[key];
      const idx = node.vertIdx;
      const tLocal = _vertexThickness[idx];
      if (tLocal <= 0.2) return;
      
      let neighSum = 0;
      let neighMax = 0;
      let count = 0;
      node.neighbors.forEach(nk => {
        const neighNode = graph[nk];
        if (neighNode) {
          const tNeigh = _vertexThickness[neighNode.vertIdx];
          neighSum += tNeigh;
          if (tNeigh > neighMax) neighMax = tNeigh;
          count++;
        }
      });
      
      if (count === 0) return;
      const neighAvg = neighSum / count;
      
      const massRatio = tLocal / neighAvg;
      const isMassHigh = massRatio >= 1.5;
      
      const mat = MATERIAL_DB[_material] || MATERIAL_DB.ABS;
      const targetRibRatio = mat.ribRatio || 0.6;
      const ribRatio = neighMax > 0 ? (tLocal / neighMax) : 1.0;
      let ribRisk = 'LOW';
      if (ribRatio > targetRibRatio) ribRisk = 'HIGH';
      else if (ribRatio >= targetRibRatio * 0.8) ribRisk = 'MEDIUM';
      
      const isBossHigh = tLocal > neighAvg * 1.2;
      
      let risk = 'LOW';
      if (isMassHigh || isBossHigh || ribRisk === 'HIGH') {
        risk = 'HIGH';
        highCount++;
        if (isBossHigh) recos.add("Boss Core Out 적용");
        if (ribRisk === 'HIGH') recos.add("Rib Thickness 감소");
        if (isMassHigh) recos.add("Wall Thickness 균일화");
      } else if (ribRisk === 'MEDIUM') {
        risk = 'MEDIUM';
        medCount++;
      } else {
        lowCount++;
      }
      
      if (risk !== 'LOW') {
        details.push({
          pos: new THREE.Vector3(node.x, node.y, node.z),
          risk,
          ratio: ribRatio,
          thickness: tLocal
        });
      }
    });
    
    const distinct = [];
    details.forEach(d => {
      if (distinct.every(c => d.pos.distanceTo(c.pos) >= 15)) {
        distinct.push(d);
      }
    });
    
    const countTotal = distinct.length;
    const area = countTotal * 12.5;
    let severity = 'LOW';
    if (distinct.some(d => d.risk === 'HIGH') || countTotal > 15) {
      severity = 'HIGH';
      recos.add("Gate 위치 조정");
      recos.add("Cooling 개선");
    }
    else if (countTotal > 5) severity = 'MEDIUM';
    
    return { count: countTotal, area: Math.round(area), severity, details: distinct, recommendations: Array.from(recos) };
  }

  function predictShrinkage(graph) {
    const mat = MATERIAL_DB[_material] || MATERIAL_DB.ABS;
    const baseShrink = mat.linearShrinkage || 0.005;
    
    if (!_geometry || !_vertexThickness || !graph) {
      return { maxShrinkage: baseShrink * 100, avgShrinkage: baseShrink * 100, globalShrinkage: baseShrink * 100, riskLevel: 'LOW', details: [], recommendations: [] };
    }
    
    let totalThick = 0;
    const keys = Object.keys(graph);
    keys.forEach(k => {
      totalThick += _vertexThickness[graph[k].vertIdx];
    });
    const avgThick = keys.length > 0 ? totalThick / keys.length : 1;
    
    let sumShrink = 0;
    let maxShrink = 0;
    let count = 0;
    const details = [];
    const recos = new Set();
    
    keys.forEach(key => {
      const node = graph[key];
      const idx = node.vertIdx;
      const tLocal = _vertexThickness[idx];
      const dGate = (_flowDistances && _flowDistances[idx] !== Infinity) ? _flowDistances[idx] : (_maxFlowDistance * 0.5);
      const gateFactor = _maxFlowDistance > 0 ? (1.0 + 0.3 * (dGate / _maxFlowDistance)) : 1.0;
      const thickFactor = 1.0 + 0.5 * ((tLocal - avgThick) / avgThick);
      
      const tc = calculateCoolingTime(tLocal, _material);
      const coolingFactor = Math.max(0.8, Math.min(1.5, tc / 15.0));
      
      let sLocal = baseShrink * gateFactor * thickFactor * coolingFactor;
      sLocal = Math.max(baseShrink * 0.5, Math.min(baseShrink * 3.0, sLocal));
      
      sumShrink += sLocal;
      if (sLocal > maxShrink) maxShrink = sLocal;
      count++;
      
      let riskLevel = 'LOW';
      if (sLocal >= baseShrink * 1.6) riskLevel = 'HIGH';
      else if (sLocal >= baseShrink * 1.2) riskLevel = 'MEDIUM';
      
      details.push({
        pos: new THREE.Vector3(node.x, node.y, node.z),
        shrinkage: sLocal,
        riskLevel
      });
    });
    
    const avgShrink = count > 0 ? (sumShrink / count) : baseShrink;
    let riskLevel = 'LOW';
    if (maxShrink >= baseShrink * 1.6) {
      riskLevel = 'HIGH';
      recos.add("Holding Pressure 증가");
      recos.add("Holding Time 증가");
      recos.add("Gate 확대");
      recos.add("두께 편차 감소");
    }
    else if (maxShrink >= baseShrink * 1.2) {
      riskLevel = 'MEDIUM';
      recos.add("Cooling 균일화");
    }
    
    return {
      maxShrinkage: maxShrink * 100,
      avgShrinkage: avgShrink * 100,
      globalShrinkage: avgShrink * 100,
      riskLevel,
      details,
      recommendations: Array.from(recos)
    };
  }

  function predictWarpage(graph, shrinkResult) {
    const mat = MATERIAL_DB[_material] || MATERIAL_DB.ABS;
    const baseShrink = mat.linearShrinkage || 0.005;
    
    if (!_geometry || !_vertexThickness || !shrinkResult || !graph) {
      return { score: 0, direction: '+Z', magnitude: 0, risk: 'LOW', recommendations: [] };
    }
    
    const size = new THREE.Vector3();
    _geometry.boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
    
    let sumThick = 0;
    const keys = Object.keys(graph);
    keys.forEach(k => {
      sumThick += _vertexThickness[graph[k].vertIdx];
    });
    const avgThick = keys.length > 0 ? sumThick / keys.length : 1;
    
    let sumSqDiff = 0;
    keys.forEach(k => {
      sumSqDiff += Math.pow(_vertexThickness[graph[k].vertIdx] - avgThick, 2);
    });
    const stdDevThick = Math.sqrt(sumSqDiff / (keys.length || 1));
    const thickVarWeight = 1.0 + 2.0 * (stdDevThick / avgThick);
    
    const diffRatio = Math.abs(mat.flowShrinkage - mat.crossFlowShrinkage) / baseShrink;
    const diffShrinkWeight = 1.0 + 2.5 * diffRatio;
    
    let coolingImbalance = 1.2;
    if (_runnerType === 'cold') coolingImbalance = 1.5;
    
    const flowLengthWeight = _maxFlowDistance > 0 ? (1.0 + 1.0 * (_maxFlowDistance / maxDim)) : 1.2;
    
    let ribNodeCount = 0;
    let bossNodeCount = 0;
    keys.forEach(key => {
      const node = graph[key];
      const tLocal = _vertexThickness[node.vertIdx];
      let maxNeigh = 0;
      let sumNeigh = 0;
      node.neighbors.forEach(nk => {
        const neighNode = graph[nk];
        if (neighNode && _vertexThickness[neighNode.vertIdx] > maxNeigh) {
          maxNeigh = _vertexThickness[neighNode.vertIdx];
        }
        if (neighNode) sumNeigh += _vertexThickness[neighNode.vertIdx];
      });
      const targetRibRatio = mat.ribRatio || 0.6;
      if (maxNeigh > 0 && tLocal / maxNeigh < targetRibRatio) {
        ribNodeCount++;
      }
      const neighAvg = node.neighbors.length > 0 ? sumNeigh / node.neighbors.length : tLocal;
      if (tLocal > neighAvg * 1.2) bossNodeCount++;
    });
    const ribDensity = ribNodeCount / (keys.length || 1);
    const ribDensityWeight = 1.0 + 3.0 * ribDensity;
    
    const rawScore = thickVarWeight * diffShrinkWeight * coolingImbalance * flowLengthWeight * ribDensityWeight;
    let score = Math.min(100, Math.round((rawScore / 30.0) * 100));
    
    const modelCenter = new THREE.Vector3();
    _geometry.boundingBox.getCenter(modelCenter);
    
    const warpVec = new THREE.Vector3();
    shrinkResult.details.forEach(d => {
      const diffFromAvg = d.shrinkage - (shrinkResult.avgShrinkage / 100);
      const vecToNode = d.pos.clone().sub(modelCenter);
      warpVec.add(vecToNode.multiplyScalar(diffFromAvg));
    });
    
    let direction = '+Z';
    if (warpVec.lengthSq() > 0.001) {
      warpVec.normalize();
      const ax = Math.abs(warpVec.x);
      const ay = Math.abs(warpVec.y);
      const az = Math.abs(warpVec.z);
      if (ax > ay && ax > az) {
        direction = warpVec.x > 0 ? '+X' : '-X';
      } else if (ay > ax && ay > az) {
        direction = warpVec.y > 0 ? '+Y' : '-Y';
      } else {
        direction = warpVec.z > 0 ? '+Z' : '-Z';
      }
    }
    
    const magnitude = maxDim * (shrinkResult.maxShrinkage / 100) * (score / 100) * 0.3;
    
    let risk = 'LOW';
    const recos = new Set();
    if (score >= 70) {
      risk = 'HIGH';
      recos.add("Cooling Channel 추가");
      recos.add("Gate 위치 변경");
      recos.add("Wall Thickness 균일화");
      recos.add("재질 변경 검토");
    } else if (score >= 40) {
      risk = 'MEDIUM';
      recos.add("Rib 구조 최적화");
      recos.add("Boss 구조 최적화");
    }
    
    return {
      score,
      direction,
      magnitude,
      risk,
      recommendations: Array.from(recos)
    };
  }

  function updateWarpArrow() {
    if (_warpArrow) {
      _scene.remove(_warpArrow);
      _warpArrow = null;
    }
    if (!_warpOverlayActive || !_geometry) return;
    
    const shrinkRes = predictShrinkage(_adjacencyGraph);
    const warpRes = predictWarpage(_adjacencyGraph, shrinkRes);
    
    _geometry.computeBoundingBox();
    const box = _geometry.boundingBox;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    _geometry.boundingBox.getSize(size);
    const radius = size.length();
    
    let dir = new THREE.Vector3(0, 0, 1);
    if (warpRes.direction === '+X') dir.set(1, 0, 0);
    else if (warpRes.direction === '-X') dir.set(-1, 0, 0);
    else if (warpRes.direction === '+Y') dir.set(0, 1, 0);
    else if (warpRes.direction === '-Y') dir.set(0, -1, 0);
    else if (warpRes.direction === '+Z') dir.set(0, 0, 1);
    else if (warpRes.direction === '-Z') dir.set(0, 0, -1);
    
    const arrowLen = Math.max(15, radius * 0.4);
    const color = 0x0055ff;
    _warpArrow = new THREE.ArrowHelper(dir, center, arrowLen, color, arrowLen * 0.25, arrowLen * 0.15);
    _scene.add(_warpArrow);
  }

  function updateWeldLines(weldLines) {
    const segments = [];
    const weldDetails = [];
    if (weldLines && weldLines.length > 0) {
      weldLines.forEach(wl => {
        const p = new THREE.Vector3(wl[0], wl[1], wl[2]);
        segments.push(
          p.clone().add(new THREE.Vector3(-0.8, 0, 0)),
          p.clone().add(new THREE.Vector3(0.8, 0, 0))
        );
        weldDetails.push({
          start: p,
          end: p,
          angle: 180,
          severity: 'HIGH',
          length: 1.6
        });
      });
    }

    const defects = [
      { type: 'weld_line', pos: _gatePositions[0] ? _gatePositions[0].clone() : new THREE.Vector3(), segments, weldDetails }
    ];

    if (_lastDefects) {
      _lastDefects.forEach(d => {
        if (d.type !== 'weld_line') defects.push(d);
      });
    }
    
    _lastDefects = defects;
    createDefectMarkers(defects);
  }

  function computeSinkColors(positions, normals) {
    const colors = new Float32Array(positions.length);
    
    if (_vertexSinkRisk && _vertexSinkRisk.length > 0) {
      for (let i = 0; i < positions.length; i += 3) {
        const idx = i / 3;
        const val = _vertexSinkRisk[idx] !== undefined ? _vertexSinkRisk[idx] : 0.0;
        const color = getRainbowColor(val);
        colors[i] = color.r; colors[i+1] = color.g; colors[i+2] = color.b;
      }
      return colors;
    }
    
    const sinkRes = predictSinkMarks(_adjacencyGraph);
    const nodeRisk = {};
    if (sinkRes && sinkRes.details) {
      sinkRes.details.forEach(d => {
        const key = `${Math.round(d.pos.x*1000)/1000},${Math.round(d.pos.y*1000)/1000},${Math.round(d.pos.z*1000)/1000}`;
        if (_adjacencyGraph && _adjacencyGraph[key]) {
          nodeRisk[_adjacencyGraph[key].vertIdx] = d.risk;
        }
      });
    }
    
    for (let i = 0; i < positions.length; i += 3) {
      const vertIdx = i / 3;
      const risk = nodeRisk[vertIdx];
      let val = 0.0;
      if (risk === 'HIGH') {
        val = 1.0;
      } else if (risk === 'MEDIUM') {
        val = 0.5;
      }
      const color = getRainbowColor(val);
      colors[i] = color.r; colors[i+1] = color.g; colors[i+2] = color.b;
    }
    return colors;
  }

  function computeShrinkagePredictColors(positions, normals) {
    const colors = new Float32Array(positions.length);
    const shrinkRes = predictShrinkage(_adjacencyGraph);
    const nodeShrink = {};
    if (shrinkRes && shrinkRes.details) {
      shrinkRes.details.forEach(d => {
        const key = `${Math.round(d.pos.x*1000)/1000},${Math.round(d.pos.y*1000)/1000},${Math.round(d.pos.z*1000)/1000}`;
        if (_adjacencyGraph && _adjacencyGraph[key]) {
          nodeShrink[_adjacencyGraph[key].vertIdx] = d.shrinkage;
        }
      });
    }
    
    const mat = MATERIAL_DB[_material] || MATERIAL_DB.ABS;
    const baseShrink = mat.linearShrinkage || 0.005;
    
    for (let i = 0; i < positions.length; i += 3) {
      const vertIdx = i / 3;
      const val = nodeShrink[vertIdx] || baseShrink;
      const t = Math.max(0.0, Math.min(1.0, val / (baseShrink * 2.0)));
      const color = getRainbowColor(t);
      colors[i] = color.r; 
      colors[i+1] = color.g; 
      colors[i+2] = color.b;
    }
    return colors;
  }

  function computeWarpageColors(positions, normals) {
    const colors = new Float32Array(positions.length);
    const shrinkRes = predictShrinkage(_adjacencyGraph);
    const warpRes = predictWarpage(_adjacencyGraph, shrinkRes);
    
    _geometry.computeBoundingBox();
    const center = new THREE.Vector3();
    _geometry.boundingBox.getCenter(center);
    
    let warpAxis = new THREE.Vector3(0, 0, 1);
    if (warpRes.direction === '+X') warpAxis.set(1, 0, 0);
    else if (warpRes.direction === '-X') warpAxis.set(-1, 0, 0);
    else if (warpRes.direction === '+Y') warpAxis.set(0, 1, 0);
    else if (warpRes.direction === '-Y') warpAxis.set(0, -1, 0);
    else if (warpRes.direction === '+Z') warpAxis.set(0, 0, 1);
    else if (warpRes.direction === '-Z') warpAxis.set(0, 0, -1);
    
    const size = new THREE.Vector3();
    _geometry.boundingBox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
    
    for (let i = 0; i < positions.length; i += 3) {
      const nodePos = new THREE.Vector3(positions[i], positions[i+1], positions[i+2]);
      const distFromCenter = nodePos.sub(center).dot(warpAxis);
      const t = Math.max(0.0, Math.min(1.0, Math.abs(distFromCenter) / (maxDim * 0.5)));
      colors[i] = 0.1 * (1.0 - t); 
      colors[i+1] = 0.5 * (1.0 - t) + 0.3 * t; 
      colors[i+2] = 0.4 + 0.6 * t;
    }
    return colors;
  }

  function toggleSinkOverlay(active) {
    _sinkOverlayActive = active;
    if (active) {
      _flowOverlayActive = false;
      _shrinkageOverlayActive = false;
      _warpOverlayActive = false;
    }
    recolorGeometry();
  }
  
  function toggleWarpOverlay(active) {
    _warpOverlayActive = active;
    if (active) {
      _flowOverlayActive = false;
      _shrinkageOverlayActive = false;
      _sinkOverlayActive = false;
    }
    recolorGeometry();
  }

  function toggleCoolingOverlay(active) {
    _coolingOverlayActive = active;
    recolorGeometry();
  }

  function setVertexTemperatures(temps) {
    _vertexTemperatures = temps;
  }

  function setFlowDistances(dists) {
    _flowDistances = dists ? new Float32Array(dists) : null;
  }
  
  function setVertexSinkRisk(risk) {
    _vertexSinkRisk = risk ? new Float32Array(risk) : null;
  }
  
  function setMaxFlowDistance(dist) {
    _maxFlowDistance = dist;
  }

  function computeCoolingColors(positions, temperatures) {
    const colors = new Float32Array(positions.length);
    if (!temperatures || temperatures.length === 0) return colors;
    
    let minT = Infinity, maxT = -Infinity;
    for (let i = 0; i < temperatures.length; i++) {
      if (temperatures[i] < minT) minT = temperatures[i];
      if (temperatures[i] > maxT) maxT = temperatures[i];
    }
    const range = maxT - minT || 1.0;
    
    for (let i = 0; i < positions.length; i += 3) {
      const idx = i / 3;
      const tVal = temperatures[idx] !== undefined ? temperatures[idx] : minT;
      const t = Math.max(0.0, Math.min(1.0, (tVal - minT) / range));
      
      const color = getRainbowColor(t);
      colors[i] = color.r;
      colors[i+1] = color.g;
      colors[i+2] = color.b;
    }
    return colors;
  }

  return { resizeViewer, parseSTL, parseSTP, initViewer, loadGeometry, analyze, toggleOverlay, setWireframe, resetCamera, setPullAxis, setFlipAxis, recolorGeometry, updateCoreHelpers, updatePartingLine, setGateSettingMode, isGateSettingMode, onViewerClick, getGatePosition, getGatePositions, addGatePosition, removeGateAt, recalculateFlow, toggleFlowOverlay, toggleShrinkageOverlay, setFlowAnimationTime, clearGate, highlightCore, resetCoreHighlights, getCanvas, onGateRepositioned, onRightClickModel, setPhysicalParams, calculateCoolingTime, setRunnerType, setGateParams, toggleSinkOverlay, toggleWarpOverlay, toggleCoolingOverlay, setVertexTemperatures, setFlowDistances, setVertexSinkRisk, setMaxFlowDistance, predictSinkMarks, predictShrinkage, predictWarpage, updateWeldLines };



})();
