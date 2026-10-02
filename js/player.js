(function () {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (n) => { n = Number.isFinite(n) ? Math.max(0, n) : 0; const h=Math.floor(n/3600), m=Math.floor(n%3600/60), s=Math.floor(n%60); return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`; };
  const icon = (name) => {
    const p={play:'<path d="m9 6 9 6-9 6V6Z"/>',pause:'<path d="M8 6v12M16 6v12"/>',back:'<path d="m15 18-6-6 6-6"/>',settings:'<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Z"/><path d="m19 13-.9.4.1 1-.9 1.5-1 .1-.4.9-1.8.5-.7-.7-.9.4-.1 1-1.7.6-1.3-1-.9-.4-.7.7-1.8-.5-.4-.9-1-.1-.9-1.5.1-1L5 13l.2-2-.8-.7.4-1.7 1-.3.3-1 1.8-.6.7.7.9-.4.1-1 1.7-.6 1.3 1 .9.4.7-.7 1.8.6.4 1 1 .3.9 1.5-.1 1 .9.4-.2 2Z"/>',fullscreen:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/>',pip:'<path d="M3 5h18v14H3z"/><path d="M13 12h6v4h-6z"/>',captions:'<path d="M4 6h16v12H4z"/><path d="M7 10h4M13 10h4M7 14h3M12 14h5"/>',volume:'<path d="M5 10v4h3l4 3V7L8 10H5Z"/><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10"/>',mute:'<path d="M5 10v4h3l4 3V7l-4 3H5Z"/><path d="m17 10-4 4M13 10l4 4"/>',speed:'<path d="M4 14a8 8 0 1 1 16 0"/><path d="M12 12 16 9"/>',quality:'<path d="M4 6h16v12H4z"/><path d="M7 9h10M7 13h6"/>'};
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p[name]||''}</svg>`;
  };

  function unwrap(url) {
    let value = String(url || '').trim();
    if (!value) return '';
    try { value = decodeURIComponent(value); } catch (_) {}
    try {
      const u = new URL(value);
      for (const k of ['url','source','src']) {
        const v = u.searchParams.get(k);
        if (v && (/^https?:/i.test(v))) return v;
      }
    } catch (_) {}
    return value;
  }

  async function resolveInput(input) {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('Paste a source URL first.');

    let unwrapped = unwrap(raw);
    if (/^data:application\/json/i.test(unwrapped)) return { type:'json', data: JSON.parse(atob(unwrapped.split(',')[1])) };

    const api = '/api/resolve?url=' + encodeURIComponent(unwrapped);
    const res = await fetch(api, { headers:{'Accept':'application/json'} });
    if (!res.ok) throw new Error((await res.text()) || `Resolver failed (${res.status})`);
    const payload = await res.json();
    return payload;
  }

  function mediaFromData(data) {
    if (!data || typeof data !== 'object') throw new Error('Resolver returned invalid JSON.');
    if (data.videoUrl || Array.isArray(data.resolutions)) return {
      videoUrl: data.videoUrl || (data.resolutions || [])[0]?.url,
      resolutions: (data.resolutions || []).filter(x => x && x.url).map(x => ({ quality:String(x.quality||''), url:String(x.url) })),
      subtitles: Array.isArray(data.subtitleTracks) ? data.subtitleTracks.filter(x=>x && x.url).map(x=>({language:x.language||'',label:x.label||x.language||'Subtitle',url:x.url})) : [],
      defaultAudioLabel: data.defaultAudioLabel || ''
    };
    if (data.url) return { videoUrl:data.url, resolutions:[], subtitles:[] };
    throw new Error('No playable video URL found in the response.');
  }

  class Player {
    constructor(mount,{autoplay=true}={}) { this.mount=mount; this.autoplay=autoplay; this.currentMedia=null; this.subtitles=[]; this.hideTimer=null; this.render(); }
    render(){
      this.mount.innerHTML=`<div class="sp-root">
        <video class="sp-video" playsinline preload="metadata"></video>
        <div class="sp-chrome">
          <div class="sp-gradient-top"></div><div class="sp-gradient-bottom"></div>
          <div class="sp-center-play"><button type="button" aria-label="Play">${icon('play')}</button></div>
          <div class="sp-controls">
            <div class="sp-seek-row"><span class="sp-time" data-current>0:00</span><div class="sp-seek-track"><div class="sp-seek-bg"></div><div class="sp-seek-buffered"></div><div class="sp-seek-fill"></div><input type="range" min="0" max="100" value="0" step="0.1" aria-label="Seek"></div><span class="sp-time" data-duration>0:00</span></div>
            <div class="sp-btn-row">
              <button class="sp-btn" data-back10 aria-label="Back 10 seconds">↶<span style="font:700 8px ui-monospace;position:absolute;transform:translateY(1px)">10</span></button>
              <button class="sp-btn" data-play aria-label="Play">${icon('play')}</button>
              <button class="sp-btn" data-next10 aria-label="Forward 10 seconds">↷<span style="font:700 8px ui-monospace;position:absolute;transform:translateY(1px)">10</span></button>
              <button class="sp-btn" data-mute aria-label="Mute">${icon('volume')}</button><div class="sp-volume-row"><input type="range" min="0" max="1" step="0.01" value="1" aria-label="Volume"></div>
              <div class="sp-spacer"></div><button class="sp-btn" data-settings aria-label="Settings">${icon('settings')}</button><button class="sp-btn" data-fullscreen aria-label="Fullscreen">${icon('fullscreen')}</button>
            </div>
          </div>
        </div>
        <div class="sp-subtitle-overlay"></div><div class="sp-spinner"><div class="sp-spinner-ring"></div></div>
        <div class="sp-menu sp-menu-closed" data-menu></div>
        <div class="sp-seek-flash sp-seek-flash-left" data-flash-left>${icon('back')}</div><div class="sp-seek-flash sp-seek-flash-right" data-flash-right>${icon('back')}</div>
        <div class="sp-error-overlay" data-error style="display:none"><div class="sp-error-card"><h2 class="sp-error-title">Playback error</h2><p class="sp-error-desc" data-error-text></p><button class="sp-action" data-retry>Retry</button></div></div>
      </div>`;
      this.video=this.mount.querySelector('.sp-video'); this.chrome=this.mount.querySelector('.sp-chrome'); this.playButton=this.mount.querySelector('[data-play]'); this.center=this.mount.querySelector('.sp-center-play button'); this.range=this.mount.querySelector('.sp-seek-track input'); this.fill=this.mount.querySelector('.sp-seek-fill'); this.buffer=this.mount.querySelector('.sp-seek-buffered'); this.current=this.mount.querySelector('[data-current]'); this.duration=this.mount.querySelector('[data-duration]'); this.volume=this.mount.querySelector('.sp-volume-row input'); this.menu=this.mount.querySelector('[data-menu]'); this.spinner=this.mount.querySelector('.sp-spinner'); this.subtitle=this.mount.querySelector('.sp-subtitle-overlay'); this.error=this.mount.querySelector('[data-error]'); this.errorText=this.mount.querySelector('[data-error-text]'); this.bind(); }
    bind(){
      const toggle=()=>this.toggle(); this.center.onclick=toggle; this.playButton.onclick=toggle;
      this.video.onclick=toggle; this.video.ondblclick=()=>this.fullscreen();
      this.video.onplay=()=>this.updatePlay(true); this.video.onpause=()=>this.updatePlay(false); this.video.onloadedmetadata=()=>{this.duration.textContent=fmt(this.video.duration)};
      this.video.ontimeupdate=()=>this.updateProgress(); this.video.onprogress=()=>this.updateProgress(); this.video.onwaiting=()=>this.spinner.classList.add('sp-spinner-visible'); this.video.onplaying=()=>this.spinner.classList.remove('sp-spinner-visible'); this.video.onerror=()=>this.fail(this.video.error?.message||'The browser could not decode this media.');
      this.range.oninput=()=>{ if(Number.isFinite(this.video.duration)) this.video.currentTime=(Number(this.range.value)/100)*this.video.duration; this.showChrome(); };
      this.volume.oninput=()=>{this.video.volume=Number(this.volume.value);this.video.muted=this.video.volume===0;};
      this.mount.querySelector('[data-back10]').onclick=()=>this.seek(-10); this.mount.querySelector('[data-next10]').onclick=()=>this.seek(10);
      this.mount.querySelector('[data-mute]').onclick=()=>{this.video.muted=!this.video.muted;};
      this.mount.querySelector('[data-fullscreen]').onclick=()=>this.fullscreen(); this.mount.querySelector('[data-settings]').onclick=()=>this.openMenu(); this.mount.querySelector('[data-retry]').onclick=()=>this.retry();
      this.mount.addEventListener('mousemove',()=>this.showChrome()); this.mount.addEventListener('touchstart',()=>this.showChrome(),{passive:true});
      document.addEventListener('keydown',(e)=>{ if (!this.mount.closest('body')) return; if(e.key===' '){e.preventDefault();this.toggle();} if(e.key==='ArrowLeft')this.seek(-10); if(e.key==='ArrowRight')this.seek(10); if(e.key.toLowerCase()==='f')this.fullscreen(); });
    }
    showChrome(){this.chrome.classList.remove('sp-hidden'); clearTimeout(this.hideTimer); if(!this.video.paused) this.hideTimer=setTimeout(()=>this.chrome.classList.add('sp-hidden'),2200)}
    updatePlay(on){ const v=on?icon('pause'):icon('play'); this.playButton.innerHTML=v; this.center.innerHTML=v; this.center.setAttribute('aria-label',on?'Pause':'Play'); if(on)this.showChrome(); }
    toggle(){ if(this.video.paused)this.video.play().catch(()=>{}); else this.video.pause(); }
    seek(delta){ if(!Number.isFinite(this.video.duration))return; this.video.currentTime=Math.max(0,Math.min(this.video.duration,this.video.currentTime+delta)); const el=this.mount.querySelector(delta<0?'[data-flash-left]':'[data-flash-right]'); el.classList.add('sp-seek-flash-active'); setTimeout(()=>el.classList.remove('sp-seek-flash-active'),220); }
    updateProgress(){ if(!Number.isFinite(this.video.duration)||this.video.duration<=0)return; const p=(this.video.currentTime/this.video.duration)*100; this.range.value=String(p); this.fill.style.width=p+'%'; this.current.textContent=fmt(this.video.currentTime); try{const b=this.video.buffered.length?this.video.buffered.end(this.video.buffered.length-1):0;this.buffer.style.width=((b/this.video.duration)*100)+'%';}catch(_){}} 
    async fullscreen(){ if(document.fullscreenElement) return document.exitFullscreen().catch(()=>{}); return this.mount.querySelector('.sp-root').requestFullscreen?.().catch(()=>{}); }
    openMenu(){ const qualities=(this.currentMedia?.resolutions||[]); const subs=this.currentMedia?.subtitles||[]; this.menu.classList.remove('sp-menu-closed'); this.menu.innerHTML=`<div class="sp-menu-header"><button class="sp-menu-back" data-close>×</button><span class="sp-menu-title">Settings</span></div><button class="sp-menu-row" data-qrow>${icon('quality')}<span class="sp-menu-row-label">Quality</span><span class="sp-menu-row-value">${esc(this.video.dataset.quality||'Auto')}</span></button><button class="sp-menu-row" data-srow>${icon('captions')}<span class="sp-menu-row-label">Subtitles</span><span class="sp-menu-row-value">${esc(this.video.dataset.subtitle||'Off')}</span></button><button class="sp-menu-row" data-vrow>${icon('speed')}<span class="sp-menu-row-label">Speed</span><span class="sp-menu-row-value">${this.video.playbackRate}×</span></button>`;
        this.menu.querySelector('[data-close]').onclick=()=>this.closeMenu(); this.menu.querySelector('[data-qrow]').onclick=()=>this.qualityMenu(qualities); this.menu.querySelector('[data-srow]').onclick=()=>this.subtitleMenu(subs); this.menu.querySelector('[data-vrow]').onclick=()=>this.speedMenu(); }
    closeMenu(){this.menu.classList.add('sp-menu-closed');}
    option(title,items,current,cb){this.menu.innerHTML=`<div class="sp-menu-header"><button class="sp-menu-back" data-back>‹</button><span class="sp-menu-title">${esc(title)}</span></div>`+items.map(x=>`<button class="sp-menu-option" data-v="${esc(x.value)}"><span>${esc(x.label)}</span>${x.value===current?`<span class="sp-menu-check">✓</span>`:''}</button>`).join('');this.menu.querySelector('[data-back]').onclick=()=>this.openMenu();this.menu.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>cb(b.getAttribute('data-v')));}
    qualityMenu(items){const opts=[{value:'auto',label:'Auto'},...items.map(x=>({value:x.url,label:x.quality||'Quality'}))];this.option('Quality',opts,this.video.dataset.quality||'auto',async v=>{const keep=this.video.currentTime,playing=!this.video.paused;if(v==='auto'){await this.setSource(this.currentMedia.videoUrl,keep,playing,'Auto')}else{const found=items.find(x=>x.url===v);await this.setSource(found.url,keep,playing,found.quality)}this.openMenu();});}
    subtitleMenu(items){const opts=[{value:'off',label:'Off'},...items.map(x=>({value:x.url,label:x.label||x.language||'Subtitle'}))];this.option('Subtitles',opts,this.video.dataset.subtitleUrl||'off',v=>{this.loadSubtitle(v,items);this.openMenu();});}
    speedMenu(){this.option('Speed',[.5,.75,1,1.25,1.5,1.75,2].map(x=>({value:String(x),label:x+'×'})),String(this.video.playbackRate),v=>{this.video.playbackRate=Number(v);this.openMenu();});}
    loadSubtitle(url,items){ [...this.video.querySelectorAll('track')].forEach(t=>t.remove()); this.subtitle.textContent=''; this.video.dataset.subtitle='Off'; this.video.dataset.subtitleUrl='off'; if(url==='off')return; const item=items.find(x=>x.url===url); if(!item)return; const track=document.createElement('track');track.kind='subtitles';track.label=item.label||item.language||'Subtitle';track.srclang=item.language||'en';track.src=item.url;track.default=true;this.video.appendChild(track);this.video.dataset.subtitle=item.label||item.language||'Subtitle';this.video.dataset.subtitleUrl=url;track.addEventListener('cuechange',()=>{const cues=track.track.activeCues;this.subtitle.textContent=cues&&cues.length?Array.from(cues).map(c=>c.text).join('\n'):'';this.subtitle.classList.toggle('sp-subtitle-visible',!!(cues&&cues.length));});}
    async setSource(url,time=0,playing=false,quality='Auto'){this.video.dataset.quality=quality;this.video.src=url;this.video.load();await new Promise(resolve=>{const h=()=>{this.video.removeEventListener('loadedmetadata',h);resolve();};this.video.addEventListener('loadedmetadata',h,{once:true});setTimeout(resolve,5000)});if(Number.isFinite(time)&&time>0)this.video.currentTime=Math.min(time,Math.max(0,this.video.duration-0.1));if(playing)this.video.play().catch(()=>{});}
    async loadMedia(media){ this.error.style.display='none'; this.currentMedia=media; const first=media.videoUrl || media.resolutions[0]?.url; if(!first)throw new Error('No playable video URL found.'); this.spinner.classList.add('sp-spinner-visible'); await this.setSource(first,0,this.autoplay,'Auto'); this.spinner.classList.remove('sp-spinner-visible'); this.loadSubtitle('off',media.subtitles||[]); }
    fail(msg){this.spinner.classList.remove('sp-spinner-visible');this.errorText.textContent=msg||'Unable to play this source.';this.error.style.display='flex';}
    async retry(){if(!this.currentMedia)return;try{await this.loadMedia(this.currentMedia)}catch(e){this.fail(e.message)}}
  }

  async function loadInto(app,url){
    app.status.removeAttribute('data-error'); app.status.textContent='Resolving source…';
    try{
      const payload=await resolveInput(url);
      if(payload.mode==='iframe'){ app.status.textContent='Embed source detected.'; app.mount.innerHTML=`<div class="sp-root"><iframe title="Embedded player" src="${esc(payload.url)}" style="width:100%;height:100%;border:0;background:#000" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`; return; }
      const data=payload.data||payload; const media=mediaFromData(data); if(!app.player)app.player=new Player(app.mount,{autoplay:app.autoplay}); await app.player.loadMedia(media);
      app.status.textContent='Source loaded.';
    }catch(e){app.status.textContent=e.message||'Unable to resolve source.';app.status.dataset.error='1';if(app.player)app.player.fail(e.message);}
  }

  window.NeoPlayerApp={init({mount,input,loadButton,status,autoplay=true}){const app={mount,input,loadButton,status,autoplay,player:null};const go=()=>loadInto(app,input.value);loadButton.addEventListener('click',go);input.addEventListener('keydown',e=>{if(e.key==='Enter')go()});return app;}};
})();
