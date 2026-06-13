import { useState, useEffect } from 'react'
import { Icon } from '../data.jsx'
import { loadLivechatClients } from '../lib/supabase.js'
import { extractSheetId } from '../lib/sheetParserAPI.js'
import { parseDomainText, createOrderSheet, fillOrderSheet } from '../lib/lcSheetBuilder.js'

const NICHES = [
  { id: 'general', label: 'General' },
  { id: 'casino',  label: 'Casino' },
  { id: 'cbd',     label: 'CBD' },
  { id: 'crypto',  label: 'Crypto' },
]

// ── Client search/select ──────────────────────────────────

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 8 }}>Search clients</div>
        <input className="input" placeholder="Type to filter…" value={search}
               onChange={e => setSearch(e.target.value)} style={{ width: '100%' }} autoFocus />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '12px 0' }}>Loading clients…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '12px 0' }}>No clients found</div>
        ) : filtered.map(c => (
          <div key={c.id} onClick={() => onSelect(c)}
               style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer', background: 'var(--surface)' }}
               onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
               onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
            <div style={{ width: 32, height: 32, borderRadius: 7, background: 'color-mix(in srgb, var(--accent) 12%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
              {c.client_name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{c.client_name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {c.client_type === 'buyer' ? 'Buyer' : 'Reseller'}
                {c.article_cost ? ` · $${c.article_cost}/article` : ''}
                {c.permanent_discount ? ` · ${c.permanent_discount}% disc` : ''}
              </div>
            </div>
            <Icon name="arrow" size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          </div>
        ))}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 8 }}>Or paste client's order sheet URL</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="https://docs.google.com/spreadsheets/d/…"
                 value={urlInput} onChange={e => { setUrlInput(e.target.value); setUrlError('') }}
                 style={{ flex: 1 }} />
          <button className="btn" onClick={tryUrlMatch} disabled={!urlInput.trim()}>Find</button>
        </div>
        {urlError && <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>{urlError}</div>}
      </div>
    </div>
  )
}

// ── Selected client chip ──────────────────────────────────

function ClientChip({ client, onClear }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 8px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
      <div style={{ width: 24, height: 24, borderRadius: 5, background: 'color-mix(in srgb, var(--accent) 20%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 10 }}>
        {client.client_name.slice(0, 2).toUpperCase()}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{client.client_name}</span>
      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{client.client_type}</span>
      <button onClick={onClear} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)', padding: 0, display: 'flex', lineHeight: 1 }}>
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

// ── Label ─────────────────────────────────────────────────

function Label({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', marginBottom: 8 }}>
      {children}
    </div>
  )
}

// ── Writing service toggle ────────────────────────────────

function WritingToggle({ value, onChange }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, border: `1.5px solid ${value ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', background: value ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--surface)', userSelect: 'none' }}
    >
      {/* pill toggle */}
      <div style={{ width: 36, height: 20, borderRadius: 10, background: value ? 'var(--accent)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <div style={{ position: 'absolute', top: 3, left: value ? 19 : 3, width: 14, height: 14, borderRadius: '50%', background: value ? 'var(--accent-ink)' : 'var(--bg)', transition: 'left .15s' }} />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Include writing service</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 1 }}>
          {value ? 'Writing service charge will appear in the summary section' : 'Client writes their own content — writing row omitted'}
        </div>
      </div>
    </div>
  )
}

// ── Main wizard ───────────────────────────────────────────

function todayLabel() {
  const d = new Date()
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export function LiveChatOrderSheet() {
  const [step, setStep]           = useState('client')  // client | config | input | processing | done
  const [client, setClient]       = useState(null)
  const [niche, setNiche]         = useState('general')
  const [mode, setMode]           = useState('a')        // a=new tab, b=existing sheet
  const [input, setInput]         = useState('')
  const [sheetName, setSheetName] = useState(todayLabel)
  const [includeWriting, setIncludeWriting] = useState(true)
  const [discountEnabled, setDiscountEnabled] = useState(false)
  const [customDiscount, setCustomDiscount]   = useState('')
  const [progress, setProgress]   = useState('')
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState('')

  // Init discount from client whenever client changes
  useEffect(() => {
    if (!client) return
    const pd = parseFloat(client.permanent_discount) || 0
    setDiscountEnabled(pd > 0)
    setCustomDiscount(pd > 0 ? String(pd) : '')
  }, [client])

  function selectClient(c) {
    setClient(c)
    setStep('config')
  }

  function goBack() {
    if (step === 'config')      { setStep('client');     setClient(null) }
    else if (step === 'input')  setStep('config')
    else if (step === 'done' || step === 'error') {
      setStep('input'); setResult(null); setError('')
    }
  }

  async function run() {
    const domains = mode === 'a' ? parseDomainText(input) : []

    if (mode === 'a' && !domains.length) { setError('Enter at least one domain'); return }
    if (mode === 'b' && !input.trim())   { setError('Paste the sheet URL'); return }
    if (mode === 'a' && !client.order_sheet_url) {
      setError("This client has no Order Sheet URL set. Edit the client in Clients and add one."); return
    }

    setError('')
    setStep('processing')
    setProgress('Starting…')

    const discountPct = discountEnabled ? (parseFloat(customDiscount) || 0) : 0

    try {
      let res
      if (mode === 'a') {
        res = await createOrderSheet(client, niche, domains, includeWriting, sheetName.trim() || null, discountPct, setProgress)
      } else {
        res = await fillOrderSheet(client, niche, input.trim(), includeWriting, discountPct, setProgress)
      }
      setResult(res)
      setStep('done')
    } catch (err) {
      setError(err.message || 'Something went wrong')
      setStep('input')
    }
  }

  return (
    <div className="page" style={{ maxWidth: 680 }}>
      <div className="page-head">
        <div>
          <h1>Order Sheet</h1>
          <div className="sub">Build or fill a client order sheet from publisher data</div>
        </div>
        {step !== 'client' && step !== 'processing' && (
          <button className="btn ghost" onClick={goBack} style={{ fontSize: 12 }}>← Back</button>
        )}
      </div>

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 28 }}>
        {[['client','1','Client'],['config','2','Configure'],['input','3','Input'],['done','4','Done']].map(([id, num, label], i) => {
          const states = ['client','config','input','done']
          const idx    = states.indexOf(step === 'processing' ? 'input' : step)
          const myIdx  = states.indexOf(id)
          const done   = myIdx < idx
          const active = myIdx === idx
          return (
            <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ color: 'var(--border)', fontSize: 14 }}>—</span>}
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, background: done ? 'var(--accent)' : active ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : 'var(--surface)', color: done ? 'var(--accent-ink)' : active ? 'var(--accent)' : 'var(--text-faint)', border: active ? '1.5px solid var(--accent)' : '1.5px solid transparent' }}>
                  {done ? '✓' : num}
                </span>
                <span style={{ fontSize: 12, color: active ? 'var(--text)' : 'var(--text-faint)', fontWeight: active ? 600 : 400 }}>{label}</span>
              </span>
            </span>
          )
        })}
      </div>

      <div className="card">
        <div className="card-pad">

          {step === 'client' && (
            <ClientPicker onSelect={selectClient} />
          )}

          {step === 'config' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <Label>Selected client</Label>
                <ClientChip client={client} onClear={() => { setClient(null); setStep('client') }} />
              </div>

              <div>
                <Label>Niche</Label>
                <span className="seg">
                  {NICHES.map(n => (
                    <button key={n.id} className={niche === n.id ? 'on' : ''} onClick={() => setNiche(n.id)}>{n.label}</button>
                  ))}
                </span>
              </div>

              <div>
                <Label>Mode</Label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { id: 'a', title: 'New sub-sheet', desc: 'Paste domains → creates a new tab in the client\'s sheet named today\'s date' },
                    { id: 'b', title: 'Existing sub-sheet', desc: 'Paste a sheet URL (with sub-sheet) → finds the domains and fills in the data' },
                  ].map(m => (
                    <div key={m.id} onClick={() => setMode(m.id)}
                         style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 8, border: `1.5px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`, cursor: 'pointer', background: mode === m.id ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--surface)' }}>
                      <div style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`, flexShrink: 0, marginTop: 1, background: mode === m.id ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center' }}>
                        {mode === m.id && <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent-ink)' }} />}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{m.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>{m.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => { setError(''); setStep('input') }}>
                Continue →
              </button>
            </div>
          )}

          {step === 'input' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <ClientChip client={client} onClear={() => { setClient(null); setStep('client') }} />
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>·</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', textTransform: 'capitalize' }}>{niche}</span>
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>·</span>
                <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{mode === 'a' ? 'New sub-sheet' : 'Fill existing'}</span>
              </div>

              {mode === 'a' && (
                <div>
                  <Label>Sheet tab name</Label>
                  <input className="input" style={{ width: '100%' }}
                         value={sheetName} onChange={e => setSheetName(e.target.value)}
                         placeholder={todayLabel()} />
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5 }}>If a tab with this name already exists, a suffix like (2) will be added automatically.</div>
                </div>
              )}

              {mode === 'a' ? (
                <div>
                  <Label>Domains</Label>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>One per line or comma-separated. No https:// or www needed.</div>
                  <textarea
                    value={input}
                    onChange={e => { setInput(e.target.value); setError('') }}
                    placeholder={'example.com\nanother.com\nthird.com'}
                    style={{ width: '100%', minHeight: 160, resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 13, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', outline: 'none', boxSizing: 'border-box', lineHeight: 1.7 }}
                  />
                  {input.trim() && (() => {
                    const count = parseDomainText(input).length
                    const cost  = client?.article_cost
                    return (
                      <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6, display: 'flex', gap: 12 }}>
                        <span>{count} domain{count !== 1 ? 's' : ''}</span>
                        {includeWriting && cost > 0 && (
                          <span style={{ color: 'var(--text)' }}>
                            Writing: {count} × ${cost} = <strong>${(count * cost).toFixed(2)}</strong>
                          </span>
                        )}
                      </div>
                    )
                  })()}
                </div>
              ) : (
                <div>
                  <Label>Sub-sheet URL</Label>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>Paste the full URL including the sheet tab (gid parameter).</div>
                  <input className="input" style={{ width: '100%' }}
                         value={input} onChange={e => { setInput(e.target.value); setError('') }}
                         placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=123456" />
                </div>
              )}

              <WritingToggle value={includeWriting} onChange={setIncludeWriting} />

              {/* Discount toggle */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 8, border: `1.5px solid ${discountEnabled ? 'var(--accent)' : 'var(--border)'}`, background: discountEnabled ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'var(--surface)', userSelect: 'none' }}
              >
                <div onClick={() => setDiscountEnabled(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, cursor: 'pointer' }}>
                  <div style={{ width: 36, height: 20, borderRadius: 10, background: discountEnabled ? 'var(--accent)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
                    <div style={{ position: 'absolute', top: 3, left: discountEnabled ? 19 : 3, width: 14, height: 14, borderRadius: '50%', background: discountEnabled ? 'var(--accent-ink)' : 'var(--bg)', transition: 'left .15s' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Apply discount</div>
                    <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 1 }}>
                      {discountEnabled ? 'Overrides permanent discount — enter any % below' : 'No discount row in sheet (permanent discount ignored)'}
                    </div>
                  </div>
                </div>
                {discountEnabled && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <input
                      type="number" min="0" max="100" step="0.1"
                      value={customDiscount}
                      onChange={e => setCustomDiscount(e.target.value)}
                      placeholder="0"
                      style={{ width: 64, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--font-mono)', textAlign: 'right', outline: 'none' }}
                    />
                    <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>%</span>
                  </div>
                )}
              </div>

              {error && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.25)', fontSize: 13, color: '#f87171' }}>
                  {error}
                </div>
              )}

              <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={run}
                      disabled={!input.trim()}>
                {mode === 'a' ? 'Create Sheet →' : 'Fill Sheet →'}
              </button>
            </div>
          )}

          {step === 'processing' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 15%, transparent)', display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                <Icon name="refresh" size={22} />
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-faint)', textAlign: 'center', maxWidth: 360 }}>{progress}</div>
            </div>
          )}

          {step === 'done' && result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(74,222,128,.12)', display: 'grid', placeItems: 'center', color: '#4ade80', flexShrink: 0 }}>
                  <Icon name="check" size={22} />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>
                    {mode === 'a' ? 'Sheet tab created!' : 'Sheet filled!'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                    Tab: <strong style={{ color: 'var(--text)' }}>{result.sheetTitle}</strong>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: 'Domains entered', value: result.total },
                  { label: 'Found in GPL', value: result.found },
                  { label: 'Not found', value: result.total - result.found },
                  { label: 'Niche', value: NICHES.find(n => n.id === niche)?.label },
                ].map(s => (
                  <div key={s.label} style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <a href={result.sheetUrl} target="_blank" rel="noreferrer"
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-ink)', textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
                  <Icon name="arrow" size={13} /> Open Sheet
                </a>
                <button className="btn ghost" onClick={() => { setStep('input'); setResult(null); setInput(''); setSheetName(todayLabel()) }}>
                  New sheet
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
