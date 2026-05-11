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

function getCookieArgs(platform) {
  if (platform === 'youtube' && YT_COOKIES_FILE) return ['--cookies', YT_COOKIES_FILE];
  if (['instagram', 'facebook'].includes(platform) && !IS_HEADLESS) return ['--cookies-from-browser', getCookieBrowser()];
  return [];
}

function getBaseArgs(platform) {
  const args = ['--no-playlist', '--no-warnings'];
  if (platform === 'youtube') {
    args.push('--extractor-args', 'youtube:player_client=mweb,tv_embedded');
    args.push('--user-agent', 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36');
  }
  return args;
}

// ── Piped API (YouTube en servidor sin cookies) ─────────────
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.garudalinux.org',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.in.projectsegfau.lt',
];

// Allowed hostnames for the stream proxy (security guard)
const PROXY_ALLOWED_HOSTS = [
  'googlevideo.com', 'youtube.com',
  ...PIPED_INSTANCES.map(u => new URL(u).hostname),
];

function isAllowedProxyUrl(url) {
  try {
    const h = new URL(url).hostname;
    return PROXY_ALLOWED_HOSTS.some(allowed => h === allowed || h.endsWith('.' + allowed));
  } catch { return false; }
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0];
    return u.searchParams.get('v');
  } catch { return null; }
}

function parseHeight(qualityStr) {
  if (!qualityStr) return null;
  const m = qualityStr.match(/^(\d+)/);
  return m ? parseInt(m[1]) : null;
}

async function getPipedStreams(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${instance}/streams/${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot/1.0)' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { console.log(`[Piped] ${instance} → ${res.status}`); continue; }
      const data = await res.json();
      if (data.error) { console.log(`[Piped] ${instance} error: ${data.error}`); continue; }
      if (data.videoStreams?.length || data.audioStreams?.length) {
        console.log(`[Piped] OK via ${instance}`);
        return data;
      }
    } catch (e) {
      console.log(`[Piped] ${instance} failed: ${e.message}`);
    }
  }
  return null;
}

// ── Stream proxy (pipes YouTube CDN → client) ───────────────
app.get('/api/stream', async (req, res) => {
  const { url: rawUrl, filename } = req.query;
  if (!rawUrl) return res.status(400).end();

  const streamUrl = decodeURIComponent(rawUrl);
  if (!isAllowedProxyUrl(streamUrl)) return res.status(403).json({ error: 'URL no permitida' });

  try {
    const upstream = await fetch(streamUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Error al obtener el stream' });

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const cl = upstream.headers.get('content-length');
    res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    res.setHeader('Content-Disposition', `attachment; filename="${filename || 'descarga.mp4'}"`);
    res.setHeader('Cache-Control', 'no-store');

    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    console.error('[stream proxy]', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error al descargar' });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/info
// ══════════════════════════════════════════════════════════
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url || !validateUrl(url)) return res.status(400).json({ error: 'URL inválida o plataforma no soportada' });

  const platform = detectPlatform(url);

  // ── YouTube en servidor: usar Piped API ─────────────────
  if (platform === 'youtube' && IS_HEADLESS && !YT_COOKIES_FILE) {
    const videoId = extractYouTubeId(url);
    if (!videoId) return res.status(400).json({ error: 'URL de YouTube inválida' });

    const piped = await getPipedStreams(videoId);
    if (!piped) return res.status(400).json({ error: 'No se pudo obtener información del video. Intenta de nuevo.' });

    const qualities = [];
    if (piped.videoStreams) {
      const seen = new Set();
      piped.videoStreams
        .filter(s => !s.videoOnly) // combined streams have audio
        .sort((a, b) => (parseHeight(b.quality) || 0) - (parseHeight(a.quality) || 0))
        .forEach(s => {
          const h = parseHeight(s.quality);
          if (h && !seen.has(h)) { seen.add(h); qualities.push({ height: h, label: qualityLabel(h) }); }
        });
    }

    return res.json({
      platform,
      title: piped.title || 'Sin título',
      thumbnail: piped.thumbnailUrl || null,
      duration: formatDuration(piped.duration),
      uploader: piped.uploader || null,
      qualities,
    });
  }

  // ── Otras plataformas o YouTube local: usar yt-dlp ─────
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
app.post('/api/download', async (req, res) => {
  const { url, type, quality } = req.body;
  if (!url || !validateUrl(url)) return res.status(400).json({ error: 'URL inválida' });

  const platform = detectPlatform(url);
  const isAudio = type === 'audio';

  // ── YouTube en servidor: usar Piped API ─────────────────
  if (platform === 'youtube' && IS_HEADLESS && !YT_COOKIES_FILE) {
    const videoId = extractYouTubeId(url);
    if (!videoId) return res.status(400).json({ error: 'URL de YouTube inválida' });

    const piped = await getPipedStreams(videoId);
    if (!piped) return res.status(500).json({ error: 'No se pudo obtener los streams del video' });

    let streamUrl, ext, mimeType;

    if (isAudio) {
      // Best audio stream
      const audio = (piped.audioStreams || [])
        .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0))[0];
      if (!audio) return res.status(500).json({ error: 'No se encontró stream de audio' });
      streamUrl = audio.url;
      mimeType = audio.mimeType || 'audio/mp4';
      ext = mimeType.includes('webm') ? '.webm' : '.m4a';
    } else {
      // Combined (non-videoOnly) streams, pick closest quality
      const videos = (piped.videoStreams || []).filter(s => !s.videoOnly);
      if (!videos.length) return res.status(500).json({ error: 'No se encontró stream de video compatible' });

      const target = quality ? parseInt(quality) : 9999;
      videos.sort((a, b) => (parseHeight(b.quality) || 0) - (parseHeight(a.quality) || 0));
      const best = videos.find(s => (parseHeight(s.quality) || 0) <= target) || videos[videos.length - 1];

      streamUrl = best.url;
      mimeType = best.mimeType || 'video/mp4';
      ext = mimeType.includes('webm') ? '.webm' : '.mp4';
    }

    if (!isAllowedProxyUrl(streamUrl)) return res.status(500).json({ error: 'URL de stream inválida' });

    try {
      const upstream = await fetch(streamUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36',
          'Referer': 'https://www.youtube.com/',
          'Origin': 'https://www.youtube.com',
        },
        signal: AbortSignal.timeout(60000),
      });

      if (!upstream.ok) return res.status(500).json({ error: 'Error al descargar el stream' });

      const ct = upstream.headers.get('content-type') || mimeType;
      const cl = upstream.headers.get('content-length');
      res.setHeader('Content-Type', ct);
      if (cl) res.setHeader('Content-Length', cl);
      res.setHeader('Content-Disposition', `attachment; filename="descarga${ext}"`);

      const { Readable } = require('stream');
      Readable.fromWeb(upstream.body).pipe(res);
    } catch (e) {
      console.error('[Piped download]', e.message);
      if (!res.headersSent) res.status(500).json({ error: 'Error al descargar el video' });
    }
    return;
  }

  // ── Otras plataformas o YouTube local: usar yt-dlp ─────
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
