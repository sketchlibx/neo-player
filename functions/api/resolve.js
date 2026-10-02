const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestGet(context) {
  try {
    const raw = new URL(context.request.url).searchParams.get('url');
    if (!raw) return json({ error: 'Missing url parameter.' }, 400);
    const source = unwrap(raw);
    const result = await resolveSource(source, new Set());
    return json(result, 200);
  } catch (error) {
    return json({ error: safeError(error) }, 502);
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function safeError(error) {
  return error instanceof Error ? error.message : 'Source could not be resolved.';
}

function unwrap(value) {
  let v = String(value || '').trim();
  try { v = decodeURIComponent(v); } catch {}
  try {
    const u = new URL(v);
    for (const key of ['url', 'source', 'src', 'stream']) {
      const nested = u.searchParams.get(key);
      if (nested && /^https?:\/\//i.test(nested)) return nested;
    }
  } catch {}
  return v;
}

function validateUrl(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP(S) sources are supported.');
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Custom ports are not supported.');
  const host = u.hostname.toLowerCase();
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host) || host.endsWith('.local')) {
    throw new Error('Local network targets are not supported.');
  }
  return u;
}

function looksLikeDirectMedia(url) {
  return /\.(mp4|m4v|webm|mov|m3u8|mpd)(?:$|[?#])/i.test(new URL(url).pathname);
}

function normalizeJson(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid JSON response.');
  if (value.videoUrl || Array.isArray(value.resolutions) || Array.isArray(value.subtitleTracks)) {
    return { mode: 'json', data: value };
  }
  if (typeof value.url === 'string' && /^https?:\/\//i.test(value.url)) {
    return { mode: 'json', data: { videoUrl: value.url, resolutions: [], subtitleTracks: [] } };
  }
  return null;
}

async function resolveSource(input, seen) {
  let source = unwrap(input);
  if (seen.has(source)) throw new Error('Resolve loop detected.');
  seen.add(source);

  const url = validateUrl(source);
  if (looksLikeDirectMedia(source)) {
    return { mode: 'json', data: { videoUrl: source, resolutions: [], subtitleTracks: [] } };
  }

  const response = await fetch(url.toString(), {
    redirect: 'follow',
    headers: {
      'Accept': 'application/json,text/html;q=0.95,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; NeoStreamResolver/1.0)'
    }
  });

  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  const finalUrl = response.url || url.toString();
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();

  if (/json/i.test(contentType) || /^[\s\[{]/.test(body)) {
    try {
      const parsed = JSON.parse(body);
      const normalized = normalizeJson(parsed);
      if (normalized) return normalized;
    } catch {}
  }

  const html = decodeHtml(body);

  // Generic wrappers: follow a URL-like source parameter when present in HTML.
  const sourceMatch = html.match(/(?:[?&](?:url|source|src|stream)=)(https?%3A%2F%2F[^\"'<>\s&]+)/i);
  if (sourceMatch?.[1]) {
    const nested = decodeURIComponent(sourceMatch[1]);
    return resolveSource(nested, seen);
  }

  // Generic iframe/embed discovery. The player is intentionally generic rather than tied to a specific site.
  const iframeMatch = html.match(/<(?:iframe|embed)[^>]+(?:src|data-src)=["']([^"']+)["']/i);
  if (iframeMatch?.[1]) {
    const frameUrl = new URL(iframeMatch[1], finalUrl).toString();
    const frameNested = unwrap(frameUrl);
    if (frameNested !== frameUrl) return resolveSource(frameNested, seen);
    return { mode: 'iframe', url: frameUrl };
  }

  // Some providers expose an absolute direct media URL in script/JSON markup.
  const direct = html.match(/https?:\\?\/\\?\/[^\"'<>\s]+\.(?:m3u8|mpd|mp4|webm)(?:\?[^\"'<>\s]*)?/i);
  if (direct?.[0]) {
    const cleaned = direct[0].replaceAll('\\/', '/');
    return { mode: 'json', data: { videoUrl: cleaned, resolutions: [], subtitleTracks: [] } };
  }

  throw new Error('No supported JSON, direct media URL, or embeddable source was found.');
}

function decodeHtml(text) {
  return String(text || '')
    .replaceAll('&amp;', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\/', '/')
    .replaceAll('\\u003A', ':')
    .replaceAll('\\u002F', '/');
}
