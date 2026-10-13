// Builds a formatted Google Sheet from the Tracking page's batches — one row per recipient
// across every batch, with Email/Missive Link/Internal Note as the columns the user asked
// for by name. Follows the same direct-fetch Sheets API pattern as emailHarvesterSheet.js
// (own createSpreadsheet, shared batchWriteRangeValues/batchFormatSheet primitives) rather
// than createUltimateOutputSheet, since that helper hardcodes a single "Websites" tab name.
import { batchWriteRangeValues, batchFormatSheet } from './sheetParserAPI.js'

const C = {
  headerBg:  { red: 0.118, green: 0.118, blue: 0.149 },
  white:     { red: 1, green: 1, blue: 1 },
  accentBg:  { red: 0.18,  green: 0.18,  blue: 0.22  },
  lightGray: { red: 0.96,  green: 0.96,  blue: 0.96  },
  sentBg:    { red: 0.878, green: 0.957, blue: 0.878 },
  failedBg:  { red: 0.988, green: 0.882, blue: 0.882 },
  green:     { red: 0.133, green: 0.545, blue: 0.133 },
  red:       { red: 0.75,  green: 0.133, blue: 0.133 },
  gray:      { red: 0.50,  green: 0.50,  blue: 0.50  },
  blue:      { red: 0.133, green: 0.333, blue: 0.700 },
}

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
    body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: 'Tracking' } }] }),
  })
  const created = await createRes.json()
  if (!createRes.ok || created.error) throw new Error(`Sheet create failed: ${created.error?.message}`)

  await fetch(`https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  })

  return { spreadsheetId: created.spreadsheetId, sheetId: created.sheets[0].properties.sheetId }
}

const COLS = ['Batch', 'Name', 'Email', 'Status', 'Sent', 'Reply', 'Internal Note', 'Missive Link']
// Note gets a generous FIXED width, and every row (see buildFmt) gets the SAME fixed height
// regardless of note length — a long note is clipped within its cell, not wrapped into a
// taller row, so every row stays visually even no matter how long any one note is.
const WIDTHS = [160, 140, 220, 90, 150, 90, 340, 110]
const N = COLS.length
const HEADER_ROW = 3 // rows 0-2 are title/subtitle/spacer
const DATA_START = HEADER_ROW + 1

function batchLabel(b) {
  return b.batch_name?.trim() || `Batch · ${new Date(b.created_at).toLocaleDateString()}`
}
function statusLabel(status) {
  if (status === 'sent') return 'Sent'
  if (status === 'sending') return 'Sending…'
  if (status === 'error') return 'Failed'
  return 'Pending'
}
// A cell value starting with =, +, -, or @ is read by Sheets as a formula — guard any
// free-text field (names/notes typed by a person) from being misinterpreted as one.
function safeText(v) {
  const s = String(v ?? '')
  return /^[=+\-@]/.test(s) ? `'${s}` : s
}

function flattenRows(batches) {
  const out = []
  for (const b of batches) {
    const label = batchLabel(b)
    for (const r of (b.rows || [])) out.push({ batch: label, row: r })
  }
  return out
}

function buildValues(batches, dateStr) {
  const flat = flattenRows(batches)
  const values = [
    ['MISSIVE TRACKING REPORT', '', '', '', '', '', '', ''],
    [`Generated: ${dateStr}`, '', `${flat.length} recipient${flat.length === 1 ? '' : 's'} across ${batches.length} batch${batches.length === 1 ? '' : 'es'}`, '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    COLS,
  ]
  for (const { batch, row } of flat) {
    values.push([
      safeText(batch),
      safeText(row.name || ''),
      safeText(row.email || ''),
      statusLabel(row.status),
      row.sentAt ? new Date(row.sentAt).toLocaleString() : '',
      row.hasReply ? 'Replied' : '',
      safeText(row.note || ''),
      row.webUrl ? `=HYPERLINK("${row.webUrl}","Open →")` : '',
    ])
  }
  return { values, flat }
}

function buildFmt(sheetId, flat) {
  const dataEnd = DATA_START + flat.length

  const reqs = [
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: HEADER_ROW + 1 } }, fields: 'gridProperties.frozenRowCount' } },

    rowFmt(sheetId, 0, N, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 15 }, verticalAlignment: 'MIDDLE' }),
    rowH(sheetId, 0, 1, 44),
    rowFmt(sheetId, 1, N, { backgroundColor: C.accentBg, textFormat: { foregroundColor: C.white, fontSize: 10 }, verticalAlignment: 'MIDDLE' }),
    rowH(sheetId, 1, 2, 26),
    rowH(sheetId, 2, 3, 12),

    rowFmt(sheetId, HEADER_ROW, N, { backgroundColor: C.headerBg, textFormat: { bold: true, foregroundColor: C.white, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' }),
    rowH(sheetId, HEADER_ROW, DATA_START, 32),

    // Default body alignment, then per-column overrides. Every data row gets the SAME fixed
    // height no matter how long its note is — CLIP (not WRAP) on every column, Note included,
    // so a long note is visually truncated within its cell instead of wrapping and blowing up
    // that one row's height. The full text is never lost: it's still the real cell value,
    // just click the cell (or widen the column) to read all of it.
    rangeFmt(sheetId, DATA_START, dataEnd, 0, N, { verticalAlignment: 'MIDDLE', wrapStrategy: 'CLIP' }),
    rowH(sheetId, DATA_START, dataEnd, 24),
    rangeFmt(sheetId, DATA_START, dataEnd, 2, 3, { textFormat: { fontFamily: 'Courier New', fontSize: 11 } }),
    rangeFmt(sheetId, DATA_START, dataEnd, 3, 4, { horizontalAlignment: 'CENTER' }),
    rangeFmt(sheetId, DATA_START, dataEnd, 5, 6, { horizontalAlignment: 'CENTER' }),
    rangeFmt(sheetId, DATA_START, dataEnd, 6, 7, { horizontalAlignment: 'LEFT' }),
    rangeFmt(sheetId, DATA_START, dataEnd, 7, 8, { horizontalAlignment: 'CENTER', textFormat: { foregroundColor: C.blue, bold: true } }),

    ...WIDTHS.map((px, i) => colW(sheetId, i, px)),
  ]

  flat.forEach(({ row }, i) => {
    const ri = DATA_START + i
    const bg = row.status === 'sent' ? C.sentBg : row.status === 'error' ? C.failedBg : C.lightGray
    reqs.push(rowFmt(sheetId, ri, N, { backgroundColor: bg }))

    const statusFg = row.status === 'sent' ? C.green : row.status === 'error' ? C.red : C.gray
    reqs.push(cell(sheetId, ri, 3, { textFormat: { bold: true, foregroundColor: statusFg }, horizontalAlignment: 'CENTER' }))

    if (row.hasReply) reqs.push(cell(sheetId, ri, 5, { textFormat: { bold: true, foregroundColor: C.red }, horizontalAlignment: 'CENTER' }))
  })

  return reqs
}

export async function buildMissiveTrackingSheet(batches, onProgress) {
  onProgress?.('Creating spreadsheet…')

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const title = `Missive Tracking · ${now.toISOString().slice(0, 10)}`

  const { spreadsheetId, sheetId } = await createSpreadsheet(title)

  onProgress?.('Writing data…')
  const { values, flat } = buildValues(batches, dateStr)
  await batchWriteRangeValues(spreadsheetId, [{ range: `'Tracking'!A1`, values }])

  onProgress?.('Formatting…')
  const allFmt = buildFmt(sheetId, flat)
  const CHUNK = 400
  for (let i = 0; i < allFmt.length; i += CHUNK) {
    await batchFormatSheet(spreadsheetId, allFmt.slice(i, i + CHUNK))
  }

  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}
