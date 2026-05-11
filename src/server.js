const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');

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

function getCookieArgs(platform) {
  if (platform === 'youtube' && YT_COOKIES_FILE) return ['--cookies', YT_COOKIES_FILE];
  if (['instagram', 'facebook'].includes(platform) && !IS_HEADLESS) return ['--cookies-from-browser', getCookieBrowser()];
  return [];
}

function getBaseArgs(platform) {
  const args = ['--no-playlist', '--no-warnings'];
  if (platform === 'youtube') {
    args.push('--extractor-args', 'youtube:player_client=tv_embedded,web_embedded,mweb');
    args.push('--user-agent', 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1');
  }
  return args;
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    return u.searchParams.get('v');
  } catch { return null; }
}

// ── YouTube page scrape (no IP blocking, works everywhere) ───
async function scrapeYouTubeInfo(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const html = await res.text();

  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s);
  if (!m) return null;

  try {
    const data = JSON.parse(m[1]);
    if (data.playabilityStatus?.status !== 'OK') return null;
    const d = data.videoDetails;
    return {
      title: d?.title || null,
      thumbnail: d?.thumbnail?.thumbnails?.slice(-1)[0]?.url || null,
      duration: parseInt(d?.lengthSeconds) || null,
      uploader: d?.author || null,
    };
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════
// GET /api/info
// ══════════════════════════════════════════════════════════
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url || !validateUrl(url)) return res.status(400).json({ error: 'URL inválida o plataforma no soportada' });

  const platform = detectPlatform(url);

  // ── YouTube: scrape page for reliable metadata ──────────
  if (platform === 'youtube') {
    const info = await scrapeYouTubeInfo(url);
    if (!info) {
      // Might be private/unavailable
      return res.status(400).json({ error: 'Video privado, eliminado o no disponible' });
    }
    // Fixed quality options — yt-dlp will pick best available at or below
    const qualities = YT_COOKIES_FILE || !IS_HEADLESS
      ? [
          { height: 1080, label: 'Full HD (1080p)' },
          { height: 720, label: 'HD (720p)' },
          { height: 480, label: '480p' },
          { height: 360, label: '360p' },
        ]
      : [
          { height: 720, label: 'HD (720p)' },
          { height: 480, label: '480p' },
          { height: 360, label: '360p' },
        ];

    return res.json({
      platform,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: formatDuration(info.duration),
      uploader: info.uploader,
      qualities,
    });
  }

  // ── Other platforms: use yt-dlp ─────────────────────────
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
      const isPrivate = errorOutput.toLowerCase().includes('private');
      const isAuth = errorOutput.includes('login') || errorOutput.includes('Login') || errorOutput.includes('empty media');
      return res.status(400).json({
        error: isPrivate ? 'Video privado o no disponible'
          : isAuth ? 'Este video requiere iniciar sesión'
          : 'No se pudo obtener información del video'
      });
    }
    try {
      const info = JSON.parse(output.trim().split('\n').pop());
      res.json({
        platform,
        title: info.title || 'Sin título',
        thumbnail: info.thumbnail || null,
        duration: formatDuration(info.duration),
        uploader: info.uploader || info.channel || null,
        qualities: []
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
      ? `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`
      : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best';

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
      console.error(`[yt-dlp dl error] ${errorOutput.slice(0, 400)}`);
      if (!res.headersSent) {
        const isBlocked = errorOutput.includes('Sign in') || errorOutput.includes('bot')
          || errorOutput.includes('confirm') || errorOutput.includes('HTTP Error 403');
        res.status(isBlocked ? 403 : 500).json({
          error: isBlocked
            ? 'YouTube está bloqueando la descarga desde el servidor. Configura las cookies de YouTube para desbloquear.'
            : 'Error al descargar el video',
          needsCookies: isBlocked && platform === 'youtube',
        });
      }
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
