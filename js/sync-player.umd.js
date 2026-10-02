(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SyncPlayer = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (value) => {
    const n = Number.isFinite(value) ? Math.max(0, value) : 0;
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = Math.floor(n % 60);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  };

  function icon(name) {
    const p = {
      play:'<path d="m9 6 9 6-9 6V6Z"/>',
      pause:'<path d="M8 6v12M16 6v12"/>',
      volume:'<path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10"/>',
      mute:'<path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="m16 9-4 6M12 9l4 6"/>',
      settings:'<path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19 13 .7 1.2-1.2 2-1.4-.1-1 .9-.1 1.4-2.2.6-.9-1.1h-1.5l-.9 1.1-2.2-.6-.1-1.4-1-.9-1.4.1-1.2-2L5 13l.2-2L4.7 9l1.2-2 1.4.1 1-.9.1-1.4 2.2-.6.9 1.1H13l.9-1.1 2.2.6.1 1.4 1 .9 1.4-.1 1.2 2-.7 2Z"/>',
      fullscreen:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>',
      pip:'<path d="M3 5h18v14H3z"/><path d="M13 12h6v4h-6z"/>',
      cc:'<path d="M4 6h16v12H4z"/><path d="M7 10h4M13 10h4M7 14h3M12 14h5"/>',
      speed:'<path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 12 16 9"/>',
      quality:'<path d="M4 6h16v12H4z"/><path d="M7 10h10M7 14h6"/>',
      back:'<path d="m15 18-6-6 6-6"/>',
      check:'<path d="m5 12 4 4L19 6"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[name] || ''}</svg>`;
  }

  function normalizeSourcePayload(data) {
    if (!data || typeof data !== 'object') throw new Error('Source returned invalid JSON.');
    if (data.error) throw new Error(String(data.error));
    const resolutions = Array.isArray(data.resolutions)
      ? data.resolutions.filter(x => x && typeof x.url === 'string' && x.url).map(x => ({ quality: String(x.quality || 'Auto'), url: x.url }))
      : [];
    const subtitles = Array.isArray(data.subtitleTracks)
      ? data.subtitleTracks.filter(x => x && typeof x.url === 'string' && x.url).map(x => ({ label: String(x.label || x.language || 'Subtitle'), language: String(x.language || 'en'), url: x.url }))
      : [];
    const audioTracks = Array.isArray(data.audioTracks)
      ? data.audioTracks.filter(x => x && typeof x.url === 'string' && x.url).map(x => ({ label: String(x.label || x.language || 'Audio'), language: String(x.language || ''), url: x.url }))
      : [];
    const videoUrl = typeof data.videoUrl === 'string' && data.videoUrl ? data.videoUrl : (resolutions[0] && resolutions[0].url) || '';
    if (!videoUrl && !resolutions.length) throw new Error('No video URL was returned by the source.');
    return { ...data, videoUrl: videoUrl || resolutions[0].url, resolutions, subtitles, audioTracks, title: data.title || '' };
  }

  async function fetchSource(apiUrl, options) {
    const response = await fetch(apiUrl, { signal: options && options.signal, credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch (_) { throw new Error(`Resolver returned non-JSON data (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(payload && payload.error ? payload.error : `Resolver failed (HTTP ${response.status}).`);
    return normalizeSourcePayload(payload);
  }

  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream; }
  function canPlayMKV(video) { try { return !!video && !!video.canPlayType && !!video.canPlayType('video/x-matroska').replace('no',''); } catch (_) { return false; } }

  class SyncPlayer {
    constructor(mount, options) {
      this.mount = mount;
      this.options = options || {};
      this.autoplay = this.options.autoplay !== false;
      this.media = null;
      this.currentUrl = '';
      this.usedProxy = false;
      this.bound = false;
      this.render();
      this.bind();
    }

    render() {
      this.mount.innerHTML = `<div class="sp-root" tabindex="0">
        <video class="sp-video" playsinline preload="metadata" crossorigin="anonymous"></video>
        <div class="sp-poster" aria-hidden="true"></div>
        <div class="sp-center-play"><button type="button" class="sp-big-play" aria-label="Play">${icon('play')}</button></div>
        <div class="sp-spinner" aria-hidden="true"><div></div><span>Loading</span></div>
        <div class="sp-message sp-message-hidden" data-message><strong data-message-title>Unable to play</strong><span data-message-text></span><button type="button" data-retry>Retry</button></div>
        <div class="sp-controls">
          <div class="sp-progress-row"><span data-current>0:00</span><div class="sp-seek"><div class="sp-buffer"></div><div class="sp-progress"></div><input type="range" min="0" max="1000" value="0" step="1" aria-label="Seek"></div><span data-duration>0:00</span></div>
          <div class="sp-control-row">
            <button class="sp-icon-btn" data-back10 type="button" aria-label="Back 10 seconds">↶<small>10</small></button>
            <button class="sp-icon-btn" data-play type="button" aria-label="Play">${icon('play')}</button>
            <button class="sp-icon-btn" data-next10 type="button" aria-label="Forward 10 seconds">↷<small>10</small></button>
            <button class="sp-icon-btn" data-mute type="button" aria-label="Mute">${icon('volume')}</button>
            <input class="sp-volume" type="range" min="0" max="1" value="1" step="0.01" aria-label="Volume">
            <span class="sp-spacer"></span>
            <button class="sp-icon-btn" data-settings type="button" aria-label="Settings">${icon('settings')}</button>
            <button class="sp-icon-btn" data-pip type="button" aria-label="Picture in picture">${icon('pip')}</button>
            <button class="sp-icon-btn" data-fullscreen type="button" aria-label="Fullscreen">${icon('fullscreen')}</button>
          </div>
        </div>
        <div class="sp-subtitle" aria-live="polite"></div>
        <div class="sp-menu sp-menu-hidden" data-menu></div>
      </div>`;
      this.root = $('.sp-root', this.mount);
      this.video = $('.sp-video', this.root);
      this.spinner = $('.sp-spinner', this.root);
      this.message = $('[data-message]', this.root);
      this.messageTitle = $('[data-message-title]', this.root);
      this.messageText = $('[data-message-text]', this.root);
      this.controls = $('.sp-controls', this.root);
      this.playBtn = $('[data-play]', this.root);
      this.bigPlay = $('.sp-big-play', this.root);
      this.range = $('.sp-seek input', this.root);
      this.progress = $('.sp-progress', this.root);
      this.buffer = $('.sp-buffer', this.root);
      this.current = $('[data-current]', this.root);
      this.duration = $('[data-duration]', this.root);
      this.volume = $('.sp-volume', this.root);
      this.subtitle = $('.sp-subtitle', this.root);
      this.menu = $('[data-menu]', this.root);
      this.video.addEventListener('contextmenu', e => e.preventDefault());
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      this.bigPlay.onclick = () => this.toggle();
      this.playBtn.onclick = () => this.toggle();
      this.video.onclick = () => this.toggle();
      this.video.ondblclick = () => this.fullscreen();
      $('[data-back10]', this.root).onclick = () => this.seek(-10);
      $('[data-next10]', this.root).onclick = () => this.seek(10);
      $('[data-mute]', this.root).onclick = () => { this.video.muted = !this.video.muted; this.updateVolume(); };
      $('[data-settings]', this.root).onclick = () => this.openSettings();
      $('[data-pip]', this.root).onclick = () => this.pip();
      $('[data-fullscreen]', this.root).onclick = () => this.fullscreen();
      $('[data-retry]', this.root).onclick = () => this.retry();
      this.range.oninput = () => { if (Number.isFinite(this.video.duration)) this.video.currentTime = this.video.duration * (Number(this.range.value) / 1000); };
      this.volume.oninput = () => { this.video.volume = Number(this.volume.value); this.video.muted = this.video.volume === 0; this.updateVolume(); };
      this.video.onloadedmetadata = () => {
        this.duration.textContent = fmt(this.video.duration);
        if (Number.isFinite(this.video.duration) && this.video.duration > 0) {
          this.hideError();
          this.onState('ready');
          if (this.pendingTime > 0) this.video.currentTime = Math.min(this.pendingTime, Math.max(0, this.video.duration - 0.15));
          if (this.pendingPlay) this.playWithFallback();
        }
      };
      this.video.ontimeupdate = () => this.updateProgress();
      this.video.onprogress = () => this.updateProgress();
      this.video.onwaiting = () => this.setLoading(true);
      this.video.onplaying = () => { this.setLoading(false); this.hideError(); this.onState('playing'); };
      this.video.onpause = () => this.updatePlayIcon();
      this.video.onplay = () => this.updatePlayIcon();
      this.video.onended = () => this.onState('ended');
      this.video.onerror = () => this.handleMediaError();
      this.video.onstalled = () => this.setLoading(true);
      this.video.oncanplay = () => this.setLoading(false);
      this.root.addEventListener('mousemove', () => this.revealControls(), { passive: true });
      this.root.addEventListener('touchstart', () => this.revealControls(), { passive: true });
      this.root.addEventListener('keydown', e => {
        if (e.target.matches('button,input,select,textarea')) return;
        if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
        else if (e.key === 'ArrowLeft') this.seek(-10);
        else if (e.key === 'ArrowRight') this.seek(10);
        else if (e.key.toLowerCase() === 'f') this.fullscreen();
      });
    }

    onState(state) { if (typeof this.options.onState === 'function') this.options.onState(state); }

    async load(input) {
      this.media = normalizeSourcePayload(input);
      this.hideError();
      this.pendingTime = Number.isFinite(this.video.currentTime) ? this.video.currentTime : 0;
      this.pendingPlay = this.autoplay;
      const preferred = this.pickPlayableSource();
      return this.setSource(preferred.url, { quality: preferred.quality, resetTracks: true, time: 0, playing: this.autoplay });
    }

    pickPlayableSource() {
      const list = [];
      if (this.media.videoUrl) list.push({ url: this.media.videoUrl, quality: 'Auto' });
      for (const x of this.media.resolutions || []) if (x.url && !list.some(y => y.url === x.url)) list.push(x);
      const playable = list.find(x => this.urlLooksSupported(x.url) && this.probablyPlayable(x.url));
      return playable || list[0];
    }

    urlLooksSupported(url) {
      try {
        const path = new URL(url).pathname.toLowerCase();
        if (path.endsWith('.m3u8')) return true;
        if (path.endsWith('.mpd')) return false;
        if (path.endsWith('.mkv')) return canPlayMKV(this.video);
        if (path.endsWith('.mp4') || path.endsWith('.webm') || path.endsWith('.m4v') || path.endsWith('.mov')) return true;
        return true;
      } catch (_) { return true; }
    }

    probablyPlayable(url) {
      try {
        const path = new URL(url).pathname.toLowerCase();
        if (path.endsWith('.webm')) return !!this.video.canPlayType('video/webm');
        if (path.endsWith('.mp4') || path.endsWith('.m4v')) return !!this.video.canPlayType('video/mp4');
        if (path.endsWith('.mkv')) return canPlayMKV(this.video);
      } catch (_) {}
      return true;
    }

    async setSource(url, opts) {
      if (!url) throw new Error('No media URL available.');
      this.currentUrl = url;
      this.pendingTime = Number.isFinite(opts.time) ? opts.time : 0;
      this.pendingPlay = !!opts.playing;
      this.usedProxy = false;
      this.setLoading(true);
      this.hideError();
      if (opts.resetTracks) this.installSubtitles('off');
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video.src = url;
      this.video.load();
      this.video.dataset.quality = opts.quality || 'Auto';
      try {
        await this.waitForPlayable(6500);
      } catch (error) {
        if (!this.usedProxy && !this.isCrossOriginProxy(url)) {
          this.usedProxy = true;
          const proxy = `/api/media?url=${encodeURIComponent(url)}`;
          this.video.src = proxy;
          this.video.load();
          try { await this.waitForPlayable(6500); } catch (_) { throw error; }
        } else {
          throw error;
        }
      }
      if (opts.resetTracks) {
        const firstSubtitle = this.media && this.media.defaultSubtitleUrl;
        if (firstSubtitle) this.installSubtitles(firstSubtitle);
      }
      this.setLoading(false);
      if (this.pendingPlay) await this.playWithFallback();
      this.onState('ready');
    }

    isCrossOriginProxy(url) {
      try { return new URL(url, location.href).origin === location.origin; } catch (_) { return false; }
    }

    waitForPlayable(timeoutMs) {
      return new Promise((resolve, reject) => {
        if (this.video.readyState >= 1 && Number.isFinite(this.video.duration) && this.video.duration > 0) return resolve();
        let settled = false;
        const finish = (fn, value) => { if (settled) return; settled = true; cleanup(); fn(value); };
        const ok = () => {
          if (Number.isFinite(this.video.duration) && this.video.duration > 0) finish(resolve);
        };
        const bad = () => finish(reject, new Error(this.describeVideoError()));
        const timer = setTimeout(() => finish(reject, new Error(this.describeVideoError())), timeoutMs);
        const cleanup = () => { clearTimeout(timer); this.video.removeEventListener('loadedmetadata', ok); this.video.removeEventListener('durationchange', ok); this.video.removeEventListener('error', bad); this.video.removeEventListener('canplay', ok); };
        this.video.addEventListener('loadedmetadata', ok);
        this.video.addEventListener('durationchange', ok);
        this.video.addEventListener('canplay', ok);
        this.video.addEventListener('error', bad);
      });
    }

    describeVideoError() {
      const err = this.video.error;
      if (err && err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        return 'The browser cannot decode this media format/container. Try another quality or an MP4/WebM/HLS source.';
      }
      if (/\.mkv(?:$|[?#])/i.test(this.currentUrl) && !canPlayMKV(this.video)) {
        return 'This browser does not provide native Matroska (MKV) playback. A browser-supported MP4/WebM/HLS source is required.';
      }
      return 'Video metadata could not be loaded. The source may require different CORS/Range headers or may have expired.';
    }

    async playWithFallback() {
      try { await this.video.play(); return true; }
      catch (_) { this.pendingPlay = false; this.onState('ready'); return false; }
    }

    async handleMediaError() {
      this.setLoading(false);
      if (!this.usedProxy && this.currentUrl && !this.isCrossOriginProxy(this.currentUrl)) {
        this.usedProxy = true;
        const proxy = `/api/media?url=${encodeURIComponent(this.currentUrl)}`;
        this.video.src = proxy;
        this.video.load();
        try { await this.waitForPlayable(6500); if (this.pendingPlay) await this.playWithFallback(); return; } catch (_) {}
      }
      this.showError('Playback failed', this.describeVideoError());
      this.onState('error');
    }

    toggle() { if (this.video.paused) this.playWithFallback(); else this.video.pause(); }
    seek(delta) { if (!Number.isFinite(this.video.duration)) return; this.video.currentTime = Math.max(0, Math.min(this.video.duration, (this.video.currentTime || 0) + delta)); this.revealControls(); }
    updateProgress() { if (!Number.isFinite(this.video.duration) || this.video.duration <= 0) return; const ratio = Math.min(1, Math.max(0, this.video.currentTime / this.video.duration)); this.range.value = String(Math.round(ratio * 1000)); this.progress.style.width = `${ratio * 100}%`; this.current.textContent = fmt(this.video.currentTime); this.duration.textContent = fmt(this.video.duration); try { const b = this.video.buffered; const end = b.length ? b.end(b.length - 1) : 0; this.buffer.style.width = `${Math.min(100, (end / this.video.duration) * 100)}%`; } catch (_) {} }
    updatePlayIcon() { const playing = !this.video.paused; const markup = playing ? icon('pause') : icon('play'); this.playBtn.innerHTML = markup; this.bigPlay.innerHTML = markup; this.bigPlay.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
    updateVolume() { $('[data-mute]', this.root).innerHTML = this.video.muted || this.video.volume === 0 ? icon('mute') : icon('volume'); }
    revealControls() { this.controls.classList.remove('sp-controls-hidden'); clearTimeout(this.chromeTimer); if (!this.video.paused) this.chromeTimer = setTimeout(() => this.controls.classList.add('sp-controls-hidden'), 2600); }
    setLoading(value) { this.spinner.classList.toggle('sp-spinner-visible', value); if (!value) this.revealControls(); }
    hideError() { this.message.classList.add('sp-message-hidden'); }
    showError(title, text) { this.messageTitle.textContent = title; this.messageText.textContent = text; this.message.classList.remove('sp-message-hidden'); }
    fail(message) { this.showError('Unable to play', message || 'The source could not be played.'); this.setLoading(false); this.onState('error'); }
    retry() { if (!this.media) return; const keep = this.video.currentTime || 0; const quality = this.video.dataset.quality || 'Auto'; const chosen = quality === 'Auto' ? {url: this.media.videoUrl, quality:'Auto'} : (this.media.resolutions || []).find(x => x.quality === quality) || {url:this.media.videoUrl,quality:'Auto'}; this.setSource(chosen.url,{time:keep,playing:true,quality:chosen.quality,resetTracks:false}).catch(e => this.fail(e.message)); }

    openSettings() {
      const q = this.media && this.media.resolutions ? this.media.resolutions : [];
      const subs = this.media && this.media.subtitles ? this.media.subtitles : [];
      const speeds = [0.5,0.75,1,1.25,1.5,1.75,2];
      const rows = [
        { key:'quality', icon:'quality', label:'Quality', value:this.video.dataset.quality || 'Auto' },
        { key:'subs', icon:'cc', label:'Subtitles', value:this.video.dataset.subtitle || 'Off' },
        { key:'speed', icon:'speed', label:'Playback speed', value:`${this.video.playbackRate}×` }
      ];
      this.menu.classList.remove('sp-menu-hidden');
      this.menu.innerHTML = `<div class="sp-menu-head"><strong>Player settings</strong><button type="button" data-menu-close aria-label="Close">×</button></div>${rows.map(r=>`<button type="button" class="sp-menu-row" data-row="${r.key}">${icon(r.icon)}<span>${r.label}</span><em>${esc(r.value)}</em><b>›</b></button>`).join('')}`;
      $('[data-menu-close]', this.menu).onclick = () => this.closeMenu();
      $('[data-row="quality"]', this.menu).onclick = () => this.menuOptions('Quality', [{value:'Auto',label:'Auto'},...q.map(x=>({value:x.url,label:x.quality}))], this.video.dataset.qualityUrl || 'Auto', async value => {
        const time=this.video.currentTime||0, playing=!this.video.paused;
        const chosen=value==='Auto'?{url:this.media.videoUrl,quality:'Auto'}:(q.find(x=>x.url===value)||q[0]);
        if (!chosen) return this.closeMenu();
        this.video.dataset.qualityUrl=value; await this.setSource(chosen.url,{time,playing,quality:chosen.quality,resetTracks:false}); this.openSettings();
      });
      $('[data-row="subs"]', this.menu).onclick = () => this.menuOptions('Subtitles', [{value:'off',label:'Off'},...subs.map(x=>({value:x.url,label:x.label}))], this.video.dataset.subtitleUrl || 'off', value => { this.video.dataset.subtitleUrl=value; this.installSubtitles(value); this.openSettings(); });
      $('[data-row="speed"]', this.menu).onclick = () => this.menuOptions('Playback speed', speeds.map(v=>({value:String(v),label:`${v}×`})), String(this.video.playbackRate), value => { this.video.playbackRate=Number(value); this.openSettings(); });
    }

    menuOptions(title, options, selected, choose) {
      this.menu.innerHTML = `<div class="sp-menu-head"><button type="button" data-menu-back aria-label="Back">${icon('back')}</button><strong>${esc(title)}</strong><button type="button" data-menu-close aria-label="Close">×</button></div>${options.map(o=>`<button type="button" class="sp-option" data-value="${esc(o.value)}"><span>${esc(o.label)}</span>${o.value===selected?`<b>${icon('check')}</b>`:''}</button>`).join('')}`;
      $('[data-menu-back]',this.menu).onclick=()=>this.openSettings();
      $('[data-menu-close]',this.menu).onclick=()=>this.closeMenu();
      $$('.sp-option',this.menu).forEach(b=>b.onclick=()=>Promise.resolve(choose(b.dataset.value)));
    }

    closeMenu(){ this.menu.classList.add('sp-menu-hidden'); }
    installSubtitles(value) {
      $$('track', this.video).forEach(t => t.remove());
      this.subtitle.textContent = '';
      this.subtitle.classList.remove('sp-subtitle-visible');
      this.video.dataset.subtitle = value === 'off' ? 'Off' : ((this.media.subtitles || []).find(x=>x.url===value) || {}).label || 'Off';
      if (!value || value === 'off') return;
      const item=(this.media.subtitles || []).find(x=>x.url===value); if (!item) return;
      const track=document.createElement('track'); track.kind='subtitles'; track.label=item.label; track.srclang=item.language||'en'; track.src=item.url; track.default=true; this.video.appendChild(track);
      try { track.track.mode='showing'; } catch (_) {}
      const render=()=>{ const cues=track.track && track.track.activeCues; const text=cues && cues.length ? Array.from(cues).map(c=>c.text).join('\n') : ''; this.subtitle.textContent=text; this.subtitle.classList.toggle('sp-subtitle-visible',!!text); };
      track.addEventListener('load',render); setTimeout(render,200);
    }
    pip(){ if (!document.pictureInPictureEnabled || this.video.disablePictureInPicture || !this.video.requestPictureInPicture) return; document.pictureInPictureElement ? document.exitPictureInPicture() : this.video.requestPictureInPicture().catch(()=>{}); }
    fullscreen(){ if (document.fullscreenElement) document.exitFullscreen().catch(()=>{}); else this.root.requestFullscreen?.().catch(()=>{}); }
  }

  function watchAdblock() { return () => {}; }
  function detectAdblock() { return Promise.resolve(false); }

  return { SyncEngine: null, SyncPlayer, canPlayMKV, detectAdblock, fetchSource, isIOS, normalizeSourcePayload, watchAdblock };
});
