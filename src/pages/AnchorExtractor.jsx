import { useState } from 'react'

function parseDocUrls(text) {
  return text
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
}

// Builds one row per doc: AnchorText1 \t AnchorURL1 \t AnchorText2 \t AnchorURL2 ...
// Pasting this directly into Google Sheets spreads each doc's links across paired columns.
function buildSheetText(docs) {
  return docs
    .filter(d => !d.error && d.links?.length)
    .map(d => d.links.flatMap(l => [l.text, l.url]).join('\t'))
    .join('\n')
}

function DocCard({ doc }) {
  const hasError = !!doc.error
  const count = doc.links?.length || 0

  return (
    <div style={{
      border: `1px solid ${hasError ? 'rgba(255,92,124,.3)' : count ? 'var(--border)' : 'var(--border)'}`,
      borderRadius: 10,
      background: 'var(--surface)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: hasError ? 'none' : '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
          {doc.title || doc.docId || doc.input}
        </span>
        {hasError ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#ff8fa3', flexShrink: 0 }}>Error</span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: count ? 'var(--accent)' : 'var(--text-faint)', flexShrink: 0 }}>
            {count} link{count !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {hasError ? (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>{doc.error}</div>
      ) : count === 0 ? (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-ghost)' }}>No hyperlinks found in this doc.</div>
      ) : (
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {doc.links.map((l, i) => (
                <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '7px 12px', color: 'var(--text-dim)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.text}</td>
                  <td style={{ padding: '7px 12px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', wordBreak: 'break-all' }}>{l.url}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function AnchorExtractorPage() {
  const [inputText, setInputText] = useState('')
  const [docs, setDocs]           = useState([])
  const [running, setRunning]     = useState(false)
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)

  const urls   = parseDocUrls(inputText)
  const canRun = urls.length > 0 && !running

  async function run() {
    if (!canRun) return
    setRunning(true)
    setError('')
    setDocs([])
    try {
      const res = await fetch('/api/doc-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDocs(data.results || [])
    } catch (err) {
      setError('Something went wrong: ' + err.message)
    } finally {
      setRunning(false)
    }
  }

  function copyForSheets() {
    const text = buildSheetText(docs)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function clear() {
    setInputText('')
    setDocs([])
    setError('')
  }

  const totalLinks   = docs.reduce((s, d) => s + (d.links?.length || 0), 0)
  const successCount = docs.filter(d => !d.error).length
  const errorCount   = docs.filter(d => d.error).length

  const S = {
    page: {
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px 80px',
    },
    card: { width: '100%', maxWidth: 760 },
    logo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 },
    logoBox: {
      width: 36, height: 36, borderRadius: 8,
      background: 'var(--accent)', color: 'var(--accent-ink)',
      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18,
    },
    logoLabel: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' },
    heading: { fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.03em' },
    sub: { fontSize: 14, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.6 },
    note: {
      fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 8, padding: '9px 13px',
      marginTop: 12, marginBottom: 24, lineHeight: 1.6,
    },
    label: { fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'block' },
    textarea: {
      width: '100%', minHeight: 130, resize: 'vertical',
      border: '1.5px solid var(--border-strong)', borderRadius: 10,
      padding: '14px 16px', background: 'var(--surface)',
      fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)',
      outline: 'none', lineHeight: 1.6, boxSizing: 'border-box',
    },
    hint: { fontSize: 12, color: 'var(--text-ghost)', marginTop: 6 },
    actionRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, flexWrap: 'wrap' },
    btnAccent: {
      background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none',
      borderRadius: 6, padding: '9px 20px', fontWeight: 700, fontSize: 13,
      cursor: 'pointer', fontFamily: 'var(--font-sans)', minWidth: 140,
    },
    btnGhost: {
      background: 'transparent', color: 'var(--text-dim)',
      border: '1px solid var(--border-strong)', borderRadius: 6,
      padding: '8px 14px', fontWeight: 600, fontSize: 13,
      cursor: 'pointer', fontFamily: 'var(--font-sans)',
    },
    error: {
      background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)',
      color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginTop: 16,
    },
    resultsHeader: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, marginBottom: 14, flexWrap: 'wrap' },
    statOk: { fontSize: 12, fontWeight: 600, color: 'var(--accent)' },
    statErr: { fontSize: 12, fontWeight: 600, color: '#ff8fa3' },
    statDim: { fontSize: 12, color: 'var(--text-faint)' },
    list: { display: 'flex', flexDirection: 'column', gap: 8 },
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoBox}>R</div>
          <span style={S.logoLabel}>Relay</span>
        </div>

        <h1 style={S.heading}>Anchor Link Extractor</h1>
        <p style={S.sub}>
          Paste one or more Google Doc links below. We'll pull out every hyperlink's
          anchor text and destination URL — ready to paste straight into a Google Sheet.
        </p>
        <div style={S.note}>
          Each doc must be shared as <b>"Anyone with the link can view"</b> — we read the doc's
          public export, no sign-in required on your end.
        </div>

        <span style={S.label}>Google Doc links · one per line</span>
        <textarea
          style={S.textarea}
          placeholder={'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit\nhttps://docs.google.com/document/d/...'}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
        />
        <div style={S.hint}>{urls.length > 0 ? `${urls.length} link${urls.length !== 1 ? 's' : ''} detected` : 'Paste doc share links, one per line'}</div>

        <div style={S.actionRow}>
          <button style={{ ...S.btnAccent, opacity: canRun ? 1 : 0.5, cursor: canRun ? 'pointer' : 'default' }} onClick={run} disabled={!canRun}>
            {running ? 'Extracting…' : `Extract ${urls.length > 0 ? urls.length + ' doc' + (urls.length !== 1 ? 's' : '') : 'Links'}`}
          </button>

          {docs.length > 0 && !running && (
            <>
              <button style={S.btnAccent} onClick={copyForSheets} disabled={successCount === 0}>
                {copied ? 'Copied!' : 'Copy for Sheets'}
              </button>
              <button style={S.btnGhost} onClick={clear}>Clear</button>
            </>
          )}
        </div>

        {error && <div style={S.error}>{error}</div>}

        {docs.length > 0 && (
          <>
            <div style={S.resultsHeader}>
              <span style={S.statOk}>✓ {successCount} doc{successCount !== 1 ? 's' : ''} processed</span>
              <span style={S.statDim}>{totalLinks} link{totalLinks !== 1 ? 's' : ''} total</span>
              {errorCount > 0 && <span style={S.statErr}>⚠ {errorCount} failed</span>}
            </div>

            <div style={S.list}>
              {docs.map((d, i) => <DocCard key={i} doc={d} />)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
