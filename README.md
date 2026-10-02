# Neo Stream Player v2

Cloudflare Pages-ready player project with a clean folder structure:

- `index.html` — player page only
- `css/player.css` — player + page styles
- `js/player.js` — player, source parsing, quality/subtitle/speed controls
- `functions/api/resolve.js` — Cloudflare Pages Function for server-side source resolution
- `assets/` — local SVG assets

## Supported input forms

1. Direct video/stream URL
2. Direct JSON API URL returning `videoUrl` / `resolutions` / `subtitleTracks`
3. Wrapper URL containing `?url=...`, `?source=...` or `?src=...`
4. A source page that contains an embedded stream/player link
5. A page with an iframe/embed source

You can also share a player URL such as `/?url=<encoded-source>`.


## Important

The resolver does not bypass DRM, authentication, signed-URL expiry, hotlink protection, or CORS restrictions on the media itself. Use it with media and pages you are authorized to access.

The browser's native `<video>` element must support the delivered codec/container. MKV playback is not universally supported by browsers.
