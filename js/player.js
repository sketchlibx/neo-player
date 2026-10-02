(() => {
  'use strict';

  const STORE = 'neo.stream.v3';
  const HISTORY_LIMIT = 8;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (n) => {
    n = Number.isFinite(n) ? Math.max(0, n) : 0;
    const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = Math.floor(n % 60);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  };
  const icon = (name) => {
    const p = {
      play:'<path d="m9 6 9 6-9 6V6Z"/>', pause:'<path d="M8 6v12M16 6v12"/>',
      volume:'<path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 7a7 7 0 0 1 0 10"/>',
      mute:'<path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="m16 9-4 6M12 9l4 6"/>',
      settings:'<path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"/><path d="m19 13 .7 1.2-1.2 2-1.4-.1-1 .9-.1 1.4-2.2.6-.9-1.1h-1.5l-.9 1.1-2.2-.6-.1-1.4-1-.9-1.4.1-1.2-2L5 13l.2-2L4.7 9l1.2-2 1.4.1 1-.9.1-1.4 2.2-.6.9 1.1H13l.9-1.1 2.2.6.1 1.4 1 .9 1.4-.1 1.2 2-.7 2Z"/>',
      fullscreen:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>',
      pip:'<path d="M3 5h18v14H3z"/><path d="M13 12h6v4h-6z"/>',
      captions:'<path d="M4 6h16v12H4z"/><path d="M7 10h4M13 10h4M7 14h3M12 14h5"/>',
      quality:'<path d="M4 6h16v12H4z"/><path d="M7 10h10M7 14h6"/>',
      speed:'<path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 12 16 9"/>',
      back:'<path d="m15 18-6-6 6-6"/>', check:'<path d="m5 12 4 4L19 6"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[name] || ''}</svg>`;
  };

  function b64UrlEncode(value) {
    try {
      const bytes = new TextEncoder().encode(String(value));
      let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    } catch { return encodeURIComponent(value); }
  }
  function b64UrlDecode(value) {
    try {
      const normalized = value.replaceAll('-','+').replaceAll('_','/') + '='.repeat((4 - value.length % 4) % 4);
      const binary = atob(normalized);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch { return decodeURIComponent(value); }
  }
  function unwrap(value) {
    let v = String(value || '').trim();
    try { v = decodeURIComponent(v); } catch {}
    try {
      const u = new URL(v, location.href);
      for (const key of ['url','source','src','stream']) {
        const nested = u.searchParams.get(key);
        if (nested && /^https?:\/\//i.test(nested)) return nested;
      }
    } catch {}
    return v;
  }

  function getState() {
    try { return JSON.parse(localStorage.getItem(STORE) || '{"history":[],"last":""}'); } catch { return { history: [], last: '' }; }
  }
  function setState(state) { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} }
  function rememberSource(source, title = '') {
    const clean = String(source || '').trim(); if (!clean) return;
    const state = getState();
    state.last = b64UrlEncode(clean);
    state.history = [{ encoded: b64UrlEncode(clean), title: title || hostname(clean), at: Date.now() }, ...(state.history || []).filter(x => x.encoded !== state.last)].slice(0, HISTORY_LIMIT);
    setState(state);
  }
  function lastSource() { const v = getState().last; return v ? b64UrlDecode(v) : ''; }
  function hostname(value) { try { return new URL(value).hostname; } catch { return 'Source'; } }

  function normalizeMedia(data) {
    if (!data || typeof data !== 'object') throw new Error('The source returned invalid JSON.');
    const resolutions = Array.isArray(data.resolutions) ? data.resolutions.filter(x => x && x.url).map(x => ({ quality: String(x.quality || 'Auto'), url: String(x.url) })) : [];
    const subtitles = Array.isArray(data.subtitleTracks) ? data.subtitleTracks.filter(x => x && x.url).map(x => ({ label: String(x.label || x.language || 'Subtitle'), language: String(x.language || 'en'), url: String(x.url) })) : [];
    const videoUrl = typeof data.videoUrl === 'string' && data.videoUrl ? data.videoUrl : (resolutions[0]?.url || '');
    if (!videoUrl) throw new Error('No playable video URL was found in the JSON response.');
    return { videoUrl, resolutions, subtitles, title: data.title || '' };
  }

  async function resolveSource(source) {
    const value = unwrap(source);
    if (!value) throw new Error('Paste a source URL first.');
    const endpoint = `/api/resolve?url=${encodeURIComponent(value)}`;
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    let payload = null;
    try { payload = await response.json(); } catch { throw new Error(`Resolver returned HTTP ${response.status}.`); }
    if (!response.ok || payload?.error) throw new Error(payload?.error || `Resolver failed (${response.status}).`);
    if (payload.mode === 'iframe') return payload;
    return { mode: 'media', data: normalizeMedia(payload.data || payload) };
  }

  class Player {
    constructor(mount, { autoplay = true, onState } = {}) { this.mount = mount; this.autoplay = autoplay; this.onState = onState; this.media = null; this.hideTimer = 0; this.render(); bind(this); }
    render() {
      this.mount.innerHTML = `<div class="sp-root">
        <video class="sp-video" playsinline preload="metadata"></video>
        <div class="sp-chrome">
          <div class="sp-gradient-top"></div><div class="sp-gradient-bottom"></div>
          <div class="sp-center-play"><button type="button" aria-label="Play">${icon('play')}</button></div>
          <div class="sp-controls">
            <div class="sp-seek-row"><span class="sp-time" data-current>0:00</span><div class="sp-seek-track"><div class="sp-seek-bg"></div><div class="sp-seek-buffered"></div><div class="sp-seek-fill"></div><input type="range" min="0" max="100" value="0" step="0.1" aria-label="Seek"></div><span class="sp-time" data-duration>0:00</span></div>
            <div class="sp-btn-row">
              <button class="sp-btn" data-back10 aria-label="Back 10 seconds"><span style="position:relative;display:inline-flex">↶<b style="font:700 7px ui-monospace;position:absolute;left:7px;top:8px">10</b></span></button>
              <button class="sp-btn" data-play aria-label="Play">${icon('play')}</button>
              <button class="sp-btn" data-next10 aria-label="Forward 10 seconds"><span style="position:relative;display:inline-flex">↷<b style="font:700 7px ui-monospace;position:absolute;left:7px;top:8px">10</b></span></button>
              <button class="sp-btn" data-mute aria-label="Mute">${icon('volume')}</button><div class="sp-volume-row"><input type="range" min="0" max="1" step=".01" value="1" aria-label="Volume"></div>
              <div class="sp-spacer"></div>
              <button class="sp-btn" data-settings aria-label="Settings">${icon('settings')}</button>
              <button class="sp-btn" data-pip aria-label="Picture in picture">${icon('pip')}</button>
              <button class="sp-btn" data-fullscreen aria-label="Fullscreen">${icon('fullscreen')}</button>
            </div>
          </div>
        </div>
        <div class="sp-subtitle-overlay"></div>
        <div class="sp-spinner"><div class="sp-spinner-ring"></div></div>
        <div class="sp-seek-flash sp-seek-flash-left" data-flash-left>${icon('back')}</div><div class="sp-seek-flash sp-seek-flash-right" data-flash-right>${icon('play')}</div>
        <div class="sp-menu sp-menu-closed" data-menu></div>
        <div class="sp-error-overlay sp-error-overlay-hidden" data-error><p data-error-text></p><button type="button" data-retry>Retry</button></div>
      </div>`;
      this.root = $('.sp-root', this.mount); this.video=$('.sp-video',this.root); this.chrome=$('.sp-chrome',this.root); this.play=$('[data-play]',this.root); this.center=$('.sp-center-play button',this.root); this.range=$('.sp-seek-track input',this.root); this.fill=$('.sp-seek-fill',this.root); this.buffer=$('.sp-seek-buffered',this.root); this.current=$('[data-current]',this.root); this.duration=$('[data-duration]',this.root); this.volume=$('.sp-volume-row input',this.root); this.menu=$('[data-menu]',this.root); this.spinner=$('.sp-spinner',this.root); this.subtitle=$('.sp-subtitle-overlay',this.root); this.error=$('[data-error]',this.root); this.errorText=$('[data-error-text]',this.root);
    }
    load(media) { this.media = media; return this.changeSource(media.videoUrl, 0, this.autoplay, 'Auto', true); }
    async changeSource(url, time = 0, playing = false, quality = 'Auto', resetTracks = false) {
      this.error.classList.add('sp-error-overlay-hidden'); this.spinner.classList.add('sp-spinner-visible'); this.video.dataset.quality = quality;
      if (resetTracks) this.clearSubtitles();
      this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.src = url; this.video.load();
      try { await this.waitForMetadata(); } catch {}
      if (Number.isFinite(time) && time > 0 && Number.isFinite(this.video.duration)) this.video.currentTime = Math.min(time, Math.max(0, this.video.duration - .15));
      if (playing) this.video.play().catch(() => {});
      this.spinner.classList.remove('sp-spinner-visible'); this.onState?.('active');
    }
    waitForMetadata() { return new Promise((resolve, reject) => { if (this.video.readyState >= 1) return resolve(); const ok=()=>{cleanup();resolve()}; const bad=()=>{cleanup();reject(new Error('metadata failed'))}; const t=setTimeout(()=>{cleanup();resolve()},5500); const cleanup=()=>{clearTimeout(t);this.video.removeEventListener('loadedmetadata',ok);this.video.removeEventListener('error',bad)}; this.video.addEventListener('loadedmetadata',ok,{once:true}); this.video.addEventListener('error',bad,{once:true}); }); }
    clearSubtitles() { $$('track', this.video).forEach(x => x.remove()); this.subtitle.textContent=''; this.subtitle.classList.remove('sp-subtitle-visible'); this.video.dataset.subtitle='Off'; }
    loadSubtitle(url, list) { this.clearSubtitles(); if (!url || url === 'off') return; const item=list.find(x=>x.url===url); if (!item) return; const track=document.createElement('track'); track.kind='subtitles'; track.src=item.url; track.label=item.label; track.srclang=item.language || 'en'; track.default=true; this.video.appendChild(track); this.video.dataset.subtitle=item.label; track.addEventListener('load',()=>this.hookCue(track)); try { track.track.mode='showing'; } catch { setTimeout(()=>this.hookCue(track),50); } }
    hookCue(track) { track.track.addEventListener('cuechange',()=>{ const cues=track.track.activeCues; const text=cues?.length ? [...cues].map(c=>c.text).join('\n') : ''; this.subtitle.textContent=text; this.subtitle.classList.toggle('sp-subtitle-visible',Boolean(text)); }); }
    toggle(){ if(this.video.paused) this.video.play().catch(()=>{}); else this.video.pause(); }
    seek(delta){ if(!Number.isFinite(this.video.duration)) return; this.video.currentTime=Math.max(0,Math.min(this.video.duration,(this.video.currentTime||0)+delta)); const el=this.mount.querySelector(delta<0?'[data-flash-left]':'[data-flash-right]'); el.classList.add('sp-seek-flash-active'); setTimeout(()=>el.classList.remove('sp-seek-flash-active'),220); this.showChrome(); }
    updateProgress(){ if(!Number.isFinite(this.video.duration)||this.video.duration<=0) return; const p=(this.video.currentTime/this.video.duration)*100; this.range.value=p; this.fill.style.width=`${p}%`; this.current.textContent=fmt(this.video.currentTime); try{const end=this.video.buffered.length?this.video.buffered.end(this.video.buffered.length-1):0;this.buffer.style.width=`${Math.min(100,end/this.video.duration*100)}%`}catch{}}
    showChrome(){ this.chrome.classList.remove('sp-hidden'); clearTimeout(this.hideTimer); if(!this.video.paused) this.hideTimer=setTimeout(()=>this.chrome.classList.add('sp-hidden'),2600); }
    updatePlay(){ const playing=!this.video.paused; const val=playing?icon('pause'):icon('play'); this.play.innerHTML=val; this.center.innerHTML=val; this.center.setAttribute('aria-label',playing?'Pause':'Play'); if(playing)this.showChrome(); }
    fullscreen(){ const node=this.root; if(document.fullscreenElement)return document.exitFullscreen().catch(()=>{}); return node.requestFullscreen?.().catch(()=>{}); }
    pip(){ if(document.pictureInPictureElement)return document.exitPictureInPicture?.(); if(document.pictureInPictureEnabled && !this.video.disablePictureInPicture)return this.video.requestPictureInPicture?.().catch(()=>{}); }
    mute(){ this.video.muted=!this.video.muted; this.updateVolumeIcon(); }
    updateVolumeIcon(){ const b=this.mount.querySelector('[data-mute]'); b.innerHTML=this.video.muted||this.video.volume===0?icon('mute'):icon('volume'); }
    openSettings(){ const q=this.media?.resolutions || []; const s=this.media?.subtitles || []; this.menu.classList.remove('sp-menu-closed'); this.menu.innerHTML=`<div class="sp-menu-header"><button class="sp-menu-back" data-back aria-label="Back">${icon('back')}</button><span class="sp-menu-title">Settings</span></div><button class="sp-menu-row" data-q>${icon('quality')}<span class="sp-menu-row-label">Quality</span><span class="sp-menu-row-value">${esc(this.video.dataset.quality||'Auto')}</span><span class="sp-menu-row-chev">›</span></button><button class="sp-menu-row" data-s>${icon('captions')}<span class="sp-menu-row-label">Subtitles</span><span class="sp-menu-row-value">${esc(this.video.dataset.subtitle||'Off')}</span><span class="sp-menu-row-chev">›</span></button><button class="sp-menu-row" data-sp>${icon('speed')}<span class="sp-menu-row-label">Speed</span><span class="sp-menu-row-value">${this.video.playbackRate}×</span><span class="sp-menu-row-chev">›</span></button>`; $('[data-back]',this.menu).onclick=()=>this.closeMenu(); $('[data-q]',this.menu).onclick=()=>this.qualityMenu(q); $('[data-s]',this.menu).onclick=()=>this.subtitleMenu(s); $('[data-sp]',this.menu).onclick=()=>this.speedMenu(); }
    closeMenu(){this.menu.classList.add('sp-menu-closed')}
    options(title, items, current, cb){ this.menu.innerHTML=`<div class="sp-menu-header"><button class="sp-menu-back" data-back>${icon('back')}</button><span class="sp-menu-title">${esc(title)}</span></div>${items.map(x=>`<button class="sp-menu-option" data-v="${esc(x.value)}"><span>${esc(x.label)}</span>${x.value===current?`<span class="sp-menu-check">${icon('check')}</span>`:''}</button>`).join('')}`; $('[data-back]',this.menu).onclick=()=>this.openSettings(); $$('.sp-menu-option',this.menu).forEach(b=>b.onclick=()=>cb(b.dataset.v)); }
    qualityMenu(items){ const list=[{value:'auto',label:'Auto'},...items.map(x=>({value:x.url,label:x.quality}))]; this.options('Quality',list,this.video.dataset.qualityUrl||'auto',async v=>{ const keep=this.video.currentTime||0, play=!this.video.paused; if(v==='auto'){this.video.dataset.qualityUrl='auto';await this.changeSource(this.media.videoUrl,keep,play,'Auto',false)}else{const f=items.find(x=>x.url===v);this.video.dataset.qualityUrl=v;await this.changeSource(f.url,keep,play,f.quality,false)}this.openSettings();}); }
    subtitleMenu(items){ const list=[{value:'off',label:'Off'},...items.map(x=>({value:x.url,label:x.label}))]; const current=this.video.dataset.subtitleUrl||'off'; this.options('Subtitles',list,current,v=>{this.video.dataset.subtitleUrl=v;this.loadSubtitle(v,items);this.openSettings();}); }
    speedMenu(){ const vals=[.5,.75,1,1.25,1.5,1.75,2]; this.options('Speed',vals.map(v=>({value:String(v),label:`${v}×`})),String(this.video.playbackRate),v=>{this.video.playbackRate=Number(v);this.openSettings()}); }
    retry(){ if(this.media)this.load(this.media).catch(()=>{}); }
    fail(message){ this.spinner.classList.remove('sp-spinner-visible'); this.errorText.textContent=message || 'Unable to play this source.'; this.error.classList.remove('sp-error-overlay-hidden'); this.onState?.('error'); }
  }

  function bind(p) {
    p.center.onclick=()=>p.toggle(); p.play.onclick=()=>p.toggle(); p.video.onclick=()=>p.toggle(); p.video.ondblclick=()=>p.fullscreen();
    p.video.onplay=()=>p.updatePlay(); p.video.onpause=()=>p.updatePlay(); p.video.onloadedmetadata=()=>{p.duration.textContent=fmt(p.video.duration);p.updateProgress()}; p.video.ontimeupdate=()=>p.updateProgress(); p.video.onprogress=()=>p.updateProgress(); p.video.onwaiting=()=>p.spinner.classList.add('sp-spinner-visible'); p.video.onplaying=()=>{p.spinner.classList.remove('sp-spinner-visible');p.showChrome()}; p.video.onerror=()=>p.fail('This media could not be decoded by the browser. Try another quality or a browser with support for this format.');
    p.range.oninput=()=>{if(Number.isFinite(p.video.duration))p.video.currentTime=(Number(p.range.value)/100)*p.video.duration;p.showChrome()}; p.volume.oninput=()=>{p.video.volume=Number(p.volume.value);p.video.muted=p.video.volume===0;p.updateVolumeIcon()};
    $('[data-back10]',p.root).onclick=()=>p.seek(-10); $('[data-next10]',p.root).onclick=()=>p.seek(10); $('[data-mute]',p.root).onclick=()=>p.mute(); $('[data-settings]',p.root).onclick=()=>p.openSettings(); $('[data-pip]',p.root).onclick=()=>p.pip(); $('[data-fullscreen]',p.root).onclick=()=>p.fullscreen(); $('[data-retry]',p.root).onclick=()=>p.retry();
    p.root.addEventListener('mousemove',()=>p.showChrome(),{passive:true}); p.root.addEventListener('touchstart',()=>p.showChrome(),{passive:true});
    document.addEventListener('keydown',e=>{if(!p.root.isConnected)return;if(e.target.matches('input,textarea,button'))return; if(e.code==='Space'){e.preventDefault();p.toggle()}else if(e.key==='ArrowLeft')p.seek(-10);else if(e.key==='ArrowRight')p.seek(10);else if(e.key.toLowerCase()==='f')p.fullscreen();});
  }

  function renderHistory(els, loadFn) {
    const history = getState().history || [];
    els.historyList.innerHTML = history.length ? history.map((item,i)=>`<button class="history-item" data-index="${i}" type="button"><span style="width:29px;height:29px;border-radius:8px;background:#ffffff06;display:grid;place-items:center;color:#8290a5;font:700 10px ui-monospace">${i+1}</span><span style="min-width:0;flex:1"><strong>${esc(item.title||'Source')}</strong><small>${esc(b64UrlDecode(item.encoded))}</small></span><span class="history-use">→</span></button>`).join('') : '<div class="empty-history">No recent sources yet. Load a source and it will appear here.</div>';
    $$('.history-item',els.historyList).forEach(b=>b.onclick=()=>{const i=Number(b.dataset.index), item=history[i];if(!item)return;const source=b64UrlDecode(item.encoded);els.input.value=source;els.clearButton.hidden=false;closeHistory(els);loadFn(source)});
  }
  function openHistory(els, loadFn){ renderHistory(els,loadFn); els.historyPanel.classList.add('open');els.historyPanel.setAttribute('aria-hidden','false'); }
  function closeHistory(els){els.historyPanel.classList.remove('open');els.historyPanel.setAttribute('aria-hidden','true');}

  function init(opts){
    const els=opts; let player=null; const params=new URLSearchParams(location.search); const shared=params.get('url')||params.get('source')||params.get('src');
    const cached=lastSource();
    const setStatus=(text,error=false)=>{els.status.textContent=text;els.status.dataset.error=error?'1':''};
    const setBusy=busy=>{els.loadButton.classList.toggle('busy',busy);$('.load-label',els.loadButton).textContent=busy?'Loading':'Load';};
    const showClear=()=>{els.clearButton.hidden=!els.input.value};
    async function load(source, {remember=true}={}){
      const value=unwrap(source); if(!value){setStatus('Paste a source URL first.',true);return}
      setBusy(true);setStatus('Resolving source…');els.badge.textContent='Resolving';els.badge.classList.remove('active');
      try{
        const result=await resolveSource(value);
        if(result.mode==='iframe'){
          els.mount.innerHTML=`<div class="sp-root"><iframe title="Embedded media player" src="${esc(result.url)}" style="width:100%;height:100%;border:0;background:#000" allow="autoplay;fullscreen;picture-in-picture;encrypted-media" allowfullscreen referrerpolicy="no-referrer"></iframe></div>`;
          els.badge.textContent='Embed';els.badge.classList.add('active');setStatus('Embeddable player detected.');
        }else{
          if(!player)player=new Player(els.mount,{autoplay:opts.autoplay,onState:s=>{if(s==='active'){els.badge.textContent='Playing';els.badge.classList.add('active')}if(s==='error'){els.badge.textContent='Error';els.badge.classList.remove('active')}}});
          player.media=result.data;await player.load(result.data);els.badge.textContent='Playing';els.badge.classList.add('active');setStatus('Source ready.');
          if(result.data.subtitles?.length && !player.video.dataset.subtitle) { player.loadSubtitle('off',result.data.subtitles); }
        }
        if(remember)rememberSource(value,result.data?.title||hostname(value));
        const u=new URL(location.href);u.searchParams.set('url',value);history.replaceState(null,'',u.toString());
      }catch(error){setStatus(error.message||'Unable to resolve source.',true);els.badge.textContent='Error';els.badge.classList.remove('active');if(player)player.fail(error.message||'Unable to resolve source.');}
      finally{setBusy(false);showClear();}
      els.mount.closest('.player-section')?.scrollIntoView({behavior:'smooth',block:'start'});
    }
    els.loadButton.onclick=()=>load(els.input.value);els.input.onkeydown=e=>{if(e.key==='Enter')load(els.input.value)};els.input.oninput=showClear;els.clearButton.onclick=()=>{els.input.value='';showClear();setStatus('Ready for a source.');els.input.focus()};els.restoreButton.onclick=()=>load(lastSource());
    els.historyButton.onclick=()=>openHistory(els,load);els.closeHistory.onclick=()=>closeHistory(els);$('.history-backdrop',els.historyPanel).onclick=()=>closeHistory(els);els.clearHistory.onclick=()=>{setState({history:[],last:''});renderHistory(els,load)};
    if(shared){els.input.value=shared;showClear();load(shared,{remember:true})}else if(cached){els.input.value=cached;showClear();els.restoreButton.hidden=false;setStatus('Last source restored. Press Load to play it.')} 
  }

  window.NeoPlayerApp={init};
})();
