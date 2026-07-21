# HOOD AVATAR — get boogafied

Turns an X profile picture into a pixel-art avatar wearing the green HOOD hoodie.

## Flow
1. Enter your X handle → we fetch your public avatar via unavatar.io.
2. Photo goes to Gemini (`gemini-2.5-flash-image` / nano-banana) with the hoodie
   prompt, plus `assets/style-reference.png` as a style-only reference. Identity
   always comes from your photo; the reference contributes rendering style and
   hoodie design only.
3. Before/after reveal + PNG download.

## Setup
```bash
npm install
cp .env.example .env   # then fill in a key
npm run dev            # vite on :5200, api on :8800
```

- **Gemini**: API key with a billed project (free tier has zero image quota).
  Both the Gemini API and Vertex AI express endpoints are supported — the server
  tries both automatically.
- **Replicate** (alternative): token from replicate.com/account/api-tokens.
- No key (or `MOCK_GENERATE=1`)? Generation echoes the source photo back.

## Deploy
GitHub Pages (static demo mode — client-side avatar fetch, mock generation) via
`.github/workflows/pages.yml`. The real generator needs the node server on any
node host.

## Style reference
`assets/style-reference.png` is sent as a second input image so generations
match the hoodie design and pixel style exactly.
