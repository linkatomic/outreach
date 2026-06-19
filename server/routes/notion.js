import { Router } from 'express'

export const notionRouter = Router()

notionRouter.post('/', async (req, res) => {
  const { properties } = req.body || {}
  if (!properties) return res.status(400).json({ error: 'properties required' })

  const token  = process.env.NOTION_TOKEN
  const db_id  = process.env.NOTION_DATABASE_ID
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN not configured' })

  try {
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent: { database_id: db_id }, properties }),
    })
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error' })
    return res.json({ id: data.id, url: data.url })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
})
