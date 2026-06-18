// Injection Verification Tool (DIMA) — Tauri desktop shell
// 기존 C# HttpListener 런처를 대체한다. 기존 app/ (HTML/JS/occt WASM)과
// Python 솔버를 그대로 재사용하며, 다음을 제공한다:
//   - 정적 파일 서빙 (COOP/COEP + .wasm MIME, occt WASM 호환)
//   - POST /solve-flow-python  → python solve_cli.py 실행
//   - POST /cleanup-cad        → 백그라운드 AutoCAD 프로세스 정리
//   - (옵션) Flask server.py 사이드카 기동 (AI 리뷰 등 /api/* 경로)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::Manager;
use tiny_http::{Header, Method, Response, Server};

/// 종료 시 정리할 자식 프로세스(Flask 등)
struct Children(Mutex<Vec<Child>>);

fn find_free_port(start: u16) -> u16 {
    for p in start..start + 100 {
        if TcpListener::bind(("127.0.0.1", p)).is_ok() {
            return p;
        }
    }
    start
}

fn mime_for(path: &str) -> &'static str {
    let p = path.to_lowercase();
    if p.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if p.ends_with(".js") {
        "application/javascript; charset=utf-8"
    } else if p.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if p.ends_with(".wasm") {
        "application/wasm"
    } else if p.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if p.ends_with(".png") {
        "image/png"
    } else if p.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

fn hdr(k: &str, v: &str) -> Header {
    Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap()
}

/// 최소 percent-decoder (gates JSON 쿼리 디코딩용)
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let h = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2]));
                if let (Some(a), Some(b)) = h {
                    out.push(a * 16 + b);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// "a=b&c=d" → 특정 key 값
fn query_get(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (it.next(), it.next()) {
            if k == key {
                return Some(v.to_string());
            }
        }
    }
    None
}

/// 솔버 실행 프로그램 결정: 번들된 solve_cli(.exe) 우선, 없으면 시스템 python + 스크립트.
/// 반환: (프로그램 경로, 선행 인자들)
fn solver_invocation(bin_dir: &Option<PathBuf>, backend_dir: &Path) -> (String, Vec<String>) {
    let exe_name = if cfg!(windows) { "solve_cli.exe" } else { "solve_cli" };
    if let Some(b) = bin_dir {
        let p = b.join(exe_name);
        if p.exists() {
            return (p.to_string_lossy().to_string(), vec![]);
        }
    }
    (
        python_exe().to_string(),
        vec![backend_dir.join("solve_cli.py").to_string_lossy().to_string()],
    )
}

/// solve_cli 실행(번들 exe 또는 python 스크립트) → stdout(JSON) 반환
fn run_solver(backend_dir: &Path, bin_dir: &Option<PathBuf>, query: &str, stl_bytes: &[u8]) -> Result<String, String> {
    let gates = query_get(query, "gates").map(|g| url_decode(&g)).unwrap_or_else(|| "[]".to_string());
    let resolution = query_get(query, "resolution").unwrap_or_else(|| "0.5".to_string());
    let cooling = query_get(query, "cooling_enabled").unwrap_or_else(|| "false".to_string());
    let coolant = query_get(query, "coolant_temp").unwrap_or_else(|| "25.0".to_string());
    let melt = query_get(query, "melt_temp").unwrap_or_else(|| "230.0".to_string());

    let tmp = std::env::temp_dir().join("DIMA");
    let _ = fs::create_dir_all(&tmp);
    let stl_path = tmp.join(format!("{}.stl", uniq()));
    let gates_path = tmp.join(format!("{}.json", uniq()));
    fs::write(&stl_path, stl_bytes).map_err(|e| e.to_string())?;
    fs::write(&gates_path, gates).map_err(|e| e.to_string())?;

    let (program, lead_args) = solver_invocation(bin_dir, backend_dir);
    let output = Command::new(&program)
        .args(&lead_args)
        .arg("--stl").arg(&stl_path)
        .arg("--gates_file").arg(&gates_path)
        .arg("--resolution").arg(&resolution)
        .arg("--cooling_enabled").arg(&cooling)
        .arg("--coolant_temp").arg(&coolant)
        .arg("--melt_temp").arg(&melt)
        .current_dir(backend_dir)
        .output()
        .map_err(|e| format!("솔버 실행 실패({}): {}", program, e))?;

    let _ = fs::remove_file(&stl_path);
    let _ = fs::remove_file(&gates_path);

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn cleanup_cad() -> String {
    // Windows: 백그라운드 AutoCAD(acad.exe) 종료
    #[cfg(windows)]
    {
        let r = Command::new("taskkill")
            .args(["/IM", "acad.exe", "/F"])
            .output();
        return match r {
            Ok(o) if o.status.success() => "AutoCAD 백그라운드 프로세스를 정리했습니다.".into(),
            _ => "정리할 AutoCAD 프로세스가 없습니다.".into(),
        };
    }
    #[cfg(not(windows))]
    {
        "이 플랫폼에서는 CAD 정리를 지원하지 않습니다.".into()
    }
}

fn python_exe() -> &'static str {
    // 시스템 PATH의 python 사용 (기존 C# 런처와 동일 가정)
    if cfg!(windows) {
        "python"
    } else {
        "python3"
    }
}

fn uniq() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("dima_{}", n)
}

/// 임베디드 HTTP 서버 시작 (정적 + 솔버 엔드포인트)
fn start_server(port: u16, app_root: PathBuf, bin_dir: Option<PathBuf>) {
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("HTTP 서버 시작 실패: {}", e);
            return;
        }
    };
    let backend_dir = app_root.join("python_backend");

    for mut request in server.incoming_requests() {
        let method = request.method().clone();
        let url = request.url().to_string();
        let (path, query) = match url.split_once('?') {
            Some((p, q)) => (p.to_string(), q.to_string()),
            None => (url.clone(), String::new()),
        };

        // ---- POST /solve-flow-python ----
        if method == Method::Post && path == "/solve-flow-python" {
            let mut body = Vec::new();
            let _ = request.as_reader().read_to_end(&mut body);
            let resp = match run_solver(&backend_dir, &bin_dir, &query, &body) {
                Ok(stdout) => Response::from_string(stdout)
                    .with_header(hdr("Content-Type", "application/json; charset=utf-8")),
                Err(err) => Response::from_string(format!("Python Solver Error: {}", err))
                    .with_status_code(500u16)
                    .with_header(hdr("Content-Type", "text/plain; charset=utf-8")),
            };
            let _ = request.respond(resp);
            continue;
        }

        // ---- POST /cleanup-cad ----
        if method == Method::Post && path == "/cleanup-cad" {
            let msg = cleanup_cad();
            let _ = request.respond(
                Response::from_string(msg).with_header(hdr("Content-Type", "text/plain; charset=utf-8")),
            );
            continue;
        }

        // ---- 정적 파일 ----
        let mut rel = if path == "/" || path.is_empty() { "/index.html".to_string() } else { path.clone() };
        rel = rel.replace("..", "").replace("//", "/");
        let file_path = app_root.join(rel.trim_start_matches('/'));

        // 경로 탈출 방지
        if !file_path.starts_with(&app_root) {
            let _ = request.respond(Response::from_string("Forbidden").with_status_code(403u16));
            continue;
        }

        match fs::read(&file_path) {
            Ok(data) => {
                let mime = mime_for(file_path.to_string_lossy().as_ref());
                let resp = Response::from_data(data)
                    .with_header(hdr("Content-Type", mime))
                    .with_header(hdr("Cache-Control", "no-cache"))
                    // occt-import-js(WASM) 호환을 위한 격리 헤더
                    .with_header(hdr("Cross-Origin-Opener-Policy", "same-origin"))
                    .with_header(hdr("Cross-Origin-Embedder-Policy", "require-corp"));
                let _ = request.respond(resp);
            }
            Err(_) => {
                let _ = request.respond(Response::from_string("Not Found").with_status_code(404u16));
            }
        }
    }
}

/// Flask(server.py) 사이드카 기동 (AI 리뷰 등 /api/* 경로). 실패해도 무시.
/// 번들된 server(.exe) 우선, 없으면 시스템 python + server.py.
fn spawn_flask(app_root: &Path, bin_dir: &Option<PathBuf>) -> Option<Child> {
    let exe_name = if cfg!(windows) { "server.exe" } else { "server" };
    if let Some(b) = bin_dir {
        let p = b.join(exe_name);
        if p.exists() {
            return Command::new(&p)
                .current_dir(app_root)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .ok();
        }
    }
    let server_py = app_root.join("server.py");
    if !server_py.exists() {
        return None;
    }
    Command::new(python_exe())
        .arg(&server_py)
        .current_dir(app_root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()
}

fn resolve_app_root(app: &tauri::App) -> PathBuf {
    // 1) 번들된 리소스(app-bundle) 우선
    if let Some(p) = app.path_resolver().resolve_resource("app-bundle") {
        if p.exists() {
            return p;
        }
    }
    // 2) 개발 모드 폴백: ../../app
    if let Ok(cwd) = std::env::current_dir() {
        let dev = cwd.join("..").join("..").join("app");
        if dev.exists() {
            return dev;
        }
    }
    PathBuf::from("app-bundle")
}

/// 번들된 Python exe 디렉터리(bin) 해석. 없으면 None → 시스템 python 폴백.
fn resolve_bin_dir(app: &tauri::App) -> Option<PathBuf> {
    if let Some(p) = app.path_resolver().resolve_resource("bin") {
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn main() {
    tauri::Builder::default()
        .manage(Children(Mutex::new(Vec::new())))
        .setup(|app| {
            let app_root = resolve_app_root(app);
            let bin_dir = resolve_bin_dir(app);
            let port = find_free_port(8899);

            // Flask 사이드카(있으면) 기동 후 정리 목록에 등록
            if let Some(child) = spawn_flask(&app_root, &bin_dir) {
                app.state::<Children>().0.lock().unwrap().push(child);
            }

            // 임베디드 서버 스레드 시작
            let root_clone = app_root.clone();
            let bin_clone = bin_dir.clone();
            thread::spawn(move || start_server(port, root_clone, bin_clone));

            // 메인 창 생성 → 로컬 서버 로드
            let url = format!("http://127.0.0.1:{}/index.html", port);
            tauri::WindowBuilder::new(
                app,
                "main",
                tauri::WindowUrl::External(url.parse().unwrap()),
            )
            .title("Injection Verification Tool")
            .inner_size(1400.0, 900.0)
            .min_inner_size(1024.0, 680.0)
            .build()?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 앱 초기화 실패")
        .run(|app_handle, event| {
            // 종료 시 사이드카 프로세스 정리
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(children) = app_handle.try_state::<Children>() {
                    for mut c in children.0.lock().unwrap().drain(..) {
                        let _ = c.kill();
                    }
                }
            }
        });
}
