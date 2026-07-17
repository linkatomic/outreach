import { batchWriteRangeValues, batchFormatSheet } from './sheetParserAPI.js'

// ── Palette ───────────────────────────────────────────────
const C = {
  headerBg:    { red: 0.118, green: 0.118, blue: 0.149 },
  white:       { red: 1, green: 1, blue: 1 },
  accentBg:    { red: 0.18,  green: 0.18,  blue: 0.22  },
  hasEmailBg:  { red: 0.878, green: 0.957, blue: 0.878 },
  noEmailBg:   { red: 0.96,  green: 0.96,  blue: 0.96  },
  errorBg:     { red: 0.988, green: 0.882, blue: 0.882 },
  richBg:      { red: 0.820, green: 0.940, blue: 0.820 },
  statBlueBg:  { red: 0.878, green: 0.918, blue: 0.980 },
  statGreenBg: { red: 0.878, green: 0.957, blue: 0.878 },
  statPurpleBg:{ red: 0.929, green: 0.878, blue: 0.980 },
  statAmberBg: { red: 1.0,   green: 0.949, blue: 0.800 },
  green:       { red: 0.133, green: 0.545, blue: 0.133 },
  blue:        { red: 0.133, green: 0.333, blue: 0.700 },
  purple:      { red: 0.467, green: 0.133, blue: 0.700 },
  amber:       { red: 0.60,  green: 0.40,  blue: 0.00  },
  red:         { red: 0.75,  green: 0.133, blue: 0.133 },
  gray:        { red: 0.50,  green: 0.50,  blue: 0.50  },
  lightGray:   { red: 0.96,  green: 0.96,  blue: 0.96  },
  midGray:     { red: 0.88,  green: 0.88,  blue: 0.88  },
  topEmailBg:  { red: 0.133, green: 0.353, blue: 0.133 },  // deep green for top-email tab headers
}

const PAGE_TYPES = ['Home', 'Contact', 'About', 'Privacy']

// ── Helpers ───────────────────────────────────────────────
function rc(sheetId, r0, r1, c0, c1) {
  return { sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }
}
function colW(sheetId, ci, px) {
  return { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: ci, endIndex: ci + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }
}
function rowH(sheetId, r0, r1, px) {
  return { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: r0, endIndex: r1 }, properties: { pixelSize: px }, fields: 'pixelSize' } }
}
function cell(sheetId, r, c, fmt) {
  return { repeatCell: { range: rc(sheetId, r, r + 1, c, c + 1), cell: { userEnteredFormat: fmt }, fields: `userEnteredFormat(${Object.keys(fmt).join(',')})` } }
}
function rowFmt(sheetId, ri, nCols, fmt) {
  return { repeatCell: { range: rc(sheetId, ri, ri + 1, 0, nCols), cell: { userEnteredFormat: fmt }, fields: `userEnteredFormat(${Object.keys(fmt).join(',')})` } }
}
function rangeFmt(sheetId, r0, r1, c0, c1, fmt) {
  return { repeatCell: { range: rc(sheetId, r0, r1, c0, c1), cell: { userEnteredFormat: fmt }, fields: `userEnteredFormat(${Object.keys(fmt).join(',')})` } }
}

// ── Cross-site email frequency ────────────────────────────
function computeEmailFrequency(results) {
  const freq = {}
  for (const r of results.filter(x => x.status !== 'pending')) {
    for (const email of (r.allEmails || [])) {
      freq[email] = (freq[email] || 0) + 1
    }
  }
  return freq
}

// ── Email prefix helpers (used by flat sheet) ─────────────
const PREFIX_CATEGORIES = {
  contact:   ['info', 'contact', 'hello', 'hi', 'hey', 'team', 'mail', 'email', 'enquiries', 'enquiry', 'general'],
  support:   ['support', 'help', 'service', 'care', 'assist', 'helpdesk', 'customerservice', 'customer'],
  sales:     ['sales', 'business', 'advertising', 'ads', 'media', 'partnerships', 'collab', 'collaborate', 'marketing', 'pr', 'press', 'sponsorship', 'partner', 'bd'],
  editorial: ['editor', 'editorial', 'content', 'writer', 'contribute', 'submission', 'submit', 'write', 'contributors', 'blog'],
  admin:     ['admin', 'webmaster', 'noreply', 'no-reply', 'donotreply', 'postmaster', 'root', 'hostmaster'],
}
function getEmailPrefix(email) { return email.split('@')[0].toLowerCase() }
function getPrefixCategory(prefix) {
  for (const [cat, keys] of Object.entries(PREFIX_CATEGORIES)) {
    if (keys.some(k => prefix === k || prefix.startsWith(k))) return cat
  }
  return 'personal'
}

// ── Create spreadsheet ────────────────────────────────────
async function createSpreadsheet(title, extraSheetNames = []) {
  const CLIENT_ID     = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
  const REFRESH_TOKEN = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN

  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token' }),
  })
  const tokData = await tokRes.json()
  if (!tokRes.ok || tokData.error) throw new Error(`Auth failed: ${tokData.error_description || tokData.error}`)
  const token = tokData.access_token

  const baseSheets = [
    { properties: { title: 'Dashboard',       index: 0 } },
    { properties: { title: 'Email Directory', index: 1 } },
    { properties: { title: 'All Emails',      index: 2 } },
  ]
  const topSheets = extraSheetNames.map((name, i) => ({
    properties: { title: name, index: 3 + i },
  }))

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title }, sheets: [...baseSheets, ...topSheets] }),
  })
  const created = await createRes.json()
  if (!createRes.ok || created.error) throw new Error(`Sheet create failed: ${created.error?.message}`)

  await fetch(`https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  })

  return {
    spreadsheetId: created.spreadsheetId,
    dashId: created.sheets[0].properties.sheetId,
    dirId:  created.sheets[1].properties.sheetId,
    flatId: created.sheets[2].properties.sheetId,
    topIds: created.sheets.slice(3).map(s => s.properties.sheetId),
  }
}

// ── Dashboard values ──────────────────────────────────────
function buildDashboardValues(results, dateStr, freq) {
  const done       = results.filter(r => r.status !== 'pending')
  const withEmails = done.filter(r => (r.allEmails?.length || 0) > 0)
  const noEmails   = done.filter(r => !r.error && (r.allEmails?.length || 0) === 0)
  const errors     = done.filter(r => r.error)
  const allFlat    = done.flatMap(r => r.allEmails || [])
  const totalUniq  = [...new Set(allFlat)].length
  const avg        = withEmails.length ? (totalUniq / withEmails.length).toFixed(1) : '0'

  const crossSiteEmails = Object.entries(freq || {})
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)

  const rows = []

  // Row 0: title
  rows.push(['EMAIL HARVEST REPORT', '', '', '', ''])
  // Row 1: subtitle
  rows.push([`Generated: ${dateStr}`, '', `Sites scanned: ${done.length}`, '', ''])
  // Row 2: spacer
  rows.push(['', '', '', '', ''])
  // Rows 3–6: stat boxes
  rows.push(['SITES SCANNED', '', 'SITES WITH EMAILS', '', 'TOTAL UNIQUE EMAILS'])
  rows.push([done.length, '', withEmails.length, '', totalUniq])
  rows.push(['AVG EMAILS / SITE', '', 'SITES WITH NO EMAILS', '', 'ERRORS'])
  rows.push([avg, '', noEmails.length, '', errors.length])
  // Row 7: spacer
  rows.push(['', '', '', '', ''])

  // Cross-site section (right after stat boxes)
  if (crossSiteEmails.length > 0) {
    rows.push(['EMAILS FOUND ACROSS MULTIPLE SITES', '', '', '', ''])
    rows.push(['Email Address', '# Sites', 'Domains Found On', '', ''])
    for (const [email, count] of crossSiteEmails) {
      const domains = done
        .filter(r => (r.allEmails || []).includes(email))
        .map(r => r.domain)
        .join(', ')
      rows.push([email, count, domains, '', ''])
    }
    rows.push(['', '', '', '', ''])
  }

  // No-emails section
  if (noEmails.length > 0) {
    rows.push(['SITES WITH NO EMAILS FOUND', '', '', '', ''])
    rows.push(['Domain', '', '', '', ''])
    for (const r of noEmails) {
      rows.push([r.domain, '', '', '', ''])
    }
    rows.push(['', '', '', '', ''])
  }

  // Errors section
  if (errors.length > 0) {
    rows.push(['UNREACHABLE SITES', '', '', '', ''])
    rows.push(['Domain', 'Error', '', '', ''])
    for (const r of errors) {
      rows.push([r.domain, r.error || 'Failed', '', '', ''])
    }
  }

  return {
    rows,
    withEmailsCount: withEmails.length,
    noEmailsCount:   noEmails.length,
    errorsCount:     errors.length,
    crossSiteCount:  crossSiteEmails.length,
  }
}

// ── Dashboard formatting ──────────────────────────────────
function buildDashboardFmt(dashId, meta) {
  const { noEmailsCount, errorsCount, crossSiteCount } = meta
  const reqs = []

  // Row 0: big title
  reqs.push(rowFmt(dashId, 0, 5, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 15 }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE' }))
  reqs.push(rowH(dashId, 0, 1, 52))

  // Row 1: subtitle
  reqs.push(rowFmt(dashId, 1, 5, { backgroundColor: C.accentBg, textFormat: { foregroundColor: C.white, fontSize: 10 }, verticalAlignment: 'MIDDLE' }))
  reqs.push(rowH(dashId, 1, 2, 28))

  // Row 2: spacer
  reqs.push(rowH(dashId, 2, 3, 14))

  // Rows 3–6: stat boxes
  const statBoxes = [
    { bg: C.statBlueBg,   fg: C.blue   },
    { bg: C.statGreenBg,  fg: C.green  },
    { bg: C.statPurpleBg, fg: C.purple },
    { bg: C.statAmberBg,  fg: C.amber  },
  ]
  for (const ri of [3, 4, 5, 6]) {
    for (const ci of [0, 2, 4]) {
      const isValue = ri === 4 || ri === 6
      const boxIdx  = (ri <= 4 ? 0 : 2) + (ci === 0 ? 0 : ci === 2 ? 1 : 2)
      const box     = statBoxes[boxIdx % statBoxes.length]
      reqs.push(cell(dashId, ri, ci, {
        backgroundColor: box.bg,
        textFormat: { bold: true, foregroundColor: box.fg, fontSize: isValue ? 22 : 9 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'MIDDLE',
      }))
    }
    reqs.push(rowH(dashId, ri, ri + 1, ri === 4 || ri === 6 ? 44 : 28))
  }

  // Row 7: spacer
  reqs.push(rowH(dashId, 7, 8, 18))

  // Running row pointer
  let r = 8

  // Cross-site section
  if (crossSiteCount > 0) {
    // Section header
    reqs.push(rowFmt(dashId, r, 5, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 } }))
    reqs.push(rowH(dashId, r, r + 1, 30))
    r++
    // Column header
    reqs.push(rowFmt(dashId, r, 5, { backgroundColor: C.accentBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 9 }, horizontalAlignment: 'CENTER' }))
    r++
    // Data rows
    for (let i = 0; i < crossSiteCount; i++) {
      if (i % 2 === 1) reqs.push(rowFmt(dashId, r + i, 5, { backgroundColor: C.lightGray }))
      reqs.push(cell(dashId, r + i, 0, { textFormat: { fontFamily: 'Courier New', fontSize: 11 } }))
      reqs.push(cell(dashId, r + i, 1, { textFormat: { bold: true, fontSize: 14, foregroundColor: C.green }, horizontalAlignment: 'CENTER' }))
    }
    r += crossSiteCount + 1 // +1 for spacer
  }

  // No-emails section
  if (noEmailsCount > 0) {
    reqs.push(rowFmt(dashId, r, 5, { backgroundColor: C.accentBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 } }))
    reqs.push(rowH(dashId, r, r + 1, 28))
    r++ // column header row
    reqs.push(rowFmt(dashId, r, 5, { backgroundColor: C.accentBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 9 } }))
    r++
    for (let i = 0; i < noEmailsCount; i++) {
      reqs.push(rowFmt(dashId, r + i, 5, { backgroundColor: C.lightGray, textFormat: { foregroundColor: C.gray } }))
      reqs.push(cell(dashId, r + i, 0, { textFormat: { fontFamily: 'Courier New', fontSize: 11, foregroundColor: C.gray } }))
    }
    r += noEmailsCount + 1
  }

  // Errors section
  if (errorsCount > 0) {
    reqs.push(rowFmt(dashId, r, 5, { backgroundColor: C.errorBg, textFormat: { bold: true, foregroundColor: C.red, fontSize: 10 } }))
    reqs.push(rowH(dashId, r, r + 1, 28))
    r++ // column header row
    reqs.push(rowFmt(dashId, r, 5, { backgroundColor: C.errorBg, textFormat: { bold: true, foregroundColor: C.red, fontSize: 9 } }))
    r++
    for (let i = 0; i < errorsCount; i++) {
      reqs.push(rowFmt(dashId, r + i, 5, { backgroundColor: C.errorBg }))
    }
  }

  // Column widths
  reqs.push(colW(dashId, 0, 240))
  reqs.push(colW(dashId, 1, 80))
  reqs.push(colW(dashId, 2, 200))
  reqs.push(colW(dashId, 3, 80))
  reqs.push(colW(dashId, 4, 500))

  return reqs
}

// ── Top-email sub-sheet values ────────────────────────────
function buildTopEmailValues(email, count, domains) {
  return [
    [email,                                              '', ''],
    [`Found on ${count} site${count !== 1 ? 's' : ''}`, '', ''],
    ['',                                                 '', ''],
    ['Domain',                                           '', ''],
    ...domains.map(d => [d, '', '']),
  ]
}

function buildTopEmailFmt(sheetId, domainCount) {
  const reqs = []

  // Row 0: email header
  reqs.push(rowFmt(sheetId, 0, 3, { backgroundColor: C.topEmailBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 13, fontFamily: 'Courier New' }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE' }))
  reqs.push(rowH(sheetId, 0, 1, 46))

  // Row 1: site count subtitle
  reqs.push(rowFmt(sheetId, 1, 3, { backgroundColor: C.accentBg, textFormat: { foregroundColor: C.white, fontSize: 10 }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE' }))
  reqs.push(rowH(sheetId, 1, 2, 26))

  // Row 2: spacer
  reqs.push(rowH(sheetId, 2, 3, 14))

  // Row 3: column header
  reqs.push(rowFmt(sheetId, 3, 3, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 }, verticalAlignment: 'MIDDLE' }))
  reqs.push(rowH(sheetId, 3, 4, 30))

  // Domain data rows
  for (let i = 0; i < domainCount; i++) {
    if (i % 2 === 1) reqs.push(rowFmt(sheetId, 4 + i, 3, { backgroundColor: C.lightGray }))
    reqs.push(cell(sheetId, 4 + i, 0, { textFormat: { fontFamily: 'Courier New', fontSize: 12 }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE' }))
    reqs.push(rowH(sheetId, 4 + i, 5 + i, 26))
  }

  reqs.push(colW(sheetId, 0, 300))
  reqs.push(colW(sheetId, 1, 20))
  reqs.push(colW(sheetId, 2, 20))

  return reqs
}

// ── Email Directory (per-domain) ──────────────────────────
const DIR_COLS   = ['Domain', '# Emails', 'Home', 'Contact', 'About', 'Privacy', 'All Emails Found', 'Checked URL']
const DIR_WIDTHS = [200, 80, 70, 80, 70, 75, 420, 240]
const N_DIR      = DIR_COLS.length

function buildDirectoryValues(results) {
  const done = results.filter(r => r.status !== 'pending')
  const rows = [DIR_COLS]

  for (const r of done) {
    const pageMap  = Object.fromEntries((r.pages || []).map(p => [p.type, p]))
    const pageCells = PAGE_TYPES.map(type => {
      const p = pageMap[type]
      if (!p || !p.fetched) return '—'
      if (p.emails.length === 0) return '○'
      return p.emails.length === 1 ? '1 email' : `${p.emails.length} emails`
    })
    rows.push([
      r.domain,
      r.error ? 'Error' : (r.allEmails?.length || 0),
      ...pageCells,
      r.error ? r.error : (r.allEmails || []).join(', ') || '—',
      `https://${r.domain}`,
    ])
  }

  return rows
}

function buildDirectoryFmt(dirId, results) {
  const done = results.filter(r => r.status !== 'pending')
  const N    = done.length

  const reqs = [
    { updateSheetProperties: { properties: { sheetId: dirId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    {
      repeatCell: {
        range: rc(dirId, 0, 1, 0, N_DIR),
        cell: { userEnteredFormat: { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    rowH(dirId, 0, 1, 34),
    {
      repeatCell: {
        range: rc(dirId, 1, N + 1, 0, N_DIR),
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    rangeFmt(dirId, 0, N + 1, 0, 1, { horizontalAlignment: 'LEFT' }),
    rangeFmt(dirId, 1, N + 1, 6, 7, { horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' }),
    rangeFmt(dirId, 1, N + 1, 7, 8, { horizontalAlignment: 'LEFT' }),
    ...DIR_WIDTHS.map((px, i) => colW(dirId, i, px)),
  ]

  done.forEach((r, di) => {
    const ri    = di + 1
    const count = r.allEmails?.length || 0
    let bg = C.noEmailBg
    if (r.error)       bg = C.errorBg
    else if (count >= 5) bg = C.richBg
    else if (count > 0)  bg = C.hasEmailBg
    reqs.push(rowFmt(dirId, ri, N_DIR, { backgroundColor: bg }))

    if (!r.error) {
      const fg = count > 0 ? C.green : C.gray
      reqs.push(cell(dirId, ri, 1, { textFormat: { bold: true, foregroundColor: fg, fontSize: 13 } }))
    } else {
      reqs.push(cell(dirId, ri, 1, { textFormat: { bold: true, foregroundColor: C.red } }))
    }

    PAGE_TYPES.forEach((_, pi) => {
      const page = (r.pages || []).find(p => p.type === PAGE_TYPES[pi])
      if (!page?.fetched) {
        reqs.push(cell(dirId, ri, 2 + pi, { textFormat: { foregroundColor: C.gray } }))
      } else if (page.emails.length > 0) {
        reqs.push(cell(dirId, ri, 2 + pi, { textFormat: { bold: true, foregroundColor: C.green } }))
      }
    })
  })

  return reqs
}

// ── All Emails flat list ──────────────────────────────────
const FLAT_COLS   = ['#', 'Domain', 'Email Address', 'Prefix', 'Category', '# Sites', 'Pages Found On']
const FLAT_WIDTHS = [40, 190, 250, 130, 130, 65, 250]
const N_FLAT      = FLAT_COLS.length

function buildFlatValues(results, freq) {
  const done = results.filter(r => r.status !== 'pending')
  const rows = [FLAT_COLS]
  let rowNum = 0

  const sorted = [...done].sort((a, b) => (b.allEmails?.length || 0) - (a.allEmails?.length || 0))

  for (const r of sorted) {
    for (const email of (r.allEmails || [])) {
      rowNum++
      const prefix    = getEmailPrefix(email)
      const category  = getPrefixCategory(prefix)
      const catLabel  = category === 'contact'   ? 'Contact / General'
                      : category === 'sales'     ? 'Sales / Business'
                      : category === 'editorial' ? 'Editorial'
                      : category === 'support'   ? 'Support'
                      : category === 'admin'     ? 'Admin / System'
                      : 'Personal / Other'
      const siteCount = freq?.[email] || 1
      const foundOn   = (r.pages || []).filter(p => p.emails.includes(email)).map(p => p.type).join(', ')
      rows.push([rowNum, r.domain, email, prefix + '@', catLabel, siteCount, foundOn || '—'])
    }
  }

  return rows
}

function buildFlatFmt(flatId, totalEmailRows) {
  const reqs = [
    { updateSheetProperties: { properties: { sheetId: flatId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    {
      repeatCell: {
        range: rc(flatId, 0, 1, 0, N_FLAT),
        cell: { userEnteredFormat: { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    rowH(flatId, 0, 1, 34),
    {
      repeatCell: {
        range: rc(flatId, 1, totalEmailRows + 1, 0, N_FLAT),
        cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
      },
    },
    rangeFmt(flatId, 0, totalEmailRows + 1, 0, 1, { horizontalAlignment: 'CENTER', textFormat: { foregroundColor: C.gray, fontSize: 11 } }),
    rangeFmt(flatId, 1, totalEmailRows + 1, 2, 3, { horizontalAlignment: 'LEFT', textFormat: { fontFamily: 'Courier New', fontSize: 12 } }),
    rangeFmt(flatId, 1, totalEmailRows + 1, 1, 2, { horizontalAlignment: 'LEFT' }),
    rangeFmt(flatId, 1, totalEmailRows + 1, 3, 4, { horizontalAlignment: 'CENTER', textFormat: { fontFamily: 'Courier New', fontSize: 11, foregroundColor: C.blue } }),
    rangeFmt(flatId, 1, totalEmailRows + 1, 4, 5, { horizontalAlignment: 'CENTER' }),
    rangeFmt(flatId, 1, totalEmailRows + 1, 5, 6, { horizontalAlignment: 'CENTER', textFormat: { bold: true, fontSize: 12 } }),
    rangeFmt(flatId, 1, totalEmailRows + 1, 6, 7, { horizontalAlignment: 'LEFT', textFormat: { foregroundColor: C.gray, fontSize: 11 } }),
    ...FLAT_WIDTHS.map((px, i) => colW(flatId, i, px)),
  ]

  for (let i = 0; i < totalEmailRows; i++) {
    if (i % 2 === 1) reqs.push(rowFmt(flatId, i + 1, N_FLAT, { backgroundColor: C.lightGray }))
  }

  return reqs
}

// ── Public entry point ────────────────────────────────────
export async function buildEmailHarvesterSheet(results, onProgress) {
  onProgress?.('Creating spreadsheet…')

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const isoDate = now.toISOString().slice(0, 10)
  const title   = `Email Harvest · ${isoDate}`

  const freq = computeEmailFrequency(results)
  const done = results.filter(r => r.status !== 'pending')

  // Top 3 emails by cross-site frequency (must appear on 2+ domains)
  const top3 = Object.entries(freq)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([email, count]) => ({
      email,
      count,
      domains: done.filter(r => (r.allEmails || []).includes(email)).map(r => r.domain),
    }))

  // Tab names: use email address, truncated to 40 chars
  const topSheetNames = top3.map(t => t.email.length > 40 ? t.email.slice(0, 37) + '…' : t.email)

  const { spreadsheetId, dashId, dirId, flatId, topIds } =
    await createSpreadsheet(title, topSheetNames)

  onProgress?.('Analysing data…')

  const { rows: dashRows, ...dashMeta } = buildDashboardValues(results, dateStr, freq)
  const dirRows  = buildDirectoryValues(results)
  const flatRows = buildFlatValues(results, freq)

  onProgress?.('Writing data…')

  const rangeWrites = [
    { range: `'Dashboard'!A1`,       values: dashRows },
    { range: `'Email Directory'!A1`, values: dirRows  },
    { range: `'All Emails'!A1`,      values: flatRows },
    ...top3.map((t, i) => ({
      range:  `'${topSheetNames[i]}'!A1`,
      values: buildTopEmailValues(t.email, t.count, t.domains),
    })),
  ]

  await batchWriteRangeValues(spreadsheetId, rangeWrites)

  onProgress?.('Formatting…')

  const allFmt = [
    ...buildDashboardFmt(dashId, dashMeta),
    ...buildDirectoryFmt(dirId, results),
    ...buildFlatFmt(flatId, flatRows.length - 1),
    ...top3.flatMap((t, i) => buildTopEmailFmt(topIds[i], t.domains.length)),
  ]

  await batchFormatSheet(spreadsheetId, allFmt)

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}
