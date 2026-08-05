const TOOLS = [
  {
    path: '/anchor-extractor',
    title: 'Anchor Link Extractor',
    desc: 'Paste multiple Google Doc links and pull out every hyperlink\'s anchor text + destination URL — formatted to paste straight into a Google Sheet.',
    tag: 'Google Docs',
  },
  {
    path: '/url-fetcher',
    title: 'URL Fetcher',
    desc: 'Paste cells copied from Google Sheets (or any hyperlinked text) and extract all the underlying links, in order.',
    tag: 'Google Sheets',
  },
  {
    path: '/domain-extractor',
    title: 'Domain Extractor',
    desc: 'Paste an outreach email — tables, bullet lists, plain text — and get back a clean, deduplicated list of domains.',
    tag: 'Email',
  },
]

export function PublicToolsPage() {
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
    card: { width: '100%', maxWidth: 720 },
    logo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 },
    logoBox: {
      width: 36, height: 36, borderRadius: 8,
      background: 'var(--accent)', color: 'var(--accent-ink)',
      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18,
    },
    logoLabel: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' },
    heading: { fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.03em' },
    sub: { fontSize: 14, color: 'var(--text-dim)', marginBottom: 32, lineHeight: 1.6 },
    list: { display: 'flex', flexDirection: 'column', gap: 12 },
    toolCard: {
      display: 'block',
      textDecoration: 'none',
      color: 'inherit',
      border: '1px solid var(--border-strong)',
      borderRadius: 12,
      padding: '18px 20px',
      background: 'var(--surface)',
      transition: 'border-color .15s, background .15s',
    },
    toolHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
    toolTitle: { fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' },
    tag: {
      fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
      borderRadius: 5, padding: '2px 8px',
    },
    toolDesc: { fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 10 },
    toolLink: { fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' },
    footer: { fontSize: 12, color: 'var(--text-ghost)', marginTop: 32, textAlign: 'center' },
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoBox}>R</div>
          <span style={S.logoLabel}>Relay</span>
        </div>

        <h1 style={S.heading}>Free Tools</h1>
        <p style={S.sub}>
          A few small, no-login utilities we built for outreach work. Pick one below — nothing to sign up for.
        </p>

        <div style={S.list}>
          {TOOLS.map(t => (
            <a
              key={t.path}
              href={t.path}
              style={S.toolCard}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-strong)' }}
            >
              <div style={S.toolHead}>
                <span style={S.toolTitle}>{t.title}</span>
                <span style={S.tag}>{t.tag}</span>
              </div>
              <div style={S.toolDesc}>{t.desc}</div>
              <div style={S.toolLink}>{t.path} →</div>
            </a>
          ))}
        </div>

        <div style={S.footer}>More tools get added here over time.</div>
      </div>
    </div>
  )
}
