// Crisp REST API client — website-tier token, server-only.
// CRISP_IDENTIFIER/CRISP_KEY/CRISP_WEBSITE_ID must be plain (non-VITE_-prefixed)
// env vars so Vite never inlines them into the client bundle.

const BASE_URL = 'https://api.crisp.chat/v1'

function authHeader() {
  const id = process.env.CRISP_IDENTIFIER
  const key = process.env.CRISP_KEY
  if (!id || !key) throw new Error('Crisp credentials not configured (CRISP_IDENTIFIER/CRISP_KEY)')
  return 'Basic ' + Buffer.from(`${id}:${key}`).toString('base64')
}

export function crispWebsiteId() {
  const id = process.env.CRISP_WEBSITE_ID
  if (!id) throw new Error('Crisp credentials not configured (CRISP_WEBSITE_ID)')
  return id
}

export async function crispRequest(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      Authorization: authHeader(),
      'X-Crisp-Tier': 'website',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || body?.error) {
    throw new Error(body?.reason || `Crisp API error ${res.status}`)
  }
  return body.data
}
