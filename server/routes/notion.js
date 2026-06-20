import { Router } from 'express'

export const notionRouter = Router()

function notionHeaders() {
  return {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  }
}

notionRouter.get('/', async (req, res) => {
  const { pageId } = req.query || {}
  if (pageId) {
    try {
      const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: notionHeaders() })
      const data = await r.json()
      if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error', code: data.code })
      return res.json(data)
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }
  const db_id = process.env.NOTION_DATABASE_ID
  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${db_id}`, { headers: notionHeaders() })
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error', code: data.code })
    return res.json({ ok: true, title: data.title?.[0]?.plain_text, type: data.object, id: data.id })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
})

notionRouter.patch('/', async (req, res) => {
  const { pageId, properties } = req.body || {}
  if (!pageId || !properties) return res.status(400).json({ error: 'pageId and properties required' })
  try {
    const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ properties }),
    })
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error', code: data.code })
    return res.json({ id: data.id })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
})

notionRouter.post('/', async (req, res) => {
  const { properties } = req.body || {}
  if (!properties) return res.status(400).json({ error: 'properties required' })
  if (!process.env.NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN not configured' })
  try {
    const r = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders(),
      body: JSON.stringify({ parent: { database_id: process.env.NOTION_DATABASE_ID }, properties }),
    })
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ error: data.message || 'Notion error', code: data.code })
    return res.json({ id: data.id, url: data.url })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
})
