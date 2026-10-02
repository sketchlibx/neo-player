# NeoStream Player

A fast, framework-free web video player designed for Cloudflare Pages.

## What it supports

- Direct browser-playable video URLs (`.mp4`, `.webm`, `.m3u8`, `.mpd`, etc.)
- JSON media endpoints with fields such as:
  - `videoUrl`
  - `resolutions[]` with `quality` + `url`
  - `subtitleTracks[]` with `language`, `label`, `url`
  - `defaultAudioLabel`
- Iframe/embed URLs (shown inside an iframe)
- Quality switching when the JSON provides multiple URLs
- WebVTT subtitle tracks
- 10-second back/forward buttons
- Native browser fullscreen and Picture-in-Picture
- Mobile responsive UI
- Dark/light mode
- No build step and no framework dependency

## JSON example

```json
{
  "videoUrl": "https://example.com/720p.mp4",
  "resolutions": [
    {"quality": "480p", "url": "https://example.com/480p.mp4"},
    {"quality": "720p", "url": "https://example.com/720p.mp4"},
    {"quality": "1080p", "url": "https://example.com/1080p.mp4"}
  ],
  "subtitleTracks": [
    {"url": "https://example.com/en.vtt", "language": "eng", "label": "English"}
  ],
  "defaultAudioLabel": "Hindi"
}
```

## Cloudflare Pages

This is a static site. Upload/push the project as-is to a Cloudflare Pages project. No build command is required; the output directory is the project root.

## Important browser limitation

The frontend cannot bypass CORS, authentication, DRM, expired signed URLs, or an origin's iframe restrictions. For a remote JSON endpoint, the endpoint must allow browser CORS. A direct media URL must also be browser-playable and reachable. Iframe sources are embedded as provided; the embedded provider controls what the iframe can play.
