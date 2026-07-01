import { useState, useRef } from 'react'

export function UrlFetcherPage() {
  const [urls, setUrls]     = useState([])
  const [error, setError]   = useState('')
  const [copied, setCopied] = useState(false)
  const pasteRef            = useRef(null)

  function handlePaste(e) {
    e.preventDefault()
    setError('')
    const html = e.clipboardData.getData('text/html')

    if (html) {
      const doc   = new DOMParser().parseFromString(html, 'text/html')
      const links = Array.from(doc.querySelectorAll('a[href]'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && (h.startsWith('http://') || h.startsWith('https://')))
      if (links.length > 0) { setUrls(links); return }
    }

    // Fallback: scan plain text for raw URLs
    const text  = e.clipboardData.getData('text/plain')
    const found = (text || '').match(/https?:\/\/[^\s]+/g) || []
    if (found.length > 0) { setUrls(found); return }

    setError('No links found in the pasted content. Make sure you\'re copying cells that contain hyperlinks.')
  }

  function copyAll() {
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function clear() {
    setUrls([])
    setError('')
    if (pasteRef.current) pasteRef.current.focus()
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
    card: {
      width: '100%',
      maxWidth: 680,
    },
    logo: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 32,
    },
    logoBox: {
      width: 36,
      height: 36,
      borderRadius: 8,
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      display: 'grid',
      placeItems: 'center',
      fontWeight: 800,
      fontSize: 18,
    },
    logoLabel: {
      fontSize: 18,
      fontWeight: 700,
      color: 'var(--text)',
      letterSpacing: '-0.02em',
    },
    heading: {
      fontSize: 26,
      fontWeight: 700,
      marginBottom: 6,
      letterSpacing: '-0.03em',
    },
    sub: {
      fontSize: 14,
      color: 'var(--text-dim)',
      marginBottom: 28,
      lineHeight: 1.6,
    },
    pasteBox: {
      width: '100%',
      minHeight: 120,
      border: '1.5px dashed var(--border-strong)',
      borderRadius: 10,
      padding: '18px 20px',
      background: 'var(--surface)',
      fontSize: 14,
      color: 'var(--text-faint)',
      cursor: 'text',
      outline: 'none',
      lineHeight: 1.5,
      marginBottom: 8,
      transition: 'border-color .15s',
    },
    hint: {
      fontSize: 12,
      color: 'var(--text-ghost)',
      marginBottom: 24,
    },
    error: {
      background: 'rgba(255,92,124,.1)',
      border: '1px solid rgba(255,92,124,.25)',
      color: '#ff8fa3',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 13,
      marginBottom: 20,
    },
    resultsHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
    },
    badge: {
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      borderRadius: 999,
      padding: '2px 10px',
      fontSize: 12,
      fontWeight: 700,
    },
    actions: {
      display: 'flex',
      gap: 8,
    },
    btnAccent: {
      background: 'var(--accent)',
      color: 'var(--accent-ink)',
      border: 'none',
      borderRadius: 6,
      padding: '7px 16px',
      fontWeight: 700,
      fontSize: 13,
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
    },
    btnGhost: {
      background: 'transparent',
      color: 'var(--text-dim)',
      border: '1px solid var(--border-strong)',
      borderRadius: 6,
      padding: '7px 14px',
      fontWeight: 600,
      fontSize: 13,
      cursor: 'pointer',
      fontFamily: 'var(--font-sans)',
    },
    list: {
      listStyle: 'none',
      margin: 0,
      padding: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    },
    listItem: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 13,
    },
    num: {
      fontSize: 11,
      fontWeight: 700,
      color: 'var(--text-ghost)',
      minWidth: 24,
      textAlign: 'right',
      flexShrink: 0,
    },
    urlText: {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--accent)',
      wordBreak: 'break-all',
      flex: 1,
    },
    copyLink: {
      fontSize: 11,
      color: 'var(--text-faint)',
      cursor: 'pointer',
      flexShrink: 0,
      textDecoration: 'none',
      background: 'none',
      border: 'none',
      fontFamily: 'var(--font-sans)',
      padding: 0,
    },
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoBox}>R</div>
          <span style={S.logoLabel}>Relay</span>
        </div>

        <h1 style={S.heading}>URL Fetcher</h1>
        <p style={S.sub}>
          Copy cells from Google Sheets that display "VIEW" (or any text with a hidden link),
          then paste below. The tool extracts all hyperlinks in order.
        </p>

        <div
          ref={pasteRef}
          contentEditable
          suppressContentEditableWarning
          onPaste={handlePaste}
          style={S.pasteBox}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border-strong)'; if (!e.currentTarget.textContent.trim()) e.currentTarget.style.color = 'var(--text-faint)' }}
          data-placeholder="Paste Google Sheets cells here (Ctrl+V / ⌘V)…"
        />
        <div style={S.hint}>Paste directly from Google Sheets — do not convert to plain text first.</div>

        {error && <div style={S.error}>{error}</div>}

        {urls.length > 0 && (
          <>
            <div style={S.resultsHeader}>
              <span style={S.badge}>{urls.length} URL{urls.length !== 1 ? 's' : ''} found</span>
              <div style={S.actions}>
                <button style={S.btnAccent} onClick={copyAll}>
                  {copied ? 'Copied!' : 'Copy All'}
                </button>
                <button style={S.btnGhost} onClick={clear}>Clear</button>
              </div>
            </div>

            <ol style={S.list}>
              {urls.map((url, i) => (
                <li key={i} style={S.listItem}>
                  <span style={S.num}>{i + 1}</span>
                  <span style={S.urlText}>{url}</span>
                  <button
                    style={S.copyLink}
                    onClick={() => navigator.clipboard.writeText(url)}
                    title="Copy this URL"
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
