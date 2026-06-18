# PyInstaller spec — solve_cli (사출 솔버 CLI) 무설치 단독 exe
# 빌드:  pyinstaller --noconfirm --clean solve_cli.spec   (app/python_backend 에서)
# 산출:  dist/solve_cli(.exe)
#
# solve_cli.py 는 같은 폴더의 voxelizer/solver/cooling_solver 와
# numpy/scipy/trimesh 를 사용한다. trimesh·scipy 는 동적 로딩이 많아
# collect_all 로 데이터/바이너리/은닉 임포트를 모두 포함한다.

from PyInstaller.utils.hooks import collect_all

datas, binaries, hiddenimports = [], [], []
for pkg in ['trimesh', 'scipy', 'numpy']:
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

# trimesh 가 선택적으로 부르는 모듈 보강
hiddenimports += [
    'scipy.spatial.transform._rotation_groups',
    'scipy.special._cdflib',
    'numpy.core._dtype_ctypes',
]

block_cipher = None

a = Analysis(
    ['solve_cli.py'],
    pathex=['.'],
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
    name='solve_cli',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,   # stdout(JSON)/stderr 를 Rust 셸이 캡처
)
