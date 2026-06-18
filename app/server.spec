# PyInstaller spec — server (Flask AI 리뷰 서버) 무설치 단독 exe
# 빌드:  pyinstaller --noconfirm --clean server.spec   (app/ 에서)
# 산출:  dist/server(.exe)
#
# server.py 는 app/ 의 flow_solver/cooling_solver/sinkmark_solver 와
# python_backend 의 솔버, 그리고 flask/flask_cors/dotenv/google.generativeai 를 사용한다.
# (이 exe 는 멀티-AI 리뷰 등 온라인 기능 전용 — 오프라인 코어 분석에는 불필요)

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ['trimesh', 'scipy', 'numpy', 'flask', 'flask_cors',
            'google.generativeai', 'dotenv']:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

hiddenimports += [
    'scipy.spatial.transform._rotation_groups',
    'scipy.special._cdflib',
]

block_cipher = None

a = Analysis(
    ['server.py'],
    pathex=['.', 'python_backend'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=['matplotlib', 'PyQt5', 'PySide2', 'tkinter', 'IPython', 'pytest'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,  # 백그라운드 서버
)
