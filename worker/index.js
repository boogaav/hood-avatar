// Cloudflare Worker: serves the built frontend (Workers Assets) + the full API.
// Sessions are stateless HMAC-signed cookies (only the handle is stored; the
// avatar is re-fetched from unavatar on demand).
import { hoodPrompt, withStyleRoles, GEMINI_ENDPOINTS, GEMINI_MODELS } from '../shared/prompt.js'
import styleRefBytes from '../assets/style-reference.png'

const enc = new TextEncoder()
const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

async function sign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

async function makeSession(env, user) {
  const payload = b64url(enc.encode(JSON.stringify(user)))
  return `${payload}.${await sign(env.SESSION_SECRET, payload)}`
}

async function readSession(env, request) {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/(?:^|;\s*)session=([^;]+)/)
  if (!match) return null
  const [payload, sig] = match[1].split('.')
  if (!payload || !sig) return null
  if ((await sign(env.SESSION_SECRET, payload)) !== sig) return null
  try {
    const pad = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(pad))
  } catch {
    return null
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

const unavatarUrl = (handle) => `https://unavatar.io/twitter/${encodeURIComponent(handle)}`

function toBase64(buf) {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

async function fetchImagePart(url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`failed to fetch photo (${r.status})`)
  const buf = await r.arrayBuffer()
  return { mime: r.headers.get('content-type') || 'image/jpeg', data: toBase64(buf) }
}

function styleRefPart() {
  const bytes = new Uint8Array(styleRefBytes)
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png'
  return { mime, data: toBase64(styleRefBytes) }
}

async function generateWithGemini(env, prompt, images) {
  let sawQuota = false
  let lastErr = ''
  for (const model of GEMINI_MODELS) {
    for (const endpoint of GEMINI_ENDPOINTS) {
      const r = await fetch(endpoint(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } })),
              ],
            },
          ],
        }),
      })
      if (!r.ok) {
        if (r.status === 429) sawQuota = true
        lastErr = `${r.status}: ${(await r.text()).slice(0, 300)}`
        console.error('gemini error', endpoint(model), lastErr.slice(0, 200))
        continue
      }
      const data = await r.json()
      const parts = data.candidates?.[0]?.content?.parts || []
      const img = parts.find((p) => p.inlineData || p.inline_data)
      if (!img) {
        const text = parts.find((p) => p.text)?.text || 'no image in response'
        throw new Error(`gemini returned no image: ${text.slice(0, 200)}`)
      }
      const d = img.inlineData || img.inline_data
      return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`
    }
  }
  throw new Error(sawQuota ? 'image quota exhausted — try again later' : lastErr || 'generation failed')
}

// best-effort per-IP limiter (per isolate): 5 generations / 10 minutes
const ipHits = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < 10 * 60_000)
  if (hits.length >= 5) return true
  hits.push(now)
  ipHits.set(ip, hits)
  return false
}

async function handleApi(request, env) {
  const url = new URL(request.url)
  const route = `${request.method} ${url.pathname}`

  if (route === 'GET /api/config') return json({ mock: !env.GEMINI_API_KEY })

  if (route === 'POST /api/login') {
    const { handle } = await request.json().catch(() => ({}))
    const clean = String(handle || '').replace(/^@/, '').trim()
    if (!clean) return json({ error: 'handle required' }, 400)
    const probe = await fetch(`${unavatarUrl(clean)}?fallback=false`)
    if (!probe.ok) return json({ error: 'no avatar found for that handle' }, 404)
    const session = await makeSession(env, { name: clean, username: clean })
    return json(
      { ok: true },
      200,
      { 'Set-Cookie': `session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400` }
    )
  }

  if (route === 'GET /api/me') {
    const user = await readSession(env, request)
    if (!user) return json({ error: 'not signed in' }, 401)
    return json({ ...user, photo: unavatarUrl(user.username) })
  }

  if (route === 'POST /api/logout') {
    return json({ ok: true }, 200, {
      'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
    })
  }

  if (route === 'POST /api/generate') {
    const user = await readSession(env, request)
    if (!user) return json({ error: 'not signed in' }, 401)
    if (!env.GEMINI_API_KEY) return json({ error: 'generator not configured' }, 501)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (rateLimited(ip)) return json({ error: 'slow down — try again in a few minutes' }, 429)
    try {
      const photo = await fetchImagePart(unavatarUrl(user.username))
      const ref = styleRefPart()
      const emblem = user.username.toUpperCase()
      const prompt = withStyleRoles(hoodPrompt(emblem))
      const image = await generateWithGemini(env, prompt, [photo, ref])
      return json({ image })
    } catch (err) {
      console.error('generate error', err)
      return json({ error: String(err.message || err) }, 502)
    }
  }

  return json({ error: 'not found' }, 404)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) return handleApi(request, env)
    return env.ASSETS.fetch(request)
  },
}
