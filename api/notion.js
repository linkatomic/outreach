const NOTION_TOKEN = process.env.NOTION_TOKEN
const DB_ID = process.env.NOTION_DATABASE_ID

const notionHeaders = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
}

export default async function handler(req, res) {
  if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN not configured' })

  // GET → fetch a specific page (pageId query param) OR test database connection
  if (req.method === 'GET') {
    const { pageId } = req.query || {}
    if (pageId) {
      try {
        const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders })
        const data = await r.json()
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error', code: data.code })
        return res.json(data)
      } catch (e) {
        return res.status(500).json({ error: e.message })
      }
    }
    try {
      const r = await fetch(`https://api.notion.com/v1/databases/${DB_ID}`, { headers: notionHeaders })
      const data = await r.json()
      if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error', code: data.code })
      return res.json({ ok: true, title: data.title?.[0]?.plain_text, type: data.object, id: data.id })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // PATCH → update page properties
  if (req.method === 'PATCH') {
    const { pageId, properties } = req.body || {}
    if (!pageId || !properties) return res.status(400).json({ error: 'pageId and properties required' })
    try {
      const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: notionHeaders,
        body: JSON.stringify({ properties }),
      })
      const data = await r.json()
      if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error', code: data.code })
      return res.json({ id: data.id })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  // POST → create page
  if (req.method === 'POST') {
    const { properties } = req.body || {}
    if (!properties) return res.status(400).json({ error: 'properties required' })
    try {
      const r = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: notionHeaders,
        body: JSON.stringify({ parent: { database_id: DB_ID }, properties }),
      })
      const data = await r.json()
      if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion API error', code: data.code })
      return res.json({ id: data.id, url: data.url })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  res.status(405).end()
}
