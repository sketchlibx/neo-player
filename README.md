# Neo Stream — Material 3 source player

Cloudflare Pages-ready source project built around the `SyncPlayer.SyncPlayer` API shape from the supplied player implementation.

## What is included

- Material 3 inspired dark UI with restrained surfaces, outlined source field and filled action button.
- Custom `SyncPlayer` controls: play/pause, seek, volume, speed, quality, subtitles, PiP and fullscreen.
- `/api/resolve` accepts direct media URLs, JSON endpoints, wrapped `url/source/src/stream` links, and accessible HTML embeds.
- `/api/media` is a transparent range-aware fallback proxy for cross-origin media responses where direct playback fails because of response headers.
- Last source is stored in browser storage as URL-safe base64; no signed `videoUrl` is treated as permanent storage.
- Ad-block detection/overlay from the supplied player is not included.
- Resolver and player fail fast instead of treating a metadata timeout as successful playback, which prevents the old `0:00` stuck state.

## Important media compatibility note

A web browser still needs to support the actual media container/codec. The player can proxy a stream to fix CORS/range/header problems, but a Cloudflare Pages Function cannot magically transcode an unsupported container such as an MKV into MP4. The player therefore reports a clear format error instead of displaying a fake `0:00` state.

## Deploy

Push the folder to GitHub and create a Cloudflare Pages project using the repository root as the build output directory. No build command is required.

For local testing with Wrangler:

```bash
npx wrangler pages dev .
```

## Player API compatibility

The generated `js/sync-player.umd.js` exposes:

```js
new SyncPlayer.SyncPlayer(element, { apiUrl, autoplay })
SyncPlayer.fetchSource(apiUrl)
SyncPlayer.normalizeSourcePayload(payload)
```

No ad-block probing or ad-block overlay is present.
