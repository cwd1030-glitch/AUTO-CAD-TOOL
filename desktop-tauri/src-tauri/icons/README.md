# 아이콘 생성 필요

이 폴더에는 빌드 시 아이콘 파일(32x32.png, 128x128.png, 128x128@2x.png, icon.ico, icon.icns)이 있어야 합니다.

준비된 로고(PNG, 1024×1024 권장)로 한 번에 생성하세요:

```bash
npm run icon -- path/to/logo.png
```

이 명령이 위 파일들을 자동으로 이 폴더에 만들어 줍니다. (Tauri CLI 내장 기능)
