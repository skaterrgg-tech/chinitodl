#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  ChinitoDownload — Crear DMG drag-and-drop para macOS
# ─────────────────────────────────────────────────────────────
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="${PROJECT_DIR}/src/public/logo.png"
APP_NAME="ChinitoDownload"
APP_PATH="/tmp/CDL_build/${APP_NAME}.app"
DMG_OUT="$HOME/Desktop/${APP_NAME}.dmg"
BUILD_DIR="/tmp/CDL_build"

echo ""; echo "🏗️   Construyendo ${APP_NAME}.dmg..."
rm -rf "$BUILD_DIR" && mkdir -p "$BUILD_DIR"

# ══════════════════════════════════════════════════════════════
# 1. CONSTRUIR EL .APP AUTO-CONTENIDO
#    Los archivos del proyecto van dentro del .app (Resources/app/)
#    El launcher detecta si es primera vez y se configura solo.
# ══════════════════════════════════════════════════════════════
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources/app"

# Copiar proyecto dentro del .app
cp -r "${PROJECT_DIR}/src"          "$APP_PATH/Contents/Resources/app/"
cp    "${PROJECT_DIR}/package.json" "$APP_PATH/Contents/Resources/app/"

# ── Icono ──────────────────────────────────────────────────
echo "   🎨 Generando icono..."
if [ -f "$LOGO" ]; then
  IS="/tmp/cdl.iconset"; rm -rf "$IS"; mkdir "$IS"
  for S in 16 32 64 128 256 512; do
    sips -z $S $S "$LOGO" --out "$IS/icon_${S}x${S}.png" &>/dev/null
  done
  sips -z 32  32  "$LOGO" --out "$IS/icon_16x16@2x.png"   &>/dev/null
  sips -z 64  64  "$LOGO" --out "$IS/icon_32x32@2x.png"   &>/dev/null
  sips -z 256 256 "$LOGO" --out "$IS/icon_128x128@2x.png" &>/dev/null
  sips -z 512 512 "$LOGO" --out "$IS/icon_256x256@2x.png" &>/dev/null
  iconutil -c icns "$IS" -o "$APP_PATH/Contents/Resources/AppIcon.icns" &>/dev/null || true
  rm -rf "$IS"
fi

# ── Info.plist ─────────────────────────────────────────────
cat > "$APP_PATH/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key>    <string>ChinitoDownload</string>
  <key>CFBundleIdentifier</key>    <string>com.chinitodl.app</string>
  <key>CFBundleName</key>          <string>ChinitoDownload</string>
  <key>CFBundleDisplayName</key>   <string>ChinitoDownload</string>
  <key>CFBundleIconFile</key>      <string>AppIcon</string>
  <key>CFBundleVersion</key>       <string>1.0</string>
  <key>CFBundlePackageType</key>   <string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# ── Launcher principal ─────────────────────────────────────
# Primera vez: abre Terminal y se instala solo
# Siguientes veces: lanza el servidor y abre el browser
cat > "$APP_PATH/Contents/MacOS/ChinitoDownload" << 'LAUNCHER'
#!/bin/bash
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:$PATH"

RESOURCES="$(cd "$(dirname "$0")/../Resources" && pwd)"
INSTALL_DIR="$HOME/Library/Application Support/ChinitoDownload"
FLAG="$INSTALL_DIR/.ready"
PORT=3000

# ── Función: lanzar servidor ───────────────────────────────
launch_server() {
  if curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
    open "http://localhost:$PORT"
    exit 0
  fi
  cd "$INSTALL_DIR"
  nohup node src/server.js >/tmp/chinitodl.log 2>&1 &
  for i in $(seq 1 12); do
    sleep 1
    curl -s "http://localhost:$PORT" >/dev/null 2>&1 && break
  done
  open "http://localhost:$PORT"
}

# ── Ya instalado ───────────────────────────────────────────
if [ -f "$FLAG" ]; then
  launch_server
  exit 0
fi

# ── Primera vez: escribir script de setup y abrir Terminal ─
SETUP="/tmp/cdl_firstrun.sh"
cat > "$SETUP" << SETUP_SCRIPT
#!/bin/bash
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:\$PATH"
INSTALL_DIR="\$HOME/Library/Application Support/ChinitoDownload"
FLAG="\$INSTALL_DIR/.ready"
RESOURCES="${RESOURCES}"

G='\033[0;32m'; Y='\033[1;33m'; B='\033[1;34m'; R='\033[0;31m'; N='\033[0m'; BOLD='\033[1m'

clear
echo -e "\${BOLD}\${B}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║    ChinitoDownload — Primera vez      ║"
echo "  ║    Configurando todo automáticamente  ║"
echo "  ╚═══════════════════════════════════════╝\${N}"
echo ""
echo -e "  \${Y}Esto solo ocurre una vez. Tarda ~5 minutos.\${N}"
echo ""

ok()   { echo -e "  \${G}✓\${N}  \$1"; }
paso() { echo ""; echo -e "  \${B}▶\${N}  \${BOLD}\$1\${N}"; }
err()  { echo -e "  \${R}✗  Error: \$1\${N}"; read -p "  Presiona Enter para cerrar..." _; exit 1; }

paso "Homebrew..."
if ! command -v brew &>/dev/null; then
  /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || err "No se pudo instalar Homebrew"
  eval "\$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
  export PATH="/opt/homebrew/bin:\$PATH"
fi
ok "Homebrew \$(brew --version | head -1)"

paso "Node.js..."
command -v node &>/dev/null || brew install node || err "No se pudo instalar Node.js"
ok "Node.js \$(node --version)"

paso "yt-dlp..."
command -v yt-dlp &>/dev/null || brew install yt-dlp || err "No se pudo instalar yt-dlp"
ok "yt-dlp listo"

paso "ffmpeg..."
command -v ffmpeg &>/dev/null || brew install ffmpeg || err "No se pudo instalar ffmpeg"
ok "ffmpeg listo"

paso "Copiando archivos..."
mkdir -p "\$INSTALL_DIR"
cp -r "\$RESOURCES/app/." "\$INSTALL_DIR/"
cd "\$INSTALL_DIR"
npm install --silent 2>/dev/null || npm install || err "npm install falló"
touch "\$FLAG"
ok "Listo en \$INSTALL_DIR"

echo ""
echo -e "\${BOLD}\${G}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     ✅  ¡Todo listo!                  ║"
echo "  ║     Abriendo ChinitoDownload...       ║"
echo "  ╚═══════════════════════════════════════╝\${N}"
echo ""
sleep 2

cd "\$INSTALL_DIR"
nohup node src/server.js >/tmp/chinitodl.log 2>&1 &
for i in \$(seq 1 12); do sleep 1
  curl -s http://localhost:3000 >/dev/null 2>&1 && break
done
open http://localhost:3000
sleep 4
osascript -e 'tell application "Terminal" to close front window' &>/dev/null || true
SETUP_SCRIPT

chmod +x "$SETUP"

osascript << 'APPLE'
tell application "Terminal"
  activate
  set w to do script ("bash /tmp/cdl_firstrun.sh")
  set custom title of w to "ChinitoDownload — Configuración"
  delay 0.5
  set bounds of front window to {200, 200, 900, 650}
end tell
APPLE
LAUNCHER

chmod +x "$APP_PATH/Contents/MacOS/ChinitoDownload"
echo "   ✅ .app lista"

# ══════════════════════════════════════════════════════════════
# 2. CREAR EL DMG
# ══════════════════════════════════════════════════════════════
echo "   💿 Creando DMG..."

DMG_DIR="$BUILD_DIR/dmg_root"
mkdir -p "$DMG_DIR"
cp -r "$APP_PATH" "$DMG_DIR/"
ln -s /Applications "$DMG_DIR/Applications"

rm -f "$DMG_OUT"
hdiutil create \
  -volname "$APP_NAME" \
  -srcfolder "$DMG_DIR" \
  -ov -format UDZO \
  -imagekey zlib-level=9 \
  "$DMG_OUT" > /dev/null

rm -rf "$BUILD_DIR"
SIZE=$(du -sh "$DMG_OUT" | cut -f1)
echo ""
echo "✅  ${APP_NAME}.dmg listo en el Escritorio ($SIZE)"
echo ""
echo "   La otra Mac solo necesita:"
echo "   1. Abrir el DMG"
echo "   2. Arrastrar ChinitoDownload → Aplicaciones"
echo "   3. Abrir la app (solo la primera vez instala las dependencias)"
echo ""
