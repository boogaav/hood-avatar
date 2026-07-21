import dotenv from 'dotenv'
import express from 'express'
import cookieParser from 'cookie-parser'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// .env is the source of truth — override any key inherited from the shell (e.g. ~/.zshrc)
dotenv.config({ path: path.join(__dirname, '.env'), override: true })

const PORT = process.env.API_PORT || 8800
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || ''
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const MOCK_GENERATE = process.env.MOCK_GENERATE === '1'
const HAS_GENERATOR = Boolean(GEMINI_API_KEY || REPLICATE_API_TOKEN)

const app = express()
app.use(express.json())
app.use(cookieParser())

// ---- in-memory sessions ----
const sessions = new Map() // sid -> { user: {name, username, photo} }

function getSession(req) {
  const sid = req.cookies.sid
  return sid ? sessions.get(sid) : undefined
}

function createSession(res, data) {
  const sid = crypto.randomUUID()
  sessions.set(sid, data)
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' })
  return sid
}

// ---- config ----
app.get('/api/config', (req, res) => {
  res.json({
    mock: MOCK_GENERATE || !HAS_GENERATOR,
  })
})

// ---- login by handle: fetch the public avatar via unavatar ----
app.post('/api/login', async (req, res) => {
  const handle = String(req.body.handle || '').replace(/^@/, '').trim()
  if (!handle) return res.status(400).json({ error: 'handle required' })
  const url = `https://unavatar.io/twitter/${encodeURIComponent(handle)}?fallback=false`
  const r = await fetch(url)
  if (!r.ok) return res.status(404).json({ error: 'no avatar found for that handle' })
  const buf = Buffer.from(await r.arrayBuffer())
  const type = r.headers.get('content-type') || 'image/jpeg'
  const photo = `data:${type};base64,${buf.toString('base64')}`
  createSession(res, { user: { name: handle, username: handle, photo } })
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  const session = getSession(req)
  if (!session) return res.status(401).json({ error: 'not signed in' })
  res.json(session.user)
})

app.post('/api/logout', (req, res) => {
  const sid = req.cookies.sid
  if (sid) sessions.delete(sid)
  res.clearCookie('sid')
  res.json({ ok: true })
})

// ---- generation ----
// images are handled as {mime, data(base64)} parts
async function toImagePart(src) {
  if (src.startsWith('data:')) {
    const m = src.match(/^data:([^;]+);base64,(.+)$/)
    if (!m) throw new Error('bad data uri')
    return { mime: m[1], data: m[2] }
  }
  const r = await fetch(src, { redirect: 'follow' })
  if (!r.ok) throw new Error(`failed to fetch photo (${r.status})`)
  const buf = Buffer.from(await r.arrayBuffer())
  return { mime: r.headers.get('content-type') || 'image/jpeg', data: buf.toString('base64') }
}

function styleReference() {
  const p = path.join(__dirname, 'assets', 'style-reference.png')
  if (!fs.existsSync(p)) return null
  const buf = fs.readFileSync(p)
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png'
  return { mime, data: buf.toString('base64') }
}

const toDataUri = (part) => `data:${part.mime};base64,${part.data}`

// the same key format works against either the Gemini API or Vertex AI express
// endpoint depending on which Google project it comes from — try both.
const GEMINI_ENDPOINTS = [
  (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
  (m) => `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`,
]

async function generateWithGemini(prompt, images) {
  const models = ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview']
  let sawQuota = false
  let lastErr = ''
  for (const model of models) {
    for (const endpoint of GEMINI_ENDPOINTS) {
      const r = await fetch(endpoint(model), {
        method: 'POST',
        headers: { 'x-goog-api-key': GEMINI_API_KEY, 'Content-Type': 'application/json' },
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
        lastErr = `${r.status}: ${(await r.text()).slice(0, 500)}`
        console.error('gemini error', endpoint(model), lastErr.slice(0, 200))
        continue // other endpoint/model may still work
      }
      const json = await r.json()
      const parts = json.candidates?.[0]?.content?.parts || []
      const img = parts.find((p) => p.inlineData || p.inline_data)
      if (!img) {
        const text = parts.find((p) => p.text)?.text || 'no image in response'
        throw new Error(`gemini returned no image: ${text.slice(0, 200)}`)
      }
      const d = img.inlineData || img.inline_data
      return `data:${d.mimeType || d.mime_type || 'image/png'};base64,${d.data}`
    }
  }
  if (sawQuota) {
    throw new Error(
      'Gemini image quota exhausted — the API key is on the free tier, which cannot generate images. Enable billing at aistudio.google.com or set REPLICATE_API_TOKEN.'
    )
  }
  throw new Error(lastErr || 'no gemini image model available for this key')
}

const hoodPrompt = (emblem) =>
  [
    'Redraw the person from the first input image as a high-quality pixel-art avatar:',
    'bust portrait on a plain light-gray background, rendered in clean detailed pixel art',
    'with visible pixel clusters and smooth shading.',
    'They wear an oversized bright lime-green (chartreuse) hoodie with the hood pulled up',
    'over their head, a chunky black metal zipper, black drawstrings, and bold black',
    'tiger-claw stripe markings on the hood, shoulders and sleeves.',
    `On the left chest is a black diamond-shaped emblem with the word '${emblem}' in bold`,
    'letters sized to fit the diamond, and on the right chest a black feather emblem.',
    `The chest emblem text must read exactly '${emblem}' — spelled letter-for-letter,`,
    'even if a style reference image shows a different word.',
    "Preserve the person's facial likeness: face shape, hair color, skin tone, expression,",
    'and any glasses, hat or accessories they wear (if they wear a hat, keep the hat and',
    'drape the hood behind their head instead). Square 1:1 image.',
  ].join(' ')

app.post('/api/generate', async (req, res) => {
  const session = getSession(req)
  if (!session) return res.status(401).json({ error: 'not signed in' })

  try {
    const photo = await toImagePart(session.user.photo)

    if (MOCK_GENERATE || !HAS_GENERATOR) {
      await new Promise((r) => setTimeout(r, 1500))
      return res.json({ image: toDataUri(photo), mock: true })
    }

    const emblem = (session.user.username || 'HOOD').replace(/^@/, '').toUpperCase()
    const basePrompt = hoodPrompt(emblem)
    const ref = styleReference()
    const images = ref ? [photo, ref] : [photo]
    const prompt = ref
      ? [
          'INPUT ROLES — follow strictly:',
          'The FIRST image is the person to portray. Their entire identity — face, facial features,',
          'hair, skin tone, expression, glasses, hat, accessories — must come EXCLUSIVELY from the',
          'first image. If the first image is not a clear human face (a logo, sketch or object),',
          'stylize THAT subject inside the hoodie instead of inventing a person.',
          'The SECOND image is a STYLE GUIDE ONLY: copy its pixel-art rendering technique, hoodie',
          'design, colors and background. NEVER copy the face, hair or any identity feature from',
          'the second image.',
          `TASK: ${basePrompt}`,
        ].join(' ')
      : basePrompt

    if (GEMINI_API_KEY) {
      const image = await generateWithGemini(prompt, images)
      return res.json({ image })
    }

    const imageInput = images.map(toDataUri)
    const predRes = await fetch(
      'https://api.replicate.com/v1/models/google/nano-banana/predictions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
          Prefer: 'wait=60',
        },
        body: JSON.stringify({
          input: { prompt, image_input: imageInput, output_format: 'png' },
        }),
      }
    )
    if (!predRes.ok) {
      const text = await predRes.text()
      console.error('replicate error', predRes.status, text)
      return res.status(502).json({ error: `replicate error ${predRes.status}` })
    }
    let pred = await predRes.json()

    // poll if not finished within the wait window
    while (pred.status === 'starting' || pred.status === 'processing') {
      await new Promise((r) => setTimeout(r, 1500))
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      })
      pred = await poll.json()
    }
    if (pred.status !== 'succeeded') {
      console.error('prediction failed', pred.status, pred.error)
      return res.status(502).json({ error: pred.error || 'generation failed' })
    }
    const image = Array.isArray(pred.output) ? pred.output[0] : pred.output
    res.json({ image })
  } catch (err) {
    console.error('generate error', err)
    res.status(500).json({ error: String(err.message || err) })
  }
})

// proxy download so the browser can save the PNG without CORS issues
app.get('/api/download', async (req, res) => {
  const url = String(req.query.url || '')
  if (!/^https:\/\/([a-z0-9-]+\.)?replicate\.(delivery|com)\//.test(url)) {
    return res.status(400).send('bad url')
  }
  const r = await fetch(url)
  if (!r.ok) return res.status(502).send('fetch failed')
  res.set('Content-Type', r.headers.get('content-type') || 'image/png')
  res.set('Content-Disposition', 'attachment; filename="hood-avatar.png"')
  res.send(Buffer.from(await r.arrayBuffer()))
})

app.listen(PORT, () => {
  console.log(`hood-avatar api on http://localhost:${PORT}`)
  console.log(
    `  Generator: ${GEMINI_API_KEY ? 'gemini (direct)' : REPLICATE_API_TOKEN ? 'replicate' : 'NONE (mock generation)'}`
  )
})
