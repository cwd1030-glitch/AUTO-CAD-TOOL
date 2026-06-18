/**
 * main.js — Electron 데스크톱 진입점 (설치형 앱)
 * 내부 HTTP 서버(COOP/COEP + .wasm MIME)로 앱을 서빙한 뒤 창에서 로드한다.
 * → STP(occt-import-js WASM) 및 SharedArrayBuffer가 안정적으로 동작한다.
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');

let win;
let server;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.stl': 'application/octet-stream', '.stp': 'application/octet-stream',
  '.step': 'application/octet-stream', '.dxf': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8'
};

function findFreePort(start, cb) {
  let port = start;
  function tryPort() {
    const tester = net.createServer()
      .once('error', () => { port++; if (port < start + 100) tryPort(); else cb(start); })
      .once('listening', () => tester.close(() => cb(port)))
      .listen(port, '127.0.0.1');
  }
  tryPort();
}

function startServer(baseDir, cb) {
  server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
      urlPath = urlPath.replace(/\.\.(\/|\\)/g, '').replace(/^[/\\]+/, '');
      const filePath = path.join(baseDir, urlPath);
      if (!filePath.startsWith(baseDir)) { res.statusCode = 403; res.end('Forbidden'); return; }

      fs.readFile(filePath, (err, data) => {
        if (err) { res.statusCode = 404; res.end('Not found'); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        // STP WASM / SharedArrayBuffer 활성화
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.statusCode = 200;
        res.end(data);
      });
    } catch (e) { res.statusCode = 500; res.end('Server error'); }
  });

  findFreePort(8899, (port) => {
    server.listen(port, '127.0.0.1', () => cb(port));
  });
}

function createWindow() {
  const baseDir = __dirname;
  startServer(baseDir, (port) => {
    win = new BrowserWindow({
      width: 1400,
      height: 900,
      backgroundColor: '#080c18',
      title: 'DIMA CAD',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    win.setMenuBarVisibility(false);
    win.loadURL('http://127.0.0.1:' + port + '/');
    win.on('closed', () => { win = null; });
  });
}

app.whenReady().then(createWindow);

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

app.on('window-all-closed', () => {
  try { if (server) server.close(); } catch (e) {}
  app.quit();
});
