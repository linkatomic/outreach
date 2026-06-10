import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
)
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN })

function buildRaw({ to, subject, html }) {
  const msg = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    ``,
    html,
  ].join('\r\n')
  return Buffer.from(msg).toString('base64url')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { to, subject, html } = req.body || {}
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'to, subject, and html are required' })
  }

  try {
    const { token } = await oauth2Client.getAccessToken()
    if (!token) throw new Error('Could not get Gmail access token — check GOOGLE_* env vars and ensure gmail.send scope is included in the refresh token')

    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: buildRaw({ to, subject, html }) }),
    })
    if (!r.ok) {
      const err = await r.json()
      throw new Error(err.error?.message || `Gmail API error ${r.status}`)
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[send-email]', err.message)
    res.status(500).json({ error: err.message })
  }
}
