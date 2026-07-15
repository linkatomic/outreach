import {
  writeRangeValues, batchWriteRangeValues, batchFormatSheet, addSheetTab,
} from './sheetParserAPI.js'

// ── Colours ───────────────────────────────────────────────
const DARK_BG  = { red: 0.13, green: 0.13, blue: 0.16 }   // header bg (near-black)
const WHITE    = { red: 1,    green: 1,    blue: 1    }
const GREEN_BG = { red: 0.88, green: 0.96, blue: 0.89 }   // found
const AMBER_BG = { red: 1.0,  green: 0.95, blue: 0.80 }   // other emails only
const RED_BG   = { red: 0.99, green: 0.89, blue: 0.89 }   // not found at all
const GRAY_BG  = { red: 0.96, green: 0.96, blue: 0.96 }   // page not fetched
const GREEN_TXT = { red: 0.13, green: 0.55, blue: 0.13 }
const RED_TXT   = { red: 0.75, green: 0.13, blue: 0.13 }
const AMBER_TXT = { red: 0.60, green: 0.40, blue: 0.00 }

// ── Column layouts ────────────────────────────────────────
//  Main sheet: Domain | Found? | Pages | Other Emails | Checked Url
const MAIN_HEADERS = ['Domain', 'Email Found?', 'Pages Found On', 'Other Emails', 'Checked URL']
const MAIN_WIDTHS  = [220, 120, 180, 380, 300]

//  Sub sheet:  Domain | Other Emails
const SUB_HEADERS = ['Domain', 'Other Emails (comma-separated)']
const SUB_WIDTHS  = [220, 600]

// ── Helpers ───────────────────────────────────────────────
function rc(sheetId, r0, r1, c0, c1) {
  return { sheetId, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }
}

function colWidthReq(sheetId, colIdx, px) {
  return {
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: colIdx, endIndex: colIdx + 1 },
      properties: { pixelSize: px },
      fields: 'pixelSize',
    },
  }
}

async function createSpreadsheet(title) {
  const token = await import('./sheetParserAPI.js').then(m => m.getToken?.() ?? Promise.reject('no getToken'))
    .catch(async () => {
      // getToken is not exported; access it indirectly by calling a dummy op
      // Instead, piggyback on writeRangeValues after creation
      return null
    })

  // Create via fetch directly using the refresh-token helper exported by sheetParserAPI
  // We can't call gsheets() directly, so we create the sheet via writeRangeValues which
  // calls getToken internally — first we need a spreadsheetId.
  // Use the Sheets API v4 create endpoint via our own fetch-with-token.
  // Since we can't call getToken externally, we'll use createOutputSheet's pattern:
  // write dummy data first to trigger token acquisition, then batchUpdate.
  // Simpler: import the private function via dynamic injection... not possible.
  // Cleanest solution: expose a createBlankSpreadsheet helper in sheetParserAPI and call it.
  // For now, use XMLHttpRequest workaround: call addSheetTab on a known sheet to get token,
  // or just call batchFormatSheet with an empty request to get the token flowing.
  // → Actually the cleanest thing: use the Vite env vars directly here.
  const CLIENT_ID     = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
  const REFRESH_TOKEN = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN

  // Get access token
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token' }),
  })
  const tokData = await tokRes.json()
  if (!tokRes.ok || tokData.error) throw new Error(`Auth failed: ${tokData.error_description || tokData.error}`)
  const accessToken = tokData.access_token

  // Create spreadsheet with two empty sheets
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Email Check', index: 0 } },
        { properties: { title: 'Other Emails', index: 1 } },
      ],
    }),
  })
  const created = await createRes.json()
  if (!createRes.ok || created.error) throw new Error(`Sheet create failed: ${created.error?.message}`)

  const spreadsheetId = created.spreadsheetId
  const mainSheetId   = created.sheets[0].properties.sheetId
  const subSheetId    = created.sheets[1].properties.sheetId

  // Share with anyone (editor)
  await fetch(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  })

  return { spreadsheetId, mainSheetId, subSheetId, accessToken }
}

// ── Public API ────────────────────────────────────────────

export async function buildEmailCheckerSheet(targetEmail, results, onProgress) {
  onProgress?.('Creating spreadsheet…')

  const now   = new Date()
  const label = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const title = `Email Check · ${targetEmail} · ${label}`

  const { spreadsheetId, mainSheetId, subSheetId } = await createSpreadsheet(title)

  onProgress?.('Writing data…')

  // ── Build main sheet rows ────────────────────────────────
  const mainRows = [MAIN_HEADERS]
  const rowMeta  = [] // track row status for coloring (0 = header)

  for (const r of results) {
    if (r.status === 'pending') continue
    const pagesFoundOn = (r.pages || []).filter(p => p.hasTarget).map(p => p.type).join(', ') || '—'
    const otherEmails  = (r.allEmails || []).filter(e => e !== targetEmail.toLowerCase()).join(', ') || '—'
    const foundLabel   = r.hasTarget ? 'YES' : (r.error ? 'Error' : 'NO')
    const checkedUrl   = `https://${r.domain}`

    mainRows.push([r.domain, foundLabel, pagesFoundOn, otherEmails, checkedUrl])
    rowMeta.push(r.hasTarget ? 'found' : r.error ? 'error' : (r.allEmails?.length ? 'other' : 'none'))
  }

  // ── Build sub sheet rows (Other Emails) ──────────────────
  const subRows = [SUB_HEADERS]
  for (const r of results) {
    if (r.status === 'pending') continue
    const others = (r.allEmails || []).filter(e => e !== targetEmail.toLowerCase())
    if (!others.length) continue
    subRows.push([r.domain, others.join(', ')])
  }

  // Write data
  await batchWriteRangeValues(spreadsheetId, [
    { range: `'Email Check'!A1`, values: mainRows },
    { range: `'Other Emails'!A1`, values: subRows },
  ])

  onProgress?.('Formatting…')

  // ── Format main sheet ─────────────────────────────────────
  const N = mainRows.length - 1 // data rows (excluding header)

  const mainFmt = [
    // Freeze row 1
    { updateSheetProperties: { properties: { sheetId: mainSheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },

    // Header row: dark bg, white bold, centered
    {
      repeatCell: {
        range: rc(mainSheetId, 0, 1, 0, MAIN_HEADERS.length),
        cell: { userEnteredFormat: { backgroundColor: DARK_BG, textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },

    // Data rows: center, middle, clip (default)
    {
      repeatCell: {
        range: rc(mainSheetId, 1, N + 1, 0, MAIN_HEADERS.length),
        cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' } },
        fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },

    // Domain col: left-align
    {
      repeatCell: {
        range: rc(mainSheetId, 0, N + 1, 0, 1),
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },

    // Other Emails col: left-align, wrap
    {
      repeatCell: {
        range: rc(mainSheetId, 1, N + 1, 3, 4),
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(horizontalAlignment,wrapStrategy)',
      },
    },

    // Column widths
    ...MAIN_WIDTHS.map((px, i) => colWidthReq(mainSheetId, i, px)),

    // Row height for header
    {
      updateDimensionProperties: {
        range: { sheetId: mainSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: 'pixelSize',
      },
    },
  ]

  // Per-row background color based on status
  rowMeta.forEach((status, di) => {
    const rowIdx = di + 1 // 0 = header
    const bg = status === 'found' ? GREEN_BG : status === 'other' ? AMBER_BG : RED_BG
    mainFmt.push({
      repeatCell: {
        range: rc(mainSheetId, rowIdx, rowIdx + 1, 0, MAIN_HEADERS.length),
        cell: { userEnteredFormat: { backgroundColor: bg } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })
  })

  // "Email Found?" column text color (col 1)
  rowMeta.forEach((status, di) => {
    const rowIdx = di + 1
    const fg = status === 'found' ? GREEN_TXT : status === 'error' ? AMBER_TXT : RED_TXT
    mainFmt.push({
      repeatCell: {
        range: rc(mainSheetId, rowIdx, rowIdx + 1, 1, 2),
        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: fg } } },
        fields: 'userEnteredFormat.textFormat',
      },
    })
  })

  // ── Format sub sheet ──────────────────────────────────────
  const S = subRows.length - 1
  const subFmt = [
    { updateSheetProperties: { properties: { sheetId: subSheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
    {
      repeatCell: {
        range: rc(subSheetId, 0, 1, 0, SUB_HEADERS.length),
        cell: { userEnteredFormat: { backgroundColor: DARK_BG, textFormat: { bold: true, foregroundColor: WHITE, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
      },
    },
    {
      repeatCell: {
        range: rc(subSheetId, 1, S + 1, 0, SUB_HEADERS.length),
        cell: { userEnteredFormat: { verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
        fields: 'userEnteredFormat(verticalAlignment,wrapStrategy)',
      },
    },
    // Domain left-aligned
    {
      repeatCell: {
        range: rc(subSheetId, 0, S + 1, 0, 1),
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    // Other Emails left-aligned
    {
      repeatCell: {
        range: rc(subSheetId, 0, S + 1, 1, 2),
        cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    },
    // Alternating row backgrounds on sub sheet
    ...Array.from({ length: S }, (_, i) => ({
      repeatCell: {
        range: rc(subSheetId, i + 1, i + 2, 0, SUB_HEADERS.length),
        cell: { userEnteredFormat: { backgroundColor: i % 2 === 0 ? WHITE : GRAY_BG } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })),
    ...SUB_WIDTHS.map((px, i) => colWidthReq(subSheetId, i, px)),
    {
      updateDimensionProperties: {
        range: { sheetId: subSheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 36 },
        fields: 'pixelSize',
      },
    },
  ]

  await batchFormatSheet(spreadsheetId, [...mainFmt, ...subFmt])

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}
