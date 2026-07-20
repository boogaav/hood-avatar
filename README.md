# HOOD AVATAR — get boogafied

Turns an X profile picture into a pixel-art avatar wearing the green BOOGA hoodie.

## Flow
1. Sign in with X (OAuth 2.0 + PKCE) → we fetch your `profile_image_url` at 400×400.
2. Photo goes to Replicate `google/nano-banana` with the hoodie prompt (plus
   `assets/style-reference.png` as a style image if present).
3. Before/after reveal + PNG download.

## Setup
```bash
npm install
cp .env.example .env   # then fill in keys
npm run dev            # vite on :5200, api on :8800
```

- **X app**: developer.x.com → create Web App (confidential), callback URL
  `http://localhost:8800/auth/callback`, scopes `users.read tweet.read`.
  Put client ID/secret in `.env`.
- **Replicate**: token from replicate.com/account/api-tokens (~$0.04/image).
- No X credentials? The app falls back to handle-based login via unavatar.io.
- No Replicate token (or `MOCK_GENERATE=1`)? Generation echoes the source photo.

## Style reference
Drop the example hood avatar PNG at `assets/style-reference.png` — it is sent to
nano-banana as a second input image, which markedly improves style consistency.
