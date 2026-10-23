// POST /api/personal-email-sender
// Body: { action, payload }
// Backs the Personal Email Sender — restricted to Dev Pandya only, sends email using
// Dev's own personal Missive API token (MISSIVE_PERSONAL_API_TOKEN), not the shared
// export token other Missive tools use.

import { requireExactUser, supabaseAdmin } from './_lib/supabaseAdmin.js'
import { missivePersonalRequest, fetchAllSharedLabels } from './_lib/missive.js'
import { fetchMessageStubs, fetchFullMessages, bodyToPlainText, checkConversationReplies } from './_lib/missiveMessages.js'
import { glmComplete } from './_lib/glm.js'

// Dev Pandya's real Supabase user_profiles.id (UUID) — requireExactUser checks this against
// the authenticated caller's actual profile row, read straight from user_profiles here, so
// it must be the UUID. This is NOT the same value as the client-side gate: the frontend
// (Shell.jsx, PersonalEmailSender.jsx) only ever sees `me.id` as the short member_id slug
// ('dev'), since App.jsx remaps the profile before any page gets it. Hardcoded since this
// tool is personal to one specific person, not role- or allowlist-gated.
const DEV_USER_ID = 'a680f0f2-2ae2-4dc0-a094-5bbd1eb8cf7f'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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

// Posts a note into an existing conversation (the orange-avatar "internal note" entries
// visible in Missive's UI, distinct from the email thread itself). POST /v1/posts, body
// wrapped in a `posts` key, `conversation` is the existing conversation's ID, `markdown` is
// the note's content. `notification` turned out to be required in production (a real send
// returned "Validation failed: notification is required") even though it's optional in a
// third-party reference implementation this was checked against — so it's always included
// here now, confirmed against the live API rather than that reference alone.
async function postConversationNote(conversationId, note, notificationTitle = 'Note added') {
  const body = note.length > 200 ? note.slice(0, 200) + '…' : note
  await missivePersonalRequest('/posts', {
    method: 'POST',
    body: JSON.stringify({
      posts: {
        conversation: conversationId,
        markdown: note,
        notification: { title: notificationTitle, body },
      },
    }),
  })
}

// Walks a conversation's messages newest-first and collects every one sent by the external
// contact (no `author` field — the same "isOurs = !!m.author" convention missive-export.js's
// export feature already relies on) up until hitting one of ours. That's "everything they
// said since we last sent" — usually one reply, but this also covers back-to-back replies
// sent before a check ran. 20 is generous headroom; a real new-reply run is almost always 1-2.
async function fetchNewReplyText(conversationId) {
  const stubs = await fetchMessageStubs(missivePersonalRequest, conversationId, 20)
  const theirs = []
  for (const stub of stubs) {
    if (stub.author) break
    theirs.push(stub)
  }
  if (!theirs.length) return ''

  const full = await fetchFullMessages(missivePersonalRequest, theirs.map(m => m.id))
  const byId = new Map(full.map(m => [m.id, m]))
  return theirs
    .slice()
    .reverse() // oldest of the new replies first
    .map(stub => {
      const fullRaw = byId.get(stub.id)?.body || ''
      const previewRaw = stub.preview || stub.body || ''
      // Prefer whichever raw text is actually longer — guards against the full-message fetch
      // silently resolving to something no longer than the list endpoint's own short preview
      // (a real run got back a ~140-char, mid-word-truncated snippet under `body` instead of
      // the real multi-paragraph reply — root cause unconfirmed, this is a safety net on top
      // of the envelope-key fix in missiveMessages.js, not a replacement for it).
      const raw = fullRaw.length >= previewRaw.length ? fullRaw : previewRaw
      return bodyToPlainText(raw)
    })
    .join('\n\n---\n\n')
}

const REPLY_SUMMARY_PROMPT = `You are processing an email reply for an outreach team member. The text below is a reply FROM the person we emailed (an outreach/guest-post/link-building contact) — never summarize or translate our own outgoing email, only theirs. Respond in Markdown.

First, check whether the email is written in English.
- If it is NOT in English: start with a "## Original Reply (Translated to English)" section containing a complete, faithful English translation of their entire email — translate it as-is, do not summarize, shorten, or skip any of it here. Then continue with the sections below.
- If it IS already in English: skip that section entirely and start directly with "## TL;DR".

Then always include these sections, in this order, written in English regardless of the reply's original language:

## TL;DR
1-3 sentences on what they said and what it means for us.

## Guidelines
Bullet points for any requirements, conditions, rules, or restrictions they mentioned (e.g. content requirements, turnaround time, what they will/won't do). Omit this whole section if they mentioned none.

## Pricing
Every price, rate, or cost they mentioned, each as its own clearly labeled bullet point (e.g. "- Guest post: $50" / "- Do-follow link: $30 one-time"). Omit this whole section if they mentioned no pricing.

Keep the TL;DR/Guidelines/Pricing sections tight and scannable. Do not invent information that isn't in the email below.`

// Best-effort, same contract as the rest of this file's post-send steps: a failure here
// never surfaces as anything other than its own { posted: false, error } entry — it's always
// called after a reply is already confirmed to exist, so it must never look like the reply
// itself failed.
async function summarizeAndPostReply(conversationId) {
  const replyText = await fetchNewReplyText(conversationId)
  if (!replyText.trim()) return { posted: false }

  // A non-English reply gets a full translation ahead of the summary (see the prompt), which
  // can run considerably longer than the summary alone — the default cap was sized for
  // English-only input.
  const summary = await glmComplete([
    { role: 'system', content: REPLY_SUMMARY_PROMPT },
    { role: 'user', content: replyText.slice(0, 12000) },
  ], { maxTokens: 2000 })
  await postConversationNote(conversationId, summary, 'Reply summary (AI)')
  return { posted: true }
}

async function summarizeReplies(conversationIds) {
  const CONCURRENCY = 2 // each one is a Missive messages fetch plus a GLM call — gentler
  // than the plain Missive-only loops elsewhere in this file.

  // Only ONE slice's worth per call, not every slice in a loop: each GLM call is already
  // bounded close to this endpoint's own 60s (Hobby plan) ceiling, so two SEQUENTIAL slices
  // could exceed it even though neither one alone would. Anything left over keeps
  // `summaryPosted: false` with no error, so it naturally reappears as "newly replied" (still
  // eligible, not yet summarized) on the caller's next check instead of being lost.
  const slice = conversationIds.slice(0, CONCURRENCY)
  const settled = await Promise.allSettled(slice.map(id => summarizeAndPostReply(id)))
  return settled.map((r, bi) => {
    const conversationId = slice[bi]
    if (r.status === 'fulfilled') return { conversationId, posted: r.value.posted }
    if (r.reason?.isTimeout) return { conversationId, posted: false, pending: true, error: r.reason.message }
    return { conversationId, posted: false, error: r.reason?.message || 'Failed' }
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
        // A real send showed the note appearing ABOVE the email it was about in Missive's
        // UI, even though this call only ever fires after the draft POST above already
        // returned. Most likely explanation: `delivered_at` on the email message reflects
        // actual SMTP delivery, which completes some time after our send request returns,
        // while a post's timestamp is set immediately on creation — so a note posted right
        // away can easily land before the email's own delivered_at. There's no API-level way
        // to pin a post's position, so this is a pragmatic delay to bias toward correct
        // ordering, not a guarantee.
        await sleep(5000)
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
      return res.json({ results: await checkConversationReplies(missivePersonalRequest, entries) })
    }

    if (action === 'summarizeReplies') {
      const { conversationIds } = payload
      if (!Array.isArray(conversationIds) || !conversationIds.length) return res.json({ results: [] })
      return res.json({ results: await summarizeReplies(conversationIds) })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
