import { requireToolAccess } from './_lib/supabaseAdmin.js'
import { crispRequest, crispWebsiteId } from './_lib/crisp.js'

const TOOL_ID = 'crisp-chat-export'

// Kept short on purpose — Vercel's Hobby plan hard-kills functions at 10s
// regardless of maxDuration, so each call here does ONE small step (one
// page of conversations, or one conversation's full message history) and
// the frontend drives the loop across many short calls instead of one long
// server-side batch job.
const MAX_MESSAGE_PAGES = 10

function fmtStamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

async function listConversationsPage(fromMs, toMs, page) {
  const websiteId = crispWebsiteId()
  const data = await crispRequest(
    `/website/${websiteId}/conversations/${page}?filter_date_start=${fromMs}&filter_date_end=${toMs}&per_page=20`
  )
  return (data || []).map(c => ({
    sessionId: c.session_id,
    nickname: c.meta?.nickname || null,
    email: c.meta?.email || null,
    state: c.state,
    createdAt: c.created_at,
  }))
}

async function fetchFullTranscript(sessionId) {
  const websiteId = crispWebsiteId()
  const [meta, ...pages] = await Promise.all([
    crispRequest(`/website/${websiteId}/conversation/${sessionId}/meta`).catch(() => ({})),
    // First page (most recent messages) — older pages are fetched below, one at a time,
    // since each page's cursor depends on the oldest timestamp seen so far.
    crispRequest(`/website/${websiteId}/conversation/${sessionId}/messages`).catch(() => []),
  ])

  let allMessages = [...(pages[0] || [])]
  let oldestSeen = allMessages.length ? Math.min(...allMessages.map(m => m.timestamp)) : null

  for (let i = 1; i < MAX_MESSAGE_PAGES && oldestSeen; i++) {
    const older = await crispRequest(
      `/website/${websiteId}/conversation/${sessionId}/messages?timestamp_before=${oldestSeen}`
    ).catch(() => [])
    if (!older.length) break
    allMessages.push(...older)
    oldestSeen = Math.min(...older.map(m => m.timestamp))
  }

  allMessages.sort((a, b) => a.timestamp - b.timestamp)

  const header = [
    `Conversation ${sessionId}`,
    `Visitor: ${meta?.nickname || meta?.email || 'Unknown'}${meta?.email ? ` <${meta.email}>` : ''}`,
    `${allMessages.length} message${allMessages.length === 1 ? '' : 's'}`,
    '─'.repeat(60),
  ].join('\n')

  const body = allMessages.map(m => {
    if (m.type === 'note') return `[${fmtStamp(m.timestamp)}] (note) ${flattenContent(m.content)}`
    const who = m.from === 'operator' ? (m.user?.nickname || 'Operator') : (meta?.nickname || 'Visitor')
    return `[${fmtStamp(m.timestamp)}] ${who}: ${flattenContent(m.content)}`
  }).join('\n')

  return { sessionId, text: `${header}\n${body}\n`, messageCount: allMessages.length }
}

function flattenContent(content) {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    if (content.text) return content.text
    return JSON.stringify(content)
  }
  return '(empty)'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const caller = await requireToolAccess(req, res, TOOL_ID)
  if (!caller) return

  const { action, payload = {} } = req.body || {}

  try {
    if (action === 'listConversationsPage') {
      const { fromMs, toMs, page } = payload
      if (!fromMs || !toMs || !page) return res.status(400).json({ error: 'fromMs, toMs and page are required' })
      const conversations = await listConversationsPage(fromMs, toMs, page)
      return res.json({ conversations })
    }

    if (action === 'getTranscript') {
      const { sessionId } = payload
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })
      const result = await fetchFullTranscript(sessionId)
      return res.json(result)
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[crisp-export]', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
