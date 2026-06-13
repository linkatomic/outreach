import {
  extractSheetId, getSheetTabs, getSheetRows, cleanDomain,
  addSheetTab, writeRangeValues, batchWriteRangeValues,
} from './sheetParserAPI.js'

const GPL_TOKEN = import.meta.env.VITE_GPL_API_TOKEN

// ── Column layout (0-indexed, A=0 … T=19) ────────────────

export const HEADERS = [
  'Order ID', 'Domain', 'Price', 'No. Backlinks',
  'Replacement', 'R. Price',
  'Anchor Text 1', 'Anchor URL 1',
  'Anchor Text 2', 'Anchor URL 2',
  'Anchor Text 3', 'Anchor URL 3',
  'Link Type', 'Link Validity', 'Primary Language',
  'Article Length Min', 'Rules',
  'Article Doc', 'Live Link', 'Remark',
]
const NUM_COLS = HEADERS.length // 20

const C = {
  ORDER_ID: 0, DOMAIN: 1, PRICE: 2, BACKLINKS: 3,
  REPLACEMENT: 4, R_PRICE: 5,
  ANCHOR_TEXT_1: 6, ANCHOR_URL_1: 7,
  ANCHOR_TEXT_2: 8, ANCHOR_URL_2: 9,
  ANCHOR_TEXT_3: 10, ANCHOR_URL_3: 11,
  LINK_TYPE: 12, LINK_VALIDITY: 13,
  PRIMARY_LANGUAGE: 14, ARTICLE_LENGTH_MIN: 15,
  RULES: 16, ARTICLE_DOC: 17, LIVE_LINK: 18, REMARK: 19,
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Domain text parser ────────────────────────────────────

export function parseDomainText(text) {
  return [...new Set(
    text.split(/[\n,]+/)
      .map(d => cleanDomain(d.trim()))
      .filter(Boolean)
  )]
}

// ── GPL API ───────────────────────────────────────────────

async function fetchGplData(domains, onProgress) {
  const map = new Map()
  if (!domains.length || !GPL_TOKEN) return map

  const BATCH = 100
  const batches = []
  for (let i = 0; i < domains.length; i += BATCH) batches.push(domains.slice(i, i + BATCH))

  let done = 0
  for (const batch of batches) {
    try {
      const res = await fetch('https://api.records.guestpostlinks.net/v2/publisher/website/gpl/search-publishers', {
        method: 'POST',
        headers: { Authorization: GPL_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ websites: batch }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.success) {
          for (const site of data.data?.websites || []) {
            map.set(site.website.toLowerCase(), site)
          }
        }
      }
    } catch { /* skip failed batch */ }
    done += batch.length
    onProgress?.(done, domains.length)
  }

  return map
}

function getPrice(siteData, niche, clientType) {
  if (!siteData?.vendors) return ''
  const vendor = siteData.vendors.find(v => v.is_primary && !v.is_disable)
               ?? siteData.vendors.find(v => !v.is_disable)
               ?? siteData.vendors[0]
  if (!vendor?.addons) return ''
  const addon = vendor.addons.find(a => a.label === niche.toLowerCase())
             ?? vendor.addons.find(a => a.label === 'general')
  if (!addon) return ''
  return clientType === 'buyer' ? (addon.buyer_price ?? '') : (addon.reseller_price ?? '')
}

// ── Row builders ──────────────────────────────────────────

function buildDataRow(domain, siteData, niche, clientType) {
  const row = Array(NUM_COLS).fill('')
  row[C.DOMAIN] = domain
  if (siteData) {
    row[C.PRICE]              = getPrice(siteData, niche, clientType)
    row[C.BACKLINKS]          = siteData.backlinks ?? ''
    row[C.LINK_TYPE]          = siteData.link_type ?? ''
    row[C.LINK_VALIDITY]      = siteData.link_validity ?? ''
    row[C.PRIMARY_LANGUAGE]   = siteData.primary_language ?? ''
    row[C.ARTICLE_LENGTH_MIN] = siteData.article_min_length ?? ''
    row[C.RULES]              = siteData.rules ?? ''
  }
  return row
}

function buildSummaryRows(dataRows, client) {
  const prices = dataRows.map(r => Number(r[C.PRICE])).filter(p => !isNaN(p) && p > 0)
  const articlePub    = Math.round(prices.reduce((s, p) => s + p, 0) * 100) / 100
  const domainCount   = dataRows.filter(r => r[C.DOMAIN]).length
  const articleCost   = parseFloat(client.article_cost) || 0
  const writingService = Math.round(domainCount * articleCost * 100) / 100
  const total          = Math.round((articlePub + writingService) * 100) / 100
  const discount       = parseFloat(client.permanent_discount) || 0

  const blank = () => Array(NUM_COLS).fill('')
  const pub   = blank(); pub[C.DOMAIN]  = 'Article Publication'; pub[C.PRICE]  = articlePub
  const writ  = blank(); writ[C.DOMAIN] = 'Writing Service';      writ[C.PRICE] = writingService
  const tot   = blank(); tot[C.DOMAIN]  = 'Total';                tot[C.PRICE]  = total

  const rows = [blank(), blank(), blank(), pub, writ, tot]

  if (discount > 0) {
    const discounted = Math.round(total * (1 - discount / 100) * 100) / 100
    const disc = blank(); disc[C.DOMAIN] = `After ${discount}% discount`; disc[C.PRICE] = discounted
    rows.push(disc)
  }

  return rows
}

// ── Mode A: create new sub-sheet tab ─────────────────────

export async function createOrderSheet(client, niche, domains, onProgress) {
  const spreadsheetId = extractSheetId(client.order_sheet_url)
  if (!spreadsheetId) throw new Error('Client record has no valid order sheet URL')

  onProgress?.(`Fetching publisher data for ${domains.length} domains…`)
  const gplMap = await fetchGplData(domains, (done, total) => {
    onProgress?.(`Fetching publisher data… ${done}/${total}`)
  })

  const d = new Date()
  const sheetTitle = `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

  onProgress?.('Creating sheet tab…')
  await addSheetTab(spreadsheetId, sheetTitle)

  const dataRows   = domains.map(dom => buildDataRow(dom, gplMap.get(dom), niche, client.client_type))
  const summaryRows = buildSummaryRows(dataRows, client)
  const allRows    = [HEADERS, ...dataRows, ...summaryRows]

  onProgress?.('Writing data…')
  await writeRangeValues(spreadsheetId, `'${sheetTitle}'!A1:T${allRows.length}`, allRows)

  return {
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetTitle,
    total: domains.length,
    found: domains.filter(dom => gplMap.has(dom)).length,
  }
}

// ── Mode B: fill existing sub-sheet from URL ─────────────

const API_COLS = [
  { header: 'Price',              idx: C.PRICE },
  { header: 'No. Backlinks',      idx: C.BACKLINKS },
  { header: 'Link Type',          idx: C.LINK_TYPE },
  { header: 'Link Validity',      idx: C.LINK_VALIDITY },
  { header: 'Primary Language',   idx: C.PRIMARY_LANGUAGE },
  { header: 'Article Length Min', idx: C.ARTICLE_LENGTH_MIN },
  { header: 'Rules',              idx: C.RULES },
]

export async function fillOrderSheet(client, niche, subSheetUrl, onProgress) {
  const spreadsheetId = extractSheetId(subSheetUrl)
  if (!spreadsheetId) throw new Error('Invalid sheet URL')

  const gid = subSheetUrl.match(/[#&?]gid=(\d+)/)?.[1]

  onProgress?.('Reading sheet…')
  const tabs = await getSheetTabs(spreadsheetId)
  const sheetName = (gid ? tabs.find(t => String(t.sheetId) === gid)?.name : null) ?? tabs[0]?.name
  if (!sheetName) throw new Error('Sheet not found')

  const rows = await getSheetRows(spreadsheetId, sheetName)

  const headerRowIdx = rows.findIndex(row =>
    row.some(cell => String(cell).trim() === 'Domain')
  )
  if (headerRowIdx === -1) throw new Error('No "Domain" column found in sheet')

  const headerRow = rows[headerRowIdx]
  const colMap = {}
  headerRow.forEach((h, i) => { colMap[String(h).trim()] = i })
  const domainColIdx = colMap['Domain'] ?? C.DOMAIN

  const dataRowsRaw = rows.slice(headerRowIdx + 1).filter(r => String(r[domainColIdx] || '').trim())
  if (!dataRowsRaw.length) throw new Error('No domains found in sheet')

  const domains = dataRowsRaw.map(r => cleanDomain(String(r[domainColIdx] || '')))

  onProgress?.(`Fetching publisher data for ${domains.length} domains…`)
  const gplMap = await fetchGplData(domains, (done, total) => {
    onProgress?.(`Fetching publisher data… ${done}/${total}`)
  })

  onProgress?.('Writing data…')
  const valueRanges = []

  dataRowsRaw.forEach((rawRow, i) => {
    const domain = cleanDomain(String(rawRow[domainColIdx] || ''))
    const siteData = gplMap.get(domain)
    if (!siteData) return
    const dataRow   = buildDataRow(domain, siteData, niche, client.client_type)
    const sheetRow  = headerRowIdx + 2 + i // 1-indexed

    for (const { header, idx } of API_COLS) {
      const colIdx = colMap[header] ?? idx
      valueRanges.push({
        range: `'${sheetName}'!${String.fromCharCode(65 + colIdx)}${sheetRow}`,
        values: [[dataRow[idx]]],
      })
    }
  })

  // Summary
  const freshDataRows  = dataRowsRaw.map(r => buildDataRow(cleanDomain(String(r[domainColIdx] || '')), gplMap.get(cleanDomain(String(r[domainColIdx] || ''))), niche, client.client_type))
  const summaryRows    = buildSummaryRows(freshDataRows, client)
  const lastDataRow    = headerRowIdx + 1 + dataRowsRaw.length // 1-indexed
  const domCol  = String.fromCharCode(65 + (colMap['Domain'] ?? C.DOMAIN))
  const priceCol = String.fromCharCode(65 + (colMap['Price']  ?? C.PRICE))

  summaryRows.forEach((row, i) => {
    if (!row[C.DOMAIN]) return // skip blank rows
    const sheetRow = lastDataRow + 1 + i
    valueRanges.push({ range: `'${sheetName}'!${domCol}${sheetRow}`, values: [[row[C.DOMAIN]]] })
    valueRanges.push({ range: `'${sheetName}'!${priceCol}${sheetRow}`, values: [[row[C.PRICE]]] })
  })

  if (valueRanges.length) await batchWriteRangeValues(spreadsheetId, valueRanges)

  return {
    sheetUrl: subSheetUrl,
    sheetTitle: sheetName,
    total: domains.length,
    found: domains.filter(d => gplMap.has(d)).length,
  }
}
