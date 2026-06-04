// Internal tool credentials — keep this repo private.
// All Google operations use a single account (the owner's refresh token).
// No sign-in required from other users.

const GOOGLE_CLIENT_ID     = import.meta.env.VITE_GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET
const GOOGLE_REFRESH_TOKEN = import.meta.env.VITE_GOOGLE_REFRESH_TOKEN
const OPENAI_API_KEY       = import.meta.env.VITE_OPENAI_API_KEY

// ── Google OAuth — refresh token flow ────────────────────
// Exchange the refresh token for a short-lived access token.
// Cached per session; auto-refreshes when near expiry.

let _accessToken = null
let _tokenExpiry = 0
let _scopesVerified = false

async function getToken() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      `Missing credentials — check Vercel env vars:\n` +
      `VITE_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID ? 'OK' : 'MISSING'}\n` +
      `VITE_GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET ? 'OK' : 'MISSING'}\n` +
      `VITE_GOOGLE_REFRESH_TOKEN: ${GOOGLE_REFRESH_TOKEN ? 'OK' : 'MISSING'}`
    )
  }

  if (_accessToken && Date.now() < _tokenExpiry - 60_000) return _accessToken

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    throw new Error(
      data.error_description
        ? `Google auth failed: ${data.error_description}`
        : `Google auth failed (${data.error || res.status}). The credentials may need to be refreshed — contact the tool owner.`
    )
  }
  _accessToken = data.access_token
  _tokenExpiry = Date.now() + data.expires_in * 1000
  return _accessToken
}

// ── Google Sheets API ─────────────────────────────────────

async function gsheets(path, opts = {}) {
  const token = await getToken()

  // Check token scopes before first Sheets call
  if (!_scopesVerified) {
    const info = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`)
    const infoData = await info.json()
    const scopes = infoData.scope || ''
    if (!scopes.includes('spreadsheets') && !scopes.includes('drive')) {
      throw new Error(
        `Refresh token is missing Sheets/Drive scope.\n` +
        `Current scopes: ${scopes || '(none)'}\n\n` +
        `Regenerate the refresh token and include these scopes:\n` +
        `https://www.googleapis.com/auth/spreadsheets\n` +
        `https://www.googleapis.com/auth/drive`
      )
    }
    _scopesVerified = true
  }

  const res = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  const data = await res.json()
  if (!res.ok || data.error) {
    const msg = data.error?.message || JSON.stringify(data.error)
    throw new Error(`[HTTP ${res.status}] ${msg}\nPath: ${path}`)
  }
  return data
}

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
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.4-nano',
      messages: [
        { role: 'system', content: 'You are a data analyst. Respond only with valid JSON, no markdown, no explanation.' },
        { role: 'user',   content: prompt },
      ],
      temperature: 0,
      max_completion_tokens: 800,
    }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(`OpenAI: ${data.error?.message || res.status}`)
  const text = data.choices[0].message.content.trim()
  return JSON.parse(text)
}

// ── Google Drive API ─────────────────────────────────────

async function gdrive(path, opts = {}) {
  const token = await getToken()
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (res.status === 204) return {}
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error?.message || JSON.stringify(data.error))
  return data
}

// ── Output sheet creation ─────────────────────────────────

export async function createOutputSheet(title, headers, rows, numPriceCols) {
  const created = await gsheets('/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Websites' } }],
    }),
  })
  const newId   = created.spreadsheetId
  const sheetId = created.sheets[0].properties.sheetId

  await gsheets(`/spreadsheets/${newId}/values/Websites!A1?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [headers, ...rows] }),
  })

  // Buyer columns are at indices 3, 5, 7, … (3 + 2*i)
  const buyerColRequests = Array.from({ length: numPriceCols }, (_, i) => ({
    repeatCell: {
      range: { sheetId, startColumnIndex: 3 + i * 2, endColumnIndex: 4 + i * 2 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.851, green: 0.918, blue: 0.827 } } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  }))

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
        ...buyerColRequests,
      ],
    }),
  })

  // Share with anyone as editor
  await gdrive(`/files/${newId}/permissions`, {
    method: 'POST',
    body: JSON.stringify({ role: 'writer', type: 'anyone' }),
  })

  return `https://docs.google.com/spreadsheets/d/${newId}/edit`
}

// ── Data helpers ──────────────────────────────────────────

export function cleanDomain(raw) {
  if (!raw) return ''
  let s = String(raw).trim()
  s = s.replace(/^https?:\/\//i, '')
  s = s.replace(/^www\./i, '')
  s = s.split('/')[0]
  s = s.split(/\s/)[0]
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
