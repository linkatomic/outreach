const GPL_TOKEN = import.meta.env.VITE_GPL_API_TOKEN

// ── Notion connection test ────────────────────────────────

export async function testNotionConnection() {
  const res = await fetch('/api/notion')
  const data = await res.json()
  if (!res.ok) return { ok: false, error: data.error, code: data.code }
  return { ok: true, title: data.title, id: data.id }
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

export function extractGplInfo(siteData, niche) {
  if (!siteData?.vendors?.length) return {}
  const vendor = siteData.vendors.find(v => v.is_primary && !v.is_disable)
               ?? siteData.vendors.find(v => !v.is_disable)
  if (!vendor) return {}
  const nicheKey = (niche || 'general').toLowerCase()
  const addon = vendor.addons?.find(a => a.label === nicheKey)
             ?? vendor.addons?.find(a => a.label === 'general')
             ?? vendor.addons?.[0]
  return {
    vendor:      vendor.name ?? vendor.vendor_name ?? '',
    vendorPrice: addon?.admin_price ?? '',
    actualPaid:  addon?.buyer_price ?? '',
    currency:    vendor.currency ?? '',
  }
}

// ── Property builder ──────────────────────────────────────

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
          postType, paymentStatus, note, publicationCost, orderUrl } = common

  if (orderStatus)     p['Order Status']         = { status: stat(orderStatus) }
  if (clientName)      p['Customer Name']         = { rich_text: txt(clientName) }
  if (clientSheet)     p['Client Sheet']          = { url: clientSheet }
  if (orderFrom)       p['Order From']            = { select: sel(orderFrom) }
  if (orderType)       p['Order Type']            = { select: sel(orderType) }
  if (orderIn)         p['Order In']              = { select: sel(orderIn) }
  if (postType)        p['Post Type']             = { select: sel(postType) }
  if (paymentStatus)   p['Payment Status']        = { status: stat(paymentStatus) }
  if (note)            p['Note']                  = { rich_text: txt(note) }
  const pc = toNum(publicationCost)
  if (pc != null)      p['Publication Cost']      = { number: pc }
  if (orderUrl)        p['Order URL']             = { url: orderUrl }

  return p
}
