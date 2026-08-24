import { useState, useRef } from 'react'
import { Icon } from '../data.jsx'

const CONCURRENCY      = 3    // each request can run up to ~40s server-side, keep this modest
const CARD_RENDER_CAP  = 40   // perf guard — full URL list still included in Copy All regardless
const URLS_PER_CARD_CAP = 150 // perf guard for a single huge site's card

function parseDomains(text) {
  return text
    .split(/\n+/)
    .map(s => s.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase())
    .filter(d => d && d.includes('.'))
}

async function findPosts(domain) {
  const res = await fetch('/api/sample-posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function runCapped(tasks, cap, onResult) {
  let i = 0
  async function next() {
    if (i >= tasks.length) return
    const idx = i++
    try { onResult(idx, await tasks[idx](), null) } catch (err) { onResult(idx, null, err.message) }
    return next()
  }
  await Promise.all(Array.from({ length: Math.min(cap, tasks.length) }, next))
}

const SOURCE_LABEL = { sitemap: 'Sitemap', feed: 'Feed', 'wp-api': 'WP API', homepage: 'Homepage' }
const SOURCE_COLOR = { sitemap: 'var(--accent)', feed: '#60a5fa', 'wp-api': '#a78bfa', homepage: 'var(--text-faint)' }

function SiteCard({ result }) {
  const hasError = !!result.error
  const urls     = result.urls || []
  const shown    = urls.slice(0, URLS_PER_CARD_CAP)

  return (
    <div style={{ border: `1px solid ${hasError ? 'rgba(255,92,124,.3)' : 'var(--border)'}`, borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
      <div style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: hasError ? 'none' : '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.domain}</span>
        {hasError ? (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#ff8fa3' }}>Error</span>
        ) : (
          <>
            {Object.entries(result.bySource || {}).map(([src, count]) => (
              <span key={src} style={{ fontSize: 10, fontWeight: 700, color: SOURCE_COLOR[src] || 'var(--text-faint)', background: 'color-mix(in srgb, currentColor 12%, transparent)', borderRadius: 4, padding: '2px 6px' }}>
                {SOURCE_LABEL[src] || src} {count}
              </span>
            ))}
            <span style={{ fontSize: 11, fontWeight: 700, color: urls.length ? 'var(--accent)' : 'var(--text-faint)' }}>
              {urls.length} post{urls.length !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {hasError ? (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-faint)' }}>{result.error}</div>
      ) : urls.length === 0 ? (
        <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text-ghost)' }}>No post URLs found via sitemap, feed, or WordPress API.</div>
      ) : (
        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {shown.map((u, i) => (
                <tr key={i} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                  <td style={{ padding: '6px 12px', fontFamily: 'var(--font-mono)', color: 'var(--accent)', wordBreak: 'break-all' }}>{u.url}</td>
                  <td style={{ padding: '6px 12px', fontSize: 10, color: SOURCE_COLOR[u.source] || 'var(--text-faint)', whiteSpace: 'nowrap' }}>{SOURCE_LABEL[u.source] || u.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {urls.length > URLS_PER_CARD_CAP && (
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-ghost)' }}>+{urls.length - URLS_PER_CARD_CAP} more — all included in Copy All.</div>
          )}
        </div>
      )}
      {result.truncated && (
        <div style={{ padding: '6px 16px', fontSize: 11, color: 'var(--text-ghost)', borderTop: '1px solid var(--border)' }}>Hit the discovery cap for this site — there may be more posts than shown.</div>
      )}
    </div>
  )
}

export function SamplePostFinder() {
  const [inputText, setInputText] = useState('')
  const [results,   setResults]   = useState([])
  const [running,   setRunning]   = useState(false)
  const [progress,  setProgress]  = useState(null)
  const [copied,    setCopied]    = useState(false)
  const abortRef = useRef(false)

  const domains = parseDomains(inputText)
  const canRun  = domains.length > 0 && !running

  async function run() {
    if (!canRun) return
    abortRef.current = false
    setRunning(true)
    setResults(domains.map(d => ({ domain: d, status: 'pending' })))
    setProgress({ done: 0, total: domains.length })

    const tasks = domains.map(domain => async () => {
      if (abortRef.current) return null
      return findPosts(domain)
    })

    await runCapped(tasks, CONCURRENCY, (idx, data, err) => {
      const r = data ? { ...data } : { domain: domains[idx], error: err || 'Failed', urls: [], bySource: {} }
      setResults(prev => { const next = [...prev]; next[idx] = r; return next })
      setProgress(prev => ({ ...prev, done: (prev?.done || 0) + 1 }))
    })

    setRunning(false)
    setProgress(null)
  }

  function stop() {
    abortRef.current = true
    setRunning(false)
    setProgress(null)
    setResults(prev => prev.map(r => r.status === 'pending' ? { domain: r.domain, error: 'Stopped', urls: [], bySource: {} } : r))
  }

  function copyAll() {
    const all = results.filter(r => !r.error).flatMap(r => (r.urls || []).map(u => u.url))
    navigator.clipboard.writeText(all.join('\n')).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function clear() {
    setInputText('')
    setResults([])
  }

  const doneResults = results.filter(r => r.status !== 'pending')
  const successCount = doneResults.filter(r => !r.error).length
  const errorCount    = doneResults.filter(r => r.error).length
  const totalUrls     = doneResults.reduce((s, r) => s + (r.urls?.length || 0), 0)
  const shownResults   = doneResults.slice(0, CARD_RENDER_CAP)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontSize: 12, color: 'var(--text-faint)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', lineHeight: 1.6 }}>
        Finds post/article URLs for each site via robots.txt + sitemap discovery (including gzipped and
        recursive sitemap indexes), RSS/Atom feeds, and the WordPress REST API — falling back to a
        homepage link scan if nothing structured is found.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Websites · {domains.length > 0 ? `${domains.length} detected` : 'one per line'}
        </label>
        <textarea
          className="input"
          placeholder={'example.com\nanotherblog.com\nhttps://third.com/'}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          disabled={running}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, resize: 'vertical', minHeight: 110, lineHeight: 1.6 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn accent" onClick={run} disabled={!canRun} style={{ minWidth: 140 }}>
          {running ? `Finding… ${progress?.done || 0}/${progress?.total || 0}` : `Find Posts ${domains.length > 0 ? `(${domains.length})` : ''}`}
        </button>

        {running && <button className="btn ghost" onClick={stop}>Stop</button>}

        {progress && (
          <div style={{ height: 4, background: 'var(--surface-3, var(--surface))', borderRadius: 2, overflow: 'hidden', width: 160, border: '1px solid var(--border)' }}>
            <div style={{ height: '100%', background: 'var(--accent)', borderRadius: 2, width: `${Math.round((progress.done / progress.total) * 100)}%`, transition: 'width .3s' }} />
          </div>
        )}

        {doneResults.length > 0 && !running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {successCount > 0 && <span style={{ color: 'var(--accent)' }}>✓ {successCount} sites</span>}
            <span style={{ color: 'var(--text-dim)' }}>{totalUrls} posts total</span>
            {errorCount > 0 && <span style={{ color: '#ff8fa3' }}>⚠ {errorCount} failed</span>}
            <button className="btn accent" onClick={copyAll} disabled={totalUrls === 0} style={{ fontSize: 12, padding: '6px 14px' }}>
              {copied ? 'Copied!' : 'Copy All URLs'}
            </button>
            <button className="btn ghost" onClick={clear} style={{ fontSize: 12 }}>Clear</button>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((r, i) => (
            r.status === 'pending'
              ? <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-faint)' }}>{r.domain}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-ghost)' }}>Searching sitemaps, feeds &amp; WP API…</span>
                </div>
              : i < CARD_RENDER_CAP && <SiteCard key={i} result={r} />
          ))}
          {doneResults.length > CARD_RENDER_CAP && (
            <div style={{ fontSize: 12, color: 'var(--text-ghost)' }}>
              +{doneResults.length - CARD_RENDER_CAP} more sites processed — not shown for performance, but included in Copy All.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
