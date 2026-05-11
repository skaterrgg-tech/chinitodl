#!/bin/bash
# Genera ChinitoDownload.zip en el Escritorio
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGO="${PROJECT_DIR}/src/public/logo.png"
TEMP_DIR="/tmp/CDL_build"
OUTPUT_ZIP="$HOME/Desktop/ChinitoDownload.zip"

echo ""; echo "📦  Creando paquete portable..."

rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR/ChinitoDownload/_app/src/public"

# Copiar archivos del proyecto
cp -r "${PROJECT_DIR}/src"          "$TEMP_DIR/ChinitoDownload/_app/"
cp    "${PROJECT_DIR}/package.json" "$TEMP_DIR/ChinitoDownload/_app/"

# ── Crear Instalar.command ─────────────────────────────────
# El usuario solo hace doble clic en este archivo
cat > "$TEMP_DIR/ChinitoDownload/Instalar ChinitoDownload.command" << 'CMD'
#!/bin/bash
# ──────────────────────────────────────────────────────────
#  ChinitoDownload — Instalador
#  Doble clic para instalar
# ──────────────────────────────────────────────────────────
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/ChinitoDownload"
APP_PATH="/Applications/ChinitoDownload.app"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Colores
G='\033[0;32m'; Y='\033[1;33m'; B='\033[1;34m'; R='\033[0;31m'; N='\033[0m'; BOLD='\033[1m'

clear
echo -e "${BOLD}${B}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║      ChinitoDownload — Instalador     ║"
echo "  ╚═══════════════════════════════════════╝${N}"
echo ""

ok()   { echo -e "  ${G}✓${N}  $1"; }
paso() { echo -e "  ${B}▶${N}  ${BOLD}$1${N}"; }
warn() { echo -e "  ${Y}!${N}  $1"; }
err()  { echo -e "  ${R}✗  Error: $1${N}"; echo ""; read -p "  Presiona Enter para cerrar..." _; exit 1; }

# ── Homebrew ────────────────────────────────────────────────
paso "Verificando Homebrew..."
if ! command -v brew &>/dev/null; then
  warn "Instalando Homebrew (puede tardar ~3 min)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || err "No se pudo instalar Homebrew. Necesitas conexión a internet."
  # Añadir al PATH para Apple Silicon
  eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || true
  export PATH="/opt/homebrew/bin:$PATH"
fi
ok "Homebrew listo"

# ── Node.js ─────────────────────────────────────────────────
paso "Verificando Node.js..."
if ! command -v node &>/dev/null; then
  warn "Instalando Node.js..."
  brew install node || err "No se pudo instalar Node.js"
fi
ok "Node.js $(node --version)"

# ── yt-dlp ──────────────────────────────────────────────────
paso "Verificando yt-dlp..."
if ! command -v yt-dlp &>/dev/null; then
  warn "Instalando yt-dlp..."
  brew install yt-dlp || err "No se pudo instalar yt-dlp"
fi
ok "yt-dlp listo"

# ── ffmpeg ──────────────────────────────────────────────────
paso "Verificando ffmpeg..."
if ! command -v ffmpeg &>/dev/null; then
  warn "Instalando ffmpeg (puede tardar ~2 min)..."
  brew install ffmpeg || err "No se pudo instalar ffmpeg"
fi
ok "ffmpeg listo"

# ── Copiar archivos ──────────────────────────────────────────
paso "Instalando ChinitoDownload..."
rm -rf "$APP_DIR"
cp -r "$DIR/_app" "$APP_DIR"
cd "$APP_DIR"
npm install --silent 2>/dev/null || npm install || err "npm install falló"
ok "Archivos instalados en $APP_DIR"

# ── Crear .app ───────────────────────────────────────────────
paso "Creando acceso directo..."
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS" "$APP_PATH/Contents/Resources"

# Icono
LOGO="$APP_DIR/src/public/logo.png"
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

# Ejecutable
cat > "$APP_PATH/Contents/MacOS/ChinitoDownload" << EXEC
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
if curl -s http://localhost:3000 >/dev/null 2>&1; then
  open http://localhost:3000; exit 0
fi
cd "$APP_DIR"
nohup node src/server.js >/tmp/chinitodl.log 2>&1 &
for i in \$(seq 1 10); do sleep 1
  curl -s http://localhost:3000 >/dev/null 2>&1 && break
done
open http://localhost:3000
EXEC
chmod +x "$APP_PATH/Contents/MacOS/ChinitoDownload"

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

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP_PATH" &>/dev/null || true
ok "ChinitoDownload.app creada"

# ── Listo ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${G}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     ✅  Instalación completada        ║"
echo "  ╚═══════════════════════════════════════╝${N}"
echo ""
echo -e "  Abre ${BOLD}ChinitoDownload${N} desde el Launchpad."
echo ""
sleep 2
open "$APP_PATH"
sleep 5
osascript -e 'tell application "Terminal" to close front window' &>/dev/null || true
CMD

chmod +x "$TEMP_DIR/ChinitoDownload/Instalar ChinitoDownload.command"

# ── Comprimir ──────────────────────────────────────────────
rm -f "$OUTPUT_ZIP"
cd "$TEMP_DIR"
zip -r "$OUTPUT_ZIP" "ChinitoDownload" -x "*.DS_Store" -x "__MACOSX/*" > /dev/null
rm -rf "$TEMP_DIR"

SIZE=$(du -sh "$OUTPUT_ZIP" | cut -f1)
echo "✅  ChinitoDownload.zip listo en el Escritorio ($SIZE)"
echo ""
echo "   La otra Mac solo necesita:"
echo "   1. Descomprimir el ZIP"
echo "   2. Doble clic en 'Instalar ChinitoDownload'"
echo ""
