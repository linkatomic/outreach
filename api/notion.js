const NOTION_TOKEN = process.env.NOTION_TOKEN
const DB_ID = process.env.NOTION_DATABASE_ID

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { properties } = req.body || {}
  if (!properties) return res.status(400).json({ error: 'properties required' })
  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN not configured' })

  try {
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parent: { database_id: DB_ID },
        properties,
      }),
    })

    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion API error' })
    return res.json({ id: data.id, url: data.url })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
