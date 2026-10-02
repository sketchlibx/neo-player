# Neo Stream

A lightweight, premium-feeling static video player shell for Cloudflare Pages.

## Structure

- `index.html` — landing/source page + player mount
- `css/player.css` — premium shell UI + player styles
- `js/player.js` — resolver client, player controls, history, last-source restore
- `functions/api/resolve.js` — generic Cloudflare Pages resolver for HTTP(S) JSON/direct-media/embed sources
- `assets/` — lightweight SVG assets

## Supported input

- Direct media URLs supported by the browser
- JSON endpoints containing `videoUrl`, `resolutions[]`, and/or `subtitleTracks[]`
- Wrapped URLs using `url`, `source`, `src`, or `stream` query parameters
- Generic iframe/embed sources discovered by the resolver
- Share URLs such as `/?url=<encoded-source>`

## Player

- Quality selection
- Speed selection (0.5x–2x)
- ±10 second seeking
- WebVTT subtitles
- Fullscreen
- Picture-in-Picture when the browser allows it
- Mobile controls
- Loading / retry / decode-error UI
- Encoded last-source persistence in `localStorage`
- Recent source history

## Cloudflare Pages

Deploy the repository as a Pages project. The `/functions/api/resolve.js` function is used automatically by Cloudflare Pages Functions.

The resolver is intentionally generic. It does not contain site-specific selectors, ad/DRM bypasses, authentication bypasses, or protected-content workarounds.

## Important browser limitation

A browser cannot universally decode every container/codec (for example some MKV combinations), and CORS/DRM/authentication restrictions still apply to third-party resources. The UI reports these failures instead of hanging indefinitely.
