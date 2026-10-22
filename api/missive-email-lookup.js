import { requireToolAccess } from './_lib/supabaseAdmin.js'
import { missiveRequest } from './_lib/missive.js'
import { fetchMessageStubs } from './_lib/missiveMessages.js'

const TOOL_ID = 'missive-email-lookup'

// A real contact rarely has more threads than this with us — caps how much work one lookup
// can trigger (conversation list pages + a message-stub fetch per conversation found).
const MAX_CONVERSATIONS = 25
const MAX_MESSAGES_PER_CONV = 50

function toMillis(value) {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

// Missive paginates conversations by cursor (until = oldest last_activity_at from the
// previous page), same convention as listConversationsPage — raw cursor, passed straight back.
async function fetchConversationsForEmail(email) {
  const all = []
  let until = null
  while (all.length < MAX_CONVERSATIONS) {
    const params = new URLSearchParams({ all: 'true', email, limit: '50' })
    if (until != null) params.set('until', String(until))
    const body = await missiveRequest(`/conversations?${params}`)
    const page = body.conversations || []
    if (!page.length) break
    all.push(...page)
    if (page.length < 50) break
    until = page[page.length - 1].last_activity_at
  }
  return all.slice(0, MAX_CONVERSATIONS)
}

// A message stub's `author` field is only present when WE wrote it (see missive-export.js's
// formatMessage) — that's what distinguishes "they emailed us" from "we emailed them" within
// a thread the email-filtered conversation list already confirmed this contact is part of.
async function checkOutbound(conversationId) {
  const stubs = await fetchMessageStubs(missiveRequest, conversationId, MAX_MESSAGES_PER_CONV)
  const outboundTimes = stubs.filter(m => m.author).map(m => toMillis(m.delivered_at)).filter(t => t != null)
  if (!outboundTimes.length) return { hasOutbound: false, firstSentAt: null, lastSentAt: null }
  return {
    hasOutbound: true,
    firstSentAt: new Date(Math.min(...outboundTimes)).toISOString(),
    lastSentAt: new Date(Math.max(...outboundTimes)).toISOString(),
  }
}

async function lookupOne(email) {
  const conversations = await fetchConversationsForEmail(email)
  const enriched = await Promise.all(conversations.map(async c => {
    const outbound = await checkOutbound(c.id)
    return {
      id: c.id,
      subject: c.subject || c.latest_message_subject || '(no subject)',
      webUrl: c.web_url,
      lastActivityAt: c.last_activity_at,
      ...outbound,
    }
  }))

  const sent = enriched.filter(c => c.hasOutbound)
  const sentTimes = sent.flatMap(c => [c.firstSentAt, c.lastSentAt].filter(Boolean))
  return {
    email,
    everContacted: enriched.length > 0,
    everSent: sent.length > 0,
    firstSentAt: sentTimes.length ? sentTimes.reduce((a, b) => (a < b ? a : b)) : null,
    lastSentAt: sentTimes.length ? sentTimes.reduce((a, b) => (a > b ? a : b)) : null,
    conversations: enriched.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1)),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const caller = await requireToolAccess(req, res, TOOL_ID)
  if (!caller) return

  const { action, payload = {} } = req.body || {}

  try {
    if (action === 'lookupEmail') {
      const email = (payload.email || '').trim().toLowerCase()
      if (!email) return res.status(400).json({ error: 'email is required' })
      return res.json(await lookupOne(email))
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error('[missive-email-lookup]', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
