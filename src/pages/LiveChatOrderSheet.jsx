import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../data.jsx'
import { loadLivechatClients } from '../lib/supabase.js'
import { extractSheetId } from '../lib/sheetParserAPI.js'
import { parseDomainText, createOrderSheet, fillOrderSheet, checkGplApiStatus } from '../lib/lcSheetBuilder.js'
import { saveOrderHistory } from '../lib/supabase.js'

// ── Helpers ───────────────────────────────────────────────

const NICHES = [
  { id: 'general', label: 'General' },
  { id: 'casino',  label: 'Casino'  },
  { id: 'cbd',     label: 'CBD'     },
  { id: 'crypto',  label: 'Crypto'  },
]

function todayLabel() {
  const d = new Date()
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`
}

// ── API status (compact) ──────────────────────────────────

function useApiStatus() {
  const [status, setStatus] = useState('checking')
  const [message, setMessage] = useState('')

  const check = useCallback(async () => {
    setStatus('checking')
    const r = await checkGplApiStatus()
    setStatus(r.ok ? 'ok' : 'error')
    setMessage(r.message)
  }, [])

  useEffect(() => {
    check()
    const id = setInterval(check, 60_000)
    return () => clearInterval(id)
  }, [check])

  return { status, message, recheck: check }
}

// ── Step bar ──────────────────────────────────────────────

const STEPS = ['client', 'config', 'input', 'done']
const STEP_LABELS = ['Client', 'Configure', 'Input', 'Done']

function StepBar({ step }) {
  const cur = STEPS.indexOf(step === 'processing' ? 'input' : step)
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 28 }}>
      {STEPS.map((s, i) => {
        const done   = i < cur
        const active = i === cur
        return (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
                background: done ? 'var(--accent)' : active ? 'var(--bg)' : 'var(--surface)',
                color: done ? 'var(--accent-ink)' : active ? 'var(--accent)' : 'var(--text-faint)',
                border: active ? '2px solid var(--accent)' : done ? 'none' : '1.5px solid var(--border)',
                boxShadow: active ? '0 0 0 4px color-mix(in srgb, var(--accent) 15%, transparent)' : 'none',
                transition: 'all .2s',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: active ? 600 : 400, color: active ? 'var(--text)' : 'var(--text-faint)', whiteSpace: 'nowrap' }}>
                {STEP_LABELS[i]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, marginBottom: 16, marginLeft: 6, marginRight: 6, background: i < cur ? 'var(--accent)' : 'var(--border)', borderRadius: 1, transition: 'background .3s' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Client picker ─────────────────────────────────────────

function ClientPicker({ onSelect }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [urlError, setUrlError] = useState('')

  useEffect(() => {
    loadLivechatClients().then(setClients).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function tryUrlMatch() {
    setUrlError('')
    const docId = extractSheetId(urlInput.trim())
    if (!docId) { setUrlError('Not a valid Google Sheet URL'); return }
    const match = clients.find(c => extractSheetId(c.order_sheet_url || '') === docId)
    if (!match) { setUrlError('No client found with that sheet'); return }
    onSelect(match)
  }

  const filtered = clients.filter(c =>
    !search || c.client_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Select a client</div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <Icon name="search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)', pointerEvents: 'none' }} />
        <input className="input" placeholder="Search clients…" value={search}
               onChange={e => setSearch(e.target.value)} autoFocus
               style={{ width: '100%', paddingLeft: 36, boxSizing: 'border-box' }} />
      </div>

      {/* Client list */}
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto', marginBottom: 20, gap: 2 }}>
        {loading ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>No clients found</div>
        ) : filtered.map(c => (
          <div key={c.id} onClick={() => onSelect(c)}
               style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background .1s' }}
               onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
               onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
              {c.client_name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{c.client_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>
                <span style={{ textTransform: 'capitalize' }}>{c.client_type}</span>
                {c.article_cost ? <span> · ${c.article_cost}/article</span> : null}
                {c.permanent_discount ? <span> · {c.permanent_discount}% disc</span> : null}
              </div>
            </div>
            <Icon name="arrow" size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          </div>
        ))}
      </div>

      {/* Divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 500 }}>OR</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      {/* URL match */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>Paste client's order sheet URL to auto-identify</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="https://docs.google.com/spreadsheets/d/…"
                 value={urlInput} onChange={e => { setUrlInput(e.target.value); setUrlError('') }}
                 style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          <button className="btn" onClick={tryUrlMatch} disabled={!urlInput.trim()}>Find</button>
        </div>
        {urlError && <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{urlError}</div>}
      </div>
    </div>
  )
}

// ── Config step ───────────────────────────────────────────

function ConfigStep({ client, onClearClient, niche, setNiche, mode, setMode, onContinue }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Client summary bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div style={{ width: 38, height: 38, borderRadius: 9, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
          {client.client_name.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{client.client_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'capitalize', marginTop: 1 }}>
            {client.client_type}
            {client.article_cost ? ` · $${client.article_cost}/article` : ''}
            {client.permanent_discount ? ` · ${client.permanent_discount}% discount` : ''}
          </div>
        </div>
        <button onClick={onClearClient} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 4, display: 'flex', borderRadius: 4 }}>
          <Icon name="x" size={13} />
        </button>
      </div>

      {/* Niche */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 10 }}>Niche</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {NICHES.map(n => (
            <button key={n.id} onClick={() => setNiche(n.id)}
              style={{ padding: '7px 18px', borderRadius: 20, border: `1.5px solid ${niche === n.id ? 'var(--accent)' : 'var(--border)'}`, background: niche === n.id ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent', color: niche === n.id ? 'var(--accent)' : 'var(--text)', fontWeight: niche === n.id ? 600 : 400, fontSize: 13, cursor: 'pointer', transition: 'all .15s' }}>
              {n.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 10 }}>Mode</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { id: 'a', icon: 'plus', title: 'New tab', desc: 'Paste domains → create a new dated tab in the client\'s sheet' },
            { id: 'b', icon: 'edit', title: 'Fill existing', desc: 'Paste a tab URL → finds domains and fills in publisher data' },
          ].map(m => (
            <div key={m.id} onClick={() => setMode(m.id)}
                 style={{ padding: '14px 16px', borderRadius: 10, border: `1.5px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', background: mode === m.id ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : 'var(--bg)', transition: 'all .15s' }}>
              <div style={{ width: 30, height: 30, borderRadius: 7, background: mode === m.id ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--surface)', display: 'grid', placeItems: 'center', color: mode === m.id ? 'var(--accent)' : 'var(--text-faint)', marginBottom: 10 }}>
                <Icon name={m.icon} size={14} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: mode === m.id ? 'var(--text)' : 'var(--text)' }}>{m.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', lineHeight: 1.5 }}>{m.desc}</div>
            </div>
          ))}
        </div>
      </div>

      <button className="btn primary" style={{ alignSelf: 'flex-end', padding: '9px 22px' }} onClick={onContinue}>
        Continue →
      </button>
    </div>
  )
}

// ── Toggle row ────────────────────────────────────────────

function ToggleRow({ label, desc, value, onChange, extra }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{desc}</div>
      </div>
      {extra}
      <div onClick={() => onChange(!value)}
           style={{ width: 40, height: 22, borderRadius: 11, background: value ? 'var(--accent)' : 'var(--border)', position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background .15s' }}>
        <div style={{ position: 'absolute', top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: value ? 'var(--accent-ink)' : 'var(--bg)', transition: 'left .15s' }} />
      </div>
    </div>
  )
}

// ── Input step ────────────────────────────────────────────

function parseDuplicates(text) {
  const raw = text.split(/[\n,]+/).map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]).filter(Boolean)
  const seen = new Set(); const dupes = new Set()
  for (const d of raw) { if (seen.has(d)) dupes.add(d); else seen.add(d) }
  return [...dupes]
}

function InputStep({ client, niche, mode, input, setInput, sheetName, setSheetName,
                     includeWriting, setIncludeWriting, discountEnabled, setDiscountEnabled,
                     customDiscount, setCustomDiscount, error, onRun }) {
  const uniqueDomains = mode === 'a' && input.trim() ? parseDomainText(input) : []
  const count = uniqueDomains.length
  const duplicates = mode === 'a' && input.trim() ? parseDuplicates(input) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Context chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>{client.client_name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)', textTransform: 'capitalize' }}>{niche}</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>·</span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{mode === 'a' ? 'New tab' : 'Fill existing'}</span>
      </div>

      {/* Sheet name (mode A only) */}
      {mode === 'a' && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 8 }}>Tab name</div>
          <input className="input" style={{ width: '100%', boxSizing: 'border-box' }}
                 value={sheetName} onChange={e => setSheetName(e.target.value)}
                 placeholder={todayLabel()} />
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>Suffix (2), (3)… added automatically if the tab already exists.</div>
        </div>
      )}

      {/* Domains / URL */}
      {mode === 'a' ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)' }}>Domains</div>
            {count > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {count} domain{count !== 1 ? 's' : ''}
                {duplicates.length > 0 && <span style={{ color: '#f59e0b', marginLeft: 6, fontWeight: 600 }}>· {duplicates.length} duplicate{duplicates.length !== 1 ? 's' : ''}</span>}
              </span>
            )}
          </div>
          <textarea
            value={input} onChange={e => { setInput(e.target.value) }}
            placeholder={'example.com\nanother.com\nthird.com'}
            style={{ width: '100%', minHeight: 160, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 13, background: 'var(--bg)', border: `1px solid ${duplicates.length > 0 ? 'rgba(245,158,11,.4)' : 'var(--border)'}`, borderRadius: 8, padding: '10px 12px', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', lineHeight: 1.7 }}
          />
          {duplicates.length > 0 ? (
            <div style={{ marginTop: 7, padding: '8px 12px', borderRadius: 7, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, flexShrink: 0 }}>⚠</span>
              <div>
                <span style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>Duplicate domains will be merged: </span>
                <span style={{ fontSize: 12, color: '#f59e0b', fontFamily: 'var(--font-mono)' }}>{duplicates.join(', ')}</span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>One per line or comma-separated. https:// and www are stripped automatically.</div>
          )}
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-faint)', marginBottom: 8 }}>Sub-sheet URL</div>
          <input className="input" style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                 value={input} onChange={e => setInput(e.target.value)}
                 placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=123456" />
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>Include the gid parameter — that's how we identify the correct tab.</div>
        </div>
      )}

      {/* Toggles */}
      <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden', background: 'var(--bg)' }}>
        <div style={{ padding: '0 16px' }}>
          <ToggleRow
            label="Include writing service"
            desc={includeWriting
              ? `$${client.article_cost || '?'}/article · sites ≥1000 words → $15`
              : 'Client writes their own content — writing row omitted'}
            value={includeWriting}
            onChange={setIncludeWriting}
          />
          <ToggleRow
            label="Apply discount"
            desc={discountEnabled ? 'Overrides permanent discount for this order' : 'No discount row in sheet'}
            value={discountEnabled}
            onChange={setDiscountEnabled}
            extra={discountEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} onClick={e => e.stopPropagation()}>
                <input type="number" min="0" max="100" step="0.1" value={customDiscount}
                       onChange={e => setCustomDiscount(e.target.value)} placeholder="0"
                       style={{ width: 56, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'right', outline: 'none' }} />
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>%</span>
              </div>
            )}
          />
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.25)', fontSize: 13, color: '#f87171' }}>
          {error}
        </div>
      )}

      <button className="btn primary" style={{ alignSelf: 'flex-end', padding: '9px 22px' }}
              onClick={onRun} disabled={!input.trim()}>
        {mode === 'a' ? 'Create Sheet →' : 'Fill Sheet →'}
      </button>
    </div>
  )
}

// ── Main wizard ───────────────────────────────────────────

export function LiveChatOrderSheet({ me }) {
  const [step, setStep]           = useState('client')
  const [client, setClient]       = useState(null)
  const [niche, setNiche]         = useState('general')
  const [mode, setMode]           = useState('a')
  const [input, setInput]         = useState('')
  const [sheetName, setSheetName] = useState(todayLabel)
  const [includeWriting, setIncludeWriting] = useState(true)
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [customDiscount, setCustomDiscount]   = useState('')
  const [progress, setProgress]   = useState('')
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState('')
  const { status: apiStatus, message: apiMsg, recheck } = useApiStatus()

  useEffect(() => {
    if (!client) return
    const pd = parseFloat(client.permanent_discount) || 0
    setDiscountEnabled(pd > 0)
    setCustomDiscount(pd > 0 ? String(pd) : '')
  }, [client])

  function goBack() {
    if (step === 'config')     { setStep('client'); setClient(null) }
    else if (step === 'input') setStep('config')
    else if (step === 'done' || step === 'error') { setStep('input'); setResult(null); setError('') }
  }

  async function run() {
    const domains = mode === 'a' ? parseDomainText(input) : []
    if (mode === 'a' && !domains.length)        { setError('Enter at least one domain'); return }
    if (mode === 'b' && !input.trim())           { setError('Paste the sub-sheet URL'); return }
    if (mode === 'a' && !client.order_sheet_url) { setError("This client has no Order Sheet URL set. Edit the client and add one."); return }

    setError('')
    setStep('processing')
    setProgress('Starting…')
    const discountPct = discountEnabled ? (parseFloat(customDiscount) || 0) : 0

    try {
      const res = mode === 'a'
        ? await createOrderSheet(client, niche, domains, includeWriting, sheetName.trim() || null, discountPct, setProgress)
        : await fillOrderSheet(client, niche, input.trim(), includeWriting, discountPct, setProgress)
      setResult(res)
      setStep('done')
      saveOrderHistory({
        memberId: me?.id, memberName: me?.name || 'Unknown',
        clientName: client.client_name,
        sheetTitle: res.sheetTitle, sheetUrl: res.sheetUrl,
        type: mode === 'a' ? 'new' : 'fill',
        niche,
        domainCount: mode === 'a' ? domains.length : res.total,
      }).catch(() => {})
    } catch (err) {
      setError(err.message || 'Something went wrong')
      setStep('input')
    }
  }

  const showBack = step !== 'client' && step !== 'processing'

  return (
    <div className="page" style={{ maxWidth: 680 }}>

      {/* Header */}
      <div className="page-head" style={{ marginBottom: 8 }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Order Sheet</h1>
          <div className="sub">Build or fill a client order sheet from publisher data</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* API status chip */}
          <div onClick={recheck} title="Click to recheck" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20, cursor: 'pointer',
                background: apiStatus === 'ok' ? 'rgba(74,222,128,.08)' : apiStatus === 'error' ? 'rgba(248,113,113,.1)' : 'var(--surface)',
                border: `1px solid ${apiStatus === 'ok' ? 'rgba(74,222,128,.2)' : apiStatus === 'error' ? 'rgba(248,113,113,.3)' : 'var(--border)'}` }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, transition: 'background .3s',
                           background: apiStatus === 'ok' ? '#4ade80' : apiStatus === 'error' ? '#f87171' : 'var(--text-faint)',
                           boxShadow: apiStatus === 'ok' ? '0 0 4px #4ade80' : apiStatus === 'error' ? '0 0 4px #f87171' : 'none' }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: apiStatus === 'ok' ? '#4ade80' : apiStatus === 'error' ? '#f87171' : 'var(--text-faint)' }}>
              GPL API
            </span>
          </div>
          {showBack && (
            <button className="btn ghost" onClick={goBack} style={{ fontSize: 12 }}>← Back</button>
          )}
        </div>
      </div>

      {/* API error slim banner */}
      {apiStatus === 'error' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 8, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', marginBottom: 20 }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>⚠️</span>
          <span style={{ fontSize: 12, color: '#f87171', lineHeight: 1.4 }}>
            <strong>GPL API unreachable</strong> — {apiMsg}. Sheets will be created but all publisher data fields will be blank.
          </span>
        </div>
      )}

      {/* Step bar */}
      <StepBar step={step} />

      {/* Card content */}
      <div className="card">
        <div className="card-pad">

          {step === 'client' && (
            <ClientPicker onSelect={c => { setClient(c); setStep('config') }} />
          )}

          {step === 'config' && (
            <ConfigStep
              client={client} onClearClient={() => { setClient(null); setStep('client') }}
              niche={niche} setNiche={setNiche}
              mode={mode} setMode={setMode}
              onContinue={() => { setError(''); setStep('input') }}
            />
          )}

          {step === 'input' && (
            <InputStep
              client={client} niche={niche} mode={mode}
              input={input} setInput={setInput}
              sheetName={sheetName} setSheetName={setSheetName}
              includeWriting={includeWriting} setIncludeWriting={setIncludeWriting}
              discountEnabled={discountEnabled} setDiscountEnabled={setDiscountEnabled}
              customDiscount={customDiscount} setCustomDiscount={setCustomDiscount}
              error={error} onRun={run}
            />
          )}

          {step === 'processing' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '40px 0' }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                <Icon name="refresh" size={24} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, textAlign: 'center', marginBottom: 6 }}>Processing…</div>
                <div style={{ fontSize: 13, color: 'var(--text-faint)', textAlign: 'center' }}>{progress}</div>
              </div>
            </div>
          )}

          {step === 'done' && result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Success header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(74,222,128,.1)', display: 'grid', placeItems: 'center', color: '#4ade80', flexShrink: 0 }}>
                  <Icon name="check" size={24} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>{mode === 'a' ? 'Sheet tab created!' : 'Sheet filled!'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 3 }}>
                    Tab: <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{result.sheetTitle}</strong>
                  </div>
                </div>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: 'Entered',  value: result.total },
                  { label: 'Found',    value: result.found, color: '#4ade80' },
                  { label: 'Missing',  value: result.total - result.found, color: result.total - result.found > 0 ? '#f87171' : undefined },
                  { label: 'Niche',    value: NICHES.find(n => n.id === niche)?.label },
                ].map(s => (
                  <div key={s.label} style={{ padding: '12px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{s.label}</div>
                    <div style={{ fontWeight: 700, fontSize: 20, color: s.color || 'var(--text)' }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 10 }}>
                <a href={result.sheetUrl} target="_blank" rel="noreferrer"
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-ink)', textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
                  <Icon name="arrow" size={13} /> Open Sheet
                </a>
                <button className="btn ghost" onClick={() => { setStep('input'); setResult(null); setInput(''); setSheetName(todayLabel()) }}>
                  New order
                </button>
                <button className="btn ghost" onClick={() => { setStep('client'); setClient(null); setResult(null); setInput(''); setSheetName(todayLabel()) }}>
                  Start over
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
