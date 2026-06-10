// Vercel Cron Job — runs at midnight (configurable in vercel.json)
// Checks who hasn't submitted a daily report and sends reminder emails.
// Also sends an end-of-day status summary to the lead.

import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
)

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
)
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })

// ── Team config ─────────────────────────────────────────────
// Keep emails in sync with src/data.jsx
const MEMBERS = [
  { id: 'neha',   name: 'Neha M',    email: 'neha.m@amrytt.com' },
  { id: 'preeti', name: 'Preeti S',  email: 'preeti.s@amrytt.com' },
  { id: 'keyur',  name: 'Keyur D',   email: 'keyur.d@amrytt.com' },
  { id: 'arjun',  name: 'Arjun M',   email: 'arjun.m@amrytt.com' },
  { id: 'neel',   name: 'Neel P',    email: 'neel.p@amrytt.com' },
]
const LEAD_EMAIL = 'dev.p@amrytt.com'
const APP_URL = process.env.APP_URL || 'https://relay.vercel.app'

// ── Helpers ──────────────────────────────────────────────────
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function buildRaw({ to, subject, html }) {
  const msg = [`To: ${to}`, `Subject: ${subject}`, `MIME-Version: 1.0`, `Content-Type: text/html; charset=UTF-8`, ``, html].join('\r\n')
  return Buffer.from(msg).toString('base64url')
}

async function sendEmail({ to, subject, html }) {
  const { token } = await oauth2Client.getAccessToken()
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: buildRaw({ to, subject, html }) }),
  })
  if (!r.ok) {
    const err = await r.json()
    throw new Error(err.error?.message || `Gmail ${r.status}`)
  }
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  const today     = todayStr()
  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const { data: reports } = await supabase
    .from('daily_reports')
    .select('member_id, total')
    .eq('date', today)

  const submittedIds = new Set((reports || []).map(r => r.member_id))
  const submitted    = MEMBERS.filter(m => submittedIds.has(m.id))
  const pending      = MEMBERS.filter(m => !submittedIds.has(m.id))

  const log = []

  // Send reminder to each member who hasn't submitted
  for (const m of pending) {
    try {
      await sendEmail({
        to: m.email,
        subject: `Reminder: Daily Report for ${dateLabel}`,
        html: reminderHtml({ name: m.name.split(' ')[0], date: dateLabel }),
      })
      log.push({ id: m.id, sent: true })
    } catch (err) {
      log.push({ id: m.id, sent: false, error: err.message })
    }
  }

  // Send status summary to lead
  try {
    await sendEmail({
      to: LEAD_EMAIL,
      subject: `End-of-day Summary — ${dateLabel}`,
      html: summaryHtml({ date: dateLabel, submitted, pending, reports: reports || [] }),
    })
  } catch (_) {}

  res.json({ ok: true, date: today, pending: pending.map(m => m.id), log })
}

// ── Email templates ───────────────────────────────────────────
function reminderHtml({ name, date }) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:40px auto;color:#111;padding:0 20px;">
  <div style="background:#18181b;border-radius:12px;padding:24px;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#a3e635;">Relay</div>
    <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">${date}</div>
  </div>
  <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;">Hi ${name} 👋</h2>
  <p style="color:#52525b;line-height:1.7;margin:0 0 24px;">
    You haven't submitted your daily report yet for <strong style="color:#111;">${date}</strong>.
    It only takes 2 minutes — please log your activity before end of day.
  </p>
  <a href="${APP_URL}" style="display:inline-block;background:#a3e635;color:#000;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:8px;">
    Submit my report →
  </a>
  <p style="color:#a1a1aa;font-size:11px;margin-top:36px;border-top:1px solid #e4e4e7;padding-top:16px;">Sent by Relay · internal team tool</p>
</body>
</html>`
}

function summaryHtml({ date, submitted, pending, reports }) {
  const rows = [...submitted, ...pending].map(m => {
    const rep  = reports.find(r => r.member_id === m.id)
    const done = !!rep
    return `<tr style="border-top:1px solid #f4f4f5;">
      <td style="padding:10px 14px;font-size:14px;">${m.name}</td>
      <td style="padding:10px 14px;text-align:right;font-size:14px;font-weight:600;color:${done ? '#16a34a' : '#d4d4d8'};">${done ? rep.total : '—'}</td>
      <td style="padding:10px 14px;text-align:center;font-size:16px;">${done ? '✅' : '⏳'}</td>
    </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:40px auto;color:#111;padding:0 20px;">
  <div style="background:#18181b;border-radius:12px;padding:24px;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#a3e635;">Relay</div>
    <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">${date} · End-of-day summary</div>
  </div>
  <h2 style="font-size:18px;font-weight:600;margin:0 0 16px;">Daily Report Status</h2>
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Member</th>
        <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Total</th>
        <th style="padding:10px 14px;text-align:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="color:#6b7280;font-size:12px;margin-top:20px;">${submitted.length} of ${submitted.length + pending.length} submitted · Sent by Relay</p>
</body>
</html>`
}
