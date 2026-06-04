// All Google Sheets + OpenAI calls run directly in the browser.
// No server required — credentials are embedded via Vite env vars.

const CLIENT_ID     = import.meta.env.VITE_GOOGLE_CLIENT_ID
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
const REFRESH_TOKEN = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN
const OPENAI_KEY    = import.meta.env.VITE_OPENAI_API_KEY

// ── Google OAuth ─────────────────────────────────────────
let _token = null
let _tokenExpiry = 0

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Google auth failed: ${data.error_description || data.error}`)
  _token = data.access_token
  _tokenExpiry = Date.now() + data.expires_in * 1000
  return _token
}

async function gsheets(path, opts = {}) {
  const token = await getToken()
  const res = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))
  return data
}

// ── Sheet reading ─────────────────────────────────────────

export function extractSheetId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m ? m[1] : null
}

export async function getSheetTabs(spreadsheetId) {
  const data = await gsheets(`/spreadsheets/${spreadsheetId}?fields=sheets.properties`)
  return data.sheets.map(s => ({ name: s.properties.title, sheetId: s.properties.sheetId }))
}

export async function getSheetRows(spreadsheetId, tabName, maxRows = null) {
  const range = maxRows ? `'${tabName}'!A1:ZZ${maxRows}` : `'${tabName}'!A:ZZ`
  const data = await gsheets(
    `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`
  )
  return data.values || []
}

// ── OpenAI column detection ───────────────────────────────

export async function detectColumns(tabName, rows) {
  const preview = rows.slice(0, 15).map(r => r.map(c => String(c ?? '').trim()))

  const prompt = `You are analyzing a spreadsheet tab that contains a website/guest post inventory list.

Tab name: "${tabName}"
First ${preview.length} rows (each row is an array of cell values):
${JSON.stringify(preview, null, 2)}

TASK: Identify the header row and the relevant columns.

RULES:
- The "header row" is the row with column labels (NOT company name, payment info, or disclaimer rows at the top).
- The DOMAIN column contains website/domain names (labeled "Site Name", "Website", "Domain", "Guest Post Sites List", etc.). Cells look like "example.com", "https://example.com", "example.com New".
- PRICE columns contain monetary values with labels like "Price", "Post Price", "Link Insertion", "Gray Niche", "Casino", "CBD", "Normal", "Others", "General", etc.
- SKIP SEO metric columns: DA, DR, MOZ, Ahrefs, Traffic, Organic Traffic, TLD, TAT, "Turn Around", "Link Type", "Google News", SL, "Serial", "No." — these are NOT prices.
- Prices look like: "$10", "10$", "$20.00", "15".

Return ONLY valid JSON, no explanation:
{
  "headerRow": <0-indexed row number of column headers>,
  "domainColumn": "<exact header string, or null>",
  "domainConfidence": "high" | "medium" | "low",
  "priceColumns": [
    { "name": "<exact header string>", "label": "<clean 2-4 word label e.g. General Price, Gray Niche Price>", "confidence": "high" | "medium" | "low" }
  ]
}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a data analyst. Respond only with valid JSON, no markdown, no explanation.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 800,
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`OpenAI: ${data.error.message}`)
  const text = data.choices[0].message.content.trim()
  return JSON.parse(text)
}

// ── Output sheet creation ─────────────────────────────────

export async function createOutputSheet(title, headers, rows) {
  const token = await getToken()

  // Create the spreadsheet
  const created = await gsheets('/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Websites' } }],
    }),
  })
  const newId = created.spreadsheetId
  const sheetId = created.sheets[0].properties.sheetId

  // Write all data
  await gsheets(`/spreadsheets/${newId}/values/Websites!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [headers, ...rows] }),
  })

  // Bold header + freeze row
  await gsheets(`/spreadsheets/${newId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    }),
  })

  return `https://docs.google.com/spreadsheets/d/${newId}/edit`
}

// ── Data helpers ──────────────────────────────────────────

export function cleanDomain(raw) {
  if (!raw) return ''
  let s = String(raw).trim()
  s = s.replace(/^https?:\/\//i, '')
  s = s.replace(/^www\./i, '')
  s = s.split('/')[0]          // remove path
  s = s.split(/\s/)[0]         // remove " New", " (New)***", etc.
  s = s.replace(/[*()\[\]]+/g, '')
  s = s.replace(/[.,;:]+$/, '').trim()
  return s.toLowerCase()
}

export function parsePrice(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!s || s === '-' || s.toLowerCase() === 'n/a') return null
  const num = parseFloat(s.replace(/[^0-9.]/g, ''))
  return isNaN(num) ? null : num
}
