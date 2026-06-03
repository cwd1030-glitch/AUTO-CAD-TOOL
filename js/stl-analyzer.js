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
  let _flowOverlayActive = false;
  let _shrinkageOverlayActive = false;
  let _flowDistances = null;
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

  let _meltTemp = 230;
  let _moldTemp = 50;
  let _flowRate = 50;
  let _runnerType = 'cold';
  let _pressureLimit = 100;

  const MATERIAL_DB = {
    ABS: { shrink: 0.005, minDraft: 1.0, ribRatio: 0.6, name: 'ABS', alpha: 0.08, Tm: 230, Tw: 50, Te: 90, TmMin: 200, TmMax: 280, TwMin: 40, TwMax: 90 },
    PC:  { shrink: 0.006, minDraft: 1.5, ribRatio: 0.55, name: 'PC (폴리카보네이트)', alpha: 0.12, Tm: 290, Tw: 80, Te: 130, TmMin: 280, TmMax: 320, TwMin: 70, TwMax: 120 },
    PP:  { shrink: 0.015, minDraft: 2.0, ribRatio: 0.5,  name: 'PP (폴리프로필렌)', alpha: 0.07, Tm: 220, Tw: 40, Te: 80, TmMin: 200, TmMax: 260, TwMin: 20, TwMax: 80 },
    POM: { shrink: 0.020, minDraft: 0.5, ribRatio: 0.5,  name: 'POM (아세탈)', alpha: 0.09, Tm: 200, Tw: 70, Te: 100, TmMin: 190, TmMax: 230, TwMin: 60, TwMax: 120 },
    FORTRON: { shrink: 0.005, minDraft: 1.5, ribRatio: 0.5, name: 'FORTRON (PPS 수지)', alpha: 0.10, Tm: 310, Tw: 130, Te: 150, TmMin: 300, TmMax: 340, TwMin: 120, TwMax: 160 },
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
    if (!window.SharedArrayBuffer) {
      throw new Error('SharedArrayBuffer 미지원 — WASM 엔진 초기화 불가. COOP/COEP 헤더가 필요합니다.');
    }

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
        positions.push(...tempPts);
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
    _scene.background = new THREE.Color(0xffffff); // Clean white background for visibility
    _scene.fog = new THREE.FogExp2(0xffffff, 0.002);

    _camera = new THREE.PerspectiveCamera(45, W/H, 0.01, 10000);
    _camera.position.set(0, 0, 200);

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(window.devicePixelRatio);
    _renderer.setSize(W, H);
    _renderer.shadowMap.enabled = true;
    container.appendChild(_renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0x555555, 0.8);
    _scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dir1.position.set(1, 2, 3);
    _scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0x99bbee, 0.5);
    dir2.position.set(-2, -1, -1);
    _scene.add(dir2);
    // Rim light
    const rim = new THREE.PointLight(0x00d4ff, 0.3, 5000);
    rim.position.set(-200, 200, -200);
    _scene.add(rim);

    // Grid - adjusted to clean light gray for white background
    const grid = new THREE.GridHelper(500, 30, 0xaaaaaa, 0xdddddd);
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

    // 메시 와이어프레임 외곽선 오버레이 추가 (신뢰감 부여 및 CAD 감성 극대화)
    const wireframeGeo = new THREE.WireframeGeometry(_geometry);
    const wireframeMat = new THREE.LineBasicMaterial({
      color: 0x3d4b66, // 깨끗한 네이비 그레이 톤의 얇은 와이어프레임 선
      transparent: true,
      opacity: 0.16,
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
    updateGimbalHighlight();

    if (_pullArrow) {
      _scene.remove(_pullArrow);
      _pullArrow = null;
    }
    updatePullArrow();

    _scene.add(_mesh);
  }

  // 3.1 Ray-Triangle Intersection (Moller-Trumbore Algorithm)
  function rayTriangleIntersect(orig, dir, v0, v1, v2) {
    const EPSILON = 0.000001;
    const edge1 = new THREE.Vector3().subVectors(v1, v0);
    const edge2 = new THREE.Vector3().subVectors(v2, v0);
    const h = new THREE.Vector3().crossVectors(dir, edge2);
    const a = edge1.dot(h);
    
    if (a > -EPSILON && a < EPSILON) return null; // Parallel
    
    const f = 1.0 / a;
    const s = new THREE.Vector3().subVectors(orig, v0);
    const u = f * s.dot(h);
    
    if (u < 0.0 || u > 1.0) return null;
    
    const q = new THREE.Vector3().crossVectors(s, edge1);
    const v = f * dir.dot(q);
    
    if (v < 0.0 || u + v > 1.0) return null;
    
    const t = f * edge2.dot(q);
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

    // 1. 모든 삼각형 데이터 로딩 및 인덱싱
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
      
      triangles.push({ v0, v1, v2, centroid, normal, idx });
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
      if (pullAxis === 'X') { axisP1 = 'y'; axisP2 = 'z'; }
      else if (pullAxis === 'Y') { axisP1 = 'x'; axisP2 = 'z'; }
      else { axisP1 = 'x'; axisP2 = 'y'; }
      const rx = rayOrigin[axisP1];
      const ry = rayOrigin[axisP2];

      for (let t = 0; t < triCount; t++) {
        const tri = triangles[t];

        // 자기 자신 및 직전/직후 인접 삼각형 무시
        if (Math.abs(tri.idx - cand.idx) < 9) continue;

        // 2D bounding box check in the plane perpendicular to pull axis
        const minP1 = Math.min(tri.v0[axisP1], tri.v1[axisP1], tri.v2[axisP1]);
        const maxP1 = Math.max(tri.v0[axisP1], tri.v1[axisP1], tri.v2[axisP1]);
        const minP2 = Math.min(tri.v0[axisP2], tri.v1[axisP2], tri.v2[axisP2]);
        const maxP2 = Math.max(tri.v0[axisP2], tri.v1[axisP2], tri.v2[axisP2]);
        if (rx < minP1 - 0.2 || rx > maxP1 + 0.2 || ry < minP2 - 0.2 || ry > maxP2 + 0.2) continue;

        // 탈형 경로 반대쪽에 위치한 삼각형 필터링
        if (sign > 0) {
          if (tri.centroid[axisKey] < originVal - 0.1) continue;
        } else {
          if (tri.centroid[axisKey] > originVal + 0.1) continue;
        }

        // Bounding Box 축방향 빠른 필터링
        const tMin = Math.min(tri.v0[axisKey], tri.v1[axisKey], tri.v2[axisKey]);
        const tMax = Math.max(tri.v0[axisKey], tri.v1[axisKey], tri.v2[axisKey]);
        if (sign > 0 && tMax < originVal) continue;
        if (sign < 0 && tMin > originVal) continue;

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
          if (hAxisKey === 'x') { hAxisP1 = 'y'; hAxisP2 = 'z'; }
          else if (hAxisKey === 'y') { hAxisP1 = 'x'; hAxisP2 = 'z'; }
          else { hAxisP1 = 'x'; hAxisP2 = 'y'; }
          const hrx = rayOrigin[hAxisP1];
          const hry = rayOrigin[hAxisP2];
          
          for (let t = 0; t < triCount; t++) {
            const tri = triangles[t];
            if (Math.abs(tri.idx - cand.idx) < 9) continue;
            
            // 2D bounding box check in the plane perpendicular to slide direction
            const minHP1 = Math.min(tri.v0[hAxisP1], tri.v1[hAxisP1], tri.v2[hAxisP1]);
            const maxHP1 = Math.max(tri.v0[hAxisP1], tri.v1[hAxisP1], tri.v2[hAxisP1]);
            const minHP2 = Math.min(tri.v0[hAxisP2], tri.v1[hAxisP2], tri.v2[hAxisP2]);
            const maxHP2 = Math.max(tri.v0[hAxisP2], tri.v1[hAxisP2], tri.v2[hAxisP2]);
            if (hrx < minHP1 - 0.2 || hrx > maxHP1 + 0.2 || hry < minHP2 - 0.2 || hry > maxHP2 + 0.2) continue;

            // 수평 경로 반대쪽 필터링
            if (isHPositive) {
              if (tri.centroid[hAxisKey] < hOriginVal - 0.1) continue;
            } else {
              if (tri.centroid[hAxisKey] > hOriginVal + 0.1) continue;
            }
            
            const tMin = Math.min(tri.v0[hAxisKey], tri.v1[hAxisKey], tri.v2[hAxisKey]);
            const tMax = Math.max(tri.v0[hAxisKey], tri.v1[hAxisKey], tri.v2[hAxisKey]);
            if (isHPositive && tMax < hOriginVal) continue;
            if (!isHPositive && tMin > hOriginVal) continue;
            
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

    // 물리적 간섭(Ray-casting) 기반 진짜 언더컷 맵 도출
    const { isUndercutMap } = getPhysicalUndercuts(positions, normals, partingH, _pullAxis, _flipAxis);

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
      const isPhysicalUndercut = isUndercutMap[triIdx] === 1;

      if (isPhysicalUndercut) {
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
        componentPoints.push(...cells[curr]);
        
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

  function processCoreClusters(clusters, cSize, avgDim) {
    let finalFeatures = [];
    for (const dir in clusters) {
      if (clusters[dir].length < 30) continue; // Skip very small noise clusters
      
      const features = groupPointsIntoFeatures(clusters[dir], cSize);
      features.forEach(featPoints => {
        if (featPoints.length < 15) return; // Skip minor noise features
        
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
        
        // 모델 크기 대비 최소 7% 이상의 가치 있는 크기를 지닌 기구식 언더컷 구간만 허용
        if (maxFeatureDim < avgDim * 0.07) return;
        
        finalFeatures.push({
          dir,
          points: featPoints,
          center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
          dims: { dx: fdx, dy: fdy, dz: fdz },
          volume: volume
        });
      });
    }
    
    // Sort features by volume descending for ordering/index consistency, but do not slice/cap.
    finalFeatures.sort((a, b) => b.volume - a.volume);
    
    return finalFeatures;
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

    // 물리적 간섭(Ray-casting) 기반 진짜 언더컷 맵 도출
    const { isUndercutMap, slideDirections } = await getPhysicalUndercuts(pos, normals, partingH, _pullAxis, _flipAxis, onProgress);

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
    
    for (let i = 0; i < normals.length; i += 3) {
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
          // 사방이 벽으로 막혔으므로 경사 코어(변형코어)로 판정
          if (!lifterClusters[pDir]) lifterClusters[pDir] = [];
          lifterClusters[pDir].push(vx, vy, vz);
        }
      }
    }

    const avgDim = (dx + dy + dz) / 3;
    const cSize = Math.max(5.0, Math.min(avgDim * 0.12, 25.0));

    const finalSlides = processCoreClusters(slideClusters, cSize, avgDim);
    const finalLifters = processCoreClusters(lifterClusters, cSize, avgDim);

    finalSlides.forEach(feat => {
      moldFeatures.slides.push({ dir: feat.dir, center: feat.center });
    });
    finalLifters.forEach(feat => {
      moldFeatures.lifters.push({ dir: feat.dir, center: feat.center });
    });

    const diagnostics = _getDiagnostics(minDim, maxDim, totalArea, matKey, mat);

    return {
      issues, score, moldFeatures, diagnostics,
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
      colors = computeShrinkageColors(positions, normals);
    } else if (_flowOverlayActive && _flowDistances) {
      colors = computeFlowColors(positions, _flowDistances, _maxFlowDistance, _flowAnimationTime);
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
  }

  function updateCoreHelpers(visible) {
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
    const { isUndercutMap, slideDirections } = getPhysicalUndercuts(pos, norm, partingH, _pullAxis, _flipAxis);

    const slideClusters = {};
    const lifterClusters = {};

    for (let i = 0; i < norm.length; i += 3) {
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
          // 사방이 벽으로 막혔으므로 경사 코어(변형코어)로 판정
          if (!lifterClusters[pDir]) lifterClusters[pDir] = [];
          lifterClusters[pDir].push(vx_val, vy_val, vz_val);
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

    const finalSlides = processCoreClusters(slideClusters, cSize, avgDim);
    const finalLifters = processCoreClusters(lifterClusters, cSize, avgDim);

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
          heap.push(neighKey);
        }
      });
    }
    return distances;
  }

  function computeWeldLineSegments(graph, gateDistancesList, positions, normals) {
    const segments = [];
    if (gateDistancesList.length < 2) return segments;

    const getVertKey = (x, y, z) => `${Math.round(x*1000)/1000},${Math.round(y*1000)/1000},${Math.round(z*1000)/1000}`;
    const offsetVal = 0.5;

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
        const dists = gateDistancesList[g];
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
        const distsU = gateDistancesList[gU];
        const distsV = gateDistancesList[gV];

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
        if (airTrapClusters.length >= 2) break;
      }
    }
    airTrapClusters.forEach(v => defects.push({ type: 'air_trap', pos: v.pos, normal: v.normal, dist: Infinity }));

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
          if (distinct.length >= 2) break;
        }
      }
      distinct.forEach(v => defects.push({ type: 'air_trap', pos: v.pos, normal: v.normal, dist: v.dist }));
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
      
      const segments = (graph && gateDistancesList) ? computeWeldLineSegments(graph, gateDistancesList, positions, normals) : [];
      if (bestWeldVert) {
        defects.push({ type: 'weld_line', pos: bestWeldVert, segments });
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
        const normal = def.normal || new THREE.Vector3(0, 1, 0);
        const ringRadius = Math.max(3.0, avgDim * 0.04);
        
        const geom = new THREE.RingGeometry(ringRadius * 0.8, ringRadius, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
        const m = new THREE.Mesh(geom, mat);
        
        const worldPos = def.pos.clone();
        const worldNormal = normal.clone();
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(_mesh.matrixWorld);
        worldNormal.applyMatrix3(normalMatrix).normalize();
        
        _mesh.localToWorld(worldPos);
        worldPos.add(worldNormal.clone().multiplyScalar(0.5));
        m.position.copy(worldPos);
        
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
        
        const label = createTextSprite('에어 트랩', '#ff00ff', 5);
        label.position.set(0, ringRadius * 1.2, 0);
        m.add(label);
        
        _scene.add(m);
        _defectMarkers.push(m);
      } else if (def.type === 'weld_line') {
        if (def.segments && def.segments.length > 0) {
          const geom = new THREE.BufferGeometry().setFromPoints(def.segments);
          const mat = new THREE.LineBasicMaterial({
            color: 0xffff00,
            linewidth: 3,
            depthWrite: false
          });
          const lineSegments = new THREE.LineSegments(geom, mat);
          _mesh.add(lineSegments);
          _defectMarkers.push(lineSegments);

          const center = new THREE.Vector3();
          def.segments.forEach(p => center.add(p));
          center.divideScalar(def.segments.length);

          const label = createTextSprite('웰드 라인', '#ffff00', 4);
          label.position.copy(center).add(new THREE.Vector3(0, 4, 0));
          _mesh.add(label);
          _defectMarkers.push(label);
        } else {
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
      } else if (def.type === 'shrinkage') {
        const normal = def.normal || new THREE.Vector3(0, 1, 0);
        const ringRadius = Math.max(3.5, avgDim * 0.045);
        
        const geom = new THREE.RingGeometry(ringRadius * 0.8, ringRadius, 32);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff3300, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
        const m = new THREE.Mesh(geom, mat);
        
        const worldPos = def.pos.clone();
        const worldNormal = normal.clone();
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(_mesh.matrixWorld);
        worldNormal.applyMatrix3(normalMatrix).normalize();
        
        _mesh.localToWorld(worldPos);
        worldPos.add(worldNormal.clone().multiplyScalar(0.5));
        m.position.copy(worldPos);
        
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
        
        const label = createTextSprite(`수축 (${def.thickness.toFixed(1)}mm / 냉각:${def.coolingTime ? def.coolingTime.toFixed(1) + 's' : '-'})`, '#ff3300', 4.5);
        label.position.set(0, ringRadius * 1.25, 0);
        m.add(label);
        
        _scene.add(m);
        _defectMarkers.push(m);
      }
    });
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
        // 충진 시간 비율: 0 = 게이트(파랑), 1 = 최후충진(빨강)
        const t = maxDist > 0 ? Math.min(1.0, d / maxDist) : 0;

        if (t < 0.2) {
          // Blue → Cyan
          const s = t / 0.2;
          r = 0.0; g = s; b = 1.0;
        } else if (t < 0.4) {
          // Cyan → Green
          const s = (t - 0.2) / 0.2;
          r = 0.0; g = 1.0; b = 1.0 - s;
        } else if (t < 0.6) {
          // Green → Yellow
          const s = (t - 0.4) / 0.2;
          r = s; g = 1.0; b = 0.0;
        } else if (t < 0.8) {
          // Yellow → Orange
          const s = (t - 0.6) / 0.2;
          r = 1.0; g = 1.0 - s * 0.5; b = 0.0;
        } else {
          // Orange → Red
          const s = (t - 0.8) / 0.2;
          r = 1.0; g = 0.5 - s * 0.5; b = 0.0;
        }

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

    // 멀티 소스 대안: 각 게이트별 도달 시간(Arrival Time = 거리 / 속도)을 개별 계산하여 합성
    const vertexCount = positions.length / 3;
    _flowDistances = new Float32Array(vertexCount).fill(Infinity);
    let maxDist = 0;

    const gateArrivalsList = [];
    _gatePositions.forEach((gp, gIdx) => {
      const startKey = findClosestGraphNode(gp, graph);
      if (startKey) {
        const dists = calculateFlowDistances(startKey, graph);
        const wVal = _gateVelocityRatios[gIdx] !== undefined ? _gateVelocityRatios[gIdx] : 1.0;
        
        // 도달 시간 맵 생성
        const arrivals = {};
        for (const key in dists) {
          const d = dists[key];
          arrivals[key] = (d !== Infinity && wVal > 0) ? (d / wVal) : Infinity;
        }
        gateArrivalsList.push(arrivals);
      }
    });

    for (let i = 0; i < positions.length; i += 3) {
      const k = getVertKey(positions[i], positions[i+1], positions[i+2]);
      let minArrival = Infinity;
      
      gateArrivalsList.forEach(arrivals => {
        const arrival = arrivals[k];
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

    // Weld line 및 air trap 결함 예측 시 물리 도달 시간 기준 합성맵 전달
    const defects = predictDefects(graph, gateArrivalsList);
    createDefectMarkers(defects);
    _flowAnimationTime = 0;
    recolorGeometry();

    const minDim = Math.min(modelSize.x, modelSize.y, modelSize.z);
    const maxDim = Math.max(modelSize.x, modelSize.y, modelSize.z);
    const totalArea = (positions.length / 9) * 10; // estimate
    const diagnostics = _getDiagnostics(minDim, maxDim, totalArea, _material);

    return { maxFlowDistance: _maxFlowDistance, defects, diagnostics };
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
      defects: res.defects,
      diagnostics: res.diagnostics
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
  return { resizeViewer, parseSTL, parseSTP, initViewer, loadGeometry, analyze, toggleOverlay, setWireframe, resetCamera, setPullAxis, setFlipAxis, recolorGeometry, updateCoreHelpers, updatePartingLine, setGateSettingMode, isGateSettingMode, onViewerClick, getGatePosition, getGatePositions, addGatePosition, removeGateAt, recalculateFlow, toggleFlowOverlay, toggleShrinkageOverlay, setFlowAnimationTime, clearGate, highlightCore, resetCoreHighlights, getCanvas, onGateRepositioned, onRightClickModel, setPhysicalParams, calculateCoolingTime, setRunnerType, setGateParams };


})();
