import { useEffect, useState } from 'react'

// pixel map: g = hoodie green, d = empty hood void, k = black zipper
const HOODIE_PIXELS = [
  '....gggggggg....',
  '...gggggggggg...',
  '..gggggggggggg..',
  '..gggddddddggg..',
  '.gggddddddddggg.',
  '.ggddddddddddgg.',
  '.ggddddddddddgg.',
  '.ggddddddddddgg.',
  '.gggddddddddggg.',
  '..gggddddddggg..',
  '..ggggddddgggg..',
  '.ggggggkkgggggg.',
  'gggggggkkggggggg',
  'gggggggkkggggggg',
  'gggggggkkggggggg',
  'gggggggkkggggggg',
]
const PIXEL_FILL = { g: 'var(--green)', d: 'var(--ink)', k: '#000' }

function PixelHoodie() {
  return (
    <svg className="hero-hood" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden>
      {HOODIE_PIXELS.flatMap((row, y) =>
        [...row].map((c, x) =>
          c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={PIXEL_FILL[c]} />
        )
      )}
    </svg>
  )
}

const GENERATING_LINES = [
  'KNITTING THE HOODIE…',
  'DYEING IT BOOGA GREEN…',
  'PIXELATING YOUR FACE…',
  'PULLING THE HOOD UP…',
  'STITCHING THE LOGO…',
]

export default function App() {
  const [config, setConfig] = useState(null)
  const [user, setUser] = useState(null)
  const [handle, setHandle] = useState('')
  const [phase, setPhase] = useState('boot') // boot | signedout | ready | generating | done
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [lineIdx, setLineIdx] = useState(0)

  useEffect(() => {
    async function boot() {
      // no backend (e.g. GitHub Pages) → static demo mode
      let cfg = { mock: true, static: true }
      let me = null
      try {
        const r = await fetch('/api/config')
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) {
          cfg = await r.json()
          const meRes = await fetch('/api/me')
          me = meRes.ok ? await meRes.json() : null
        }
      } catch {
        /* static mode */
      }
      setConfig(cfg)
      setUser(me)
      setPhase(me ? 'ready' : 'signedout')
    }
    boot()
  }, [])

  useEffect(() => {
    if (phase !== 'generating') return
    const t = setInterval(() => setLineIdx((i) => (i + 1) % GENERATING_LINES.length), 1800)
    return () => clearInterval(t)
  }, [phase])

  async function login(e) {
    e.preventDefault()
    setError('')
    const clean = handle.replace(/^@/, '').trim()
    if (config?.static) {
      setUser({
        name: clean,
        username: clean,
        photo: `https://unavatar.io/twitter/${encodeURIComponent(clean)}`,
      })
      setPhase('ready')
      return
    }
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle }),
    })
    if (!r.ok) {
      setError((await r.json()).error || 'login failed')
      return
    }
    const me = await fetch('/api/me').then((r) => r.json())
    setUser(me)
    setPhase('ready')
  }

  async function generate() {
    setPhase('generating')
    setError('')
    if (config?.static) {
      await new Promise((r) => setTimeout(r, 1800))
      setResult({ image: user.photo, mock: true })
      setPhase('done')
      return
    }
    try {
      const r = await fetch('/api/generate', { method: 'POST' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'generation failed')
      setResult(data)
      setPhase('done')
    } catch (err) {
      setError(String(err.message || err))
      setPhase('ready')
    }
  }

  async function logout() {
    if (!config?.static) await fetch('/api/logout', { method: 'POST' })
    setUser(null)
    setResult(null)
    setPhase('signedout')
  }

  function downloadUrl() {
    if (!result) return '#'
    return result.image.startsWith('data:')
      ? result.image
      : `/api/download?url=${encodeURIComponent(result.image)}`
  }

  if (phase === 'boot') return <div className="shell" />

  return (
    <div className="shell">
      <header>
        <span className="logo-mark">◆</span>
        <h1>HOOD AVATAR</h1>
        <span className="tag">GET HOODED</span>
      </header>

      {error && <div className="error">⚠ {error}</div>}

      {phase === 'signedout' && (
        <section className="card center">
          <PixelHoodie />
          <p className="pitch">
            Turn your X profile pic into a pixel-art avatar in the green HOOD hoodie.
          </p>
          <form onSubmit={login} className="handle-form">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@yourhandle"
              required
            />
            <button className="btn" type="submit">FETCH PIC</button>
            <p className="hint">we grab your public X avatar by handle — no login needed</p>
          </form>
        </section>
      )}

      {(phase === 'ready' || phase === 'generating') && user && (
        <section className="card center">
          <img className="pfp" src={user.photo} alt="profile" />
          <p className="who">
            {user.name} <span className="dim">@{user.username}</span>
          </p>
          {phase === 'ready' ? (
            <>
              <button className="btn btn-big" onClick={generate}>
                ▶ GENERATE HOOD
              </button>
              {config?.mock && (
                <p className="hint">
                  {config?.static
                    ? 'static demo — real hood generation needs the server deploy'
                    : 'mock mode — no Replicate key set'}
                </p>
              )}
            </>
          ) : (
            <div className="loading">
              <div className="pixel-spinner">
                {Array.from({ length: 9 }).map((_, i) => (
                  <span key={i} style={{ animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
              <p className="loading-line">{GENERATING_LINES[lineIdx]}</p>
            </div>
          )}
          <button className="link" onClick={logout}>restart</button>
        </section>
      )}

      {phase === 'done' && user && result && (
        <section className="card">
          <div className="compare">
            <figure>
              <img src={user.photo} alt="before" />
              <figcaption>BEFORE</figcaption>
            </figure>
            <span className="arrow">→</span>
            <figure>
              <img className="glow" src={result.image} alt="hood avatar" />
              <figcaption>IN THE HOOD</figcaption>
            </figure>
          </div>
          {result.mock && (
            <p className="hint center-text">
              {config?.static
                ? 'static demo result — the deployed server version does the real pixel-art transform'
                : 'mock result — set REPLICATE_API_TOKEN for the real thing'}
            </p>
          )}
          <div className="actions">
            <a className="btn btn-big" href={downloadUrl()} download="hood-avatar.png">
              ↓ DOWNLOAD
            </a>
            <button className="btn btn-ghost" onClick={logout}>↻ NEW HANDLE</button>
          </div>
        </section>
      )}

      <footer>pixel drip division</footer>
    </div>
  )
}
