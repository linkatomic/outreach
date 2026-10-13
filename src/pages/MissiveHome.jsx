import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'
import { loadPersonalEmailSentLog, loadPersonalEmailBatches, loadPersonalEmailTemplates } from '../lib/supabase.js'

// Personal to Dev alone — kept in sync with the same check in Shell.jsx/PersonalEmailSender.jsx.
const MISSIVE_MEMBER_ID = 'dev'

function isToday(iso) {
  const d = new Date(iso), now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function MissiveHome({ me, setRoute }) {
  if (me?.id !== MISSIVE_MEMBER_ID) {
    return (
      <div className="page" style={{ maxWidth: 600 }}>
        <div className="page-head"><div><h1>Missive</h1></div></div>
        <div className="card" style={{ padding: 20, fontSize: 13, color: 'var(--text-faint)' }}>
          This module is restricted to a specific user.
        </div>
      </div>
    )
  }

  const [log, setLog] = useState([])
  const [batches, setBatches] = useState([])
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([loadPersonalEmailSentLog(), loadPersonalEmailBatches(), loadPersonalEmailTemplates()])
      .then(([l, b, t]) => { setLog(l); setBatches(b); setTemplates(t) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const sentToday = log.filter(e => isToday(e.sent_at)).length
  const pendingInBatches = batches.reduce((sum, b) => sum + (b.rows || []).filter(r => r.status !== 'sent').length, 0)

  const stats = [
    { label: 'Emails Sent',    value: loading ? '—' : log.length,        icon: 'mail',    color: 'var(--accent)' },
    { label: 'Sent Today',     value: loading ? '—' : sentToday,         icon: 'activity', color: 'var(--ok)' },
    { label: 'Saved Templates', value: loading ? '—' : templates.length, icon: 'layers',  color: 'var(--info)' },
    { label: 'Not Yet Sent',   value: loading ? '—' : pendingInBatches,  icon: 'clock',   color: 'var(--warn)' },
  ]

  const tools = [
    { id: 'missive-sender',   title: 'Email Sender', desc: 'Compose templates, build batches of recipients, and send individually via Missive', icon: 'mail' },
    { id: 'missive-tracking', title: 'Tracking', desc: 'See which batches went out, sent/pending/failed counts, and reply status', icon: 'activity' },
  ]

  const recentSends = log.slice(0, 6)

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>Missive</h1>
          <div className="sub">Email flows built on Missive — sending, tracking, follow-ups</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>{s.label}</span>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: `color-mix(in srgb, ${s.color} 15%, transparent)`, display: 'grid', placeItems: 'center', color: s.color }}>
                <Icon name={s.icon} size={13} />
              </div>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 12 }}>
        Tools
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        {tools.map(tool => (
          <div key={tool.id} className="card" onClick={() => setRoute?.(tool.id)} style={{ cursor: 'pointer' }}>
            <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                <Icon name={tool.icon} size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{tool.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>{tool.desc}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                Open <Icon name="arrow" size={11} />
              </div>
            </div>
          </div>
        ))}
        <div className="card" style={{ opacity: 0.5 }}>
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)' }}>
              <Icon name="plus" size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>More coming</div>
              <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>Follow-up tracking, email tracking, and more — ask and it lands here.</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Recent Sends</h3>
        </div>
        {loading ? (
          <div style={{ padding: '24px 16px', fontSize: 13, color: 'var(--text-faint)' }}>Loading…</div>
        ) : recentSends.length === 0 ? (
          <div style={{ padding: '24px 16px', fontSize: 13, color: 'var(--text-faint)' }}>No emails sent yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Sent</th><th>Recipient</th><th>Subject</th><th>Missive</th></tr>
            </thead>
            <tbody>
              {recentSends.map(entry => (
                <tr key={entry.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(entry.sent_at).toLocaleString()}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {entry.recipient_name ? `${entry.recipient_name} ` : ''}
                    <span className="faint">&lt;{entry.recipient_email}&gt;</span>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{entry.subject || <span className="faint">—</span>}</td>
                  <td>
                    {entry.web_url
                      ? <a href={entry.web_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>
                      : <span className="faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
