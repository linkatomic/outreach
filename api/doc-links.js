// POST /api/doc-links
// Body: { urls: string[] }
// Fetches each Google Doc's public HTML export and extracts anchor text + URL pairs.
// Docs must be shared as "Anyone with the link can view" — no auth is used here.

import { parse } from 'node-html-parser'

// Concurrency intentionally matches the frontend's batch size (see AnchorExtractor.jsx
// BATCH_SIZE) so a batch always processes in a single wave — keeps worst-case duration
// bounded by ONE per-doc timeout, not (batchSize / concurrency) of them stacked serially.
const CONCURRENCY = 20

function extractDocId(raw) {
  const m = (raw || '').match(/\/document\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

// Google Docs export wraps external links as https://www.google.com/url?q=<real>&...
function unwrapRedirect(href) {
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
    // Internal doc navigation (headings, table of contents), and Google's own "smart chip"
    // references (people/file/calendar mentions) — never real backlinks, but do render as
    // genuine <a href> tags in the export and would otherwise pollute the results.
    if (u.hostname === 'google.com' || u.hostname.endsWith('.google.com')) return false
    return true
  } catch {
    return false
  }
}

// Real DOM parsing instead of regex — regex over arbitrary HTML is fragile (misses
// single-quoted attributes, chokes on malformed/nested markup) and was the likely source
// of scrambled text/URL pairings on real-world documents.
function extractLinks(html) {
  const root = parse(html, { lowerCaseTagName: true })
  const anchorNodes = root.querySelectorAll('a')

  const links = []
  let searchFrom = 0
  let prevEnd = null

  for (const node of anchorNodes) {
    const href = node.getAttribute('href') || ''
    const text = node.textContent.replace(/\s+/g, ' ').trim()
    const url  = unwrapRedirect(href)

    // Locate this anchor's span in the original HTML (for adjacency/merge detection below).
    // Search forward-only so document order is preserved even if outerHTML repeats elsewhere.
    const outer = node.outerHTML
    const idx   = outer ? html.indexOf(outer, searchFrom) : -1
    const start = idx >= 0 ? idx : searchFrom
    const end   = idx >= 0 ? idx + outer.length : searchFrom
    searchFrom  = end

    if (!text || !isUsableUrl(url)) { prevEnd = end; continue }

    // Google Docs sometimes splits ONE visual hyperlink into several consecutive <a> tags —
    // one per formatting run (bold/italic/color changes within the same link). If two anchors
    // share the same URL and there's nothing but the tags themselves between them, they're
    // fragments of a single link — merge the text instead of emitting duplicate pairs, which
    // would otherwise shift every later column in that doc's row.
    const gapHtml = prevEnd !== null ? html.slice(prevEnd, start) : null
    const gapText = gapHtml !== null ? parse(gapHtml).textContent.trim() : null
    const last    = links[links.length - 1]

    if (last && last.url === url && gapText === '') {
      last.text += text
    } else {
      links.push({ text, url })
    }
    prevEnd = end
  }

  return links
}

function extractTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i)
  return m ? parse(m[1]).textContent.trim() : null
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
