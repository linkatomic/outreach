import { batchWriteRangeValues, batchFormatSheet } from './sheetParserAPI.js'

// ── Palette ───────────────────────────────────────────────
const C = {
  headerBg:    { red: 0.118, green: 0.118, blue: 0.149 },   // near-black header
  white:       { red: 1,     green: 1,     blue: 1     },
  green:       { red: 0.133, green: 0.545, blue: 0.133 },   // YES text
  red:         { red: 0.75,  green: 0.133, blue: 0.133 },   // NO text
  amber:       { red: 0.60,  green: 0.40,  blue: 0.00  },   // other-only text
  greenRowBg:  { red: 0.878, green: 0.957, blue: 0.878 },
  amberRowBg:  { red: 1.0,   green: 0.949, blue: 0.800 },
  redRowBg:    { red: 0.988, green: 0.882, blue: 0.882 },
  checkGreen:  { red: 0.133, green: 0.545, blue: 0.133 },
  dashGray:    { red: 0.70,  green: 0.70,  blue: 0.70  },
  summGreen:   { red: 0.878, green: 0.957, blue: 0.878 },
  summAmber:   { red: 1.0,   green: 0.949, blue: 0.800 },
  summRed:     { red: 0.988, green: 0.882, blue: 0.882 },
  accentBg:    { red: 0.18,  green: 0.18,  blue: 0.22  },   // summary section header
  lightGray:   { red: 0.96,  green: 0.96,  blue: 0.96  },
}

// Page types (must match API PAGE_CONFIGS order)
const PAGE_TYPES = ['Home', 'Contact', 'About', 'Privacy']

// ── Column layout — Main sheet ────────────────────────────
// A:Domain  B:Found?  C:Home  D:Contact  E:About  F:Privacy  G:#Pages  H:OtherEmails  I:URL
const MAIN_COLS   = ['Domain', 'Email Found?', 'Home', 'Contact', 'About', 'Privacy', '# Pages', 'Other Emails', 'Checked URL']
const MAIN_WIDTHS = [200,       110,            68,     80,         68,      72,         72,         340,            260]
const N_MAIN      = MAIN_COLS.length

// ── Column layout — Other Emails sheet ───────────────────
const OTHER_COLS   = ['Domain', 'Other Emails (comma-separated)']
const OTHER_WIDTHS = [200, 600]

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

// ── Create spreadsheet ────────────────────────────────────
async function createSpreadsheet(title) {
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

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Summary',      index: 0 } },
        { properties: { title: 'Email Check',  index: 1 } },
        { properties: { title: 'Other Emails', index: 2 } },
      ],
    }),
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
    summId:  created.sheets[0].properties.sheetId,
    mainId:  created.sheets[1].properties.sheetId,
    otherId: created.sheets[2].properties.sheetId,
  }
}

// ── Build summary sheet values ────────────────────────────
function buildSummaryValues(targetEmail, results, dateStr) {
  const done      = results.filter(r => r.status !== 'pending')
  const found     = done.filter(r => r.hasTarget)
  const notFound  = done.filter(r => !r.hasTarget && !r.error)
  const withOther = done.filter(r => !r.hasTarget && (r.allEmails?.length || 0) > 0)
  const errors    = done.filter(r => r.error)
  const total     = done.length
  const pct       = total ? Math.round((found.length / total) * 100) : 0

  const rows = [
    // Title row (merged visually by spanning content)
    ['EMAIL VERIFICATION REPORT', '', '', ''],
    ['', '', '', ''],
    ['Target Email',   targetEmail,              '', ''],
    ['Check Date',     dateStr,                  '', ''],
    ['Total Sites',    total,                    '', ''],
    ['', '', '', ''],
    // Stats header
    ['Metric',         'Count',   'Percentage',  ''],
    ['✓ Email Found',  found.length,   `${pct}%`,            ''],
    ['✗ Not Found',    notFound.length, `${total ? Math.round((notFound.length/total)*100) : 0}%`, ''],
    ['⚠ Other Emails', withOther.length, `${total ? Math.round((withOther.length/total)*100) : 0}%`, ''],
    ['⚡ Errors',      errors.length,   `${total ? Math.round((errors.length/total)*100) : 0}%`,  ''],
    ['', '', '', ''],
    // Confirmed list
    ['CONFIRMED DOMAINS', '', '', ''],
    ...found.map(r => [r.domain, '', '', '']),
    ['', '', '', ''],
    // Potential issues
    ['DOMAINS WITH OTHER EMAILS', '', '', ''],
    ...withOther.map(r => [r.domain, (r.allEmails || []).filter(e => e !== targetEmail.toLowerCase()).join(', '), '', '']),
  ]
  return rows
}

// ── Format summary sheet ──────────────────────────────────
function buildSummaryFmt(summId, targetEmail, results, dateStr) {
  const done      = results.filter(r => r.status !== 'pending')
  const found     = done.filter(r => r.hasTarget)
  const withOther = done.filter(r => !r.hasTarget && (r.allEmails?.length || 0) > 0)

  const reqs = [
    // Title row — big dark header
    rowFmt(summId, 0, 4, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 14 }, verticalAlignment: 'MIDDLE' }),
    rowH(summId, 0, 1, 48),
    // Freeze nothing on summary — it's a dashboard

    // Row 2 blank spacer
    rowH(summId, 1, 2, 12),

    // Metadata rows (2–4): label in col A bold, value in col B
    cell(summId, 2, 0, { textFormat: { bold: true, fontSize: 11 }, horizontalAlignment: 'RIGHT' }),
    cell(summId, 3, 0, { textFormat: { bold: true, fontSize: 11 }, horizontalAlignment: 'RIGHT' }),
    cell(summId, 4, 0, { textFormat: { bold: true, fontSize: 11 }, horizontalAlignment: 'RIGHT' }),

    // Blank spacer row 5
    rowH(summId, 5, 6, 12),

    // Stats header row (6)
    rowFmt(summId, 6, 4, { backgroundColor: C.accentBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }),
    rowH(summId, 6, 7, 32),

    // ✓ found row (7) — green
    rowFmt(summId, 7, 4, { backgroundColor: C.summGreen, textFormat: { bold: true, foregroundColor: C.green } }),
    // ✗ not found row (8) — red
    rowFmt(summId, 8, 4, { backgroundColor: C.summRed, textFormat: { bold: true, foregroundColor: C.red } }),
    // ⚠ other row (9) — amber
    rowFmt(summId, 9, 4, { backgroundColor: C.summAmber, textFormat: { bold: false, foregroundColor: C.amber } }),

    // Spacer row 11
    rowH(summId, 11, 12, 12),

    // "CONFIRMED DOMAINS" section header (row 12)
    rowFmt(summId, 12, 4, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 } }),
    rowH(summId, 12, 13, 28),

    // Column widths for summary
    colW(summId, 0, 220),
    colW(summId, 1, 340),
    colW(summId, 2, 110),
    colW(summId, 3, 110),
  ]

  // Confirmed domain rows (green bg)
  const confStart = 13
  found.forEach((_, i) => {
    reqs.push(rowFmt(summId, confStart + i, 4, { backgroundColor: C.summGreen }))
  })

  // "DOMAINS WITH OTHER EMAILS" section header
  const withOtherHeaderRow = confStart + found.length + 1
  reqs.push(rowFmt(summId, withOtherHeaderRow, 4, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 } }))
  reqs.push(rowH(summId, withOtherHeaderRow, withOtherHeaderRow + 1, 28))

  // Other-email domain rows (amber bg)
  withOther.forEach((_, i) => {
    reqs.push(rowFmt(summId, withOtherHeaderRow + 1 + i, 4, { backgroundColor: C.summAmber }))
  })

  return reqs
}

// ── Format main sheet ─────────────────────────────────────
function buildMainFmt(mainId, results) {
  const done = results.filter(r => r.status !== 'pending')
  const N    = done.length

  const reqs = [
    // Freeze header
    { updateSheetProperties: { properties: { sheetId: mainId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },

    // Header row
    {
      repeatCell: {
        range: rc(mainId, 0, 1, 0, N_MAIN),
        cell: { userEnteredFormat: { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    rowH(mainId, 0, 1, 36),

    // All data rows: center + middle + clip
    {
      repeatCell: {
        range: rc(mainId, 1, N + 1, 0, N_MAIN),
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },

    // Domain col: left-align
    { repeatCell: { range: rc(mainId, 0, N + 1, 0, 1), cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },

    // Other Emails col: left-align + wrap
    { repeatCell: { range: rc(mainId, 1, N + 1, 7, 8), cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy)' } },

    // Column widths
    ...MAIN_WIDTHS.map((px, i) => colW(mainId, i, px)),
  ]

  // Per-row formatting
  done.forEach((r, di) => {
    const ri  = di + 1
    const bg  = r.hasTarget ? C.greenRowBg : r.error ? C.lightGray : (r.allEmails?.length ? C.amberRowBg : C.redRowBg)

    // Row background
    reqs.push(rowFmt(mainId, ri, N_MAIN, { backgroundColor: bg }))

    // "Email Found?" cell — bold coloured text
    const fg = r.hasTarget ? C.green : r.error ? C.amber : C.red
    reqs.push(cell(mainId, ri, 1, { textFormat: { bold: true, foregroundColor: fg } }))

    // Per-page checkmark cells (cols 2–5) — color the text
    PAGE_TYPES.forEach((type, pi) => {
      const page = (r.pages || []).find(p => p.type === type)
      const colIdx = 2 + pi
      if (page?.hasTarget) {
        reqs.push(cell(mainId, ri, colIdx, { textFormat: { bold: true, foregroundColor: C.checkGreen } }))
      } else if (!page?.fetched) {
        reqs.push(cell(mainId, ri, colIdx, { textFormat: { foregroundColor: C.dashGray } }))
      }
    })
  })

  return reqs
}

// ── Format other-emails sheet ─────────────────────────────
function buildOtherFmt(otherId, othersCount) {
  const reqs = [
    { updateSheetProperties: { properties: { sheetId: otherId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    {
      repeatCell: {
        range: rc(otherId, 0, 1, 0, 2),
        cell: { userEnteredFormat: { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    rowH(otherId, 0, 1, 36),
    { repeatCell: { range: rc(otherId, 0, othersCount + 1, 0, 1), cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat.horizontalAlignment' } },
    { repeatCell: { range: rc(otherId, 0, othersCount + 1, 1, 2), cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy)' } },
    colW(otherId, 0, 200),
    colW(otherId, 1, 600),
  ]
  // Alternate row shading
  for (let i = 0; i < othersCount; i++) {
    if (i % 2 === 1) reqs.push(rowFmt(otherId, i + 1, 2, { backgroundColor: C.lightGray }))
  }
  return reqs
}

// ── Public entry point ────────────────────────────────────
export async function buildEmailCheckerSheet(targetEmail, results, onProgress) {
  onProgress?.('Creating spreadsheet…')

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const isoDate = now.toISOString().slice(0, 10)
  const title   = `Email Check · ${targetEmail} · ${isoDate}`
  const target  = targetEmail.trim().toLowerCase()

  const { spreadsheetId, summId, mainId, otherId } = await createSpreadsheet(title)

  onProgress?.('Writing data…')

  // ── Main sheet rows ───────────────────────────────────
  const done     = results.filter(r => r.status !== 'pending')
  const mainRows = [MAIN_COLS]

  for (const r of done) {
    const pageMap = Object.fromEntries((r.pages || []).map(p => [p.type, p]))
    const pageCells = PAGE_TYPES.map(type => {
      const p = pageMap[type]
      if (!p) return '—'
      if (p.hasTarget) return '✓'
      if (!p.fetched) return '—'
      return p.emails.length ? '·' : '○'
    })
    const matchCount  = PAGE_TYPES.filter(t => pageMap[t]?.hasTarget).length
    const otherEmails = (r.allEmails || []).filter(e => e !== target).join(', ') || '—'

    mainRows.push([
      r.domain,
      r.error ? 'Error' : r.hasTarget ? 'YES' : 'NO',
      ...pageCells,
      r.hasTarget ? matchCount : '—',
      otherEmails,
      `https://${r.domain}`,
    ])
  }

  // ── Other Emails sheet rows ───────────────────────────
  const otherRows = [OTHER_COLS]
  for (const r of done) {
    const others = (r.allEmails || []).filter(e => e !== target)
    if (others.length) otherRows.push([r.domain, others.join(', ')])
  }

  // ── Summary sheet rows ────────────────────────────────
  const summRows = buildSummaryValues(target, results, dateStr)

  await batchWriteRangeValues(spreadsheetId, [
    { range: `'Summary'!A1`,      values: summRows  },
    { range: `'Email Check'!A1`,  values: mainRows  },
    { range: `'Other Emails'!A1`, values: otherRows },
  ])

  onProgress?.('Formatting…')

  const allFmt = [
    ...buildSummaryFmt(summId, target, results, dateStr),
    ...buildMainFmt(mainId, results),
    ...buildOtherFmt(otherId, otherRows.length - 1),
  ]

  await batchFormatSheet(spreadsheetId, allFmt)

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}
