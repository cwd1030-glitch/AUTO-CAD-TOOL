======================================
  DIMA - Design Integrity & Manufacturability AI
  설계 검증 AI 플랫폼 (오프라인 패키지)
======================================

■ 실행 방법
-----------
▶ DIMA 실행.bat 을 더블클릭하면 자동으로 실행됩니다.

■ 요구 사항
-----------
- Windows 10 / 11
- Chrome 또는 Edge 브라우저 (설치 필요)
- 인터넷 연결 불필요 (모든 라이브러리 포함)

■ 테스트 파일
-----------
- samples\sample_bracket.dxf  → 2D 검증 테스트용
- samples\sample_part.stl     → 3D 분석 테스트용

■ 사용 방법
-----------
1. [2D 검증] 탭 → DXF 파일 업로드 → 분석 시작
2. [3D 검증] 탭 → STL 파일 업로드 → 소재 선택 → 사출성형 분석
3. [리포트]  탭 → 분석 완료 후 통합 리포트 확인

■ 폴더 구조
-----------
index.html          ← 메인 파일
css/style.css       ← 스타일
js/
  main.js           ← 앱 로직
  dxf-analyzer.js   ← 2D 분석
  stl-analyzer.js   ← 3D 분석
libs/               ← 오프라인 라이브러리 (Three.js 등)
samples/            ← 샘플 테스트 파일

■ 문의
-----------
DIMA v1.0 Prototype
설계 검증 AI 플랫폼 — 오프라인 패키지
