import { useState } from 'react'
import { Icon, TEAM } from '../data.jsx'
import {
  LISTING_STATUS_OPTIONS, LINK_TYPE_OPTIONS, LINK_VALIDITY_OPTIONS, MANAGE_BY_OPTIONS,
  LANGUAGE_OPTIONS, CATEGORY_OPTIONS, CURRENCY_OPTIONS, AUDITOR_OPTIONS, AUDIT_STATUS_OPTIONS,
  PRICE_GROUPS, PRICE_SUB_LABELS, emptyPricing,
} from '../lib/newListingFields.js'
import { createSingleListing, createBulkListings, loadNewListings, deleteNewListing } from '../lib/supabase.js'
import { NewListingBrowse } from './NewListingBrowse.jsx'

function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Shared field primitives ───────────────────────────────────────────────────

function Field({ label, children, width }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12.5, width }}>
      <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  )
}

function Text({ label, value, onChange, width, placeholder, type = 'text' }) {
  return (
    <Field label={label} width={width}>
      <input className="input" type={type} value={value ?? ''} placeholder={placeholder}
             onChange={e => onChange(e.target.value)} style={{ fontSize: 13 }} />
    </Field>
  )
}

function Num({ label, value, onChange, width, placeholder }) {
  return (
    <Field label={label} width={width}>
      <input className="input" type="number" value={value ?? ''} placeholder={placeholder}
             onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} style={{ fontSize: 13 }} />
    </Field>
  )
}

function Select({ label, value, onChange, options, width, allowBlank = true }) {
  return (
    <Field label={label} width={width}>
      <select className="input" value={value ?? ''} onChange={e => onChange(e.target.value || null)} style={{ fontSize: 13 }}>
        {allowBlank && <option value="">—</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  )
}

function Check({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' }}>
      <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)}
             style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }} />
      <span>{label}</span>
    </label>
  )
}

function TextArea({ label, value, onChange, rows = 2 }) {
  return (
    <Field label={label}>
      <textarea className="input" value={value ?? ''} onChange={e => onChange(e.target.value)} rows={rows}
                style={{ fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
    </Field>
  )
}

function SectionHead({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: 10, marginTop: 4 }}>
      {children}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>{children}</div>
}

// ── Pricing grid (shared by Single + Bulk) ────────────────────────────────────

function PricingFields({ pricing, onChange, currency, compact }) {
  const [showUsd, setShowUsd] = useState(false)
  const groups = compact ? PRICE_GROUPS.slice(0, 1) : PRICE_GROUPS

  function set(group, sub, val) {
    onChange({ ...pricing, [group]: { ...(pricing[group] || {}), [sub]: val } })
  }
  function setUsd(group, sub, val) {
    onChange({ ...pricing, usd: { ...(pricing.usd || {}), [group]: { ...(pricing.usd?.[group] || {}), [sub]: val } } })
  }

  return (
    <div>
      {groups.map(g => (
        <div key={g.key} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>{g.label} {currency ? `(${currency})` : ''}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {g.subs.map(s => (
              <Num key={s} label={PRICE_SUB_LABELS[s]} width={100}
                   value={pricing[g.key]?.[s]} onChange={v => set(g.key, s, v)} />
            ))}
          </div>
        </div>
      ))}

      {!compact && (
        <button type="button" className="btn ghost" style={{ fontSize: 11, padding: '4px 10px', marginTop: 2 }}
                onClick={() => setShowUsd(v => !v)}>
          {showUsd ? '− Hide' : '+ Show'} USD equivalents
        </button>
      )}

      {!compact && showUsd && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)' }}>
          {PRICE_GROUPS.map(g => (
            <div key={g.key} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>{g.label} (USD)</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {g.subs.map(s => (
                  <Num key={s} label={PRICE_SUB_LABELS[s]} width={100}
                       value={pricing.usd?.[g.key]?.[s]} onChange={v => setUsd(g.key, s, v)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Single listing form ───────────────────────────────────────────────────────

function emptySingleFields(me) {
  return {
    entry_date: today(), added_by: me?.name || null, status: null, missive_link: '',
    website: '', website_url: '', verification: false, manage_by: null, link_type: null,
    link_validity: null, estimated_days: null, backlinks: null, primary_language: null,
    primary_categories: null, categories: null, sample_link: '', sample_link2: '', sample_link3: '',
    languages: '', google_news: false, premium: false, sponsored: false, link_insertion_only: false,
    foreign_lang_anchor: false, min_length: null, max_length: null, rules: '', website_notes: '',
    vendor: '', currency: 'USD',
    auditor: null, audit_status: null, error_by: '', feedback: '',
  }
}

function SingleListingForm({ me, onSaved }) {
  const [f, setF] = useState(() => emptySingleFields(me))
  const [pricing, setPricing] = useState(emptyPricing())
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  function set(key, val) { setF(prev => ({ ...prev, [key]: val })) }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!f.website.trim()) { setErr('Website is required'); return }
    setSaving(true); setErr('')
    try {
      const sampleLinks = [f.sample_link, f.sample_link2, f.sample_link3].map(s => s.trim()).filter(Boolean)
      await createSingleListing({
        entry_date: f.entry_date || null, added_by: f.added_by, status: f.status,
        missive_link: f.missive_link || null, website: f.website.trim().toLowerCase(),
        website_url: f.website_url || null, verification: f.verification, manage_by: f.manage_by,
        link_type: f.link_type, link_validity: f.link_validity, estimated_days: f.estimated_days,
        backlinks: f.backlinks, primary_language: f.primary_language, primary_categories: f.primary_categories,
        categories: f.categories, sample_links: sampleLinks, languages: f.languages || null,
        google_news: f.google_news, premium: f.premium, sponsored: f.sponsored,
        link_insertion_only: f.link_insertion_only, foreign_lang_anchor: f.foreign_lang_anchor,
        min_length: f.min_length, max_length: f.max_length, rules: f.rules || null,
        website_notes: f.website_notes || null, vendor: f.vendor || null, currency: f.currency,
        pricing,
        audit: { auditor: f.auditor, status: f.audit_status, error_by: f.error_by || null, feedback: f.feedback || null },
        created_by: me?.id || null,
      })
      setDone(true)
    } catch (err2) {
      setErr(err2.message)
    } finally {
      setSaving(false)
    }
  }

  function addAnother() {
    setF(emptySingleFields(me))
    setPricing(emptyPricing())
    setDone(false)
  }

  if (done) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div style={{ padding: 20, borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>✓ Listing saved</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{f.website} was added.</div>
        </div>
        <button className="btn primary" onClick={addAnother}>Add Another</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 860 }}>
      <SectionHead>Basic Info</SectionHead>
      <Row>
        <Text label="Date" type="date" value={f.entry_date} onChange={v => set('entry_date', v)} width={160} />
        <Select label="Added By" value={f.added_by} onChange={v => set('added_by', v)} options={TEAM.map(m => m.name)} width={160} />
        <Select label="Status" value={f.status} onChange={v => set('status', v)} options={LISTING_STATUS_OPTIONS} width={170} />
        <Text label="Communication Channel / Missive Link" value={f.missive_link} onChange={v => set('missive_link', v)} width={300} />
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
          <Check label="Verification" value={f.verification} onChange={v => set('verification', v)} />
        </div>
      </Row>

      <SectionHead>Website</SectionHead>
      <Row>
        <Text label="Website *" value={f.website} onChange={v => set('website', v)} width={220} placeholder="example.com" />
        <Text label="Website URL" value={f.website_url} onChange={v => set('website_url', v)} width={260} placeholder="https://example.com/" />
        <Text label="Sample Link" value={f.sample_link} onChange={v => set('sample_link', v)} width={220} />
        <Text label="Sample Link 2" value={f.sample_link2} onChange={v => set('sample_link2', v)} width={220} />
        <Text label="Sample Link 3" value={f.sample_link3} onChange={v => set('sample_link3', v)} width={220} />
      </Row>

      <SectionHead>Classification</SectionHead>
      <Row>
        <Select label="Manage By" value={f.manage_by} onChange={v => set('manage_by', v)} options={MANAGE_BY_OPTIONS} width={170} />
        <Select label="Link Type" value={f.link_type} onChange={v => set('link_type', v)} options={LINK_TYPE_OPTIONS} width={160} />
        <Select label="Link Validity" value={f.link_validity} onChange={v => set('link_validity', v)} options={LINK_VALIDITY_OPTIONS} width={150} />
        <Num label="Estimated Days" value={f.estimated_days} onChange={v => set('estimated_days', v)} width={120} />
        <Num label="Backlinks" value={f.backlinks} onChange={v => set('backlinks', v)} width={110} />
      </Row>
      <Row>
        <Select label="Primary Language" value={f.primary_language} onChange={v => set('primary_language', v)} options={LANGUAGE_OPTIONS} width={170} />
        <Select label="Primary Categories" value={f.primary_categories} onChange={v => set('primary_categories', v)} options={CATEGORY_OPTIONS} width={190} />
        <Select label="Categories" value={f.categories} onChange={v => set('categories', v)} options={CATEGORY_OPTIONS} width={190} />
        <Text label="Languages" value={f.languages} onChange={v => set('languages', v)} width={180} placeholder="e.g. English, Spanish" />
      </Row>

      <SectionHead>Flags</SectionHead>
      <Row>
        <Check label="Google News" value={f.google_news} onChange={v => set('google_news', v)} />
        <Check label="Premium" value={f.premium} onChange={v => set('premium', v)} />
        <Check label="Mark As Sponsored" value={f.sponsored} onChange={v => set('sponsored', v)} />
        <Check label="Only link insertion allowed" value={f.link_insertion_only} onChange={v => set('link_insertion_only', v)} />
        <Check label="Foreign language anchor text" value={f.foreign_lang_anchor} onChange={v => set('foreign_lang_anchor', v)} />
      </Row>

      <SectionHead>Content Rules</SectionHead>
      <Row>
        <Num label="Min. Length" value={f.min_length} onChange={v => set('min_length', v)} width={120} />
        <Num label="Max. Length" value={f.max_length} onChange={v => set('max_length', v)} width={120} />
      </Row>
      <Row><TextArea label="Rules" value={f.rules} onChange={v => set('rules', v)} /></Row>
      <Row><TextArea label="Website Notes (Internal use)" value={f.website_notes} onChange={v => set('website_notes', v)} /></Row>

      <SectionHead>Vendor & Pricing</SectionHead>
      <Row>
        <Text label="Vendor" value={f.vendor} onChange={v => set('vendor', v)} width={240} />
        <Select label="Currency" value={f.currency} onChange={v => set('currency', v)} options={CURRENCY_OPTIONS} width={120} allowBlank={false} />
      </Row>
      <div style={{ marginBottom: 16 }}>
        <PricingFields pricing={pricing} onChange={setPricing} currency={f.currency} />
      </div>

      <SectionHead>Audit (optional)</SectionHead>
      <Row>
        <Select label="Auditor" value={f.auditor} onChange={v => set('auditor', v)} options={AUDITOR_OPTIONS} width={150} />
        <Select label="Auditing Status" value={f.audit_status} onChange={v => set('audit_status', v)} options={AUDIT_STATUS_OPTIONS} width={150} />
        <Text label="Error By" value={f.error_by} onChange={v => set('error_by', v)} width={150} />
        <Text label="Feedback" value={f.feedback} onChange={v => set('feedback', v)} width={240} />
      </Row>

      {err && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{err}</div>}

      <button className="btn primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : <><Icon name="plus" size={12} /> Save Listing</>}
      </button>
    </form>
  )
}

// ── Bulk listing form ──────────────────────────────────────────────────────────

function emptyCommonFields(me) {
  return {
    entry_date: today(), added_by: me?.name || null, status: null, missive_link: '',
    verification: false, manage_by: null, link_type: null, link_validity: null,
    estimated_days: null, backlinks: null, primary_language: null, primary_categories: null,
    categories: null, languages: '', google_news: false, premium: false, sponsored: false,
    link_insertion_only: false, foreign_lang_anchor: false, min_length: null, max_length: null,
    rules: '', website_notes: '', vendor: '', currency: 'USD',
  }
}

function emptySite() { return { website: '', website_url: '', pricing: emptyPricing() } }

function BulkListingForm({ me, onSaved }) {
  const [common, setCommon] = useState(() => emptyCommonFields(me))
  const [pricingMode, setPricingMode] = useState('same') // 'same' | 'different'
  const [sharedPricing, setSharedPricing] = useState(emptyPricing())
  const [sites, setSites] = useState([emptySite(), emptySite(), emptySite()])
  const [pasteText, setPasteText] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null) // { count }

  function setC(key, val) { setCommon(prev => ({ ...prev, [key]: val })) }
  function setSite(i, patch) { setSites(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s)) }
  function addSiteRow() { setSites(prev => [...prev, emptySite()]) }
  function removeSiteRow(i) { setSites(prev => prev.filter((_, idx) => idx !== i)) }

  function applyPaste() {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) return
    const parsed = lines.map(line => {
      const [site, url] = line.split(/[,\t]/).map(s => s?.trim())
      return { website: site || '', website_url: url || '', pricing: emptyPricing() }
    })
    setSites(parsed)
    setPasteText('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const validSites = sites.filter(s => s.website.trim())
    if (!validSites.length) { setErr('Add at least one website'); return }
    setSaving(true); setErr('')
    try {
      const batchId = crypto.randomUUID()
      const rows = validSites.map(s => ({
        entry_date: common.entry_date || null, added_by: common.added_by, status: common.status,
        missive_link: common.missive_link || null, verification: common.verification,
        manage_by: common.manage_by, link_type: common.link_type, link_validity: common.link_validity,
        estimated_days: common.estimated_days, backlinks: common.backlinks,
        primary_language: common.primary_language, primary_categories: common.primary_categories,
        categories: common.categories, languages: common.languages || null,
        google_news: common.google_news, premium: common.premium, sponsored: common.sponsored,
        link_insertion_only: common.link_insertion_only, foreign_lang_anchor: common.foreign_lang_anchor,
        min_length: common.min_length, max_length: common.max_length, rules: common.rules || null,
        website_notes: common.website_notes || null, vendor: common.vendor || null, currency: common.currency,
        website: s.website.trim().toLowerCase(), website_url: s.website_url || null,
        sample_links: [], audit: {},
        pricing: pricingMode === 'same' ? sharedPricing : s.pricing,
        created_by: me?.id || null,
      }))
      await createBulkListings(rows, { batchId, pricingMode })
      setDone({ count: rows.length })
    } catch (err2) {
      setErr(err2.message)
    } finally {
      setSaving(false)
    }
  }

  function addAnotherBatch() {
    setCommon(emptyCommonFields(me))
    setSharedPricing(emptyPricing())
    setSites([emptySite(), emptySite(), emptySite()])
    setDone(null)
  }

  if (done) {
    return (
      <div style={{ maxWidth: 480 }}>
        <div style={{ padding: 20, borderRadius: 10, marginBottom: 16, background: 'color-mix(in srgb, var(--accent) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>✓ Batch saved</div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{done.count} website{done.count !== 1 ? 's' : ''} added.</div>
        </div>
        <button className="btn primary" onClick={addAnotherBatch}>Add Another Batch</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 900 }}>
      <p style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.6 }}>
        Fill the common fields once, then list every website in the batch below.
      </p>

      <SectionHead>Common Fields (applied to every site in this batch)</SectionHead>
      <Row>
        <Text label="Date" type="date" value={common.entry_date} onChange={v => setC('entry_date', v)} width={160} />
        <Select label="Added By" value={common.added_by} onChange={v => setC('added_by', v)} options={TEAM.map(m => m.name)} width={160} />
        <Select label="Status" value={common.status} onChange={v => setC('status', v)} options={LISTING_STATUS_OPTIONS} width={170} />
        <Text label="Communication Channel / Missive Link" value={common.missive_link} onChange={v => setC('missive_link', v)} width={300} />
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 6 }}>
          <Check label="Verification" value={common.verification} onChange={v => setC('verification', v)} />
        </div>
      </Row>
      <Row>
        <Select label="Manage By" value={common.manage_by} onChange={v => setC('manage_by', v)} options={MANAGE_BY_OPTIONS} width={170} />
        <Select label="Link Type" value={common.link_type} onChange={v => setC('link_type', v)} options={LINK_TYPE_OPTIONS} width={160} />
        <Select label="Link Validity" value={common.link_validity} onChange={v => setC('link_validity', v)} options={LINK_VALIDITY_OPTIONS} width={150} />
        <Num label="Estimated Days" value={common.estimated_days} onChange={v => setC('estimated_days', v)} width={120} />
        <Num label="Backlinks" value={common.backlinks} onChange={v => setC('backlinks', v)} width={110} />
      </Row>
      <Row>
        <Select label="Primary Language" value={common.primary_language} onChange={v => setC('primary_language', v)} options={LANGUAGE_OPTIONS} width={170} />
        <Select label="Primary Categories" value={common.primary_categories} onChange={v => setC('primary_categories', v)} options={CATEGORY_OPTIONS} width={190} />
        <Select label="Categories" value={common.categories} onChange={v => setC('categories', v)} options={CATEGORY_OPTIONS} width={190} />
        <Text label="Languages" value={common.languages} onChange={v => setC('languages', v)} width={180} />
      </Row>
      <Row>
        <Check label="Google News" value={common.google_news} onChange={v => setC('google_news', v)} />
        <Check label="Premium" value={common.premium} onChange={v => setC('premium', v)} />
        <Check label="Mark As Sponsored" value={common.sponsored} onChange={v => setC('sponsored', v)} />
        <Check label="Only link insertion allowed" value={common.link_insertion_only} onChange={v => setC('link_insertion_only', v)} />
        <Check label="Foreign language anchor text" value={common.foreign_lang_anchor} onChange={v => setC('foreign_lang_anchor', v)} />
      </Row>
      <Row>
        <Num label="Min. Length" value={common.min_length} onChange={v => setC('min_length', v)} width={120} />
        <Num label="Max. Length" value={common.max_length} onChange={v => setC('max_length', v)} width={120} />
        <Text label="Vendor" value={common.vendor} onChange={v => setC('vendor', v)} width={240} />
        <Select label="Currency" value={common.currency} onChange={v => setC('currency', v)} options={CURRENCY_OPTIONS} width={120} allowBlank={false} />
      </Row>
      <Row><TextArea label="Rules" value={common.rules} onChange={v => setC('rules', v)} /></Row>
      <Row><TextArea label="Website Notes (Internal use)" value={common.website_notes} onChange={v => setC('website_notes', v)} /></Row>

      <SectionHead>Pricing</SectionHead>
      <div style={{ marginBottom: 14 }}>
        <span className="seg" style={{ width: 'fit-content' }}>
          <button type="button" className={pricingMode === 'same' ? 'on' : ''} onClick={() => setPricingMode('same')}>Same price for all sites</button>
          <button type="button" className={pricingMode === 'different' ? 'on' : ''} onClick={() => setPricingMode('different')}>Different price per site</button>
        </span>
      </div>
      {pricingMode === 'same' && (
        <div style={{ marginBottom: 20 }}>
          <PricingFields pricing={sharedPricing} onChange={setSharedPricing} currency={common.currency} />
        </div>
      )}

      <SectionHead>Websites</SectionHead>
      <div style={{ marginBottom: 10 }}>
        <Field label={'Paste websites (one per line — optionally "domain, url")'}>
          <textarea className="input" value={pasteText} onChange={e => setPasteText(e.target.value)} rows={3}
                    placeholder={'example.com\nexample2.com, https://example2.com/'} style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }} />
        </Field>
        <button type="button" className="btn ghost" style={{ fontSize: 11, padding: '4px 10px', marginTop: 6 }} onClick={applyPaste} disabled={!pasteText.trim()}>
          Apply to list below
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {sites.map((s, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <Text label="Website" value={s.website} onChange={v => setSite(i, { website: v })} width={220} placeholder="example.com" />
              <Text label="Website URL" value={s.website_url} onChange={v => setSite(i, { website_url: v })} width={260} />
              <button type="button" className="btn ghost" style={{ padding: '6px 10px' }} onClick={() => removeSiteRow(i)}>
                <Icon name="trash" size={12} />
              </button>
            </div>
            {pricingMode === 'different' && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
                <PricingFields pricing={s.pricing} onChange={p => setSite(i, { pricing: p })} currency={common.currency} />
              </div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="btn ghost" style={{ fontSize: 12, marginBottom: 20 }} onClick={addSiteRow}>
        <Icon name="plus" size={11} /> Add Website
      </button>

      {err && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>{err}</div>}

      <div>
        <button className="btn primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : <><Icon name="upload" size={12} /> Save Batch ({sites.filter(s => s.website.trim()).length} sites)</>}
        </button>
      </div>
    </form>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export function NewListing({ me }) {
  const [tab, setTab] = useState('single') // 'single' | 'bulk' | 'browse'

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <span className="seg">
          <button className={tab === 'single' ? 'on' : ''} onClick={() => setTab('single')}>Single</button>
          <button className={tab === 'bulk' ? 'on' : ''} onClick={() => setTab('bulk')}>Bulk</button>
          <button className={tab === 'browse' ? 'on' : ''} onClick={() => setTab('browse')}>Browse</button>
        </span>
      </div>
      {tab === 'single' && <SingleListingForm me={me} />}
      {tab === 'bulk' && <BulkListingForm me={me} />}
      {tab === 'browse' && <NewListingBrowse />}
    </div>
  )
}
