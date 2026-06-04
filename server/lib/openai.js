import OpenAI from 'openai'
import 'dotenv/config'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function detectColumns(tabName, rows) {
  const preview = rows.slice(0, 15).map(r =>
    r.map(cell => String(cell ?? '').trim())
  )

  const prompt = `You are analyzing a spreadsheet tab that contains a website/guest post inventory list.

Tab name: "${tabName}"
First ${preview.length} rows (each row is an array of cell values):
${JSON.stringify(preview, null, 2)}

TASK: Identify the header row and the relevant columns.

RULES:
- The "header row" is the row containing column labels (NOT company name, payment methods, or disclaimer text at the top).
- The DOMAIN column contains website/domain names (may be labeled "Site Name", "Website", "Domain", "Guest Post Sites List", etc.). Cells will look like "example.com", "https://example.com", "example.com New", "example.com (New)***".
- PRICE columns contain monetary values labeled with words like "Price", "Cost", "Rate", "Post Price", "Link Insertion", "Gray Niche", "Casino", "CBD", "Normal", "Others", "General", etc.
- SKIP columns that are SEO metrics: DA, DR, MOZ, Ahrefs, Traffic, Organic Traffic, TLD, TAT, "Turn Around", "Link Type", "Google News", SL, "Serial", "No.", etc. These are NOT prices even if they contain numbers.
- Prices look like: "$10", "10$", "$20.00", "15", "500$" — always associated with a money-related column label.

Return ONLY valid JSON with no explanation:
{
  "headerRow": <0-indexed row number of the column headers>,
  "domainColumn": "<exact string from header row, or null if not found>",
  "domainConfidence": "high" | "medium" | "low",
  "priceColumns": [
    {
      "name": "<exact string from header row>",
      "label": "<clean 2-4 word label, e.g. 'General Price', 'Gray Niche Price', 'Casino Price', 'CBD Price'>",
      "confidence": "high" | "medium" | "low"
    }
  ]
}`

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a data analyst. Respond only with valid JSON, no markdown, no explanation.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    max_tokens: 800,
  })

  const text = response.choices[0].message.content.trim()
  return JSON.parse(text)
}
