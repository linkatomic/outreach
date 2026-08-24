// POST /api/sample-posts
// Body: { domain: string }
// Discovers post/article URLs for a site via sitemaps (with robots.txt discovery + gzip
// support + recursive sitemap-index crawling), RSS/Atom feeds, the WordPress REST API,
// and — as a last resort for sites with none of the above — a homepage link scan.

import zlib from 'zlib'

const TIME_BUDGET_MS  = 40000  // stop discovering more once this much wall-clock time has passed
const MAX_SITEMAPS    = 25     // cap on sub-sitemaps fetched (sitemap indexes can be huge)
const MAX_URLS        = 3000   // cap on total post URLs collected
const MAX_WP_PAGES    = 8      // cap on WP REST API pages (100 posts/page)
const FETCH_TIMEOUT   = 8000

const POST_SITEMAP_HINT     = /(post|article|blog|news|story)/i
const NON_POST_SITEMAP_HINT = /(page|categor|tag|author|product|attachment|taxonom)/i

// Clear non-post paths — admin/system/commerce/asset paths, never articles
const EXCLUDE_PATH_RE = /\/(wp-json|wp-admin|wp-content|wp-includes|feed\/?$|category|tag|author|page\/\d+|cart|checkout|shop|product|wp-login|sitemap)(\/|$|\.)/i
const EXCLUDE_EXT_RE  = /\.(xml|jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|ico|woff2?)(\?|$)/i

function cleanDomain(raw) {
  return (raw || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

function decodeEntities(s) {
  return (s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function sameHost(url, domain) {
  try { return new URL(url).hostname.replace(/^www\./i, '') === domain } catch { return false }
}

function looksLikePostUrl(u, domain) {
  try {
    const parsed = new URL(u)
    if (domain && parsed.hostname.replace(/^www\./i, '') !== domain) return false
    const path = parsed.pathname
    if (!path || path === '/') return false
    if (EXCLUDE_PATH_RE.test(path)) return false
    if (EXCLUDE_EXT_RE.test(path)) return false
    return true
  } catch {
    return false
  }
}

async function fetchText(url, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    // Some servers serve literal .xml.gz bodies without a gzip Content-Encoding header
    // (relying on the client to notice) — fetch() only auto-decompresses proper
    // Content-Encoding, so detect the gzip magic bytes ourselves as a fallback.
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      try { return zlib.gunzipSync(buf).toString('utf-8') } catch { /* fall through */ }
    }
    return buf.toString('utf-8')
  } catch {
    clearTimeout(timer)
    return null
  }
}

async function fetchJson(url, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    return data ? { data, headers: res.headers } : null
  } catch {
    clearTimeout(timer)
    return null
  }
}

function extractLocs(xml) {
  const locs = []
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi
  let m
  while ((m = re.exec(xml)) !== null) locs.push(decodeEntities(m[1].trim()))
  return locs
}

const timeLeft = state => TIME_BUDGET_MS - (Date.now() - state.startTime)
const budgetOk = state => timeLeft(state) > 0 && state.urls.size < MAX_URLS

async function crawlSitemap(url, domain, state) {
  if (!budgetOk(state) || state.sitemapsFetched >= MAX_SITEMAPS) return
  if (state.visited.has(url)) return
  state.visited.add(url)

  // Skip obviously non-post sub-sitemaps by filename — saves budget for real posts
  if (NON_POST_SITEMAP_HINT.test(url) && !POST_SITEMAP_HINT.test(url)) return

  state.sitemapsFetched++
  const xml = await fetchText(url)
  if (!xml) return

  if (/<sitemapindex[\s>]/i.test(xml)) {
    const locs = extractLocs(xml)
    // Post-named sub-sitemaps first, so a capped crawl still yields real posts
    const prioritized = [...locs].sort((a, b) => (POST_SITEMAP_HINT.test(b) ? 1 : 0) - (POST_SITEMAP_HINT.test(a) ? 1 : 0))
    for (const loc of prioritized) {
      if (!budgetOk(state) || state.sitemapsFetched >= MAX_SITEMAPS) break
      await crawlSitemap(loc, domain, state)
    }
  } else if (/<urlset[\s>]/i.test(xml)) {
    const locs = extractLocs(xml)
    const trustAll = POST_SITEMAP_HINT.test(url) // e.g. post-sitemap.xml — every URL in it is a post
    for (const loc of locs) {
      if (state.urls.size >= MAX_URLS) break
      if (!state.urls.has(loc) && (trustAll || looksLikePostUrl(loc, domain))) {
        state.urls.set(loc, 'sitemap')
      }
    }
  }
}

async function discoverSitemaps(domain, state) {
  const candidates = new Set()

  const robots = await fetchText(`https://${domain}/robots.txt`, 6000)
  if (robots) {
    const re = /^\s*sitemap:\s*(\S+)/gim
    let m
    while ((m = re.exec(robots)) !== null) candidates.add(m[1].trim())
  }

  // Common paths even when robots.txt doesn't list one
  ;[
    '/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml',
    '/post-sitemap.xml', '/sitemap1.xml', '/sitemaps.xml', '/sitemap/sitemap-index.xml',
  ].forEach(p => candidates.add(`https://${domain}${p}`))

  for (const sm of candidates) {
    if (!budgetOk(state) || state.sitemapsFetched >= MAX_SITEMAPS) break
    await crawlSitemap(sm, domain, state)
  }
}

async function discoverFeeds(domain, homepageHtml, state) {
  const feedCandidates = new Set([
    `https://${domain}/feed`, `https://${domain}/feed/`, `https://${domain}/rss`,
    `https://${domain}/rss.xml`, `https://${domain}/atom.xml`, `https://${domain}/index.xml`,
    `https://${domain}/feeds/posts/default`, `https://${domain}/blog/feed`,
  ])

  if (homepageHtml) {
    const re = /<link\s+[^>]*type=["'](?:application\/rss\+xml|application\/atom\+xml)["'][^>]*>/gi
    let m
    while ((m = re.exec(homepageHtml)) !== null) {
      const hrefM = m[0].match(/href=["']([^"']+)["']/i)
      if (hrefM) {
        try { feedCandidates.add(new URL(hrefM[1], `https://${domain}`).href) } catch { /* skip */ }
      }
    }
  }

  for (const feedUrl of feedCandidates) {
    if (!budgetOk(state)) break
    const xml = await fetchText(feedUrl, 6000)
    if (!xml) continue

    const rssRe  = /<item>[\s\S]*?<link>\s*([^<\s]+)\s*<\/link>/gi
    const atomRe = /<entry>[\s\S]*?<link[^>]+href=["']([^"']+)["']/gi
    let m
    while ((m = rssRe.exec(xml)) !== null) {
      const u = decodeEntities(m[1].trim())
      if (!state.urls.has(u) && looksLikePostUrl(u, domain)) state.urls.set(u, 'feed')
    }
    while ((m = atomRe.exec(xml)) !== null) {
      const u = decodeEntities(m[1].trim())
      if (!state.urls.has(u) && looksLikePostUrl(u, domain)) state.urls.set(u, 'feed')
    }
  }
}

async function discoverWpApi(domain, state) {
  let page = 1
  while (page <= MAX_WP_PAGES && budgetOk(state)) {
    const result = await fetchJson(`https://${domain}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=link`)
    if (!result || !Array.isArray(result.data) || result.data.length === 0) break
    for (const post of result.data) {
      if (post.link && !state.urls.has(post.link)) state.urls.set(post.link, 'wp-api')
    }
    const totalPages = parseInt(result.headers.get('x-wp-totalpages') || '1', 10)
    if (page >= totalPages) break
    page++
  }
}

async function discoverFromHomepage(domain, homepageHtml, state) {
  if (!homepageHtml) return
  const re = /<a\s+[^>]*href=["']([^"']+)["']/gi
  let m
  while ((m = re.exec(homepageHtml)) !== null) {
    if (state.urls.size >= MAX_URLS) break
    let abs
    try { abs = new URL(m[1], `https://${domain}`).href } catch { continue }
    if (!state.urls.has(abs) && sameHost(abs, domain) && looksLikePostUrl(abs, domain)) {
      state.urls.set(abs, 'homepage')
    }
  }
}

async function discoverDomain(rawDomain) {
  const domain = cleanDomain(rawDomain)
  if (!domain || !domain.includes('.')) throw new Error('Not a valid domain')

  const state = { urls: new Map(), visited: new Set(), sitemapsFetched: 0, startTime: Date.now() }

  await discoverSitemaps(domain, state)

  const homepageHtml = budgetOk(state) ? await fetchText(`https://${domain}/`, 8000) : null

  if (budgetOk(state)) await discoverFeeds(domain, homepageHtml, state)
  if (budgetOk(state)) await discoverWpApi(domain, state)

  // Last resort — only bother if the structured sources came up nearly empty
  if (budgetOk(state) && state.urls.size < 5) {
    await discoverFromHomepage(domain, homepageHtml, state)
  }

  const bySource = {}
  for (const src of state.urls.values()) bySource[src] = (bySource[src] || 0) + 1

  return {
    domain,
    urls: [...state.urls.entries()].map(([url, source]) => ({ url, source })),
    bySource,
    truncated: state.urls.size >= MAX_URLS,
    elapsedMs: Date.now() - state.startTime,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { domain } = req.body || {}
  if (!domain) return res.status(400).json({ error: 'domain is required' })

  try {
    const result = await discoverDomain(domain)
    return res.json(result)
  } catch (err) {
    return res.json({ domain: cleanDomain(domain), urls: [], bySource: {}, error: err.message || 'Discovery failed' })
  }
}
