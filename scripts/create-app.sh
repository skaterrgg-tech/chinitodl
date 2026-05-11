#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  ChinitoDownload — Crear .app para macOS
# ─────────────────────────────────────────────────────────────
set -e

APP_NAME="ChinitoDownload"
APP_PATH="/Applications/${APP_NAME}.app"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="${PROJECT_DIR}/src/public/logo.png"

echo ""
echo "🚀  Creando ${APP_NAME}.app ..."

# ── 1. Estructura del bundle ───────────────────────────────
rm -rf "${APP_PATH}"
mkdir -p "${APP_PATH}/Contents/MacOS"
mkdir -p "${APP_PATH}/Contents/Resources"

# ── 2. Convertir logo PNG → ICNS ──────────────────────────
if [ -f "$LOGO" ]; then
  echo "🎨  Convirtiendo icono..."
  ICONSET_DIR="/tmp/${APP_NAME}.iconset"
  rm -rf "$ICONSET_DIR" && mkdir "$ICONSET_DIR"

  for SIZE in 16 32 64 128 256 512; do
    sips -z $SIZE $SIZE "$LOGO" --out "${ICONSET_DIR}/icon_${SIZE}x${SIZE}.png" &>/dev/null
  done
  # @2x variants
  sips -z 32  32  "$LOGO" --out "${ICONSET_DIR}/icon_16x16@2x.png"   &>/dev/null
  sips -z 64  64  "$LOGO" --out "${ICONSET_DIR}/icon_32x32@2x.png"   &>/dev/null
  sips -z 256 256 "$LOGO" --out "${ICONSET_DIR}/icon_128x128@2x.png" &>/dev/null
  sips -z 512 512 "$LOGO" --out "${ICONSET_DIR}/icon_256x256@2x.png" &>/dev/null

  iconutil -c icns "$ICONSET_DIR" -o "${APP_PATH}/Contents/Resources/AppIcon.icns" 2>/dev/null \
    && echo "   ✅ Icono creado" \
    || echo "   ⚠️  No se pudo generar icono .icns (ignorando)"
  rm -rf "$ICONSET_DIR"
fi

# ── 3. Ejecutable principal ────────────────────────────────
cat > "${APP_PATH}/Contents/MacOS/${APP_NAME}" << SCRIPT
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
PROJECT_DIR="${PROJECT_DIR}"
PORT=3000
LOG="/tmp/chinitodl.log"

# Si ya está corriendo, solo abre el navegador
if curl -s "http://localhost:\$PORT" > /dev/null 2>&1; then
  open "http://localhost:\$PORT"
  exit 0
fi

# Iniciar el servidor en background
cd "\$PROJECT_DIR"
nohup node src/server.js > "\$LOG" 2>&1 &
echo \$! > /tmp/chinitodl.pid

# Esperar que levante (máx 10s)
for i in \$(seq 1 10); do
  sleep 1
  if curl -s "http://localhost:\$PORT" > /dev/null 2>&1; then
    break
  fi
done

open "http://localhost:\$PORT"
SCRIPT

chmod +x "${APP_PATH}/Contents/MacOS/${APP_NAME}"

# ── 4. Info.plist ──────────────────────────────────────────
cat > "${APP_PATH}/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>   <string>ChinitoDownload</string>
  <key>CFBundleIdentifier</key>   <string>com.chinitodl.app</string>
  <key>CFBundleName</key>         <string>ChinitoDownload</string>
  <key>CFBundleDisplayName</key>  <string>ChinitoDownload</string>
  <key>CFBundleIconFile</key>     <string>AppIcon</string>
  <key>CFBundleVersion</key>      <string>1.0</string>
  <key>CFBundlePackageType</key>  <string>APPL</string>
  <key>LSMinimumSystemVersion</key> <string>12.0</string>
  <key>NSHighResolutionCapable</key> <true/>
  <key>LSBackgroundOnly</key>     <false/>
</dict>
</plist>
PLIST

# ── 5. Registrar con Launch Services ──────────────────────
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "${APP_PATH}" 2>/dev/null || true

echo ""
echo "✅  ChinitoDownload.app instalada en /Applications/"
echo "   Búscala en el Launchpad o en el Finder → Aplicaciones"
echo ""
