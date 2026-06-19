DIMA - Design Integrity & Manufacturability AI
==============================================

실행 방법
---------
루트 폴더의 DIMA.exe 하나만 실행하면 됩니다.

  DIMA.exe

실행 후 브라우저에서 자동으로 DIMA 화면이 열립니다.
자동으로 열리지 않으면 아래 주소를 직접 입력하세요.

  http://localhost:8899

정리 사항
---------
사용자가 헷갈리지 않도록 루트 폴더의 실행 진입점은 DIMA.exe 하나로 정리했습니다.
기존 배치 실행 파일과 중복 app/DIMA.exe는 삭제하지 않고 아래 폴더에 보관했습니다.

  _unused_quarantine_20260618\legacy_launchers

주요 기능
---------
- 2D DXF/DWG 도면 검증
- 3D STL/STEP 사출물 분석
- 사출 성형성, 싱크마크, 수축, 변형, 웰드라인, 에어트랩 위험 예측
- Moldflow 스타일 생산 적합성 대시보드
- 통합 리포트 출력

개발/빌드 파일
--------------
개발용 스크립트와 빌드 도구는 development 폴더에 남겨두었습니다.
일반 사용자는 DIMA.exe만 실행하면 됩니다.
