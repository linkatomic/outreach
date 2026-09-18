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

// Crisp's docs don't state the type of `created_at`/`updated_at` in a conversation
// object as explicitly as they state the *filter params* are ISO 8601 — response
// timestamps elsewhere in this API (message.timestamp) are epoch milliseconds, so
// handle both an ISO string and an epoch number (seconds or ms) defensively.
function toMillis(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

async function listConversationsPage(fromISO, toISO, page) {
  const websiteId = crispWebsiteId()
  // Crisp's docs are explicit that filter_date_start/filter_date_end are ISO 8601
  // strings, not epoch numbers — sending epoch ms here previously made Crisp silently
  // ignore the filter and return everything, paginated (that's the "2000 conversations
  // for today" bug). order_date_created=desc makes the result order deterministic.
  const qs = new URLSearchParams({
    filter_date_start: fromISO,
    filter_date_end: toISO,
    order_date_created: 'desc',
    per_page: '20',
  })
  const data = await crispRequest(`/website/${websiteId}/conversations/${page}?${qs}`)
  const fromMs = toMillis(fromISO)
  const toMs = toMillis(toISO)
  return (data || [])
    // Defensive double-check against the server-side filter — never show/export a
    // conversation outside the requested range even if Crisp's filter misbehaves.
    .filter(c => {
      const created = toMillis(c.created_at)
      return created == null || (created >= fromMs && created <= toMs)
    })
    .map(c => ({
      sessionId: c.session_id,
      nickname: c.meta?.nickname || null,
      email: c.meta?.email || null,
      state: c.state,
      createdAt: c.created_at,
      assignedUserId: c.assigned?.user_id || null,
    }))
}

// Real operators only (not pending invites/sandbox seats) — used to build the
// "filter by team member" checklist and to resolve assignedUserId to a name.
async function listOperators() {
  const websiteId = crispWebsiteId()
  const data = await crispRequest(`/website/${websiteId}/operators/list`)
  return (data || [])
    .filter(o => o.type === 'operator')
    .map(o => ({
      userId: o.details?.user_id,
      name: [o.details?.first_name, o.details?.last_name].filter(Boolean).join(' ') || o.details?.email || 'Unknown',
      email: o.details?.email || null,
    }))
    .filter(o => o.userId)
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
      const { fromDate, toDate, page } = payload
      if (!fromDate || !toDate || !page) return res.status(400).json({ error: 'fromDate, toDate and page are required' })
      const conversations = await listConversationsPage(fromDate, toDate, page)
      return res.json({ conversations })
    }

    if (action === 'getTranscript') {
      const { sessionId } = payload
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' })
      const result = await fetchFullTranscript(sessionId)
      return res.json(result)
    }

    if (action === 'listOperators') {
      const operators = await listOperators()
      return res.json({ operators })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[crisp-export]', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
