// POST /api/resolve-url
// Body: { domains: string[] }
//
// Uses a REAL headless Chrome browser (not a plain fetch client) to resolve each domain to
// its actual final URL. This matters because a plain HTTP client — even one sending a Chrome
// User-Agent header — has a different TLS handshake fingerprint than genuine Chrome, and some
// sites' security/bot-protection layers detect that mismatch and block or reset the HTTPS
// connection while leaving plain HTTP (often just an unprotected redirect rule) untouched.
// That produced false "http://" results for sites that actually serve fine over HTTPS to a
// real browser. Driving genuine Chromium sidesteps the problem entirely — it IS Chrome, so
// there's no fingerprint to mismatch. Playwright's own goto()/page.url() also natively follows
// every redirect and normalizes empty-path URLs with a trailing slash exactly like Chrome's
// address bar, so no manual redirect-chain or URL-normalization logic is needed at all.

import chromium from '@sparticuz/chromium'
import { chromium as playwrightChromium } from 'playwright-core'

const NAV_TIMEOUT      = 8000  // per navigation attempt
const PAGE_CONCURRENCY = 5     // concurrent pages sharing one browser instance

function hasProtocol(raw) {
  return /^https?:\/\//i.test(raw)
}

function classifyPlaywrightError(err) {
  const msg = err?.message || ''
  if (err?.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(msg)) return 'TIMEOUT'
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) return 'DNS_ERROR'
  if (/ERR_TOO_MANY_REDIRECTS/.test(msg)) return 'REDIRECT_LOOP'
  if (/ERR_CERT_|ERR_SSL_|ERR_BAD_SSL_CLIENT_AUTH/.test(msg)) return 'SSL_ERROR'
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED/.test(msg)) return 'CONNECTION_ERROR'
  return 'NO_RESPONSE'
}

// Errors worth retrying with the other protocol. A DNS failure or a genuine redirect loop
// would happen identically either way, so those short-circuit instead.
const RETRY_WITH_OTHER_PROTOCOL = new Set(['SSL_ERROR', 'CONNECTION_ERROR', 'TIMEOUT', 'NO_RESPONSE'])

// After a failed navigation, Chromium keeps transitioning internally to its own error page
// for a moment. If the SAME page is immediately reused for another goto() — the HTTPS-failed
// -> HTTP retry, or just the next domain in a worker's queue — that pending transition can
// cancel the new navigation with "interrupted by another navigation", which isn't a real
// verdict on the new URL at all. Retry once after a brief settle delay instead of reporting
// that as a false failure.
async function attemptGoto(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
    return { status: 'OK', finalUrl: page.url() }
  } catch (err) {
    if (/interrupted by another navigation/.test(err?.message || '')) return null
    return { status: classifyPlaywrightError(err) }
  }
}

async function navigateTo(page, url) {
  const first = await attemptGoto(page, url)
  if (first) return first
  await page.waitForTimeout(150).catch(() => {})
  const second = await attemptGoto(page, url)
  return second || { status: 'NO_RESPONSE' }
}

async function resolveOne(page, rawInput) {
  const trimmed = (rawInput || '').trim()
  if (!trimmed) return { input: rawInput, status: 'NO_RESPONSE' }

  if (hasProtocol(trimmed)) {
    // Caller gave an explicit protocol — respect it, no fallback testing of the other one.
    const r = await navigateTo(page, trimmed)
    return { input: rawInput, ...r }
  }

  const httpsResult = await navigateTo(page, `https://${trimmed}`)
  if (httpsResult.status === 'OK') return { input: rawInput, ...httpsResult }
  if (httpsResult.status === 'DNS_ERROR' || httpsResult.status === 'REDIRECT_LOOP') {
    return { input: rawInput, ...httpsResult } // http:// would fail/loop identically
  }
  if (!RETRY_WITH_OTHER_PROTOCOL.has(httpsResult.status)) return { input: rawInput, ...httpsResult }

  const httpResult = await navigateTo(page, `http://${trimmed}`)
  return httpResult.status === 'OK'
    ? { input: rawInput, ...httpResult }
    : { input: rawInput, ...httpsResult } // prefer reporting the HTTPS failure if both fail
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { domains } = req.body || {}
  if (!Array.isArray(domains) || domains.length === 0) {
    return res.status(400).json({ error: 'domains array is required' })
  }

  let browser
  try {
    browser = await playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  } catch {
    // Browser failed to launch entirely — report every domain as failed rather than crashing
    // the whole batch (and every other in-flight batch) with an unhandled error.
    return res.json({ results: domains.map(d => ({ input: d, status: 'NO_RESPONSE' })) })
  }

  const results = new Array(domains.length)
  try {
    const pageCount = Math.min(PAGE_CONCURRENCY, domains.length)
    const pages = await Promise.all(Array.from({ length: pageCount }, () => browser.newPage()))

    let next = 0
    async function worker(page) {
      while (next < domains.length) {
        const idx = next++
        try {
          results[idx] = await resolveOne(page, domains[idx])
        } catch {
          results[idx] = { input: domains[idx], status: 'NO_RESPONSE' }
        }
      }
    }
    await Promise.all(pages.map(worker))
  } finally {
    await browser.close()
  }

  return res.json({ results })
}
