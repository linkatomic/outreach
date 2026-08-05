// POST /api/doc-links
// Body: { urls: string[] }
// Fetches each Google Doc's public HTML export and extracts anchor text + URL pairs.
// Docs must be shared as "Anyone with the link can view" — no auth is used here.

// Concurrency intentionally matches the frontend's batch size (see AnchorExtractor.jsx
// BATCH_SIZE) so a batch always processes in a single wave — keeps worst-case duration
// bounded by ONE per-doc timeout, not (batchSize / concurrency) of them stacked serially.
const CONCURRENCY = 20

function extractDocId(raw) {
  const m = (raw || '').match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

function decodeEntities(str) {
  return (str || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
}

// Google Docs export wraps external links as https://www.google.com/url?q=<real>&...
function unwrapRedirect(rawHref) {
  const href = decodeEntities(rawHref)
  try {
    const u = new URL(href)
    if ((u.hostname === 'www.google.com' || u.hostname === 'google.com') && u.pathname === '/url') {
      const q = u.searchParams.get('q')
      if (q) return q
    }
    return href
  } catch {
    return href
  }
}

function isUsableUrl(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return false
    // Internal doc navigation (headings, table of contents) — not a real backlink
    if (u.hostname === 'docs.google.com') return false
    return true
  } catch {
    return false
  }
}

function extractLinks(html) {
  const links = []
  const anchorRe = /<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = anchorRe.exec(html)) !== null) {
    const text = stripTags(m[2])
    if (!text) continue
    const url = unwrapRedirect(m[1])
    if (!isUsableUrl(url)) continue
    links.push({ text, url })
  }
  return links
}

function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i)
  return m ? stripTags(m[1]) : null
}

function looksBlocked(html) {
  return /accounts\.google\.com/i.test(html)
    || /<title>\s*Sign in/i.test(html)
    || /You need (permission|access)/i.test(html)
    || /Sorry,\s*unable to open the file/i.test(html)
}

async function fetchDocHtml(docId, timeoutMs = 7000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=html`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    clearTimeout(timer)
    const html = await res.text()
    if (!res.ok || looksBlocked(html)) {
      return { ok: false, error: 'Could not open this doc — set sharing to "Anyone with the link can view"' }
    }
    return { ok: true, html }
  } catch {
    clearTimeout(timer)
    return { ok: false, error: 'Request timed out or failed' }
  }
}

async function runCapped(tasks, cap, onResult) {
  let i = 0
  async function next() {
    if (i >= tasks.length) return
    const idx = i++
    await onResult(idx, tasks[idx])
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(cap, tasks.length) }, next))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { urls } = req.body || {}
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls array is required' })
  }

  const results = new Array(urls.length)

  await runCapped(urls, CONCURRENCY, async (i, raw) => {
    const docId = extractDocId(raw)
    if (!docId) {
      results[i] = { input: raw, error: 'Not a valid Google Doc link' }
      return
    }
    const { ok, html, error } = await fetchDocHtml(docId)
    if (!ok) {
      results[i] = { input: raw, docId, error }
      return
    }
    results[i] = { input: raw, docId, title: extractTitle(html), links: extractLinks(html) }
  })

  return res.json({ results })
}
