# AUREX AI + Music Studio

AUREX is a free-tier, browser-based AI workspace backed by a Cloudflare Worker.

## Live pages
- AI workspace: https://notgamershubh.github.io/Aurex-music-ai/ai.html
- Music Studio: https://notgamershubh.github.io/Aurex-music-ai/
- Worker health: https://aurex-music-ai.factoshubh1080p.workers.dev/api/health

## Current features
- Chat and coding help through Cloudflare Workers AI.
- Search through Wikipedia (Hindi queries use Hindi Wikipedia; other queries use English Wikipedia).
- Image generation through the Cloudflare FLUX Schnell model, subject to model availability and account limits.
- Browser voice input when supported by the browser, and read-aloud using speech synthesis.
- Local chat history in this browser.
- Text/code file attachment (up to 2 MB; included as text in the prompt).
- Music Studio creates procedural audio-reactive visuals from a local audio track and exports WebM in real time.

## Important limitations
- The Video Studio endpoint creates a written editing plan; it does **not** generate an AI video file or AI video clips.
- Music Studio's visual animation is procedural, not generated scene-by-scene by a video diffusion model.
- Image and audio attachments are shown in the chat, but image understanding and audio transcription are not enabled in the current chat endpoint.
- Browser-local chat history is not account-synced and may be limited by browser storage.
- Free-tier AI services can have usage caps, temporary outages, or model availability changes. This project does not promise unlimited free inference.

## API endpoints
- `GET /api/health` — Worker status and configured AI binding indicator.
- `POST /api/generate` — generate a written video editing plan. JSON body: `{"prompt":"...","style":"cinematic"}`.
- `POST /api/ai/chat` — chat. JSON body: `{"messages":[{"role":"user","content":"..."}]}`.
- `GET /api/ai/search?q=...` — Wikipedia search.
- `POST /api/ai/image` — generate an image. JSON body: `{"prompt":"..."}`.

## Deployment notes
- The static pages are served by GitHub Pages from the repository.
- The Worker entry point is `src/index.js`; its Workers AI binding is configured in `wrangler.jsonc`.
- After editing Worker code, deploy the Worker from the connected Cloudflare account using Wrangler or the Cloudflare dashboard. A GitHub commit alone does not deploy Worker code unless a deployment workflow is configured.
- After editing the static page, wait for GitHub Pages to publish and hard-refresh the browser with Ctrl+F5.
