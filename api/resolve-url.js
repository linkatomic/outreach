// POST /api/resolve-url
// Body: { domains: string[] }
// For each domain, discovers the actual final URL a Chrome user would land on: tries HTTPS
// first (matching modern Chrome's default), falls back to HTTP only if HTTPS can't even
// connect, and manually follows the redirect chain hop-by-hop (not fetch()'s automatic
// following) so loops can be detected and every hop's real status/Location header is visible.

const PER_HOP_TIMEOUT   = 6000
const DOMAIN_TIME_BUDGET = 20000 // whole chain (incl. HTTP fallback) must finish within this
const MAX_HOPS           = 15
const CONCURRENCY         = 25   // matches the frontend's batch size — single-wave processing

function hasProtocol(raw) {
  return /^https?:\/\//i.test(raw)
}

async function fetchHop(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual', // we walk the chain ourselves — see file header
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    clearTimeout(timer)
    return { ok: true, status: res.status, location: res.headers.get('location') }
  } catch (err) {
    clearTimeout(timer)
    return { ok: false, error: err }
  }
}

function classifyError(err) {
  if (err?.name === 'AbortError') return 'TIMEOUT'
  const code = err?.cause?.code || err?.code || ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS_ERROR'
  if (/CERT|TLS|SSL|EPROTO/i.test(code)) return 'SSL_ERROR'
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') {
    return code === 'ETIMEDOUT' ? 'TIMEOUT' : 'CONNECTION_ERROR'
  }
  return 'NO_RESPONSE'
}

// Walks redirects hop-by-hop from startUrl. Returns { status: 'OK', finalUrl } or
// { status: <error code> } — never a fabricated URL.
async function resolveChain(startUrl, deadline) {
  const visited = new Set()
  let current = startUrl

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (visited.has(current)) return { status: 'REDIRECT_LOOP' }
    visited.add(current)

    const timeLeft = deadline - Date.now()
    if (timeLeft <= 0) return { status: 'TIMEOUT' }

    const result = await fetchHop(current, Math.min(PER_HOP_TIMEOUT, timeLeft))
    if (!result.ok) return { status: classifyError(result.error) }

    const isRedirect = result.status >= 300 && result.status < 400
    if (isRedirect && result.location) {
      let next
      try { next = new URL(result.location, current).href } catch { return { status: 'NO_RESPONSE' } }
      current = next
      continue
    }

    // Not a redirect (or a redirect with no Location) — this is where a browser lands
    return { status: 'OK', finalUrl: current }
  }

  return { status: 'REDIRECT_LOOP' } // exceeded MAX_HOPS without terminating
}

// Errors that mean "this protocol couldn't even connect" — worth retrying the other
// protocol. A DNS failure would fail identically either way, so it short-circuits instead.
const RETRY_WITH_OTHER_PROTOCOL = new Set(['SSL_ERROR', 'CONNECTION_ERROR', 'TIMEOUT', 'NO_RESPONSE'])

// Real browsers (and the URL/WHATWG spec) normalize an empty path to "/" — e.g. typing
// "example.com" actually requests and displays "https://example.com/". Building the start
// URL as a raw template string skips that normalization; routing it through the URL class
// applies the same rule a browser's address bar would, so a site with no redirect at all
// still reports the trailing slash instead of looking different from what Chrome shows.
function buildUrl(protocol, host) {
  try { return new URL(`${protocol}://${host}`).href } catch { return null }
}

async function resolveDomain(rawInput) {
  const trimmed = (rawInput || '').trim()
  if (!trimmed) return { status: 'NO_RESPONSE' }

  const deadline = Date.now() + DOMAIN_TIME_BUDGET

  if (hasProtocol(trimmed)) {
    // Caller gave an explicit protocol — respect it, no fallback testing of the other one.
    let normalized
    try { normalized = new URL(trimmed).href } catch { return { status: 'NO_RESPONSE' } }
    return resolveChain(normalized, deadline)
  }

  const httpsStart = buildUrl('https', trimmed)
  if (!httpsStart) return { status: 'NO_RESPONSE' }

  const httpsResult = await resolveChain(httpsStart, deadline)
  if (httpsResult.status === 'OK') return httpsResult
  if (httpsResult.status === 'DNS_ERROR') return httpsResult // http:// would fail identically
  if (httpsResult.status === 'REDIRECT_LOOP') return httpsResult // not a connectivity issue

  if (!RETRY_WITH_OTHER_PROTOCOL.has(httpsResult.status)) return httpsResult
  if (Date.now() >= deadline) return httpsResult

  const httpStart = buildUrl('http', trimmed)
  if (!httpStart) return httpsResult
  const httpResult = await resolveChain(httpStart, deadline)
  return httpResult.status === 'OK' ? httpResult : httpsResult // prefer reporting the HTTPS failure if both fail
}

async function runCapped(items, cap, onItem) {
  let i = 0
  async function next() {
    if (i >= items.length) return
    const idx = i++
    await onItem(idx, items[idx])
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, next))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { domains } = req.body || {}
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'domains array is required' })
  }

  const results = new Array(domains.length)

  await runCapped(domains, CONCURRENCY, async (i, domain) => {
    try {
      const r = await resolveDomain(domain)
      results[i] = { input: domain, ...r }
    } catch (err) {
      results[i] = { input: domain, status: 'NO_RESPONSE' }
    }
  })

  return res.json({ results })
}
