const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

process.env.PATH = ['/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/bin', '/bin', process.env.PATH].filter(Boolean).join(':');

const IS_HEADLESS = process.env.HEADLESS === 'true';
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── YouTube cookies (Render env var YT_COOKIES) ────────────
let YT_COOKIES_FILE = null;
if (process.env.YT_COOKIES) {
  YT_COOKIES_FILE = path.join(os.tmpdir(), 'yt_cookies.txt');
  fs.writeFileSync(YT_COOKIES_FILE, process.env.YT_COOKIES);
  console.log('✅ YouTube cookies cargadas');
}

// ── Helpers ────────────────────────────────────────────────
const ALLOWED_DOMAINS = [
  'youtube.com', 'www.youtube.com', 'youtu.be', 'm.youtube.com',
  'instagram.com', 'www.instagram.com',
  'facebook.com', 'www.facebook.com', 'fb.watch', 'm.facebook.com',
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'm.tiktok.com'
];

function validateUrl(url) {
  try {
    const p = new URL(url);
    if (!['http:', 'https:'].includes(p.protocol)) return false;
    return ALLOWED_DOMAINS.some(d => p.hostname.toLowerCase() === d);
  } catch { return false; }
}

function detectPlatform(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes('youtube') || h === 'youtu.be') return 'youtube';
    if (h.includes('instagram')) return 'instagram';
    if (h.includes('facebook') || h === 'fb.watch') return 'facebook';
    if (h.includes('tiktok')) return 'tiktok';
  } catch {}
  return null;
}

function formatDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}

function qualityLabel(h) {
  return h >= 2160 ? `4K (${h}p)` : h >= 1440 ? `2K (${h}p)` : h >= 1080 ? `Full HD (${h}p)` : h >= 720 ? `HD (${h}p)` : `${h}p`;
}

let _browser = null;
function getCookieBrowser() {
  if (_browser) return _browser;
  for (const { name, p } of [
    { name: 'chrome', p: '/Applications/Google Chrome.app' },
    { name: 'firefox', p: '/Applications/Firefox.app' },
    { name: 'brave', p: '/Applications/Brave Browser.app' },
    { name: 'safari', p: '/Applications/Safari.app' },
  ]) { if (fs.existsSync(p)) { _browser = name; return name; } }
  return 'chrome';
}

// Devuelve los args de cookies según la plataforma y el entorno
function getCookieArgs(platform) {
  if (platform === 'youtube' && YT_COOKIES_FILE) {
    return ['--cookies', YT_COOKIES_FILE];
  }
  if (['instagram', 'facebook'].includes(platform) && !IS_HEADLESS) {
    return ['--cookies-from-browser', getCookieBrowser()];
  }
  return [];
}

// Args base de yt-dlp para evitar detección de bots
function getBaseArgs(platform) {
  const args = ['--no-playlist', '--no-warnings'];
  if (platform === 'youtube') {
    // mweb = cliente móvil, menos restricciones en IPs de servidor
    args.push('--extractor-args', 'youtube:player_client=mweb,tv_embedded');
    args.push('--user-agent', 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36');
  }
  return args;
}

// ══════════════════════════════════════════════════════════
// GET /api/info
// ══════════════════════════════════════════════════════════
app.get('/api/info', (req, res) => {
  const { url } = req.query;
  if (!url || !validateUrl(url)) return res.status(400).json({ error: 'URL inválida o plataforma no soportada' });

  const platform = detectPlatform(url);

  const ytdlp = spawn('yt-dlp', [
    '--dump-json',
    ...getBaseArgs(platform),
    ...getCookieArgs(platform),
    url
  ]);

  let output = '', errorOutput = '';
  ytdlp.stdout.on('data', d => { output += d.toString(); });
  ytdlp.stderr.on('data', d => { errorOutput += d.toString(); });
  ytdlp.on('error', () => res.status(500).json({ error: 'yt-dlp no encontrado en el servidor' }));

  ytdlp.on('close', code => {
    if (code !== 0) {
      console.error(`[yt-dlp info error] ${errorOutput.slice(0, 300)}`);
      const isBot = errorOutput.includes('Sign in') || errorOutput.includes('bot') || errorOutput.includes('confirm');
      const isPrivate = errorOutput.toLowerCase().includes('private');
      const isAuth = errorOutput.includes('login') || errorOutput.includes('Login') || errorOutput.includes('empty media');
      return res.status(400).json({
        error: isPrivate ? 'Video privado o no disponible'
          : isBot ? 'YouTube está bloqueando el servidor. Configura las cookies de YouTube en Render.'
          : isAuth ? 'Este video requiere iniciar sesión'
          : 'No se pudo obtener información del video'
      });
    }
    try {
      const info = JSON.parse(output.trim().split('\n').pop());
      const qualities = [];
      if (platform === 'youtube' && info.formats) {
        const seen = new Set();
        info.formats
          .filter(f => f.vcodec && f.vcodec !== 'none' && f.height)
          .sort((a, b) => b.height - a.height)
          .forEach(f => {
            if (!seen.has(f.height)) { seen.add(f.height); qualities.push({ height: f.height, label: qualityLabel(f.height) }); }
          });
      }
      res.json({
        platform,
        title: info.title || 'Sin título',
        thumbnail: info.thumbnail || null,
        duration: formatDuration(info.duration),
        uploader: info.uploader || info.channel || null,
        qualities
      });
    } catch { res.status(500).json({ error: 'Error procesando el video' }); }
  });
});

// ══════════════════════════════════════════════════════════
// POST /api/download
// ══════════════════════════════════════════════════════════
app.post('/api/download', (req, res) => {
  const { url, type, quality } = req.body;
  if (!url || !validateUrl(url)) return res.status(400).json({ error: 'URL inválida' });

  const platform = detectPlatform(url);
  const isAudio = type === 'audio';
  const tmpId = crypto.randomBytes(10).toString('hex');
  const tmpDir = os.tmpdir();
  const outputTemplate = path.join(tmpDir, `ld_${tmpId}.%(ext)s`);

  const formatArg = isAudio
    ? 'bestaudio[ext=m4a]/bestaudio'
    : quality
      ? `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`
      : 'bestvideo+bestaudio/best';

  const args = [
    ...getBaseArgs(platform),
    '-f', formatArg,
    '-o', outputTemplate,
    ...getCookieArgs(platform)
  ];

  if (!isAudio) {
    args.push('-S', 'vcodec:h264,acodec:aac', '--merge-output-format', 'mp4',
      '--recode-video', 'mp4', '--postprocessor-args', 'ffmpeg:-movflags +faststart');
  }
  args.push(url);

  const ytdlp = spawn('yt-dlp', args);
  let errorOutput = '';
  ytdlp.stderr.on('data', d => { errorOutput += d.toString(); });
  ytdlp.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'yt-dlp no encontrado' }); });

  ytdlp.on('close', code => {
    if (code !== 0) {
      console.error(`[yt-dlp dl error] ${errorOutput.slice(0, 300)}`);
      if (!res.headersSent) res.status(500).json({ error: 'Error al descargar el video' });
      return;
    }
    const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`ld_${tmpId}`));
    if (!files.length) { if (!res.headersSent) res.status(500).json({ error: 'Archivo no encontrado' }); return; }

    const filePath = path.join(tmpDir, files[0]);
    const ext = path.extname(files[0]).toLowerCase();
    const contentType = isAudio ? (ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg') : 'video/mp4';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', fs.statSync(filePath).size);
    res.setHeader('Content-Disposition', `attachment; filename="descarga${ext}"`);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    const cleanup = () => fs.unlink(filePath, () => {});
    stream.on('end', cleanup);
    stream.on('error', cleanup);
  });
});

app.listen(PORT, () => console.log(`\n✅ ChinitoDownload en http://localhost:${PORT}\n`));
