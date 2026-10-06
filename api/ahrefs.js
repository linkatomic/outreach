// POST /api/ahrefs
// Body: { domains: string[] }
// Proxies Ahrefs' free "Domain Rating" endpoint (GET /v3/public/domain-rating-free) per
// domain. Done server-side rather than from the browser so the Bearer token never reaches
// the client bundle and to sidestep any CORS restriction on calling api.ahrefs.com directly.

const AHREFS_API_KEY = process.env.AHREFS_API_KEY
const CONCURRENCY = 3 // keep well under whatever Ahrefs' free-tier rate limit actually is

function cleanTarget(raw) {
  return String(raw ?? '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]
}

async function fetchDomainRating(domain, attempt = 0) {
  const url = `https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}&output=json`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AHREFS_API_KEY}`, Accept: 'application/json' },
  })
  if (res.status === 429 && attempt < 3) {
    await new Promise(r => setTimeout(r, 1000 * (attempt + 1))) // back off on rate limit
    return fetchDomainRating(domain, attempt + 1)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || data.message || `HTTP ${res.status}`)
  }
  const rating = data.domain_rating?.domain_rating
  return typeof rating === 'number' ? rating : null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!AHREFS_API_KEY) return res.status(500).json({ error: 'AHREFS_API_KEY not configured' })

  const { domains } = req.body || {}
  if (!Array.isArray(domains) || !domains.length) {
    return res.status(400).json({ error: 'domains (non-empty array) is required' })
  }

  const results = []
  for (let i = 0; i < domains.length; i += CONCURRENCY) {
    const batch = domains.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(batch.map(d => fetchDomainRating(cleanTarget(d))))
    settled.forEach((r, bi) => {
      if (r.status === 'fulfilled') results.push({ domain: batch[bi], domainRating: r.value, error: null })
      else results.push({ domain: batch[bi], domainRating: null, error: r.reason?.message || 'Failed' })
    })
  }

  return res.json({ results })
}
