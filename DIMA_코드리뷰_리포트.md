# DIMA 코드 리뷰 · 신뢰성 개선 리포트

작성일: 2026-06-14 · 대상: DIMA (사출 검증 플랫폼) · 범위: 전체(백엔드 + 프런트엔드 + 통합 흐름)

---

## 요약

핵심 연산 솔버(유동·냉각·싱크마크)와 서버, 프런트엔드 연동을 전체 점검했다.
수치 안정성을 깨뜨리는 **분모 0 / NaN 결함 2건**과 패키지 배포판에서 위험한 **Flask 디버그 모드** 등 신뢰성 직결 이슈를 우선 수정했고,
솔버 핵심에 대한 **자동화 테스트 18종을 신규 작성·전부 통과**시켰다. 구조적 개선 권고는 별도로 정리했다.

수정은 모두 동작을 바꾸지 않는 안전한 범위(가드 추가, 예외 처리 강화, 설정 외부화)에서만 적용했고,
물리 계산식·결과 형식은 그대로 유지했다.

---

## 1. 시스템 구조 (확인된 실제 동작)

| 구성 | 역할 | 포트/실행 |
| --- | --- | --- |
| DIMA.exe (C# HttpListener) | 정적 파일 서빙 + `/solve-flow-python`(→`solve_cli.py` 호출) + `/convert-dwg`(AutoCAD COM) + `/cleanup-cad` | 8899 (`.dima_port`) |
| `solve_cli.py` | **실제 운영 솔버 진입점** (voxelize → flow → cooling → warpage) | exe가 `python`으로 spawn |
| `server.py` (Flask) | `/api/analyze`, `/api/ai-review`, `/api/multi-ai-review` | 5000 (별도) |
| 프런트엔드 JS | `stl-analyzer.js`는 `/solve-flow-python`(8899), `app.js`·`main.js`는 `http://127.0.0.1:5000`(Flask) 호출 | 브라우저 |

→ **운영 경로(stl-analyzer → exe → solve_cli)** 와 **Flask 경로** 가 공존하며 포트가 다르다(통합 이슈 M-1 참고).

---

## 2. 우선순위별 발견 이슈

### 🔴 HIGH — 수치 안정성/보안 (수정 완료)

**H-1. 싱크마크 계산의 0 나눗셈 → NaN 전파**
`cooling_solver.calculate_warpage_and_sink` 에서 `solidification_time / np.max(solidification_time)`.
고화시간이 전부 0인 경우(예: 형상 전용 모드, 데이터 부족 시) `0/0 = NaN` 이 발생해 `sink_risk` 가 NaN으로 오염되고,
JSON 응답을 거쳐 프런트엔드 3D 히트맵 색상 계산까지 깨진다.
→ **수정:** 최대값이 0 이하이면 1.0으로 대체하는 가드 추가. (회귀 테스트 `test_all_zero_solidification_no_nan` 추가)

**H-2. 냉각 솔버의 0 입력 → 0 나눗셈 → NaN 온도장**
`diameter=0` 이면 `u = 4Q/(πD²)`, `h = Nu·k/D` 에서 division-by-zero,
`coolant_flow=0` 이면 속도·레이놀즈수가 0이 되어 전열계수가 비정상.
→ **수정:** `resolution/depth/diameter/coolant_flow` 를 작은 양수 최소값으로 클램프. (`test_zero_diameter_guarded`, `test_zero_flow_guarded` 추가)

**H-3. Flask 디버그 모드가 배포판에서 ON**
`app.run(..., debug=True)` 는 오프라인 패키지 앱에 부적절하다. Werkzeug 대화형 디버거는 임의 코드 실행 경로가 되고,
리로더가 프로세스를 이중 기동한다.
→ **수정:** 환경변수로 외부화. 기본 `debug=False`, 포트도 `DIMA_FLASK_PORT`(기본 5000)로 설정 가능. 개발 시에만 `DIMA_DEBUG=1`.

### 🟠 MEDIUM — 견고성/운영 (일부 수정, 일부 권고)

**M-1. 백엔드 이중화 · 포트 불일치 (권고)**
운영은 8899(exe)인데 `app.js`·`main.js`·`app-connector.js` 는 `http://127.0.0.1:5000` 를 하드코딩한다.
Flask가 함께 기동되지 않으면 해당 기능(AI 리뷰 등 일부 경로)은 조용히 실패한다.
→ **권고:** 백엔드를 하나로 통합하거나, 프런트의 베이스 URL을 `.dima_port` 기반으로 동적 구성. 하드코딩 포트 제거.

**M-2. 임시 STL 파일 누수 (수정 완료)**
`flow_solver.get_or_create_voxel_grid` 에서 voxelize 실패 시 임시 파일이 삭제되지 않아 temp 디렉터리가 누적된다.
→ **수정:** `try/finally` 로 항상 정리.

**M-3. 잘못된 Content-Type 요청 시 500 (수정 완료)**
`request.json` 은 JSON이 아닌 본문에서 예외를 던질 수 있다.
→ **수정:** 세 핸들러 모두 `request.get_json(silent=True)` + 명확한 400 응답으로 변경.

**M-4. solve_cli 오류가 무진단 (수정 완료)**
예외 시 한 줄 메시지만 stdout으로 내보내 exe 로그에 원인이 남지 않았다.
→ **수정:** stderr에 전체 트레이스백 출력(프런트로 가는 친화적 메시지/종료코드 계약은 유지).

**M-5. `app-connector.js` 가 `cooling_enabled` 미전송 (권고)**
`/api/simulate` 호출 페이로드에 냉각 플래그가 빠져 항상 형상 전용 모드로 동작한다(레거시 가능성). 사용 여부 확인 후 정리 권고.

**M-6. 멀티-AI API 키를 프런트에서 본문으로 전송 (보안 권고)**
`/api/multi-ai-review` 가 클라이언트가 보낸 OpenAI/Gemini/Claude 키를 받는다. 키는 서버 `.env`에 두고 클라이언트 노출을 피하는 것을 권고.

### 🟡 LOW — 코드 품질/유지보수 (권고)

- **L-1.** `cooling_solver` 채널 마스크의 `(x - x)**2` 는 항상 0인 죽은 항이다(채널이 x축으로 1복셀 폭). 동작엔 무해하나 의도 오타로 보임 — 물리 변경 위험이 있어 이번엔 보존, 별도 검토 권고.
- **L-2.** 솔버 모듈이 `app/` 과 `app/python_backend/` 에 중복 존재하고 import가 `sys.path` 순서에 의존한다. 단일 위치로 정리 권고.
- **L-3.** `stl-analyzer.js`(4,472줄)·`main.js`(2,484줄) 등 대형 파일 — 기능별 모듈 분리 권고.
- **L-4.** 자동화 테스트 부재 → 본 리뷰에서 솔버 테스트 18종 신규 작성.

---

## 3. 적용한 수정 (파일별)

| 파일 | 변경 | 유형 |
| --- | --- | --- |
| `app/python_backend/cooling_solver.py` | 0 입력 가드(H-2), 싱크마크 max 0 가드(H-1) | 버그 수정 |
| `app/python_backend/solve_cli.py` | 예외 시 stderr 트레이스백(M-4) | 진단 강화 |
| `app/flow_solver.py` | 임시파일 `try/finally` 정리(M-2) | 버그 수정 |
| `app/server.py` | 디버그/포트 외부화(H-3), `get_json(silent=True)`(M-3) | 보안/견고성 |
| `app/python_backend/test_solvers.py` | 신규 테스트 18종 | 테스트 |

모두 결과 데이터 형식과 물리식을 유지하는 **하위 호환** 변경이다.

---

## 4. 테스트

`app/python_backend/test_solvers.py` — 의존성: `numpy, scipy, trimesh, pytest`

```
cd app/python_backend
python -m pytest test_solvers.py -v
```

**결과: 18 passed.** 커버리지 항목:

- 유동 솔버: 출력 계약, 캐비티 전체 충진, 솔리드 미충진, 게이트 기준 단조성, 2게이트 웰드라인 검출, speed_factor=0 무크래시, 캐비티 밖 게이트 무시
- 냉각 솔버: 출력 계약, **NaN/Inf 미발생**, 사이클타임 양수, **diameter=0 가드**, **flow=0 가드**, 빈 그리드 무크래시
- 싱크/휨: 출력 계약, 위험도 0~1 범위, **전(全) 0 고화시간 NaN 회귀**, 빈 그리드 0 반환
- 통합: 냉각→온도연계 유동→싱크마크 파이프라인 전체 유한성

권장: 이 테스트를 CI 또는 빌드 스크립트(`compile_exe.ps1`)에 연결해 회귀를 자동 차단.

---

## 5. 성능 권고 (선택)

- **C-1. 냉각 FDM 루프** — 명시적 오일러 1,500스텝 × NumPy 전배열 연산. 대형 모델에서 가장 큰 비용. 해상도 적응(현재 프런트에서 일부 적용)·조기 종료 조건은 양호. 추가로 정상상태 근사/멀티그리드 또는 스텝당 조기수렴 체크로 단축 여지.
- **C-2. `calculate_warpage_and_sink` 의 3중 파이썬 루프** — `shape` 가 커지면 병목. NumPy 벡터화(슬라이딩 윈도 합은 `scipy.ndimage.uniform_filter`로 대체 가능)로 수십 배 가속 가능.
- **C-3. voxelize 결과 캐시**(`mesh_cache`)는 좋음. 다만 base64 경로는 캐시 키가 없어 매번 재복셀화 — 해시 기반 키 추가 권고.

---

## 부록 — 검증 환경

numpy 2.2.6 / scipy 1.15.3 / trimesh 4.12.2, Python 3.10. 솔버 로직을 격리 실행해 18 테스트 전부 통과 확인.
