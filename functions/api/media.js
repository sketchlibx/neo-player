const ALLOW_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Origin, Accept',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
  'Cache-Control': 'no-store'
};

export function onRequestOptions() { return new Response(null,{status:204,headers:ALLOW_HEADERS}); }

export async function onRequestGet(context) {
  const reqUrl = new URL(context.request.url);
  const raw = reqUrl.searchParams.get('url');
  if (!raw) return new Response('Missing url parameter.',{status:400,headers:{...ALLOW_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});
  let target;
  try { target = new URL(decodeURIComponent(raw)); }
  catch { return new Response('Invalid media URL.',{status:400,headers:{...ALLOW_HEADERS,'Content-Type':'text/plain; charset=utf-8'}}); }
  if (!/^https?:$/.test(target.protocol)) return new Response('Only HTTP(S) media is supported.',{status:400,headers:{...ALLOW_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});
  const host = target.hostname.toLowerCase();
  if (['localhost','127.0.0.1','0.0.0.0','::1'].includes(host)||host.endsWith('.local')) return new Response('Local targets are not supported.',{status:400,headers:{...ALLOW_HEADERS,'Content-Type':'text/plain; charset=utf-8'}});

  const headers = new Headers();
  const range = context.request.headers.get('Range');
  if (range) headers.set('Range', range);
  headers.set('Accept','*/*');
  headers.set('User-Agent','Mozilla/5.0 (compatible; NeoStreamMedia/1.0)');

  const upstream = await fetch(target,{headers,redirect:'follow'});
  const out = new Headers(ALLOW_HEADERS);
  for (const key of ['content-type','content-length','content-range','accept-ranges','etag','last-modified']) {
    const value=upstream.headers.get(key); if (value) out.set(key,value);
  }
  if (!out.get('content-type') || out.get('content-type')==='application/octet-stream') {
    const path=target.pathname.toLowerCase();
    const type=path.endsWith('.m3u8')?'application/vnd.apple.mpegurl':path.endsWith('.mp4')||path.endsWith('.m4v')?'video/mp4':path.endsWith('.webm')?'video/webm':path.endsWith('.mkv')?'video/x-matroska':'application/octet-stream';
    out.set('content-type',type);
  }
  return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:out});
}
