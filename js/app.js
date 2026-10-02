const $ = (id) => document.getElementById(id);

const sourceInput = $('sourceInput');
const loadBtn = $('loadBtn');
const clearBtn = $('clearBtn');
const statusEl = $('status');
const video = $('video');
const iframe = $('iframe');
const placeholder = $('placeholder');
const toolbar = $('playerToolbar');
const meta = $('playerMeta');
const errorEl = $('playerError');
const qualitySelect = $('qualitySelect');
const subtitleSelect = $('subtitleSelect');
const speedSelect = $('speedSelect');
const mediaTitle = $('mediaTitle');
const mediaType = $('mediaType');
const sourcePill = $('sourcePill');
const themeBtn = $('themeBtn');

let currentSources = [];
let currentSubtitles = [];
let currentVideoUrl = '';
let loadToken = 0;

function setStatus(text, state = 'idle') {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function resetPlayer() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  iframe.src = 'about:blank';
  video.hidden = true;
  iframe.hidden = true;
  placeholder.hidden = false;
  toolbar.hidden = true;
  meta.hidden = true;
  errorEl.hidden = true;
  qualitySelect.replaceChildren();
  subtitleSelect.replaceChildren();
  currentSources = [];
  currentSubtitles = [];
  currentVideoUrl = '';
}

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
  placeholder.hidden = true;
  setStatus(message, 'error');
}

function isLikelyIframe(url) {
  const lower = url.toLowerCase();
  return /\/embed(?:\/|\?|$)|[?&](?:embed|iframe)=|player\./.test(lower) || /(?:youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com)/.test(lower);
}

function guessDirectVideo(url) {
  return /\.(?:mp4|m3u8|webm|mov|m4v|ogv|mpd)(?:$|\?)/i.test(url);
}

function inferTitle(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
    return last.replace(/\.(?:mp4|m3u8|webm|mkv|mov|m4v|json)$/i, '').replace(/[_-]+/g, ' ').trim() || u.hostname;
  } catch (_) { return 'Media source'; }
}

function normalizeJson(payload, fallbackUrl) {
  if (!payload || typeof payload !== 'object') throw new Error('The source did not return a JSON object.');
  const resolutions = Array.isArray(payload.resolutions) ? payload.resolutions : [];
  const sources = resolutions
    .map(x => ({ quality: String(x?.quality || 'Auto'), url: String(x?.url || '') }))
    .filter(x => x.url);
  if (payload.videoUrl) sources.unshift({ quality: 'Auto', url: String(payload.videoUrl) });
  if (!sources.length && payload.url) sources.push({ quality: 'Auto', url: String(payload.url) });
  if (!sources.length) throw new Error('No playable video URL was found in the JSON.');

  const subtitles = Array.isArray(payload.subtitleTracks) ? payload.subtitleTracks
    .map(x => ({ language: String(x?.language || ''), label: String(x?.label || x?.language || 'Subtitle'), url: String(x?.url || '') }))
    .filter(x => x.url) : [];

  return {
    sources,
    subtitles,
    title: payload.title || payload.name || inferTitle(sources[0].url || fallbackUrl),
    audioLabel: payload.defaultAudioLabel || '',
  };
}

function fillQualityMenu(sources) {
  qualitySelect.replaceChildren();
  const unique = [];
  const seen = new Set();
  for (const source of sources) {
    const label = source.quality || 'Auto';
    if (!seen.has(label)) { seen.add(label); unique.push(source); }
  }
  unique.forEach((source, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = source.quality;
    qualitySelect.appendChild(option);
  });
  qualitySelect.disabled = unique.length <= 1;
}

function loadSubtitles(subtitles) {
  video.querySelectorAll('track').forEach(t => t.remove());
  subtitleSelect.replaceChildren();
  const off = document.createElement('option');
  off.value = '-1'; off.textContent = 'Subtitles: Off';
  subtitleSelect.appendChild(off);
  subtitles.forEach((sub, index) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label;
    track.srclang = (sub.language || 'en').slice(0, 8);
    track.src = sub.url;
    track.default = false;
    video.appendChild(track);

    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = sub.label;
    subtitleSelect.appendChild(option);
  });
  subtitleSelect.disabled = subtitles.length === 0;
}

function selectSubtitle(index) {
  video.textTracks && Array.from(video.textTracks).forEach(t => t.mode = 'disabled');
  if (index < 0) return;
  const track = video.textTracks?.[index];
  if (track) track.mode = 'showing';
}

function preserveTimeAndPlay(url) {
  const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const wasPlaying = !video.paused;
  currentVideoUrl = url;
  video.src = url;
  video.load();
  video.addEventListener('loadedmetadata', () => {
    if (time > 0 && isFinite(video.duration)) {
      try { video.currentTime = Math.min(time, Math.max(0, video.duration - .5)); } catch (_) {}
    }
    if (wasPlaying) video.play().catch(() => {});
  }, { once: true });
}

function loadDirect(url, kind = 'DIRECT', title = inferTitle(url), subtitles = [], sources = null) {
  placeholder.hidden = true;
  errorEl.hidden = true;
  iframe.hidden = true;
  video.hidden = false;
  toolbar.hidden = false;
  meta.hidden = false;
  mediaTitle.textContent = title;
  mediaType.textContent = kind === 'JSON' ? 'JSON media source' : 'Direct video source';
  sourcePill.textContent = kind;
  if (sources) currentSources = sources;
  else if (!currentSources.length) currentSources = [{ quality: 'Auto', url }];
  fillQualityMenu(currentSources);
  currentSubtitles = subtitles;
  loadSubtitles(subtitles);
  preserveTimeAndPlay(url);
}

function loadIframe(url) {
  placeholder.hidden = true;
  errorEl.hidden = true;
  video.hidden = true;
  toolbar.hidden = true;
  meta.hidden = false;
  iframe.hidden = false;
  mediaTitle.textContent = inferTitle(url);
  mediaType.textContent = 'Embedded player';
  sourcePill.textContent = 'IFRAME';
  iframe.src = url;
}

async function fetchSource(url, token) {
  if (isLikelyIframe(url)) {
    loadIframe(url);
    setStatus('Embedded player loaded.', 'success');
    return;
  }

  if (guessDirectVideo(url)) {
    loadDirect(url);
    setStatus('Direct video loaded.', 'success');
    return;
  }

  setStatus('Fetching source…');
  let response;
  try {
    response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json,text/plain,*/*' }, mode: 'cors' });
  } catch (error) {
    throw new Error('Browser could not fetch this URL. The source may block CORS. Use its direct media URL or embed URL.');
  }
  if (token !== loadToken) return;
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);

  const type = response.headers.get('content-type') || '';
  if (type.includes('application/json') || /\.json(?:$|\?)/i.test(url)) {
    const payload = await response.json();
    const parsed = normalizeJson(payload, url);
    currentSources = parsed.sources;
    currentSubtitles = parsed.subtitles;
    fillQualityMenu(currentSources);
    loadSubtitles(currentSubtitles);
    loadDirect(currentSources[0].url, 'JSON', parsed.title, parsed.subtitles, parsed.sources);
    setStatus(`Loaded ${currentSources.length} quality source${currentSources.length === 1 ? '' : 's'}.`, 'success');
    return;
  }

  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
  if (parsed) {
    const normalized = normalizeJson(parsed, url);
    currentSources = normalized.sources;
    currentSubtitles = normalized.subtitles;
    fillQualityMenu(currentSources);
    loadDirect(currentSources[0].url, 'JSON', normalized.title, normalized.subtitles, normalized.sources);
    setStatus(`Loaded ${currentSources.length} quality source${currentSources.length === 1 ? '' : 's'}.`, 'success');
    return;
  }
  throw new Error('The URL is not a supported JSON media source or direct video file.');
}

async function handleLoad() {
  const url = sourceInput.value.trim();
  if (!url) { setStatus('Paste a URL first.', 'error'); return; }
  try { new URL(url); } catch (_) { setStatus('Please enter a valid URL.', 'error'); return; }
  loadToken += 1;
  const token = loadToken;
  resetPlayer();
  try { await fetchSource(url, token); }
  catch (error) { showError(error.message || 'Could not load the source.'); }
}

qualitySelect.addEventListener('change', () => {
  const item = currentSources[Number(qualitySelect.value)];
  if (!item) return;
  const keepSubtitle = subtitleSelect.value;
  preserveTimeAndPlay(item.url);
  video.playbackRate = Number(speedSelect.value) || 1;
  setTimeout(() => { if (keepSubtitle) subtitleSelect.value = keepSubtitle; }, 0);
});

subtitleSelect.addEventListener('change', () => selectSubtitle(Number(subtitleSelect.value)));
speedSelect.addEventListener('change', () => { video.playbackRate = Number(speedSelect.value) || 1; });

$('back10').addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
$('forward10').addEventListener('click', () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); });

$('fullscreenBtn').addEventListener('click', async () => {
  const stage = $('playerStage');
  if (!document.fullscreenElement) await stage.requestFullscreen?.();
  else await document.exitFullscreen?.();
});

$('pipBtn').addEventListener('click', async () => {
  if (!document.pictureInPictureEnabled || video.hidden) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch (_) {}
});

loadBtn.addEventListener('click', handleLoad);
sourceInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleLoad(); });
clearBtn.addEventListener('click', () => { sourceInput.value = ''; resetPlayer(); setStatus('Ready'); sourceInput.focus(); });

document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.example;
    if (type === 'json') sourceInput.value = 'https://example.com/media.json';
    if (type === 'video') sourceInput.value = 'https://example.com/video.mp4';
    if (type === 'iframe') sourceInput.value = 'https://example.com/embed/player';
    sourceInput.focus();
  });
});

themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('light');
  localStorage.setItem('neo-theme', document.body.classList.contains('light') ? 'light' : 'dark');
});
if (localStorage.getItem('neo-theme') === 'light') document.body.classList.add('light');

video.addEventListener('error', () => {
  const code = video.error?.code;
  if (code) showError('The browser could not play this media. The URL may be expired, protected, blocked by CORS, or encoded in an unsupported format.');
});
