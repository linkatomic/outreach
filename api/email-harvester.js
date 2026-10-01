// POST /api/email-harvester
// Body: { domain: string }
// Fetches Home, Contact, About, Privacy pages and returns all emails found.
// Non-English contact/about/privacy pages (e.g. German "Kontakt") are found via an AI
// fallback over the site's own nav links when the English-slug guesses come up empty.

import { extractNavLinks, findPagesWithAI } from './_lib/pageDiscovery.js'

// Polish path guesses added directly (kontakt/o-nas/polityka-prywatnosci) rather than
// relying solely on the AI fallback below -- that fallback only runs once the homepage
// itself has already loaded, so a static guess that lands immediately is one less thing
// that can go wrong for a language this common in this account's domain lists.
const PAGE_CONFIGS = [
  { type: 'Contact', paths: ['/contact', '/contact-us', '/contact.html', '/contactus', '/get-in-touch', '/reach-us', '/kontakt', '/kontakt.html'] },
  { type: 'About',   paths: ['/about', '/about-us', '/about.html', '/aboutus', '/our-story', '/team', '/o-nas', '/o-firmie'] },
  { type: 'Privacy', paths: ['/privacy-policy', '/privacy', '/privacy.html', '/legal/privacy', '/policies/privacy', '/polityka-prywatnosci', '/polityka-prywatnosci.html'] },
]
const TYPE_KEY = { Contact: 'contact', About: 'about', Privacy: 'privacy' }

const EMAIL_RE  = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
const SKIP_EXTS = /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot|otf|map)$/i

function cleanDomain(raw) {
  return (raw || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

// Cloudflare encodes emails as hex XOR'd with a key byte stored at position 0
function decodeCFEmail(encoded) {
  try {
    const bytes = encoded.match(/.{2}/g)
    if (!bytes || bytes.length < 2) return null
    const key   = parseInt(bytes[0], 16)
    const email = bytes.slice(1).map(b => String.fromCharCode(parseInt(b, 16) ^ key)).join('')
    return email.includes('@') ? email : null
  } catch { return null }
}

function extractEmails(html) {
  const collected = []

  // 1. Cloudflare email protection (data-cfemail="...") — most common on WP sites
  const cfRe = /data-cfemail="([0-9a-f]+)"/gi
  let m
  while ((m = cfRe.exec(html)) !== null) {
    const decoded = decodeCFEmail(m[1])
    if (decoded) collected.push(decoded.toLowerCase())
  }

  // 2. Strip script/style/noscript blocks to avoid false positives from inline code
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')

  // 3. Decode numeric HTML entities (e.g. &#104; → h, &#x40; → @)
  text = text
    .replace(/&#(\d+);/g,       (_, c) => String.fromCharCode(+c))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))

  // 4. Strip remaining HTML tags, then run regex
  text = text.replace(/<[^>]+>/g, ' ')
  const plain = text.match(EMAIL_RE) || []
  for (const e of plain) collected.push(e.toLowerCase())

  const unique = [...new Set(collected)]
  return unique.filter(e => {
    if (SKIP_EXTS.test(e)) return false
    const [, domain] = e.split('@')
    return domain && domain.includes('.')
  })
}

async function fetchPage(url, timeoutMs = 5000) {
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

// Candidate paths fire concurrently per protocol instead of one at a time — trying all 6
// guesses serially (plus an http fallback for each) could take 6 * 2 * timeoutMs on a
// slow/dead server, which is exactly what was blowing past Vercel's 30s maxDuration and
// getting the whole function killed (not a clean per-domain failure). Racing them in two
// waves (all https guesses, then all http guesses only if none of those landed) bounds
// this page type's cost to roughly 2 * timeoutMs regardless of how many paths are tried.
async function checkPageType(domain, config) {
  const httpsHits = await Promise.all(config.paths.map(path => fetchPage(`https://${domain}${path}`)))
  let result = httpsHits.find(Boolean)

  if (!result) {
    const httpHits = await Promise.all(config.paths.map(path => fetchPage(`http://${domain}${path}`)))
    result = httpHits.find(Boolean)
  }

  if (result) {
    const emails = extractEmails(result.html)
    return { type: config.type, url: result.url, emails, fetched: true }
  }
  return { type: config.type, url: `https://${domain}${config.paths[0]}`, emails: [], fetched: false }
}

async function discoverPages(domain) {
  const homeResult = await fetchPage(`https://${domain}/`) || await fetchPage(`http://${domain}/`)
  const homePage = homeResult
    ? { type: 'Home', url: homeResult.url, emails: extractEmails(homeResult.html), fetched: true }
    : { type: 'Home', url: `https://${domain}/`, emails: [], fetched: false }

  const otherPages = await Promise.all(PAGE_CONFIGS.map(cfg => checkPageType(domain, cfg)))

  // AI fallback — only for page types the English-slug guesses missed, and only when we
  // have a homepage to pull real nav links from.
  const missing = otherPages.filter(p => !p.fetched).map(p => TYPE_KEY[p.type])
  if (missing.length && homeResult) {
    const navLinks = extractNavLinks(homeResult.html, homeResult.url)
    const found = await findPagesWithAI(domain, navLinks, missing)
    for (const page of otherPages) {
      const key = TYPE_KEY[page.type]
      if (page.fetched || !found[key]) continue
      const result = await fetchPage(found[key])
      if (result) {
        page.url = result.url
        page.emails = extractEmails(result.html)
        page.fetched = true
        page.foundVia = 'ai'
      }
    }
  }

  return [homePage, ...otherPages]
}

// Backstop against vercel.json's maxDuration (30s) killing the function outright, which
// produced an abrupt infra-level timeout instead of a clean per-domain failure the frontend
// already knows how to show and retry. The concurrency fix above should make this rare, but
// a domain with a genuinely slow (not dead) server, or one that falls through to the AI
// fallback's extra OpenAI round trip, can still add up — this guarantees a real response
// before Vercel ever gets the chance to kill it.
const DOMAIN_BUDGET_MS = 25000

function withDeadline(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('HARVEST_TIMED_OUT')), ms)),
  ])
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { domain: rawDomain } = req.body || {}
  if (!rawDomain) return res.status(400).json({ error: 'domain is required' })

  const domain = cleanDomain(rawDomain)
  try {
    const pages = await withDeadline(discoverPages(domain), DOMAIN_BUDGET_MS)
    const allEmails = [...new Set(pages.flatMap(p => p.emails))]
    return res.json({ domain, pages, allEmails })
  } catch (err) {
    if (err.message === 'HARVEST_TIMED_OUT') {
      return res.status(504).json({ error: 'Site took too long to respond (timed out)' })
    }
    throw err
  }
}
