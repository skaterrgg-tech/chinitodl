const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Fix PATH so yt-dlp and ffmpeg are always found regardless of how the app was launched
process.env.PATH = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  process.env.PATH
].filter(Boolean).join(':');

// Platforms that require browser cookies for authentication
const COOKIE_PLATFORMS = ['instagram', 'facebook'];

// Detect installed browsers — prefer Chrome/Firefox (no sandbox issues on macOS)
let _cachedBrowser = null;
function getCookieBrowser() {
  if (_cachedBrowser) return _cachedBrowser;
  const candidates = [
    { name: 'chrome',  path: '/Applications/Google Chrome.app' },
    { name: 'firefox', path: '/Applications/Firefox.app' },
    { name: 'brave',   path: '/Applications/Brave Browser.app' },
    { name: 'chromium',path: '/Applications/Chromium.app' },
    { name: 'safari',  path: '/Applications/Safari.app' },
  ];
  for (const { name, path: p } of candidates) {
    if (fs.existsSync(p)) { _cachedBrowser = name; return name; }
  }
  return 'chrome';
}

// En servidor remoto no hay navegador — omitir cookies
const IS_HEADLESS = process.env.HEADLESS === 'true';

function getCookieArgs(platform) {
  if (!COOKIE_PLATFORMS.includes(platform)) return [];
  if (IS_HEADLESS) return []; // servidor sin navegador
  return ['--cookies-from-browser', getCookieBrowser()];
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Allowed domains for security
const ALLOWED_DOMAINS = [
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'instagram.com', 'www.instagram.com',
  'facebook.com', 'www.facebook.com', 'fb.watch', 'm.facebook.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'
];

function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_DOMAINS.some(domain => hostname === domain);
  } catch {
    return false;
  }
}

function detectPlatform(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube') || hostname === 'youtu.be') return 'youtube';
    if (hostname.includes('instagram')) return 'instagram';
    if (hostname.includes('facebook') || hostname === 'fb.watch') return 'facebook';
    if (hostname.includes('tiktok')) return 'tiktok';
  } catch {}
  return null;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// GET /api/info - Fetch video metadata and available formats
app.get('/api/info', (req, res) => {
  const { url } = req.query;

  if (!url || !validateUrl(url)) {
    return res.status(400).json({ error: 'URL inválida o plataforma no soportada' });
  }

  const platform = detectPlatform(url);

  const ytdlp = spawn('yt-dlp', [
    '--dump-json',
    '--no-playlist',
    '--no-warnings',
    ...getCookieArgs(platform),
    url
  ]);

  let output = '';
  let errorOutput = '';

  ytdlp.stdout.on('data', (data) => { output += data.toString(); });
  ytdlp.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ytdlp.on('error', () => {
    res.status(500).json({
      error: 'yt-dlp no está instalado. Instálalo con: pip install yt-dlp'
    });
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      const isAuthError = errorOutput.includes('empty media response') || errorOutput.includes('not granting access') || errorOutput.includes('login') || errorOutput.includes('Login');
      const isPrivate   = errorOutput.includes('Private') || errorOutput.includes('private');
      const browser     = getCookieBrowser();
      const msg = isPrivate   ? 'Video privado o no disponible'
        : isAuthError && COOKIE_PLATFORMS.includes(platform)
          ? `Instagram requiere sesión activa. Inicia sesión en Instagram en ${browser === 'chrome' ? 'Google Chrome' : browser} e intenta de nuevo`
        : errorOutput.includes('not find') ? 'yt-dlp no encontrado'
        : 'No se pudo obtener información del video';
      return res.status(400).json({ error: msg });
    }

    try {
      const info = JSON.parse(output.trim().split('\n').pop());

      // Build quality options for YouTube
      let qualities = [];
      if (platform === 'youtube' && info.formats) {
        const seen = new Set();
        qualities = info.formats
          .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
          .sort((a, b) => b.height - a.height)
          .filter(f => {
            if (seen.has(f.height)) return false;
            seen.add(f.height);
            return true;
          })
          .map(f => ({
            height: f.height,
            label: f.height >= 2160 ? `4K (${f.height}p)`
              : f.height >= 1440 ? `2K (${f.height}p)`
              : f.height >= 1080 ? `Full HD (${f.height}p)`
              : f.height >= 720 ? `HD (${f.height}p)`
              : `${f.height}p`
          }));
      }

      res.json({
        platform,
        title: info.title || 'Sin título',
        thumbnail: info.thumbnail || null,
        duration: formatDuration(info.duration),
        uploader: info.uploader || info.channel || null,
        qualities
      });
    } catch {
      res.status(500).json({ error: 'Error procesando la información del video' });
    }
  });
});

// POST /api/download - Download video and stream to client
app.post('/api/download', (req, res) => {
  const { url, type, quality } = req.body;

  if (!url || !validateUrl(url)) {
    return res.status(400).json({ error: 'URL inválida' });
  }

  const platform = detectPlatform(url);
  const isAudio = type === 'audio';
  const tmpId = crypto.randomBytes(10).toString('hex');
  const tmpDir = os.tmpdir();
  const outputTemplate = path.join(tmpDir, `ld_${tmpId}.%(ext)s`);

  let formatArg;
  if (isAudio) {
    formatArg = 'bestaudio[ext=m4a]/bestaudio';
  } else if (quality) {
    formatArg = `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
  } else {
    formatArg = 'bestvideo+bestaudio/best';
  }

  const args = [
    '--no-playlist',
    '--no-warnings',
    '-f', formatArg,
    '-o', outputTemplate,
    ...getCookieArgs(platform)
  ];

  if (!isAudio) {
    // Prefer H.264 + AAC (QuickTime/Safari compatible), fallback to re-encode if needed
    args.push('-S', 'vcodec:h264,acodec:aac');
    args.push('--merge-output-format', 'mp4');
    args.push('--recode-video', 'mp4');
    args.push('--postprocessor-args', 'ffmpeg:-movflags +faststart');
  }

  args.push(url);

  const ytdlp = spawn('yt-dlp', args);
  let errorOutput = '';

  ytdlp.stderr.on('data', (data) => { errorOutput += data.toString(); });

  ytdlp.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'yt-dlp no está instalado' });
    }
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error al descargar el video' });
      }
      return;
    }

    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`ld_${tmpId}`));
    if (files.length === 0) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Archivo de descarga no encontrado' });
      }
      return;
    }

    const filePath = path.join(tmpDir, files[0]);
    const ext = path.extname(files[0]).toLowerCase();
    const contentType = isAudio
      ? (ext === '.mp3' ? 'audio/mpeg' : ext === '.m4a' ? 'audio/mp4' : 'audio/webm')
      : 'video/mp4';

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="descarga${ext}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    const cleanup = () => fs.unlink(filePath, () => {});
    stream.on('end', cleanup);
    stream.on('error', cleanup);
    res.on('close', () => { if (!res.writableEnded) cleanup(); });
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ LinkDownload corriendo en http://localhost:${PORT}\n`);
});
