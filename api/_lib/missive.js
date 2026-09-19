// Missive REST API client — personal API token, server-only.
// MISSIVE_API_TOKEN must be a plain (non-VITE_-prefixed) env var so Vite never
// inlines it into the client bundle.

const BASE_URL = 'https://public.missiveapp.com/v1'
const MAX_RETRIES = 3

function authHeader() {
  const token = process.env.MISSIVE_API_TOKEN
  if (!token) throw new Error('Missive API token not configured (MISSIVE_API_TOKEN)')
  return `Bearer ${token}`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Missive's docs confirm all responses (including errors) are JSON but don't publish
// the exact error-body shape — hedge across the field names other REST APIs commonly use.
function errorMessage(body, status) {
  return body?.error?.message || body?.error || body?.message || `Missive API error ${status}`
}

// Handles the documented rate limit (5 concurrent, ~1 req/sec sustained) by honoring
// Retry-After on a 429 rather than trying to pace bursts preemptively — this tool is
// low-volume and manually triggered, so reacting to a real 429 is enough; true
// cross-invocation pacing would need a shared store, which is overkill here.
export async function missiveRequest(path, opts = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...opts,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    })

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 2
      await sleep(retryAfter * 1000)
      continue
    }

    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(errorMessage(body, res.status))
    return body
  }
  throw new Error('Missive API rate limit exceeded after retries')
}
