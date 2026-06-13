import {
  extractSheetId, getSheetTabs, getSheetRows, cleanDomain,
  addSheetTab, writeRangeValues, batchWriteRangeValues, batchFormatSheet,
} from './sheetParserAPI.js'

const GPL_TOKEN = import.meta.env.VITE_GPL_API_TOKEN

// ── Column layout ─────────────────────────────────────────

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
export const NUM_COLS = HEADERS.length // 20

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

const COL_WIDTHS = [
  80, 200, 90, 110, 120, 90, 130, 220, 130, 220, 130, 220,
  90, 110, 130, 140, 320, 200, 200, 150,
]

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
          for (const site of data.data?.websites || []) map.set(site.website.toLowerCase(), site)
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

export function parseDomainText(text) {
  return [...new Set(
    text.split(/[\n,]+/).map(d => cleanDomain(d.trim())).filter(Boolean)
  )]
}

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

export function buildSummaryRows(dataRows, client, includeWriting = true, discountPct = null) {
  const prices       = dataRows.map(r => Number(r[C.PRICE])).filter(p => !isNaN(p) && p > 0)
  const articlePub   = Math.round(prices.reduce((s, p) => s + p, 0) * 100) / 100
  const articleCost  = parseFloat(client.article_cost) || 0

  // Sites with article_min_length >= 1000 words are charged $15 regardless of client rate
  const LONG_ARTICLE_THRESHOLD = 1000
  const LONG_ARTICLE_COST      = 15
  const writingCost = includeWriting
    ? Math.round(
        dataRows
          .filter(r => r[C.DOMAIN])
          .reduce((sum, r) => {
            const minLen = parseInt(r[C.ARTICLE_LENGTH_MIN]) || 0
            return sum + (minLen >= LONG_ARTICLE_THRESHOLD ? LONG_ARTICLE_COST : articleCost)
          }, 0) * 100
      ) / 100
    : 0

  const discount = discountPct !== null ? discountPct : (parseFloat(client.permanent_discount) || 0)
  const total    = Math.round((articlePub + (includeWriting ? writingCost : 0)) * 100) / 100

  const blank = () => Array(NUM_COLS).fill('')
  const pub   = blank(); pub[C.DOMAIN] = 'Article Publication'; pub[C.PRICE] = articlePub

  const rows = [blank(), blank(), blank(), pub]

  if (includeWriting) {
    const writ = blank(); writ[C.DOMAIN] = 'Writing Service'; writ[C.PRICE] = writingCost
    rows.push(writ)
  }

  const tot = blank(); tot[C.DOMAIN] = 'Total'; tot[C.PRICE] = total
  rows.push(tot)

  if (discount > 0) {
    const discounted = Math.round(total * (1 - discount / 100) * 100) / 100
    const disc = blank(); disc[C.DOMAIN] = `After ${discount}% discount`; disc[C.PRICE] = discounted
    rows.push(disc)
  }

  return rows
}

// ── Sheet formatting ──────────────────────────────────────

async function formatOrderSheet(spreadsheetId, sheetId, dataRowCount, { hasWriting, hasDiscount, notFoundRows = [], nofollowRows = [] }) {
  const ORANGE   = { red: 0.953, green: 0.604, blue: 0.204 }
  const WHITE    = { red: 1, green: 1, blue: 1 }
  const AMBER    = { red: 1.0,  green: 0.937, blue: 0.835 }
  const LIME     = { red: 0.851, green: 0.918, blue: 0.827 }
  const NOT_FOUND_BG = { red: 0.99, green: 0.88, blue: 0.88 }  // light red — not in GPL
  const NOFOLLOW_BG  = { red: 1.0,  green: 0.95, blue: 0.80 }  // light amber — nofollow
  const LINE   = { style: 'SOLID', color: { red: 0.75, green: 0.75, blue: 0.75 } }
  const BOLD_LINE = { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }
  const CURR   = { type: 'CURRENCY', pattern: '"$"#,##0.00' }

  const N          = dataRowCount
  const artPubRow  = N + 4                              // 0-indexed: header=0, data=1..N, blank=N+1..N+3
  const writRow    = hasWriting ? artPubRow + 1 : -1
  const totalRow   = artPubRow + (hasWriting ? 2 : 1)
  const discRow    = hasDiscount ? totalRow + 1 : -1

  const rc = (startRow, endRow, startCol, endCol) => ({
    sheetId, startRowIndex: startRow, endRowIndex: endRow,
    startColumnIndex: startCol, endColumnIndex: endCol,
  })

  const requests = [
    // Freeze header
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },

    // Header: orange bg, white bold text, centered, wrapped
    {
      repeatCell: {
        range: rc(0, 1, 0, NUM_COLS),
        cell: { userEnteredFormat: {
          backgroundColor: ORANGE,
          textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP',
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },

    // Data rows: center, middle, clip
    {
      repeatCell: {
        range: rc(1, N + 1, 0, NUM_COLS),
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },

    // Left-align Domain (col 1)
    {
      repeatCell: {
        range: rc(0, N + 1, 1, 2),
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },

    // Rules (col 16): left-align, clip
    {
      repeatCell: {
        range: rc(1, N + 1, 16, 17),
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', wrapStrategy: 'CLIP' } },
        fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy)',
      },
    },

    // Price column: currency format
    {
      repeatCell: {
        range: rc(1, N + 1, 2, 3),
        cell: { userEnteredFormat: { numberFormat: CURR } },
        fields: 'userEnteredFormat.numberFormat',
      },
    },

    // Grid borders for header + data
    {
      updateBorders: {
        range: rc(0, N + 1, 0, NUM_COLS),
        top: LINE, bottom: LINE, left: LINE, right: LINE,
        innerHorizontal: LINE, innerVertical: LINE,
      },
    },

    // Header row height
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 42 }, fields: 'pixelSize' } },

    // Data rows: fixed height so long Rules text doesn't bloat rows
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: N + 1 }, properties: { pixelSize: 21 }, fields: 'pixelSize' } },

    // Article Publication row: bold + currency
    {
      repeatCell: {
        range: rc(artPubRow, artPubRow + 1, 1, 3),
        cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'LEFT', numberFormat: CURR } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,numberFormat)',
      },
    },

    // Total row: amber bg, bold, larger font, currency
    {
      repeatCell: {
        range: rc(totalRow, totalRow + 1, 1, 3),
        cell: { userEnteredFormat: {
          backgroundColor: AMBER,
          textFormat: { bold: true, fontSize: 11 },
          horizontalAlignment: 'LEFT',
          numberFormat: CURR,
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)',
      },
    },
    { updateBorders: { range: rc(totalRow, totalRow + 1, 1, 3), top: BOLD_LINE, bottom: BOLD_LINE, left: BOLD_LINE, right: BOLD_LINE, innerVertical: LINE } },
  ]

  // Writing Service row: bold + currency
  if (writRow >= 0) {
    requests.push({
      repeatCell: {
        range: rc(writRow, writRow + 1, 1, 3),
        cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'LEFT', numberFormat: CURR } },
        fields: 'userEnteredFormat(textFormat,horizontalAlignment,numberFormat)',
      },
    })
  }

  // Discount row: lime bg, bold, larger font, currency
  if (discRow >= 0) {
    requests.push({
      repeatCell: {
        range: rc(discRow, discRow + 1, 1, 3),
        cell: { userEnteredFormat: {
          backgroundColor: LIME,
          textFormat: { bold: true, fontSize: 11 },
          horizontalAlignment: 'LEFT',
          numberFormat: CURR,
        }},
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)',
      },
    })
    requests.push({ updateBorders: { range: rc(discRow, discRow + 1, 1, 3), top: BOLD_LINE, bottom: BOLD_LINE, left: BOLD_LINE, right: BOLD_LINE, innerVertical: LINE } })
  }

  // Column widths
  requests.push(...COL_WIDTHS.map((size, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize: size },
      fields: 'pixelSize',
    },
  })))

  // Row highlights — applied last so they override default backgrounds
  // data rows are 1-indexed in the sheet (header=row 0)
  for (const i of notFoundRows) {
    requests.push({
      repeatCell: {
        range: rc(i + 1, i + 2, 0, NUM_COLS),
        cell: { userEnteredFormat: { backgroundColor: NOT_FOUND_BG } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })
  }
  for (const i of nofollowRows) {
    requests.push({
      repeatCell: {
        range: rc(i + 1, i + 2, 0, NUM_COLS),
        cell: { userEnteredFormat: { backgroundColor: NOFOLLOW_BG } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })
  }

  return batchFormatSheet(spreadsheetId, requests)
}

// ── Unique tab name ───────────────────────────────────────

async function addSheetTabUnique(spreadsheetId, baseName) {
  let name = baseName
  for (let attempt = 2; attempt <= 20; attempt++) {
    try {
      const sheetId = await addSheetTab(spreadsheetId, name)
      return { sheetId, sheetTitle: name }
    } catch (err) {
      if (!err.message.includes('already exists')) throw err
      name = `${baseName} (${attempt})`
    }
  }
  throw new Error(`All tab names from "${baseName}" to "${baseName} (20)" already exist. Please rename or delete existing tabs.`)
}

// ── Mode A: create new sub-sheet tab ─────────────────────

export async function createOrderSheet(client, niche, domains, includeWriting = true, customName = null, discountPct = null, onProgress) {
  const spreadsheetId = extractSheetId(client.order_sheet_url)
  if (!spreadsheetId) throw new Error('Client record has no valid order sheet URL')

  onProgress?.(`Fetching publisher data for ${domains.length} domains…`)
  const gplMap = await fetchGplData(domains, (done, total) => {
    onProgress?.(`Fetching publisher data… ${done}/${total}`)
  })

  const d = new Date()
  const baseName = customName?.trim() || `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

  onProgress?.('Creating sheet tab…')
  const { sheetId, sheetTitle } = await addSheetTabUnique(spreadsheetId, baseName)

  const dataRows    = domains.map(dom => buildDataRow(dom, gplMap.get(dom), niche, client.client_type))
  const effectiveDiscount = discountPct !== null ? discountPct : (parseFloat(client.permanent_discount) || 0)
  const summaryRows = buildSummaryRows(dataRows, client, includeWriting, discountPct)
  const allRows     = [HEADERS, ...dataRows, ...summaryRows]

  // Determine highlight rows
  const notFoundRows = domains.map((dom, i) => gplMap.has(dom) ? -1 : i).filter(i => i >= 0)
  const nofollowRows = dataRows.map((r, i) => String(r[C.LINK_TYPE] || '').toLowerCase() === 'nofollow' ? i : -1).filter(i => i >= 0)

  onProgress?.('Writing data…')
  await writeRangeValues(spreadsheetId, `'${sheetTitle}'!A1:T${allRows.length}`, allRows)

  onProgress?.('Applying formatting…')
  await formatOrderSheet(spreadsheetId, sheetId, domains.length, {
    hasWriting: includeWriting,
    hasDiscount: effectiveDiscount > 0,
    notFoundRows,
    nofollowRows,
  })

  return {
    sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetTitle,
    total: domains.length,
    found: domains.filter(dom => gplMap.has(dom)).length,
  }
}

// ── Mode B: fill existing sub-sheet ──────────────────────

const API_COLS = [
  { header: 'Price',              idx: C.PRICE },
  { header: 'No. Backlinks',      idx: C.BACKLINKS },
  { header: 'Link Type',          idx: C.LINK_TYPE },
  { header: 'Link Validity',      idx: C.LINK_VALIDITY },
  { header: 'Primary Language',   idx: C.PRIMARY_LANGUAGE },
  { header: 'Article Length Min', idx: C.ARTICLE_LENGTH_MIN },
  { header: 'Rules',              idx: C.RULES },
]

export async function fillOrderSheet(client, niche, subSheetUrl, includeWriting = true, discountPct = null, onProgress) {
  const spreadsheetId = extractSheetId(subSheetUrl)
  if (!spreadsheetId) throw new Error('Invalid sheet URL')

  const gid = subSheetUrl.match(/[#&?]gid=(\d+)/)?.[1]

  onProgress?.('Reading sheet…')
  const tabs = await getSheetTabs(spreadsheetId)
  const tab  = (gid ? tabs.find(t => String(t.sheetId) === gid) : null) ?? tabs[0]
  if (!tab) throw new Error('Sheet not found')
  const { name: sheetName, sheetId } = tab

  const rows = await getSheetRows(spreadsheetId, sheetName)

  const headerRowIdx = rows.findIndex(row => row.some(cell => String(cell).trim() === 'Domain'))
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
    const domain   = cleanDomain(String(rawRow[domainColIdx] || ''))
    const siteData = gplMap.get(domain)
    if (!siteData) return
    const dataRow  = buildDataRow(domain, siteData, niche, client.client_type)
    const sheetRow = headerRowIdx + 2 + i // 1-indexed

    for (const { header, idx } of API_COLS) {
      const colIdx = colMap[header] ?? idx
      valueRanges.push({
        range: `'${sheetName}'!${String.fromCharCode(65 + colIdx)}${sheetRow}`,
        values: [[dataRow[idx]]],
      })
    }
  })

  // Summary section
  const freshDataRows  = dataRowsRaw.map(r => buildDataRow(cleanDomain(String(r[domainColIdx] || '')), gplMap.get(cleanDomain(String(r[domainColIdx] || ''))), niche, client.client_type))
  const summaryRows    = buildSummaryRows(freshDataRows, client, includeWriting, discountPct)

  // Determine highlight rows (relative to data start, 0-indexed)
  const fillNotFound = domains.map((dom, i) => gplMap.has(dom) ? -1 : i).filter(i => i >= 0)
  const fillNofollow = freshDataRows.map((r, i) => String(r[C.LINK_TYPE] || '').toLowerCase() === 'nofollow' ? i : -1).filter(i => i >= 0)
  // Convert to absolute sheet row indices (0-indexed, header = headerRowIdx)
  const absNotFound  = fillNotFound.map(i => headerRowIdx + 1 + i)
  const absNofollow  = fillNofollow.map(i => headerRowIdx + 1 + i)
  const lastDataRow    = headerRowIdx + 1 + dataRowsRaw.length // 1-indexed
  const domCol   = String.fromCharCode(65 + (colMap['Domain'] ?? C.DOMAIN))
  const priceCol = String.fromCharCode(65 + (colMap['Price']  ?? C.PRICE))

  summaryRows.forEach((row, i) => {
    if (!row[C.DOMAIN]) return
    const sheetRow = lastDataRow + 1 + i
    valueRanges.push({ range: `'${sheetName}'!${domCol}${sheetRow}`, values: [[row[C.DOMAIN]]] })
    valueRanges.push({ range: `'${sheetName}'!${priceCol}${sheetRow}`, values: [[row[C.PRICE]]] })
  })

  if (valueRanges.length) await batchWriteRangeValues(spreadsheetId, valueRanges)

  // Format summary section only
  onProgress?.('Applying formatting…')
  const effectiveDiscount = discountPct !== null ? discountPct : (parseFloat(client.permanent_discount) || 0)
  const artPubRow   = lastDataRow + 3  // 0-indexed (lastDataRow is 1-indexed, +3 blank rows)
  const writSvcRow  = includeWriting ? artPubRow + 1 : -1
  const totalRow    = artPubRow + (includeWriting ? 2 : 1)
  const discountRow = effectiveDiscount > 0 ? totalRow + 1 : -1

  const AMBER          = { red: 1.0,  green: 0.937, blue: 0.835 }
  const LIME           = { red: 0.851, green: 0.918, blue: 0.827 }
  const NOT_FOUND_BG   = { red: 0.99, green: 0.88, blue: 0.88 }
  const NOFOLLOW_BG    = { red: 1.0,  green: 0.95, blue: 0.80 }
  const LINE      = { style: 'SOLID', color: { red: 0.75, green: 0.75, blue: 0.75 } }
  const BOLD_LINE = { style: 'SOLID_MEDIUM', color: { red: 0.6, green: 0.6, blue: 0.6 } }
  const CURR      = { type: 'CURRENCY', pattern: '"$"#,##0.00' }
  const rc = (r1, r2, c1, c2) => ({ sheetId, startRowIndex: r1, endRowIndex: r2, startColumnIndex: c1, endColumnIndex: c2 })

  const domC   = colMap['Domain'] ?? C.DOMAIN
  const priceC = colMap['Price']  ?? C.PRICE

  const fmtRequests = [
    // Article Publication
    { repeatCell: { range: rc(artPubRow, artPubRow + 1, domC, priceC + 1), cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'LEFT', numberFormat: CURR } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment,numberFormat)' } },
    // Total
    { repeatCell: { range: rc(totalRow, totalRow + 1, domC, priceC + 1), cell: { userEnteredFormat: { backgroundColor: AMBER, textFormat: { bold: true, fontSize: 11 }, horizontalAlignment: 'LEFT', numberFormat: CURR } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)' } },
    { updateBorders: { range: rc(totalRow, totalRow + 1, domC, priceC + 1), top: BOLD_LINE, bottom: BOLD_LINE, left: BOLD_LINE, right: BOLD_LINE, innerVertical: LINE } },
  ]

  if (writSvcRow >= 0) {
    fmtRequests.push({ repeatCell: { range: rc(writSvcRow, writSvcRow + 1, domC, priceC + 1), cell: { userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'LEFT', numberFormat: CURR } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment,numberFormat)' } })
  }

  if (discountRow >= 0) {
    fmtRequests.push({ repeatCell: { range: rc(discountRow, discountRow + 1, domC, priceC + 1), cell: { userEnteredFormat: { backgroundColor: LIME, textFormat: { bold: true, fontSize: 11 }, horizontalAlignment: 'LEFT', numberFormat: CURR } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,numberFormat)' } })
    fmtRequests.push({ updateBorders: { range: rc(discountRow, discountRow + 1, domC, priceC + 1), top: BOLD_LINE, bottom: BOLD_LINE, left: BOLD_LINE, right: BOLD_LINE, innerVertical: LINE } })
  }

  // Row highlights for fillOrderSheet — applied over entire row width
  const fillTotalCols = Object.keys(colMap).length || NUM_COLS
  for (const rowIdx of absNotFound) {
    fmtRequests.push({ repeatCell: { range: rc(rowIdx, rowIdx + 1, 0, fillTotalCols), cell: { userEnteredFormat: { backgroundColor: NOT_FOUND_BG } }, fields: 'userEnteredFormat.backgroundColor' } })
  }
  for (const rowIdx of absNofollow) {
    fmtRequests.push({ repeatCell: { range: rc(rowIdx, rowIdx + 1, 0, fillTotalCols), cell: { userEnteredFormat: { backgroundColor: NOFOLLOW_BG } }, fields: 'userEnteredFormat.backgroundColor' } })
  }

  await batchFormatSheet(spreadsheetId, fmtRequests)

  return {
    sheetUrl: subSheetUrl,
    sheetTitle: sheetName,
    total: domains.length,
    found: domains.filter(d => gplMap.has(d)).length,
  }
}
