export async function onRequestGet(context) {
  const cors = {'Access-Control-Allow-Origin':'*','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};
  try {
    const incoming = new URL(context.request.url).searchParams.get('url');
    if (!incoming) return new Response(JSON.stringify({error:'Missing url parameter'}),{status:400,headers:cors});
    const input = unwrap(incoming);
    const result = await resolve(input, new Set());
    return new Response(JSON.stringify(result),{status:200,headers:cors});
  } catch (err) {
    return new Response(JSON.stringify({error:err?.message || 'Resolve failed'}),{status:502,headers:cors});
  }
}

function unwrap(value) {
  let v = String(value||'').trim();
  try { v = decodeURIComponent(v); } catch {}
  try {
    const u = new URL(v);
    for (const k of ['url','source','src']) {
      const nested = u.searchParams.get(k);
      if (nested && /^https?:/i.test(nested)) return nested;
    }
  } catch {}
  return v;
}

async function resolve(input, seen) {
  if (seen.has(input)) throw new Error('Resolve loop detected');
  seen.add(input);

  const u = new URL(input);
  const ct = u.protocol === 'http:' || u.protocol === 'https:' ? '' : 'unsupported';
  if (ct) throw new Error('Only HTTP(S) sources are supported.');

  if (/\.(mp4|webm|m3u8|mpd)(?:$|\?)/i.test(u.pathname)) return {mode:'direct',data:{videoUrl:u.toString(),resolutions:[],subtitleTracks:[]}};

  // A player/wrapper URL: read its nested source parameter.
  const nested = unwrap(input);
  if (nested !== input) return resolve(nested, seen);

  const response = await fetch(input, {redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; NeoStreamResolver/1.0)'}});
  const body = await response.text();
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json') || /^[\s\[{]/.test(body)) {
    try { const json=JSON.parse(body); return {mode:'json',data:json}; } catch {}
  }

  // Generic page extraction: look for a stream/player link embedded in the HTML.
  const decoded = body.replaceAll('&amp;','&').replaceAll('\\/','/').replaceAll('\\u0026','&');
  const patterns = [
    /https?:\/\/[^\"'<>\s]+\/stream\?url=[^\"'<>\s]+/ig,
    /https?:\/\/[^\"'<>\s]+\/stream\/[^\"'<>\s]*/ig
  ];
  for (const re of patterns) {
    const m = decoded.match(re);
    if (m?.[0]) return resolve(m[0], seen);
  }

  // A bare iframe/embed page can be opened by the browser.
  const iframe = decoded.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframe?.[1]) {
    const frame = new URL(iframe[1], response.url).toString();
    return {mode:'iframe',url:frame};
  }

  throw new Error('No supported player, JSON source, or direct media URL was found on this page.');
}
