(() => {
  'use strict';
  const STORE='neo.stream.v4';
  const MAX=8;
  const $=(s,r=document)=>r.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const b64e=v=>{try{const bytes=new TextEncoder().encode(String(v));let b='';for(const x of bytes)b+=String.fromCharCode(x);return btoa(b).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}catch{return encodeURIComponent(v)}};
  const b64d=v=>{try{const s=String(v).replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-String(v).length%4)%4);const b=atob(s);return new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0)))}catch{try{return decodeURIComponent(v)}catch{return String(v||'')}}};
  const hostname=v=>{try{return new URL(v).hostname}catch{return 'Source'}};
  const unwrap=v=>{let s=String(v||'').trim();try{s=decodeURIComponent(s)}catch{};try{const u=new URL(s,location.href);for(const k of ['url','source','src','stream']){const n=u.searchParams.get(k);if(n&&/^https?:\/\//i.test(n))return n}}catch{}return s};
  const state=()=>{try{return JSON.parse(localStorage.getItem(STORE)||'{"last":"","history":[]}')}catch{return {last:'',history:[]}}};
  const save=x=>{try{localStorage.setItem(STORE,JSON.stringify(x))}catch{}};
  const remember=(url,title)=>{const s=state(), enc=b64e(url);s.last=enc;s.history=[{encoded:enc,title:title||hostname(url),at:Date.now()},...(s.history||[]).filter(x=>x.encoded!==enc)].slice(0,MAX);save(s)};

  async function resolve(source,signal){
    const value=unwrap(source); if(!value) throw new Error('Paste a source URL first.');
    const u=new URL('/api/resolve',location.origin); u.searchParams.set('url',value);
    const r=await fetch(u,{signal,cache:'no-store',headers:{Accept:'application/json'}});
    const text=await r.text(); let data; try{data=JSON.parse(text)}catch{throw new Error(`Resolver returned invalid JSON (HTTP ${r.status}).`)}
    if(!r.ok) throw new Error(data.error||`Resolver failed (HTTP ${r.status}).`);
    return data;
  }

  function init(){
    const els={
      mount:$('#player'),input:$('#sourceInput'),load:$('#loadButton'),clear:$('#clearButton'),restore:$('#restoreButton'),status:$('#sourceStatus'),badge:$('#playerBadge'),title:$('#playerTitle'),history:$('#historyButton'),panel:$('#historyPanel'),list:$('#historyList'),closeHistory:$('#closeHistory'),clearHistory:$('#clearHistory')
    };
    let player=null, controller=null;
    const cached=b64d(state().last||'');
    const params=new URLSearchParams(location.search); const shared=params.get('url')||params.get('source')||params.get('src');
    const setStatus=(t,error=false)=>{els.status.textContent=t;els.status.classList.toggle('error',error)};
    const busy=v=>{els.load.disabled=v;$('.load-label',els.load).textContent=v?'Loading':'Load'};
    const showClear=()=>{els.clear.hidden=!els.input.value};
    const closeHistory=()=>{els.panel.classList.remove('open');els.panel.setAttribute('aria-hidden','true')};
    const renderHistory=()=>{
      const h=state().history||[];
      els.list.innerHTML=h.length?h.map((x,i)=>`<button class="history-item" data-i="${i}" type="button"><span class="history-number">${i+1}</span><span class="history-copy"><strong>${esc(x.title||'Source')}</strong><small>${esc(b64d(x.encoded))}</small></span><span class="history-arrow">›</span></button>`).join(''):'<p class="history-empty">No recent sources yet.</p>';
      els.list.querySelectorAll('.history-item').forEach(b=>b.onclick=()=>{const item=h[Number(b.dataset.i)];if(!item)return;const url=b64d(item.encoded);els.input.value=url;showClear();closeHistory();load(url);});
    };
    const openHistory=()=>{renderHistory();els.panel.classList.add('open');els.panel.setAttribute('aria-hidden','false')};

    async function load(source,{rememberIt=true}={}){
      const value=unwrap(source); if(!value){setStatus('Paste a source URL first.',true);return}
      controller?.abort(); controller=new AbortController(); busy(true);setStatus('Resolving source…');els.badge.textContent='Resolving';els.badge.classList.remove('live');
      try{
        const result=await resolve(value,controller.signal);
        if(result.mode==='iframe'){
          els.mount.innerHTML=`<div class="embed-fallback"><div class="embed-head"><span>Embedded player</span><button type="button" id="openEmbed">Open source</button></div><iframe title="Embedded media player" src="${esc(result.url)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="no-referrer"></iframe></div>`;
          $('#openEmbed',els.mount).onclick=()=>window.open(result.url,'_blank','noopener,noreferrer');els.badge.textContent='Embed';els.badge.classList.add('live');els.title.textContent=result.title||'Embedded source';setStatus('Embedded player detected.');
        }else{
          if(!player){player=new SyncPlayer.SyncPlayer(els.mount,{autoplay:true,onState:s=>{if(s==='playing'){els.badge.textContent='Playing';els.badge.classList.add('live');setStatus('Playing.')}else if(s==='ready'){els.badge.textContent='Ready';els.badge.classList.add('live')}else if(s==='error'){els.badge.textContent='Error';els.badge.classList.remove('live')}}});}
          player.media=null; await player.load(SyncPlayer.normalizeSourcePayload(result.data||result));
          const data=player.media; els.title.textContent=data.title||hostname(value);els.badge.textContent='Ready';els.badge.classList.add('live');setStatus('Source ready.');
          if((data.subtitleTracks||[]).length && !data.subtitles){data.subtitles=data.subtitleTracks.map(x=>({label:x.label||x.language||'Subtitle',language:x.language||'en',url:x.url}));}
          if(data.subtitles?.length && !player.video.dataset.subtitleUrl) { player.video.dataset.subtitleUrl='off'; }
        }
        if(rememberIt) remember(value,result.data?.title||result.title||hostname(value));
        const share=new URL(location.href);share.searchParams.set('url',value);history.replaceState(null,'',share.toString());
      }catch(e){if(e.name==='AbortError')return;setStatus(e.message||'Unable to resolve source.',true);els.badge.textContent='Error';els.badge.classList.remove('live');els.title.textContent='Playback error';if(player)player.fail(e.message)}
      finally{busy(false);showClear();}
    }

    els.load.onclick=()=>load(els.input.value);els.input.onkeydown=e=>{if(e.key==='Enter')load(els.input.value)};els.input.oninput=showClear;els.clear.onclick=()=>{els.input.value='';showClear();setStatus('Ready for a source.');els.input.focus()};els.restore.onclick=()=>load(cached);els.history.onclick=openHistory;els.closeHistory.onclick=closeHistory;$('.history-backdrop',els.panel).onclick=closeHistory;els.clearHistory.onclick=()=>{save({last:'',history:[]});renderHistory();};
    els.restore.hidden=!cached;
    if(shared){els.input.value=shared;showClear();load(shared,{rememberIt:true})}else if(cached){els.input.value=cached;showClear();setStatus('Last source restored. Press Load to play it.')}
  }
  window.addEventListener('DOMContentLoaded',init);
})();
