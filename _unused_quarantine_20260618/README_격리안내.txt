[DIMA 정리 - 미사용 파일 격리]  2026-06-18

아래 파일들은 어떤 코드(index.html, desktop-tauri, *.bat, *.py)에서도
참조되지 않는 미사용 파일로 확인되어 이곳으로 이동했습니다.
(영구 삭제가 아니라 격리이며, 필요 시 원위치로 되돌릴 수 있습니다.)

 - temp_main.js   : main.js 의 옛 임시 덤프(루트). 참조 없음.
 - temp_stl.js    : stl-analyzer.js 의 옛 임시 덤프(루트). 참조 없음.
 - frontend/app.js: index.html 없는 고아 파일. app/js/app.js 와 별개. 참조 없음.

문제 없이 1~2일 사용해 본 뒤 이 폴더(_unused_quarantine_20260618)를
통째로 삭제하면 됩니다.
