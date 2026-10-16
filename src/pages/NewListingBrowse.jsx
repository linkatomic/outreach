import { useState, useEffect, useCallback } from 'react'
import { Icon } from '../data.jsx'
import { LISTING_STATUS_OPTIONS } from '../lib/newListingFields.js'
import { loadNewListings, deleteNewListing } from '../lib/supabase.js'

export function NewListingBrowse() {
  const [listings, setListings] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [entryType, setEntryType] = useState('')

  const fetchData = useCallback(() => {
    setLoading(true); setErr('')
    loadNewListings({ search, status: status || null, entryType: entryType || null })
      .then(setListings)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [search, status, entryType])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleDelete(id) {
    if (!window.confirm('Delete this listing? This cannot be undone.')) return
    try {
      await deleteNewListing(id)
      setListings(prev => prev.filter(l => l.id !== id))
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: '1 1 220px', fontSize: 13 }}
          placeholder="Search website, vendor, added by…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="input" style={{ fontSize: 13, width: 170 }} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LISTING_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" style={{ fontSize: 13, width: 140 }} value={entryType} onChange={e => setEntryType(e.target.value)}>
          <option value="">Single + Bulk</option>
          <option value="single">Single only</option>
          <option value="bulk">Bulk only</option>
        </select>
      </div>

      {err && <div style={{ background: 'rgba(255,92,124,.08)', border: '1px solid rgba(255,92,124,.2)', color: '#ff8fa3', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : listings.length === 0 ? (
        <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '24px 0' }}>No listings found.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto', maxHeight: 600 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Website</th><th>Status</th><th>Vendor</th><th>Link Type</th>
                <th>Validity</th><th>Manage By</th><th>Type</th><th>Missive</th><th></th>
              </tr>
            </thead>
            <tbody>
              {listings.map(l => (
                <tr key={l.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{l.entry_date || '—'}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {l.website_url
                      ? <a href={l.website_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)', textDecoration: 'none' }}>{l.website}</a>
                      : l.website}
                  </td>
                  <td>{l.status || <span className="faint">—</span>}</td>
                  <td style={{ whiteSpace: 'normal' }}>{l.vendor || <span className="faint">—</span>}</td>
                  <td>{l.link_type || <span className="faint">—</span>}</td>
                  <td>{l.link_validity || <span className="faint">—</span>}</td>
                  <td>{l.manage_by || <span className="faint">—</span>}</td>
                  <td className="muted" style={{ fontSize: 11, textTransform: 'capitalize' }}>{l.entry_type}</td>
                  <td>
                    {l.missive_link
                      ? <a href={l.missive_link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}><Icon name="link" size={11} /></a>
                      : <span className="faint">—</span>}
                  </td>
                  <td>
                    <button className="btn ghost" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => handleDelete(l.id)}>
                      <Icon name="trash" size={11} />
                    </button>
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
