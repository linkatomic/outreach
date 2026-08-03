// GET  ?type=reminder|summary|report&preview=1  → returns HTML for iframe preview
// POST { type }                                  → sends test email to lead

import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
)
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })

const LEAD_EMAIL = 'dev.p@amrytt.com'
const APP_URL    = process.env.APP_URL || 'https://relay.vercel.app'
const TODAY      = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

// ── Templates ──────────────────────────────────────────────

function reminderHtml() {
  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:40px auto;color:#111;padding:0 20px;">
  <div style="background:#18181b;border-radius:12px;padding:24px;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#a3e635;">Relay</div>
    <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">${TODAY}</div>
  </div>
  <h2 style="font-size:20px;font-weight:600;margin:0 0 12px;">Hi Neha 👋</h2>
  <p style="color:#52525b;line-height:1.7;margin:0 0 24px;">
    You haven't submitted your daily report yet for <strong style="color:#111;">${TODAY}</strong>.
    It only takes 2 minutes — please log your activity before end of day.
  </p>
  <a href="${APP_URL}" style="display:inline-block;background:#a3e635;color:#000;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:8px;">
    Submit my report →
  </a>
  <p style="color:#a1a1aa;font-size:11px;margin-top:36px;border-top:1px solid #e4e4e7;padding-top:16px;">Sent by Relay · internal team tool</p>
</body>
</html>`
}

function summaryHtml() {
  const members = [
    { name: 'Neha M',   total: 58, done: true  },
    { name: 'Preeti S', total: 43, done: true  },
    { name: 'Keyur D',  total: 0,  done: false },
    { name: 'Arjun M',  total: 51, done: true  },
    { name: 'Yaksh B',  total: 0,  done: false },
  ]
  const rows = members.map(m => `
    <tr style="border-top:1px solid #f4f4f5;">
      <td style="padding:10px 14px;font-size:14px;">${m.name}</td>
      <td style="padding:10px 14px;text-align:right;font-size:14px;font-weight:600;color:${m.done ? '#16a34a' : '#d4d4d8'};">${m.done ? m.total : '—'}</td>
      <td style="padding:10px 14px;text-align:center;font-size:16px;">${m.done ? '✅' : '⏳'}</td>
    </tr>`).join('')
  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:540px;margin:40px auto;color:#111;padding:0 20px;">
  <div style="background:#18181b;border-radius:12px;padding:24px;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#a3e635;">Relay</div>
    <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">${TODAY} · End-of-day summary</div>
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
  <p style="color:#6b7280;font-size:12px;margin-top:20px;">3 of 5 submitted · Sent by Relay</p>
</body>
</html>`
}

function reportHtml() {
  const metrics = [
    { label: 'Email responses', value: '32 emails' },
    { label: 'Websites added',  value: '14 sites'  },
    { label: 'Websites audited',value: '21 sites'  },
    { label: 'Vendor updates',  value: '5 vendors' },
  ]
  const rows = metrics.map(m => `
    <tr style="border-top:1px solid #f4f4f5;">
      <td style="padding:8px 14px;font-size:13px;color:#52525b;">${m.label}</td>
      <td style="padding:8px 14px;font-size:13px;font-weight:600;text-align:right;">${m.value}</td>
    </tr>`).join('')
  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:40px auto;color:#111;padding:0 20px;">
  <div style="background:#18181b;border-radius:12px;padding:24px;margin-bottom:28px;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px;color:#a3e635;">Relay</div>
    <div style="font-size:12px;color:#a1a1aa;margin-top:4px;">${TODAY}</div>
  </div>
  <h2 style="font-size:18px;font-weight:600;margin:0 0 4px;">Neha M submitted their report</h2>
  <div style="font-size:28px;font-weight:800;color:#a3e635;margin:16px 0;">72 <span style="font-size:14px;font-weight:400;color:#71717a;">total</span></div>
  <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden;margin-bottom:20px;">
    <thead>
      <tr style="background:#f9fafb;">
        <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Metric</th>
        <th style="padding:9px 14px;text-align:right;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#6b7280;">Value</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="background:#f9fafb;border-radius:8px;padding:14px;font-size:13px;color:#52525b;border-left:3px solid #a3e635;">
    <strong>Note:</strong> Focused on auditing old entries today, a lot of duplicates cleaned up.
  </div>
  <p style="color:#a1a1aa;font-size:11px;margin-top:32px;border-top:1px solid #e4e4e7;padding-top:16px;">Sent by Relay · internal team tool</p>
</body>
</html>`
}

const TEMPLATES = { reminder: reminderHtml, summary: summaryHtml, report: reportHtml }
const SUBJECTS  = {
  reminder: `[TEST] Reminder: Daily Report for ${TODAY}`,
  summary:  `[TEST] End-of-day Summary — ${TODAY}`,
  report:   `[TEST] Neha M filed report — 72 total · ${TODAY}`,
}

// ── Handler ────────────────────────────────────────────────

export default async function handler(req, res) {
  const type    = req.query?.type || 'reminder'
  const preview = req.query?.preview === '1'
  const htmlFn  = TEMPLATES[type]
  if (!htmlFn) return res.status(400).json({ error: `Unknown type: ${type}` })

  const html = htmlFn()

  // GET → return HTML for iframe preview
  if (req.method === 'GET' && preview) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.send(html)
  }

  // POST → send actual test email to lead
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const { token } = await oauth2Client.getAccessToken()
    if (!token) throw new Error('No Gmail token — check GOOGLE_* env vars and gmail.send scope')

    const msg = [
      `To: ${LEAD_EMAIL}`,
      `Subject: ${SUBJECTS[type]}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      html,
    ].join('\r\n')

    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(msg).toString('base64url') }),
    })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.error?.message || `Gmail ${r.status}`)
    }
    res.json({ ok: true, sentTo: LEAD_EMAIL })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
