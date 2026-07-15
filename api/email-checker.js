// POST /api/email-checker
// Body: { domain: string, targetEmail: string }
// Fetches Home, Contact, About, Privacy pages and extracts all emails.

const PAGE_CONFIGS = [
  { type: 'Home',    paths: ['/'] },
  { type: 'Contact', paths: ['/contact', '/contact-us', '/contact.html', '/contactus', '/get-in-touch', '/reach-us'] },
  { type: 'About',   paths: ['/about', '/about-us', '/about.html', '/aboutus', '/our-story', '/team'] },
  { type: 'Privacy', paths: ['/privacy-policy', '/privacy', '/privacy.html', '/legal/privacy', '/policies/privacy'] },
]

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const SKIP_EXTS = /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot|otf|map)$/i

function cleanDomain(raw) {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

function extractEmails(html) {
  const found = html.match(EMAIL_RE) || []
  const unique = [...new Set(found.map(e => e.toLowerCase()))]
  return unique.filter(e => {
    if (SKIP_EXTS.test(e)) return false
    const [, domain] = e.split('@')
    if (!domain || !domain.includes('.')) return false
    // skip obvious tracking/noreply patterns that aren't real contacts
    return true
  })
}

async function fetchPage(url, timeoutMs = 7000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const html = await res.text()
    return { url, html }
  } catch {
    clearTimeout(timer)
    return null
  }
}

async function checkPageType(domain, config, targetEmail) {
  for (const path of config.paths) {
    const result = await fetchPage(`https://${domain}${path}`)
      || await fetchPage(`http://${domain}${path}`)
    if (result) {
      const emails = extractEmails(result.html)
      return { type: config.type, url: result.url, emails, fetched: true, hasTarget: emails.includes(targetEmail) }
    }
  }
  return { type: config.type, url: `https://${domain}${config.paths[0]}`, emails: [], fetched: false, hasTarget: false }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { domain: rawDomain, targetEmail: rawTarget } = req.body || {}
  if (!rawDomain || !rawTarget) return res.status(400).json({ error: 'domain and targetEmail are required' })

  const domain      = cleanDomain(rawDomain)
  const targetEmail = rawTarget.trim().toLowerCase()

  const pages = await Promise.all(PAGE_CONFIGS.map(cfg => checkPageType(domain, cfg, targetEmail)))

  const allEmails = [...new Set(pages.flatMap(p => p.emails))]
  const hasTarget = allEmails.includes(targetEmail)

  return res.json({ domain, pages, allEmails, hasTarget })
}
