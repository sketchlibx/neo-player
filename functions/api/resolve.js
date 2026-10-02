const BASE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8'
};

export function onRequestOptions() { return new Response(null, { status: 204, headers: BASE_HEADERS }); }
export async function onRequestGet(context) {
  try {
    const raw = new URL(context.request.url).searchParams.get('url');
    if (!raw) return json({error:'Missing url parameter.'},400);
    const result = await resolveSource(unwrap(raw), new Set());
    return json(result,200);
  } catch (error) { return json({error: error instanceof Error ? error.message : 'Source could not be resolved.'},502); }
}
function json(body,status){return new Response(JSON.stringify(body),{status,headers:BASE_HEADERS});}
function unwrap(value){let v=String(value||'').trim();try{v=decodeURIComponent(v)}catch{};try{const u=new URL(v);for(const key of ['url','source','src','stream']){const nested=u.searchParams.get(key);if(nested&&/^https?:\/\//i.test(nested))return nested;}}catch{}return v;}
function validate(v){const u=new URL(v);if(!/^https?:$/.test(u.protocol))throw new Error('Only HTTP(S) URLs are supported.');const h=u.hostname.toLowerCase();if(['localhost','127.0.0.1','0.0.0.0','::1'].includes(h)||h.endsWith('.local'))throw new Error('Local network targets are not supported.');return u;}
function isDirect(v){return /\.(mp4|m4v|webm|mkv|mov|m3u8|mpd)(?:$|[?#])/i.test(new URL(v).pathname);}
function normalizeJson(value){if(!value||typeof value!=='object')return null;if(value.videoUrl||Array.isArray(value.resolutions)||Array.isArray(value.subtitleTracks))return {mode:'json',data:value,title:value.title||''};if(typeof value.url==='string'&&/^https?:\/\//i.test(value.url))return {mode:'json',data:{videoUrl:value.url,resolutions:[],subtitleTracks:[],audioTracks:[]}};return null;}
async function resolveSource(input,seen){const source=unwrap(input);if(seen.has(source))throw new Error('Resolve loop detected.');seen.add(source);const url=validate(source);if(isDirect(source))return {mode:'json',data:{videoUrl:source,resolutions:[],subtitleTracks:[],audioTracks:[]}};
  const r=await fetch(url,{redirect:'follow',headers:{Accept:'application/json,text/html;q=0.95,*/*;q=0.8','User-Agent':'Mozilla/5.0 (compatible; NeoStreamResolver/1.2)'}});
  if(!r.ok)throw new Error(`Source returned HTTP ${r.status}.`);const finalUrl=r.url||url.toString();const ct=r.headers.get('content-type')||'';const body=await r.text();
  if(/json/i.test(ct)||/^\s*[\[{]/.test(body)){try{const n=normalizeJson(JSON.parse(body));if(n)return n}catch{}}
  const html=decode(body);
  const nested=html.match(/(?:[?&](?:url|source|src|stream)=)(https?:[^\"'<>\s&]+)/i);if(nested?.[1])return resolveSource(decodeURIComponent(nested[1]),seen);
  const iframe=html.match(/<(?:iframe|embed)[^>]+(?:src|data-src)=['\"]([^'\"]+)['\"]/i);if(iframe?.[1]){const f=new URL(iframe[1],finalUrl).toString();const n=unwrap(f);if(n!==f)return resolveSource(n,seen);return {mode:'iframe',url:f};}
  const direct=html.match(/https?:\\?\/\\?\/[^\"'<>\s]+\.(?:m3u8|mpd|mp4|webm|mkv)(?:\?[^\"'<>\s]*)?/i);if(direct?.[0])return {mode:'json',data:{videoUrl:direct[0].replaceAll('\\/','/'),resolutions:[],subtitleTracks:[],audioTracks:[]}};
  throw new Error('No supported JSON, direct media URL, or embeddable source was found.');
}
function decode(t){return String(t||'').replaceAll('&amp;','&').replaceAll('\\u0026','&').replaceAll('\\/','/').replaceAll('\\u003A',':').replaceAll('\\u002F','/');}
