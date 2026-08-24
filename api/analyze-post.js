// POST /api/analyze-post
// Body: { urls: string[] }
// Fetches each post URL and extracts title, main article text, and external links found
// within the article body — the raw material a guest-post classifier needs. Does NOT call
// any AI itself; that happens client-side (see classifyGuestPost in sheetParserAPI.js),
// matching how this app already calls OpenAI directly from the browser elsewhere.

import { parse } from 'node-html-parser'

const CONCURRENCY   = 15
const FETCH_TIMEOUT = 8000
const CONTENT_CHARS = 3000 // enough for the model to judge tone/links without wasting tokens

// Major platforms/reference sites — near-universal, never indicate a purchased/contributed
// link, so they're excluded from the "external link" signal entirely.
const AUTHORITY_DOMAINS = [
  'wikipedia.org', 'youtube.com', 'youtu.be', 'facebook.com', 'fb.com',
  'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'pinterest.com',
  'tiktok.com', 'medium.com', 'google.com', 'goo.gl', 'amazon.com',
  'reddit.com', 'github.com', 'apple.com', 'microsoft.com',
  'wordpress.org', 'wordpress.com', 'vimeo.com', 'flickr.com', 'whatsapp.com',
  't.me', 'telegram.org', 'snapchat.com', 'threads.net',
]

function isAuthorityDomain(hostname) {
  const h = hostname.replace(/^www\./i, '').toLowerCase()
  return AUTHORITY_DOMAINS.some(d => h === d || h.endsWith('.' + d))
}

async function fetchHtml(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    clearTimeout(timer)
    return null
  }
}

function extractArticle(html, pageUrl) {
  const root = parse(html, { lowerCaseTagName: true })
  root.querySelectorAll('script, style, nav, header, footer, aside, form, noscript').forEach(el => el.remove())

  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
  const h1      = root.querySelector('h1')?.text
  const docTitle = root.querySelector('title')?.text
  const title = (ogTitle || h1 || docTitle || '').replace(/\s+/g, ' ').trim().slice(0, 200)

  const CONTENT_SELECTORS = [
    'article', '.entry-content', '.post-content', '.article-content',
    '.article-body', '.single-content', '.td-post-content', '.content-area',
    '#content', 'main',
  ]
  let contentEl = null
  for (const sel of CONTENT_SELECTORS) {
    const el = root.querySelector(sel)
    if (el && el.text.trim().length > 200) { contentEl = el; break }
  }
  if (!contentEl) contentEl = root

  const contentText = contentEl.text.replace(/\s+/g, ' ').trim().slice(0, CONTENT_CHARS)

  let siteDomain = ''
  try { siteDomain = new URL(pageUrl).hostname.replace(/^www\./i, '') } catch { /* ignore */ }

  const externalLinks = []
  const seenDomains = new Set()
  contentEl.querySelectorAll('a[href]').forEach(a => {
    if (externalLinks.length >= 15) return
    const href = a.getAttribute('href')
    if (!href) return
    let abs, host
    try { abs = new URL(href, pageUrl).href; host = new URL(abs).hostname.replace(/^www\./i, '') } catch { return }
    if (!host || host === siteDomain || isAuthorityDomain(host) || seenDomains.has(host)) return
    seenDomains.add(host)
    externalLinks.push({
      text: a.text.replace(/\s+/g, ' ').trim().slice(0, 100),
      domain: host,
      href: abs,
    })
  })

  return { title, contentText, externalLinks }
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

  await runCapped(urls, CONCURRENCY, async (i, url) => {
    const html = await fetchHtml(url)
    if (!html) { results[i] = { url, error: 'Could not fetch page' }; return }
    try {
      const { title, contentText, externalLinks } = extractArticle(html, url)
      if (!contentText) { results[i] = { url, error: 'No readable content found' }; return }
      results[i] = { url, title, contentText, externalLinks }
    } catch (err) {
      results[i] = { url, error: err.message || 'Extraction failed' }
    }
  })

  return res.json({ results })
}
