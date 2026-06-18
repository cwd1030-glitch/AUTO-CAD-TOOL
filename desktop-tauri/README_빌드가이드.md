# Injection Verification Tool — Tauri 데스크톱 빌드 가이드

기존 DIMA 분석 엔진(`app/` 의 HTML/JS/occt WASM + Python 솔버)을 **그대로 재사용**하면서,
C# 런처를 **Tauri 셸**로 교체해 네이티브 Windows 설치 프로그램(Setup.exe)을 생성합니다.

> ⚠️ **이 패키지는 스캐폴드입니다.** Tauri 설치 프로그램은 **Windows에서만** 빌드됩니다
> (WebView2 + NSIS 번들러). 아래 절차를 Windows PC에서 실행하면 `Setup.exe` 가 나옵니다.
> (이 작업은 Linux 샌드박스에서 작성·검증되어 Rust 컴파일은 수행하지 못했습니다 — JSON/구조/라우트 로직은 점검 완료.)

---

## 1. 동작 구조

```
[Tauri 창 (WebView2)]
        │  http://127.0.0.1:8899/index.html
        ▼
[Rust 내장 HTTP 서버 (main.rs)]
   ├─ 정적 파일 서빙 (app-bundle/, COOP·COEP + .wasm MIME)
   ├─ POST /solve-flow-python → python solve_cli.py 실행
   ├─ POST /cleanup-cad       → acad.exe 정리
   └─ (옵션) Flask server.py 사이드카 → /api/* (AI 리뷰)
```

기존 프런트엔드 코드는 **수정 없이** 그대로 동작합니다(상대경로 `/solve-flow-python` 등을 그대로 사용).

---

## 2. 사전 요구사항 (Windows)

| 항목 | 설치 |
| --- | --- |
| Rust | https://rustup.rs (`rustup`, stable) |
| Microsoft Edge WebView2 Runtime | 대부분 Win10/11 기본 포함, 없으면 MS에서 설치 |
| Node.js 18+ | https://nodejs.org |
| Python 3.10+ | https://python.org — 그리고 `pip install -r app/requirements.txt` |
| Visual Studio Build Tools (C++) | Rust 링커용 (MSVC) |

---

## 3. 빌드 절차 (무설치 배포)

```bash
cd desktop-tauri

# 1) Tauri CLI 설치
npm install

# 2) 아이콘 생성 (로고 PNG 1장 → 모든 규격 자동 생성)
npm run icon -- ..\\로고.png      # 또는 임의 1024x1024 PNG

# 3) ★ Python 무설치 번들 생성 (solve_cli.exe / server.exe)
powershell -ExecutionPolicy Bypass -File build-python.ps1

# 4) 개발 실행 (디버그)
npm run dev

# 5) 배포 빌드 → Setup.exe 생성
npm run build
```

빌드 산출물 위치:

```
desktop-tauri/src-tauri/target/release/bundle/nsis/
    Injection Verification Tool_1.0.0_x64-setup.exe   ← 배포용 Setup.exe
```

`beforeBuildCommand` 가 `app/` → `app-bundle/` 복사를 자동 수행합니다. 3번 단계가
`src-tauri/bin/` 에 Python exe 를 만들고 Tauri 가 함께 번들링합니다.

---

## 4. Python 무설치 번들 (배포 기본값) ★

PyInstaller 로 솔버/서버를 **단독 실행 exe** 로 묶어 **대상 PC 에 Python·pip 설치가 전혀 필요 없습니다.**

- `build-python.ps1` → `src-tauri/bin/solve_cli.exe`(필수), `server.exe`(선택, AI 리뷰용)
- 런타임: `main.rs` 가 `bin/solve_cli.exe` 가 있으면 호출하고, **없으면 시스템 `python` 으로 자동 폴백**합니다.
  → 개발 PC 에서는 번들 없이 `npm run dev` 만으로 동작, 배포본은 번들 exe 로 무설치 동작.
- spec: `app/python_backend/solve_cli.spec`, `app/server.spec` (trimesh·scipy·numpy 등 `collect_all` 포함)

> 빌드 머신(개발 PC)에만 Python 3.10+ 와 `requirements.txt` 가 필요합니다(번들 생성 시).
> **최종 사용자 PC 에는 아무것도 설치할 필요가 없습니다.**

---

## 5. 자동 업데이트 활성화 (선택)

`tauri.conf.json` 의 `tauri.updater` 는 기본 **비활성**입니다. 사용하려면:

1. 키 생성: `npm run tauri signer generate -- -w update.key`
2. `pubkey` 에 공개키, `endpoints` 에 업데이트 서버 URL 입력, `active: true`
3. `bundle.targets` 에 `"updater"` 추가 후 재빌드 → `.sig` 파일과 함께 배포

---

## 6. 라이선스 정책

요청대로 **로그인·회원가입·시리얼·동글·온라인 인증·구독 결제·라이선스 서버 전부 없음.**
설치 후 즉시 사용 가능하며 인터넷 없이 동작합니다(AI 리뷰 등 외부 API 기능 제외).

---

## 7. 현재 상태 / 다음 단계

✅ 완료: Tauri 셸, 내장 서버(정적+solver+cleanup), Flask 사이드카, NSIS 설치 설정, 빌드 스크립트
✅ 완료: **Python 무설치 번들**(PyInstaller spec + `build-python.ps1` + 번들 exe 우선 호출/폴백)
⬜ 2차 권장: 아이콘 에셋(`npm run icon`), `.ivp` 프로젝트 저장, PDF 리포트, 자동 업데이트 서버, IGES 로더
⬜ Parasolid(.x_t): 상용 SDK 필요 — 별도 검토

### 검증 메모 (이 스캐폴드 작성 환경 = Linux 샌드박스)
- ✅ 솔버 파이프라인은 numpy/scipy/trimesh로 정상 동작 확인(단위·통합 테스트 18종 + STP→STL→voxel 왕복)
- ✅ PyInstaller `collect_all` 메커니즘 검증(numpy·trimesh 의존 트리 정상 해석)
- ⚠️ 전체 EXE/Setup.exe 빌드는 **Windows 빌드 PC에서 수행 필요**(WebView2/NSIS는 Windows 전용, scipy 번들은 메모리 큰 머신 필요). 샌드박스에서는 컴파일 미수행.
