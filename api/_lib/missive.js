// Missive REST API client — personal API token, server-only.
// MISSIVE_API_TOKEN / MISSIVE_PERSONAL_API_TOKEN must be plain (non-VITE_-prefixed) env
// vars so Vite never inlines them into the client bundle.

const BASE_URL = 'https://public.missiveapp.com/v1'
const MAX_RETRIES = 3

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
async function request(path, token, opts = {}) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
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

// Shared Missive export token — whoever's token is configured for that tool.
export async function missiveRequest(path, opts = {}) {
  const token = process.env.MISSIVE_API_TOKEN
  if (!token) throw new Error('Missive API token not configured (MISSIVE_API_TOKEN)')
  return request(path, token, opts)
}

// Dev's own personal Missive API token — used only by the Personal Email Sender, so
// messages send (and threads appear) as actually authored by Dev, not a shared/export token.
export async function missivePersonalRequest(path, opts = {}) {
  const token = process.env.MISSIVE_PERSONAL_API_TOKEN
  if (!token) throw new Error('Missive personal API token not configured (MISSIVE_PERSONAL_API_TOKEN)')
  return request(path, token, opts)
}
