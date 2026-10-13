// POST /api/personal-email-sender
// Body: { action, payload }
// Backs the Personal Email Sender — restricted to Dev Pandya only, sends email using
// Dev's own personal Missive API token (MISSIVE_PERSONAL_API_TOKEN), not the shared
// export token other Missive tools use.

import { requireExactUser, supabaseAdmin } from './_lib/supabaseAdmin.js'
import { missivePersonalRequest, fetchAllSharedLabels } from './_lib/missive.js'

// Dev Pandya's real Supabase user_profiles.id (UUID) — requireExactUser checks this against
// the authenticated caller's actual profile row, read straight from user_profiles here, so
// it must be the UUID. This is NOT the same value as the client-side gate: the frontend
// (Shell.jsx, PersonalEmailSender.jsx) only ever sees `me.id` as the short member_id slug
// ('dev'), since App.jsx remaps the profile before any page gets it. Hardcoded since this
// tool is personal to one specific person, not role- or allowlist-gated.
const DEV_USER_ID = 'a680f0f2-2ae2-4dc0-a094-5bbd1eb8cf7f'

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Lightweight markdown-ish inline formatting, applied after escaping (safe — escapeHtml
// only touches &/</>, so the markers below are untouched going in):
// **bold** -> <strong>, and bare domains/URLs -> links.
function inlineFormat(escaped) {
  let html = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\bhttps?:\/\/[^\s<]+/g, url => `<a href="${url}">${url}</a>`)
  // Bare domain mentions (e.g. "nationalviews.com") not already wrapped in the <a> above.
  html = html.replace(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,})\b(?![^<]*<\/a>)/gi, (m, domain) => {
    if (/^(https?|www)/i.test(domain)) return m
    return `<a href="https://${domain}">${domain}</a>`
  })
  return html
}

// Missive recommends <div>/<br> over <p> for spacing. Blank-line-separated paragraphs each
// become their own margin-bottom <div> (plain <div>s render with no gap between them, which
// is what made earlier sends look cramped); a paragraph whose every line starts with "- "/"* "
// becomes a proper <ul> instead.
function textToHtml(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(para => {
      const lines = para.split('\n')
      if (lines.every(l => /^[-*]\s+/.test(l.trim()))) {
        const items = lines.map(l => `<li>${inlineFormat(escapeHtml(l.trim().replace(/^[-*]\s+/, '')))}</li>`).join('')
        return `<ul style="margin:0 0 16px 0; padding-left:20px;">${items}</ul>`
      }
      return `<div style="margin-bottom:16px;">${inlineFormat(escapeHtml(para)).replace(/\n/g, '<br>')}</div>`
    })
    .join('')
}

function applyMergeFields(text, name) {
  return String(text ?? '').replace(/\{\{\s*name\s*\}\}/gi, name || '')
}

// The drafts POST response shape for a sent draft isn't documented/confirmed (the reference
// doc only says some POSTs return 201 with no body at all), so rather than guess at it, look
// the conversation up the proven way: the same GET /v1/conversations?all=true&email=...
// filter missive-export.js's "chats with a specific person" feature already uses successfully.
// Conversations list newest-first by last_activity_at; prefer an exact subject match (we set
// it ourselves) in case this contact has other recent, unrelated conversations. messages_count
// is captured as the reply-detection baseline — checkReplies later compares against it.
async function resolveConversationLink(to, subject) {
  const params = new URLSearchParams({ all: 'true', email: to.address, limit: '5' })
  const body = await missivePersonalRequest(`/conversations?${params}`)
  const candidates = body.conversations || []
  const match = candidates.find(c => c.subject === subject || c.latest_message_subject === subject) || candidates[0]
  return match
    ? { conversationId: match.id, webUrl: match.web_url || null, messagesCount: match.messages_count ?? null }
    : { conversationId: null, webUrl: null, messagesCount: null }
}

// Re-fetches each conversation and compares its current messages_count against the baseline
// captured at send time — a higher count means new activity (almost certainly a reply, since
// we don't send follow-up messages into these conversations ourselves). No webhook/push
// mechanism is wired up, so this is pull-based: called on page load and on a manual refresh.
async function checkReplies(entries) {
  const CONCURRENCY = 3
  const results = []
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const slice = entries.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(slice.map(e => missivePersonalRequest(`/conversations/${e.conversationId}`)))
    settled.forEach((r, bi) => {
      const entry = slice[bi]
      if (r.status === 'fulfilled') {
        // Single-conversation envelope key isn't confirmed either way — hedge both, same as
        // missive-export.js's getConversation handler already does.
        const raw = r.value?.conversation || r.value?.conversations
        const currentCount = raw?.messages_count ?? null
        results.push({
          conversationId: entry.conversationId,
          currentCount,
          hasReply: currentCount != null && entry.baselineCount != null && currentCount > entry.baselineCount,
        })
      } else {
        results.push({ conversationId: entry.conversationId, error: r.reason?.message || 'Failed' })
      }
    })
  }
  return results
}

// Posts a note into an existing conversation (the orange-avatar "internal note" entries
// visible in Missive's UI, distinct from the email thread itself). Confirmed against the
// Missive REST API source of github.com/kanjidoc/missive-mcp (an open-source MCP server
// whose POST /v1/posts implementation cites exact line numbers of Missive's own endpoint
// docs) rather than guessed: POST /v1/posts, body wrapped in a `posts` key, `conversation`
// is the existing conversation's ID, and `markdown` is the note's content — both are plain
// optional fields, no `organization` required (that's only needed for assignee/access fields,
// which this call doesn't use).
async function postConversationNote(conversationId, note) {
  await missivePersonalRequest('/posts', {
    method: 'POST',
    body: JSON.stringify({ posts: { conversation: conversationId, markdown: note } }),
  })
}

async function handleSend(caller, payload) {
  const { to, from, subject, template, signature, team, sharedLabelIds, organizationId, batchId, note } = payload
  if (!to?.address) throw new Error('Recipient email is required')
  if (!from?.address) throw new Error('From address is required')
  if (!subject) throw new Error('Subject is required')
  if (!template) throw new Error('Email body is required')

  let bodyHtml = textToHtml(applyMergeFields(template, to.name))

  const draft = {
    subject,
    body: '', // set below, once the signature is resolved
    from_field: { address: from.address, name: from.name || undefined },
    to_fields: [{ address: to.address, name: to.name || undefined }],
    send: true,
  }
  if (team) draft.team = team
  if (Array.isArray(sharedLabelIds) && sharedLabelIds.length) {
    draft.add_shared_labels = sharedLabelIds
    // Missive requires `organization` on the draft whenever add_shared_labels is set.
    if (!organizationId) throw new Error('organizationId is required to apply shared labels')
    draft.organization = organizationId
  }

  // A typed signature always wins; leave it blank to have Missive attach whatever default
  // signature is configured for the sending account/alias instead (add_default_signature) —
  // there's no documented endpoint to read that signature's text ourselves, but the drafts
  // endpoint can attach it for us without needing to know what it says.
  if (signature?.trim()) {
    bodyHtml += textToHtml(applyMergeFields(signature, to.name))
  } else {
    draft.add_default_signature = true
  }
  draft.body = bodyHtml

  await missivePersonalRequest('/drafts', {
    method: 'POST',
    body: JSON.stringify({ drafts: draft }),
  })

  // The send already happened by this point — a failure resolving the link or writing the
  // log must never surface as a send failure, just a send with no link recorded.
  let conversationId = null
  let webUrl = null
  let messagesCount = null
  try {
    ;({ conversationId, webUrl, messagesCount } = await resolveConversationLink(to, subject))
  } catch { /* link lookup is best-effort */ }

  // The note is meant to land AFTER the email is sent, as a separate internal post on the
  // same conversation — never blocks or fails the send itself, just surfaced back so the
  // caller can show a warning if it didn't land (e.g. the conversation link above failed).
  let noteError = null
  if (note?.trim()) {
    if (!conversationId) {
      noteError = "Couldn't find the conversation to attach the note to"
    } else {
      try {
        await postConversationNote(conversationId, note.trim())
      } catch (err) {
        noteError = err.message
      }
    }
  }

  try {
    await supabaseAdmin.from('personal_email_sent_log').insert({
      user_id: caller.id,
      batch_id: batchId || null,
      recipient_name: to.name || null,
      recipient_email: to.address,
      subject,
      conversation_id: conversationId,
      web_url: webUrl,
    })
  } catch { /* logging is best-effort — never fail a successful send over it */ }

  return { conversationId, webUrl, messagesCount, noteError }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const caller = await requireExactUser(req, res, DEV_USER_ID)
  if (!caller) return

  const { action, payload = {} } = req.body || {}

  try {
    if (action === 'listOrganizations') {
      const body = await missivePersonalRequest('/organizations')
      return res.json({ organizations: body.organizations || [] })
    }

    if (action === 'listTeams') {
      const { organizationId } = payload
      if (!organizationId) return res.status(400).json({ error: 'organizationId is required' })
      const body = await missivePersonalRequest(`/teams?organization=${encodeURIComponent(organizationId)}`)
      return res.json({ teams: body.teams || [] })
    }

    if (action === 'listSharedLabels') {
      const { organizationId } = payload
      if (!organizationId) return res.status(400).json({ error: 'organizationId is required' })
      return res.json({ labels: await fetchAllSharedLabels(missivePersonalRequest, organizationId) })
    }

    if (action === 'send') {
      const { conversationId, webUrl, messagesCount, noteError } = await handleSend(caller, payload)
      return res.json({ ok: true, conversationId, webUrl, messagesCount, noteError })
    }

    if (action === 'checkReplies') {
      const { entries } = payload
      if (!Array.isArray(entries) || !entries.length) return res.json({ results: [] })
      return res.json({ results: await checkReplies(entries) })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
