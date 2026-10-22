import { useState } from 'react'
import { Icon } from '../data.jsx'
import { lookupMissiveEmail } from '../lib/supabase.js'

function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

// Three distinct outcomes, not just found/not-found — "they emailed us but we never replied"
// is meaningfully different from "never contacted at all" for deciding whether to reach out.
function StatusBadge({ everSent, everContacted }) {
  if (everSent) return <span style={{ color: '#4ade80', fontWeight: 600 }}>✓ We've sent them an email</span>
  if (everContacted) return <span style={{ color: '#f59e0b', fontWeight: 600 }}>⚠ They've contacted us — we never sent</span>
  return <span style={{ color: 'var(--text-faint)', fontWeight: 600 }}>✗ Never contacted</span>
}

function ConversationTable({ conversations }) {
  if (!conversations.length) return null
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', marginTop: 12 }}>
      <table className="table">
        <thead>
          <tr><th>Subject</th><th>Last Activity</th><th>We Sent?</th><th>Last Sent</th><th></th></tr>
        </thead>
        <tbody>
          {conversations.map(c => (
            <tr key={c.id}>
              <td style={{ whiteSpace: 'normal' }}>{c.subject}</td>
              <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(c.lastActivityAt)}</td>
              <td>{c.hasOutbound ? <span style={{ color: '#4ade80' }}>Yes</span> : <span className="faint">No</span>}</td>
              <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(c.lastSentAt) || <span className="faint">—</span>}</td>
              <td>
                {c.webUrl && <a href={c.webUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Single lookup ─────────────────────────────────────────────────────────────

function SingleLookup() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)

  async function search() {
    const e = email.trim().toLowerCase()
    if (!e) return
    setLoading(true); setErr(''); setResult(null)
    try {
      setResult(await lookupMissiveEmail(e))
    } catch (err2) {
      setErr(err2.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 700 }}>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.6 }}>
        Checks every Missive conversation involving this address and tells you whether we've ever
        sent them an email — and if so, when and which thread.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="input"
          style={{ flex: 1, fontSize: 13 }}
          placeholder="name@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          autoFocus
        />
        <button className="btn primary" onClick={search} disabled={!email.trim() || loading}>
          {loading ? 'Searching…' : <><Icon name="search" size={12} /> Search</>}
        </button>
      </div>

      {err && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>{err}</div>}

      {result && (
        <div className="card card-pad">
          <div style={{ fontSize: 14, marginBottom: 8 }}><StatusBadge everSent={result.everSent} everContacted={result.everContacted} /></div>
          {result.everSent && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 16 }}>
              <span>First sent: <strong style={{ color: 'var(--text)' }}>{fmtDate(result.firstSentAt)}</strong></span>
              <span>Last sent: <strong style={{ color: 'var(--text)' }}>{fmtDate(result.lastSentAt)}</strong></span>
            </div>
          )}
          <ConversationTable conversations={result.conversations} />
        </div>
      )}
    </div>
  )
}

// ── Bulk lookup ───────────────────────────────────────────────────────────────

const BULK_CONCURRENCY = 3 // Missive's documented limit is 5 concurrent — stays under it
// since each email's lookup itself issues several sequential Missive requests internally.

function BulkLookup() {
  const [text, setText] = useState('')
  const [rows, setRows] = useState([]) // { email, status: 'pending'|'done'|'error', result, error }
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  async function run() {
    const emails = [...new Set(text.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean))]
    if (!emails.length) return
    setRunning(true)
    setProgress({ done: 0, total: emails.length })
    const initial = emails.map(email => ({ email, status: 'pending', result: null, error: null }))
    setRows(initial)

    const queue = emails.map((_, i) => i)
    let done = 0
    async function worker() {
      while (queue.length) {
        const i = queue.shift()
        const email = emails[i]
        try {
          const result = await lookupMissiveEmail(email)
          setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'done', result } : r))
        } catch (err) {
          setRows(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', error: err.message } : r))
        }
        done += 1
        setProgress({ done, total: emails.length })
      }
    }
    await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, queue.length) }, worker))
    setRunning(false)
  }

  function copyResults() {
    const lines = rows.map(r => {
      if (r.status === 'error') return `${r.email}: error — ${r.error}`
      if (!r.result) return `${r.email}: pending`
      const status = r.result.everSent ? 'SENT' : r.result.everContacted ? 'CONTACTED (never sent)' : 'NEVER CONTACTED'
      const lastSent = r.result.lastSentAt ? ` — last sent ${fmtDate(r.result.lastSentAt)}` : ''
      const link = r.result.conversations[0]?.webUrl || ''
      return `${r.email}: ${status}${lastSent}${link ? ` — ${link}` : ''}`
    })
    navigator.clipboard.writeText(lines.join('\n'))
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.6 }}>
        Paste one email per line — each is checked the same way as a single search, {BULK_CONCURRENCY} at a time.
      </p>
      <textarea
        className="input"
        rows={6}
        style={{ fontSize: 13, fontFamily: 'var(--font-mono)', width: '100%', resize: 'vertical' }}
        placeholder={'name1@example.com\nname2@example.com'}
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={running}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 16, alignItems: 'center' }}>
        <button className="btn primary" onClick={run} disabled={!text.trim() || running}>
          {running ? `Searching ${progress.done}/${progress.total}…` : <><Icon name="search" size={12} /> Search All</>}
        </button>
        {rows.length > 0 && !running && (
          <button className="btn ghost" onClick={copyResults}><Icon name="copy" size={11} /> Copy Results</button>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 600 }}>
          <table className="table">
            <thead>
              <tr><th>Email</th><th>Status</th><th>Last Sent</th><th>Conversations</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.email}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.email}</td>
                  <td>
                    {r.status === 'pending' && <span className="faint">Searching…</span>}
                    {r.status === 'error' && <span style={{ color: '#ff8fa3' }}>Error</span>}
                    {r.status === 'done' && <StatusBadge everSent={r.result.everSent} everContacted={r.result.everContacted} />}
                  </td>
                  <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {r.status === 'done' ? (fmtDate(r.result.lastSentAt) || <span className="faint">—</span>) : ''}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {r.status === 'done' ? r.result.conversations.length : ''}
                  </td>
                  <td>
                    {r.status === 'done' && r.result.conversations[0]?.webUrl && (
                      <a href={r.result.conversations[0].webUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open →</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function MissiveEmailLookup() {
  const [tab, setTab] = useState('single') // 'single' | 'bulk'
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className="seg">
          <button className={tab === 'single' ? 'on' : ''} onClick={() => setTab('single')}>Single</button>
          <button className={tab === 'bulk' ? 'on' : ''} onClick={() => setTab('bulk')}>Bulk</button>
        </span>
      </div>
      {tab === 'single' ? <SingleLookup /> : <BulkLookup />}
    </div>
  )
}
