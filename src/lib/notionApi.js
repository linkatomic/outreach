const GPL_TOKEN = import.meta.env.VITE_GPL_API_TOKEN

// ── Notion connection test ────────────────────────────────

export async function testNotionConnection() {
  const res = await fetch('/api/notion')
  const data = await res.json()
  if (!res.ok) return { ok: false, error: data.error, code: data.code }
  return { ok: true, title: data.title, id: data.id }
}

export async function listNotionUsers() {
  const res  = await fetch('/api/notion?users=true')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.users || []
}

// ── Notion page creation ──────────────────────────────────

export async function createNotionPage(properties) {
  const res = await fetch('/api/notion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties }),
  })
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.httpStatus = res.status
    throw err
  }
  return data
}

export async function getNotionPage(pageId) {
  const res = await fetch(`/api/notion?pageId=${encodeURIComponent(pageId)}`)
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.httpStatus = res.status
    throw err
  }
  return data
}

export async function updateNotionPage(pageId, properties) {
  const res = await fetch('/api/notion', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageId, properties }),
  })
  const data = await res.json()
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.httpStatus = res.status
    throw err
  }
  return data
}

// ── GPL API lookup ────────────────────────────────────────

export async function fetchGplBatch(domains) {
  const map = new Map()
  if (!domains.length || !GPL_TOKEN) return map
  const BATCH = 100
  for (let i = 0; i < domains.length; i += BATCH) {
    const batch = domains.slice(i, i + BATCH)
    try {
      const res = await fetch('https://api.records.guestpostlinks.net/v2/publisher/website/gpl/search-publishers', {
        method: 'POST',
        headers: { Authorization: GPL_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ websites: batch }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          for (const site of data.data?.websites || []) map.set(site.website.toLowerCase(), site)
        }
      }
    } catch { /* skip failed batch */ }
  }
  return map
}

// Confirmed from GPL's "Search Publishers" API doc: this is a site-level field (not on the
// addon or vendor) — the minimum article length the publisher requires. The other spellings
// are kept as a harmless fallback in case a different endpoint ever shapes it differently.
const WORD_COUNT_KEYS = ['article_min_length', 'word_count', 'wordCount', 'words', 'min_words', 'minWords', 'word_limit', 'wordLimit']
function findWordCount(obj) {
  if (!obj) return undefined
  for (const k of WORD_COUNT_KEYS) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '' && !isNaN(+v)) return +v
  }
  return undefined
}

// Flat per-article writing-cost tiers by word count (pre-discount — the 10% in
// buildNotionProperties applies on top of whatever this returns, same as Publication Cost).
// Below 600 words there's no defined rate, so the caller falls back to a manual value.
function writingCostForWordCount(words) {
  if (words == null || isNaN(words)) return undefined
  if (words >= 3000) return 45
  if (words >= 2000) return 30
  if (words >= 1000) return 15
  if (words >= 600)  return 10
  return undefined
}

export function extractGplInfo(siteData, niche) {
  if (!siteData?.vendors?.length) return {}
  const vendor = siteData.vendors.find(v => v.is_primary && !v.is_disable)
               ?? siteData.vendors.find(v => !v.is_disable)
  if (!vendor) return {}
  const nicheKey = (niche || 'general').toLowerCase()
  const addon = vendor.addons?.find(a => a.label === nicheKey)
             ?? vendor.addons?.find(a => a.label === 'general')
             ?? vendor.addons?.[0]
  const buyerPrice = addon?.buyer_price
  const wordCount  = findWordCount(addon) ?? findWordCount(vendor) ?? findWordCount(siteData)
  return {
    vendor:      vendor.name ?? vendor.vendor_name ?? '',
    vendorPrice: addon?.admin_price ?? '',
    actualPaid:  addon?.actualPrice ?? '',
    currency:    vendor.currency ?? '',
    // Auto-fetched per site — Publication Cost from GPL's buyer price (what the client is
    // charged), Writing Cost from the word-count tier table above. Either can be undefined
    // (missing GPL data for this site, or a word count below the lowest tier); the caller
    // falls back to a manual value in that case.
    publicationCost: (buyerPrice != null && buyerPrice !== '' && !isNaN(+buyerPrice)) ? +buyerPrice : undefined,
    writingCost: writingCostForWordCount(wordCount),
  }
}

// ── Property builder ──────────────────────────────────────

// Publication Cost and Writing Cost are entered as the raw/quoted price, but the price
// actually written to Notion is always post 10% discount — e.g. a $71.9 publication cost
// is stored as $64.71, a $10 writing cost as $9.00. Rounded to cents to avoid floating-point
// noise (71.9 * 0.9 is 64.70999999999999 in plain JS).
const DISCOUNT_RATE = 0.9 // 10% off
function applyDiscount(n) {
  return Math.round(n * DISCOUNT_RATE * 100) / 100
}

export function buildNotionProperties({ orderId, domain, vendor, vendorPrice, actualPaid, currency, common }) {
  const txt  = v => v ? [{ text: { content: String(v) } }] : undefined
  const sel  = v => v ? { name: String(v) } : undefined
  const stat = v => v ? { name: String(v) } : undefined
  const toNum = v => (v !== '' && v != null && !isNaN(+v)) ? +v : undefined

  const p = {}

  // Page title: "Order ID:12345 - domain.com"
  p['Name'] = { title: [{ text: { content: `${orderId} - ${domain}` } }] }

  // Per-row: from sheet + GPL API
  if (domain) {
    const url = domain.startsWith('http') ? domain : `https://${domain}`
    p['Publisher Website'] = { url }
  }
  if (vendor)      p['Vendor']       = { rich_text: txt(vendor) }
  const vp = toNum(vendorPrice)
  if (vp != null)  p['Vendor Price'] = { number: vp }
  const ap = toNum(actualPaid)
  if (ap != null)  p['Actual Paid']  = { number: ap }
  if (currency)    p['Currency Type'] = { select: sel(currency) }

  // Common fields
  const { orderStatus, clientName, clientSheet, orderFrom, orderType, orderIn,
          postType, paymentStatus, note, publicationCost, writingCost, orderUrl,
          orderProcessBy, sentForPublication, dateOfPublication } = common

  if (orderStatus)          p['Order Status']          = { status: stat(orderStatus) }
  if (clientName)           p['Customer Name']          = { rich_text: txt(clientName) }
  if (clientSheet)          p['Client Sheet']           = { url: clientSheet }
  if (orderFrom)            p['Order From']             = { select: sel(orderFrom) }
  if (orderType)            p['Order Type']             = { select: sel(orderType) }
  if (orderIn)              p['Order In']               = { select: sel(orderIn) }
  if (postType)             p['Post Type']              = { select: sel(postType) }
  if (paymentStatus)        p['Payment Status']         = { status: stat(paymentStatus) }
  if (note)                 p['Note']                   = { rich_text: txt(note) }
  const pc = toNum(publicationCost)
  if (pc != null)           p['Publication Cost']       = { number: applyDiscount(pc) }
  const wc = toNum(writingCost)
  if (wc != null)           p['Writing Cost']           = { number: applyDiscount(wc) }
  if (orderUrl)             p['Order URL']              = { url: orderUrl }
  if (orderProcessBy)       p['Order Process By']       = { rich_text: txt(orderProcessBy) }
  if (sentForPublication)   p['Sent for Publication']   = { people: [{ object: 'user', id: sentForPublication }] }
  if (dateOfPublication)    p['Date of Publication']    = { date: { start: dateOfPublication } }

  return p
}
