/* ─── State ───────────────────────────────────────────── */
let state = {
  url: '',
  platform: null,
  videoInfo: null,
  selectedFormat: 'video',
  selectedQuality: null,
  downloading: false
};

/* ─── DOM ─────────────────────────────────────────────── */
const urlInput     = document.getElementById('urlInput');
const clearBtn     = document.getElementById('clearBtn');
const analyzeBtn   = document.getElementById('analyzeBtn');
const loadingCard  = document.getElementById('loadingCard');
const errorCard    = document.getElementById('errorCard');
const errorMsg     = document.getElementById('errorMsg');
const videoCard    = document.getElementById('videoCard');
const progressCard = document.getElementById('progressCard');

const platformBadge    = document.getElementById('platformBadge');
const videoThumbnail   = document.getElementById('videoThumbnail');
const videoTitle       = document.getElementById('videoTitle');
const videoUploader    = document.getElementById('videoUploader');
const videoDurationBadge = document.getElementById('videoDurationBadge');
const formatToggle     = document.getElementById('formatToggle');
const qualitySection   = document.getElementById('qualitySection');
const qualityGrid      = document.getElementById('qualityGrid');
const downloadBtn      = document.getElementById('downloadBtn');

/* ─── Platform metadata ───────────────────────────────── */
const PLATFORM_SVG = {
  youtube:   `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2s-.2-1.7-1-2.4c-.9-1-1.9-1-2.4-1.1C17.1 2.5 12 2.5 12 2.5s-5.1 0-8.1.2c-.5.1-1.5.1-2.4 1.1-.7.7-1 2.4-1 2.4S.3 8.1.3 10v1.8c0 1.9.2 3.8.2 3.8s.2 1.7 1 2.4c.9 1 2.1.9 2.6 1C5.6 19.2 12 19.2 12 19.2s5.1 0 8.1-.3c.5-.1 1.5-.1 2.4-1.1.7-.7 1-2.4 1-2.4s.2-1.9.2-3.8V10c0-1.9-.2-3.8-.2-3.8zM9.7 14.5V8.7l6.6 2.9-6.6 2.9z"/></svg>`,
  instagram: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>`,
  facebook:  `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  tiktok:    `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.79 1.54V6.78a4.85 4.85 0 01-1.02-.09z"/></svg>`
};
const PLATFORM_LABEL = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };

/* ─── URL Input ───────────────────────────────────────── */
urlInput.addEventListener('input', () => {
  const val = urlInput.value.trim();
  analyzeBtn.disabled = !val;
  clearBtn.hidden = !val;
  if (!val) resetVideoState();
});

urlInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !analyzeBtn.disabled) analyzeVideo();
});

clearBtn.addEventListener('click', () => {
  urlInput.value = '';
  urlInput.focus();
  analyzeBtn.disabled = true;
  clearBtn.hidden = true;
  resetVideoState();
});

analyzeBtn.addEventListener('click', analyzeVideo);

/* ─── Analyze ─────────────────────────────────────────── */
async function analyzeVideo() {
  const url = urlInput.value.trim();
  if (!url) return;
  state.url = url;
  resetVideoState();
  showLoading(true);

  try {
    const res  = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Error desconocido'); return; }
    state.videoInfo = data;
    state.platform  = data.platform;
    state.selectedFormat  = 'video';
    state.selectedQuality = data.qualities?.[0]?.height?.toString() || null;
    renderVideoCard(data);
  } catch {
    showError('Error de conexión. Verifica que el servidor esté corriendo.');
  } finally {
    showLoading(false);
  }
}

/* ─── Render video card ───────────────────────────────── */
function renderVideoCard(info) {
  // Platform badge
  const svg   = PLATFORM_SVG[info.platform] || '';
  const label = PLATFORM_LABEL[info.platform] || info.platform;
  platformBadge.className = `video-platform-badge ${info.platform}`;
  platformBadge.innerHTML = `${svg} ${label}`;

  // Thumbnail
  if (info.thumbnail) {
    videoThumbnail.src = info.thumbnail;
    videoThumbnail.onerror = () => {
      videoThumbnail.style.display = 'none';
    };
  } else {
    videoThumbnail.style.display = 'none';
  }

  // Duration badge
  if (info.duration) {
    videoDurationBadge.textContent = info.duration;
    videoDurationBadge.hidden = false;
  } else {
    videoDurationBadge.hidden = true;
  }

  // Title & uploader
  videoTitle.textContent = info.title || 'Sin título';
  if (info.uploader) {
    videoUploader.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${escHtml(info.uploader)}`;
  } else {
    videoUploader.textContent = '';
  }

  // Format toggle
  setFormatActive('video');

  // Quality options
  renderQualities(info);

  videoCard.hidden = false;
}

/* ─── Format toggle ───────────────────────────────────── */
formatToggle.addEventListener('click', e => {
  const btn = e.target.closest('.fmt-btn');
  if (!btn) return;
  setFormatActive(btn.dataset.value);
});

function setFormatActive(type) {
  state.selectedFormat = type;
  formatToggle.querySelectorAll('.fmt-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.value === type);
  });
  qualitySection.hidden = !(state.platform === 'youtube' && type === 'video');
}

/* ─── Quality options ─────────────────────────────────── */
function renderQualities(info) {
  qualityGrid.innerHTML = '';
  if (!info.qualities?.length) { qualitySection.hidden = true; return; }

  info.qualities.forEach((q, i) => {
    const btn = document.createElement('button');
    btn.className = `quality-btn${i === 0 ? ' active' : ''}`;
    btn.dataset.height = q.height;
    btn.textContent = q.label;
    btn.addEventListener('click', () => {
      qualityGrid.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedQuality = q.height.toString();
    });
    qualityGrid.appendChild(btn);
  });

  state.selectedQuality = info.qualities[0]?.height?.toString() || null;
  qualitySection.hidden = state.platform !== 'youtube';
}

/* ─── Download ────────────────────────────────────────── */
downloadBtn.addEventListener('click', startDownload);

async function startDownload() {
  if (state.downloading || !state.videoInfo) return;
  state.downloading = true;
  downloadBtn.disabled = true;
  progressCard.hidden = false;
  progressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: state.url,
        type: state.selectedFormat,
        quality: state.selectedFormat === 'video' ? state.selectedQuality : null
      })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError(data.error || 'Error al descargar');
      return;
    }

    const cd = res.headers.get('Content-Disposition') || '';
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'descarga';

    const blob   = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = objUrl; a.download = filename;
    document.body.appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 5000);

  } catch {
    showError('Error de red durante la descarga');
  } finally {
    state.downloading = false;
    downloadBtn.disabled = false;
    progressCard.hidden = true;
  }
}

/* ─── Helpers ─────────────────────────────────────────── */
function showLoading(on) {
  loadingCard.hidden = !on;
  analyzeBtn.disabled = on;
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorCard.hidden = false;
}

function resetVideoState() {
  videoCard.hidden = true;
  progressCard.hidden = true;
  errorCard.hidden = true;
  state.videoInfo = null;
  state.downloading = false;
  downloadBtn.disabled = false;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
