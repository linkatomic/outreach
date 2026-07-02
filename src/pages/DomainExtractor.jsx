import { useState } from 'react'

function extractDomains(html, text) {
  const seen = new Set()
  const list = []

  function add(raw) {
    if (!raw) return
    // strip trailing punctuation common in emails
    raw = raw.trim().replace(/[.,;|–—>)\]'"«»]+$/, '').trim()
    if (!raw) return
    try {
      const url = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
      if (!host || !host.includes('.') || host.startsWith('.')) return
      if (!seen.has(host)) { seen.add(host); list.push(host) }
    } catch {}
  }

  // 1. HTML clipboard — anchor hrefs (best source: email table links, hyperlinks)
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || ''
        if (/^https?:\/\//i.test(href)) add(href)
      })
    } catch {}
  }

  const t = text || ''

  // 2. Explicit https?:// URLs in plain text
  for (const m of t.matchAll(/https?:\/\/[^\s,;|–—<>"')\]\[]+/gi)) {
    add(m[0])
  }

  // 3. Bare domains (no protocol) — e.g. "mumbaijournals.com — DA 37"
  //    Require: starts with a letter, each segment ≥2 chars, TLD = 2-6 letters only
  for (const m of t.matchAll(/\b([a-zA-Z][a-zA-Z0-9-]{1,}(?:\.[a-zA-Z0-9][a-zA-Z0-9-]{1,})*\.[a-zA-Z]{2,6})(?![a-zA-Z])/g)) {
    add(m[1])
  }

  // Final dedup pass — catches any edge cases where the same domain
  // slips through via different extraction paths (http vs bare, www variants, etc.)
  const finalSeen = new Set()
  return list.filter(d => {
    const key = d.toLowerCase()
    if (finalSeen.has(key)) return false
    finalSeen.add(key)
    return true
  })
}

export function DomainExtractorPage() {
  const [domains, setDomains] = useState([])
  const [error, setError]     = useState('')
  const [copied, setCopied]   = useState(false)
  const [rawCount, setRawCount] = useState(0)

  function handlePaste(e) {
    e.preventDefault()
    setError('')
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')

    const result = extractDomains(html, text)
    setRawCount(result.length)

    if (result.length === 0) {
      setError('No domains found. Try pasting directly from Gmail or Outlook — the email must be open in your browser, not a screenshot.')
      return
    }
    setDomains(result)
  }

  function handleTextInput(e) {
    // Also allow typing/pasting into a plain textarea as fallback
    const text = e.target.value
    const result = extractDomains('', text)
    setDomains(result)
    setError(result.length === 0 && text.trim() ? 'No domains found in this text.' : '')
  }

  function copyAll() {
    navigator.clipboard.writeText(domains.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function clear() {
    setDomains([])
    setError('')
    setRawCount(0)
  }

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
    card: { width: '100%', maxWidth: 700 },
    logo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 },
    logoBox: {
      width: 36, height: 36, borderRadius: 8,
      background: 'var(--accent)', color: 'var(--accent-ink)',
      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18,
    },
    logoLabel: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' },
    heading: { fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.03em' },
    sub: { fontSize: 14, color: 'var(--text-dim)', marginBottom: 6, lineHeight: 1.6 },
    tabs: { display: 'flex', gap: 0, marginBottom: 20, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-strong)', width: 'fit-content' },
    section: { marginBottom: 24 },
    label: { fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, display: 'block' },
    pasteBox: {
      width: '100%', minHeight: 130,
      border: '1.5px dashed var(--border-strong)', borderRadius: 10,
      padding: '18px 20px', background: 'var(--surface)',
      fontSize: 14, color: 'var(--text-faint)', cursor: 'text',
      outline: 'none', lineHeight: 1.5,
    },
    textarea: {
      width: '100%', minHeight: 130, resize: 'vertical',
      border: '1.5px solid var(--border-strong)', borderRadius: 10,
      padding: '14px 16px', background: 'var(--surface)',
      fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)',
      outline: 'none', lineHeight: 1.6,
    },
    hint: { fontSize: 12, color: 'var(--text-ghost)', marginTop: 6 },
    divider: {
      display: 'flex', alignItems: 'center', gap: 12,
      color: 'var(--text-ghost)', fontSize: 12, margin: '20px 0',
    },
    dividerLine: { flex: 1, height: 1, background: 'var(--border)' },
    error: {
      background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)',
      color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 20,
    },
    resultsHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    badge: {
      background: 'var(--accent)', color: 'var(--accent-ink)',
      borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 700,
    },
    actions: { display: 'flex', gap: 8 },
    btnAccent: {
      background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none',
      borderRadius: 6, padding: '7px 16px', fontWeight: 700, fontSize: 13,
      cursor: 'pointer', fontFamily: 'var(--font-sans)',
    },
    btnGhost: {
      background: 'transparent', color: 'var(--text-dim)',
      border: '1px solid var(--border-strong)', borderRadius: 6,
      padding: '7px 14px', fontWeight: 600, fontSize: 13,
      cursor: 'pointer', fontFamily: 'var(--font-sans)',
    },
    list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 },
    listItem: {
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '9px 14px',
    },
    num: { fontSize: 11, fontWeight: 700, color: 'var(--text-ghost)', minWidth: 24, textAlign: 'right', flexShrink: 0 },
    domainText: { fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', flex: 1 },
    copyLink: {
      fontSize: 11, color: 'var(--text-faint)', cursor: 'pointer', flexShrink: 0,
      background: 'none', border: 'none', fontFamily: 'var(--font-sans)', padding: 0,
    },
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoBox}>R</div>
          <span style={S.logoLabel}>Relay</span>
        </div>

        <h1 style={S.heading}>Domain Extractor</h1>
        <p style={S.sub}>
          Paste any outreach email — tables, bullet lists, plain text, whatever format.
          Extracts clean domains like <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 13 }}>example.com</code> and strips everything else.
        </p>

        {/* Rich paste area */}
        <div style={S.section}>
          <span style={S.label}>Paste email (recommended)</span>
          <div
            contentEditable
            suppressContentEditableWarning
            onPaste={handlePaste}
            style={S.pasteBox}
            onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text)' }}
            onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-strong)'; if (!e.currentTarget.innerText.trim()) e.currentTarget.style.color = 'var(--text-faint)' }}
            data-placeholder="Ctrl+V / ⌘V here — works best when you copy directly from Gmail or Outlook in your browser"
          />
          <div style={S.hint}>Preserves hidden hyperlinks from HTML emails. Best method.</div>
        </div>

        <div style={S.divider}>
          <div style={S.dividerLine} />
          <span>or paste as plain text</span>
          <div style={S.dividerLine} />
        </div>

        {/* Plain text fallback */}
        <div style={S.section}>
          <span style={S.label}>Plain text input</span>
          <textarea
            style={S.textarea}
            placeholder={'Paste raw text here if the above doesn\'t work.\nHandles: https://example.com/  |  example.com — DA 40  |  • domain.co.uk'}
            onChange={handleTextInput}
          />
          <div style={S.hint}>Scans for URLs and bare domains. Great for forwarded/copied plain text.</div>
        </div>

        {error && <div style={S.error}>{error}</div>}

        {domains.length > 0 && (
          <>
            <div style={S.resultsHeader}>
              <span style={S.badge}>{domains.length} domain{domains.length !== 1 ? 's' : ''}</span>
              <div style={S.actions}>
                <button style={S.btnAccent} onClick={copyAll}>
                  {copied ? 'Copied!' : 'Copy All'}
                </button>
                <button style={S.btnGhost} onClick={clear}>Clear</button>
              </div>
            </div>

            <ol style={S.list}>
              {domains.map((d, i) => (
                <li key={i} style={S.listItem}>
                  <span style={S.num}>{i + 1}</span>
                  <span style={S.domainText}>{d}</span>
                  <button
                    style={S.copyLink}
                    onClick={() => navigator.clipboard.writeText(d)}
                    title="Copy"
                  >
                    copy
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: var(--text-faint);
          pointer-events: none;
        }
      `}</style>
    </div>
  )
}
