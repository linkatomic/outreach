import { useState, useMemo } from 'react'
import { Icon } from '../data.jsx'
import { lookupMissiveEmail } from '../lib/supabase.js'

function fmtDate(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

async function copyLines(lines, label, setStatus) {
  if (!lines.length) { setStatus(`No ${label} to copy`); setTimeout(() => setStatus(''), 2000); return }
  try {
    await navigator.clipboard.writeText(lines.join('\n'))
    setStatus(`Copied ${lines.length} ${label}`)
  } catch {
    setStatus('Copy failed — clipboard access was blocked')
  }
  setTimeout(() => setStatus(''), 2500)
}

// Three distinct outcomes, not just found/not-found — "they emailed us but we never replied"
// is meaningfully different from "never contacted at all" for deciding whether to reach out.
function statusInfo(everSent, everContacted) {
  if (everSent) return { cls: 'ok', dot: 'ok', label: "Sent" }
  if (everContacted) return { cls: 'warn', dot: 'warn', label: 'Contacted — never sent' }
  return { cls: '', dot: '', label: 'Never contacted' }
}

function StatusChip({ everSent, everContacted }) {
  const s = statusInfo(everSent, everContacted)
  return (
    <span className={`chip${s.cls ? ' ' + s.cls : ''}`}>
      {s.dot && <span className={`dot-status ${s.dot}`} />}
      {s.label}
    </span>
  )
}

function ConversationTable({ conversations }) {
  if (!conversations.length) return null
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', marginTop: 14 }}>
      <table className="table">
        <thead>
          <tr><th>Subject</th><th>Last Activity</th><th>We Sent?</th><th>Last Sent</th><th></th></tr>
        </thead>
        <tbody>
          {conversations.map(c => (
            <tr key={c.id}>
              <td style={{ whiteSpace: 'normal' }}>{c.subject}</td>
              <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(c.lastActivityAt)}</td>
              <td>{c.hasOutbound ? <span className="chip ok">Yes</span> : <span className="chip">No</span>}</td>
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
    <div style={{ maxWidth: 720 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: result.everSent ? 10 : 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{result.email}</span>
            <StatusChip everSent={result.everSent} everContacted={result.everContacted} />
          </div>
          {result.everSent && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 20 }}>
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

// Each email's lookup already fans out one Missive request per conversation it finds (capped
// at 4 concurrent in-flight by api/_lib/missive.js's own semaphore, since a single contact
// with several threads could otherwise blow past Missive's 5-concurrent limit alone) — running
// more than one of those lookups at once stacks invocations on top of each other with no
// shared limiter between them, so bulk stays fully sequential rather than risking that stack.
const BULK_CONCURRENCY = 1

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'contacted', label: 'Contacted — never sent' },
  { key: 'never', label: 'Never contacted' },
  { key: 'error', label: 'Errors' },
]

function rowBucket(r) {
  if (r.status === 'error') return 'error'
  if (r.status !== 'done') return 'pending'
  if (r.result.everSent) return 'sent'
  if (r.result.everContacted) return 'contacted'
  return 'never'
}

function BulkLookup() {
  const [text, setText] = useState('')
  const [rows, setRows] = useState([]) // { email, status: 'pending'|'done'|'error', result, error }
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [filter, setFilter] = useState('all')
  const [copyStatus, setCopyStatus] = useState('')

  const pendingCount = text.split('\n').map(l => l.trim()).filter(Boolean).length

  async function run() {
    const emails = [...new Set(text.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean))]
    if (!emails.length) return
    setRunning(true)
    setFilter('all')
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

  const counts = useMemo(() => {
    const c = { all: rows.length, sent: 0, contacted: 0, never: 0, error: 0 }
    for (const r of rows) {
      const b = rowBucket(r)
      if (b !== 'pending') c[b] = (c[b] || 0) + 1
    }
    return c
  }, [rows])

  const visibleRows = filter === 'all' ? rows : rows.filter(r => rowBucket(r) === filter)

  function copyNeverContacted() {
    const emails = rows.filter(r => rowBucket(r) === 'never').map(r => r.email)
    copyLines(emails, 'never-contacted email' + (emails.length === 1 ? '' : 's'), setCopyStatus)
  }

  function copyAllResults() {
    const lines = rows.map(r => {
      if (r.status === 'error') return `${r.email}: error — ${r.error}`
      if (!r.result) return `${r.email}: pending`
      const status = r.result.everSent ? 'SENT' : r.result.everContacted ? 'CONTACTED (never sent)' : 'NEVER CONTACTED'
      const lastSent = r.result.lastSentAt ? ` — last sent ${fmtDate(r.result.lastSentAt)}` : ''
      const link = r.result.conversations[0]?.webUrl || ''
      return `${r.email}: ${status}${lastSent}${link ? ` — ${link}` : ''}`
    })
    copyLines(lines, 'result line' + (lines.length === 1 ? '' : 's'), setCopyStatus)
  }

  const STAT_TILES = [
    { key: 'sent', label: 'Sent', icon: 'mail', color: 'var(--ok)' },
    { key: 'contacted', label: 'Contacted, never sent', icon: 'alert', color: 'var(--warn)' },
    { key: 'never', label: 'Never contacted', icon: 'inbox', color: 'var(--text-faint)' },
    { key: 'error', label: 'Errors', icon: 'flash', color: 'var(--danger)' },
  ]

  return (
    <div style={{ maxWidth: 980 }}>
      <textarea
        className="input"
        rows={5}
        style={{ fontSize: 13, fontFamily: 'var(--font-mono)', width: '100%', resize: 'vertical' }}
        placeholder={'name1@example.com\nname2@example.com'}
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={running}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 18 }}>
        <button className="btn primary" onClick={run} disabled={!text.trim() || running}>
          {running ? `Searching ${progress.done}/${progress.total}…` : <><Icon name="search" size={12} /> Search All</>}
        </button>
        {!running && pendingCount > 0 && rows.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{pendingCount} email{pendingCount !== 1 ? 's' : ''} ready</span>
        )}
        {running && (
          <div style={{ flex: 1, maxWidth: 240, height: 6, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, background: 'var(--accent)',
              width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              transition: 'width 0.2s ease',
            }} />
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
            {STAT_TILES.map(s => (
              <button
                key={s.key}
                onClick={() => setFilter(filter === s.key ? 'all' : s.key)}
                className="card card-pad"
                style={{
                  display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left', cursor: 'pointer',
                  border: filter === s.key ? `1px solid ${s.color}` : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 500 }}>{s.label}</span>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: `color-mix(in srgb, ${s.color} 15%, transparent)`, display: 'grid', placeItems: 'center', color: s.color, flexShrink: 0 }}>
                    <Icon name={s.icon} size={13} />
                  </div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{counts[s.key] || 0}</div>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="seg">
              {FILTERS.map(f => (
                <button key={f.key} className={filter === f.key ? 'on' : ''} onClick={() => setFilter(f.key)}>
                  {f.label}{f.key !== 'all' ? ` (${counts[f.key] || 0})` : ''}
                </button>
              ))}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {copyStatus && <span style={{ fontSize: 12, color: 'var(--accent)' }}>{copyStatus}</span>}
              <button className="btn ghost" onClick={copyNeverContacted} disabled={!counts.never}>
                <Icon name="copy" size={11} /> Copy Never Contacted ({counts.never || 0})
              </button>
              <button className="btn ghost" onClick={copyAllResults} disabled={running}>
                <Icon name="copy" size={11} /> Copy All Results
              </button>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 560 }}>
            <table className="table">
              <thead>
                <tr><th>Email</th><th>Status</th><th>Last Sent</th><th>Conversations</th><th></th></tr>
              </thead>
              <tbody>
                {visibleRows.map(r => (
                  <tr key={r.email}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.email}</td>
                    <td>
                      {r.status === 'pending' && <span className="faint">Searching…</span>}
                      {r.status === 'error' && <span className="chip danger" title={r.error}>Error</span>}
                      {r.status === 'done' && <StatusChip everSent={r.result.everSent} everContacted={r.result.everContacted} />}
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
          {filter !== 'all' && (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 8 }}>
              Showing {visibleRows.length} of {rows.length} — <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setFilter('all')}>clear filter</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function MissiveEmailLookup() {
  const [tab, setTab] = useState('single') // 'single' | 'bulk'
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Email Lookup</h1>
          <div className="sub">Check whether we've ever emailed an address before — and when, and in which thread</div>
        </div>
        <div className="actions">
          <span className="seg">
            <button className={tab === 'single' ? 'on' : ''} onClick={() => setTab('single')}>Single</button>
            <button className={tab === 'bulk' ? 'on' : ''} onClick={() => setTab('bulk')}>Bulk</button>
          </span>
        </div>
      </div>
      {tab === 'single' ? <SingleLookup /> : <BulkLookup />}
    </div>
  )
}
