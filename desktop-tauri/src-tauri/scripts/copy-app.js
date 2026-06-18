// 빌드 전 ../../app (기존 DIMA 프런트+백엔드)을 src-tauri/app-bundle 로 복사한다.
// Tauri 가 이 디렉터리를 리소스로 번들링하고, 런타임에 Rust 셸이 서빙/실행한다.
const fs = require('fs');
const path = require('path');

const srcApp = path.resolve(__dirname, '..', '..', '..', 'app');
const destApp = path.resolve(__dirname, '..', 'app-bundle');

// 번들에서 제외할 항목(용량/불필요)
const EXCLUDE = new Set(['__pycache__', '.dima_port', 'DIMA.exe', '.env']);

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.error('[copy-app] 원본 app 폴더를 찾을 수 없습니다:', src);
    process.exit(1);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 깨끗하게 재복사
if (fs.existsSync(destApp)) fs.rmSync(destApp, { recursive: true, force: true });
copyDir(srcApp, destApp);
console.log('[copy-app] app → app-bundle 복사 완료:', destApp);
