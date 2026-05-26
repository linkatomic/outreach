import { useState, useEffect, useRef, useMemo } from 'react'
import { TEAM, EMAILS, VENDORS, Icon, todayISO, isoNDaysAgo, fmtDateShort,
         emailsToday, emailsCountByDay, pct } from '../data.jsx'

export function EmailLogPage({ me, setRoute, showToast, focusEmailOnMount, bulkPasteOnMount }) {
  const [mode, setMode] = useState('quick');
  const [vendor, setVendor] = useState('');
  const [link, setLink] = useState('');
  const [filter, setFilter] = useState('today');
  const [filterMember, setFilterMember] = useState('all');
  const [search, setSearch] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [extraRows, setExtraRows] = useState([]);
  const [editingRow, setEditingRow] = useState(null);
  const quickRef = useRef(null);
  const linkRef = useRef(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => { if (bulkPasteOnMount) setBulkOpen(true); }, [bulkPasteOnMount]);
  useEffect(() => { if (focusEmailOnMount && quickRef.current) quickRef.current.focus(); }, [focusEmailOnMount]);

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); quickRef.current && quickRef.current.focus(); }
      if (e.key === 'b' || e.key === 'B') { e.preventDefault(); setBulkOpen(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rows = useMemo(() => {
    let all = [...EMAILS, ...extraRows];
    if (filter === 'today') all = all.filter(e => e.date === todayISO());
    else if (filter === 'week') {
      const cutoff = isoNDaysAgo(7);
      all = all.filter(e => e.date >= cutoff);
    }
    if (filterMember === 'me') all = all.filter(e => e.memberId === me.id);
    else if (filterMember !== 'all') all = all.filter(e => e.memberId === filterMember);
    if (search) {
      const q = search.toLowerCase();
      all = all.filter(e => e.vendor.toLowerCase().includes(q) || e.link.toLowerCase().includes(q));
    }
    return all.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 200);
  }, [extraRows, filter, filterMember, me.id, search]);

  function isDup(vendorName, memberId) {
    if (!vendorName) return false;
    const cutoff = isoNDaysAgo(7);
    return EMAILS.filter(e => e.memberId === memberId && e.date >= cutoff && e.vendor.toLowerCase() === vendorName.toLowerCase()).length > 0;
  }

  const myToday = emailsToday(me.id);
  const myTarget = 30;

  function submitQuick() {
    if (!vendor.trim() || !link.trim()) return;
    const next = {
      id: 'e_local_' + Date.now(),
      sr: EMAILS.length + extraRows.length + 1,
      memberId: me.id,
      date: todayISO(),
      vendor: vendor.trim(),
      link: link.trim().replace(/^https?:\/\//, ''),
      time: new Date().toTimeString().slice(0,5),
      status: 'sent',
    };
    setExtraRows(r => [next, ...r]);
    setVendor(''); setLink('');
    showToast(`Logged · ${next.vendor}`);
    setTimeout(() => quickRef.current && quickRef.current.focus(), 50);
  }

  function submitBulk() {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
    const parsed = lines.map((line, i) => {
      const linkMatch = line.match(/(missive\.app\/\d+)/i);
      const linkVal = linkMatch ? linkMatch[1] : line;
      const vendorName = linkMatch ? line.replace(linkMatch[0], '').replace(/[—\-|·,]/g, '').trim() : 'Untagged';
      return {
        id: 'e_bulk_' + Date.now() + '_' + i,
        sr: EMAILS.length + extraRows.length + i + 1,
        memberId: me.id,
        date: todayISO(),
        vendor: vendorName || VENDORS[i % VENDORS.length],
        link: linkVal,
        time: new Date().toTimeString().slice(0,5),
        status: 'sent',
      };
    });
    setExtraRows(r => [...parsed, ...r]);
    setBulkText('');
    setBulkOpen(false);
    showToast(`Imported ${parsed.length} emails from bulk paste`);
  }

  function delRow(id) {
    setExtraRows(r => r.filter(x => x.id !== id));
    showToast('Row deleted');
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Email Log</h1>
          <div className="sub">Track every outbound. ~30/day soft target.</div>
        </div>
        <div className="actions">
          <span className="seg">
            <button className={mode === 'quick' ? 'on' : ''} onClick={() => setMode('quick')}>Quick add</button>
            <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>Keyboard grid</button>
            <button className={mode === 'bulk' ? 'on' : ''} onClick={() => { setMode('bulk'); setBulkOpen(true); }}>Bulk paste</button>
          </span>
          <button className="btn ghost" onClick={() => showToast('Exported 312 rows to CSV')}><Icon name="download" size={12} />Export</button>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="kpi">
          <div className="kpi-label">My emails today</div>
          <div className="kpi-value">{myToday + extraRows.filter(r => r.memberId === me.id && r.date === todayISO()).length}<span style={{ color: 'var(--text-faint)', fontSize: 14 }}> / {myTarget}</span></div>
          <div className="bar thin"><div className="bar-fill" style={{ width: pct(myToday, myTarget) + '%' }}></div></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">This week</div>
          <div className="kpi-value">{emailsCountByDay(me.id, 7).reduce((s, d) => s + d.count, 0)}</div>
          <div className="kpi-delta up"><Icon name="arrowUp" size={10} />+18% vs last week</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Team today</div>
          <div className="kpi-value">{TEAM.filter(m => m.role==='member').reduce((s,m) => s + emailsToday(m.id), 0)}</div>
          <div className="kpi-target">5 members reporting</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg minutes per entry</div>
          <div className="kpi-value">4.2<span style={{ color: 'var(--text-faint)', fontSize: 14 }}>s</span></div>
          <div className="kpi-target">↓ from 38s in Sheets</div>
        </div>
      </div>

      {(mode === 'quick' || mode === 'bulk') && (
        <div className="card" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="plus" size={14} />
            <input ref={quickRef} className="input"
                   placeholder="Vendor name…"
                   style={{ flex: '1 1 240px', maxWidth: 320 }}
                   value={vendor}
                   list="vendors-list"
                   onChange={(e) => setVendor(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') linkRef.current && linkRef.current.focus(); }} />
            <datalist id="vendors-list">{VENDORS.map(v => <option key={v} value={v} />)}</datalist>
            <input ref={linkRef} className="input"
                   placeholder="Missive link or paste URL…"
                   style={{ flex: 1, fontFamily: 'var(--font-mono)' }}
                   value={link}
                   onChange={(e) => setLink(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') submitQuick(); }} />
            {vendor && isDup(vendor, me.id) && (
              <span className="chip warn"><Icon name="alert" size={11} />dup last 7d</span>
            )}
            <button className="btn" onClick={() => setBulkOpen(true)}><Icon name="upload" size={12} />Bulk <span className="kbd">B</span></button>
            <button className="btn primary" onClick={submitQuick}>Log entry <span className="kbd">↵</span></button>
          </div>
          <div className="hint-line" style={{ marginTop: 8 }}>
            <Icon name="zap" size={11} />
            <span>Tab between fields · paste Missive link to auto-detect vendor · row appears instantly · undo with <span className="kbd">⌘ Z</span></span>
          </div>
        </div>
      )}

      <div className="row-flex" style={{ marginBottom: 12 }}>
        <span className="seg">
          <button className={filter === 'today' ? 'on' : ''} onClick={() => setFilter('today')}>Today</button>
          <button className={filter === 'week' ? 'on' : ''} onClick={() => setFilter('week')}>Week</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        </span>
        <span className="seg">
          <button className={filterMember === 'all' ? 'on' : ''} onClick={() => setFilterMember('all')}>Everyone</button>
          <button className={filterMember === 'me' ? 'on' : ''} onClick={() => setFilterMember('me')}>Just me</button>
          {TEAM.filter(m => m.role === 'member').slice(0, 3).map(m => (
            <button key={m.id} className={filterMember === m.id ? 'on' : ''} onClick={() => setFilterMember(m.id)}>{m.name.split(' ')[0]}</button>
          ))}
        </span>
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <input className="input" placeholder="Search vendor or link…" style={{ width: 260, paddingLeft: 28 }}
                 value={search} onChange={(e) => setSearch(e.target.value)} />
          <span style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-faint)' }}><Icon name="search" size={13} /></span>
          <span className="kbd" style={{ position: 'absolute', right: 8, top: 7 }}>/</span>
        </div>
        <button className="btn ghost"><Icon name="filter" size={12} />More filters</button>
      </div>

      <div className="email-grid">
        <div className="eg-head">
          <div>SR</div>
          <div>Date</div>
          <div>Time</div>
          <div>Vendor</div>
          <div>Missive Link</div>
          <div>By</div>
          <div></div>
        </div>
        {mode === 'grid' && (
          <div className="eg-row add">
            <div className="num">+</div>
            <div className="muted mono">{fmtDateShort(todayISO())}</div>
            <div className="mono muted">now</div>
            <div><input className="input-bare" placeholder="Vendor name…" value={vendor} onChange={(e) => setVendor(e.target.value)} list="vendors-list" /></div>
            <div><input className="input-bare mono" placeholder="missive.app/…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitQuick()} /></div>
            <div className="row-flex"><div className={`avatar sm ${me.color}`}>{me.short}</div></div>
            <div><button className="btn primary" style={{ height: 22, padding: '0 8px', fontSize: 11 }} onClick={submitQuick}>↵</button></div>
          </div>
        )}
        {rows.map(r => {
          const member = TEAM.find(m => m.id === r.memberId);
          const isEditing = editingRow === r.id;
          return (
            <div key={r.id} className={`eg-row ${isEditing ? 'editing' : ''}`}
                 onClick={() => setEditingRow(r.id === editingRow ? null : r.id)}>
              <div className="num">{r.sr.toString().padStart(4, '0')}</div>
              <div className="muted mono">{fmtDateShort(r.date)}</div>
              <div className="mono muted">{r.time}</div>
              <div className="vendor">{r.vendor}</div>
              <div className="link"><Icon name="link" size={10} /> {r.link}</div>
              <div className="row-flex"><div className={`avatar sm ${member?.color}`}>{member?.short}</div><span className="muted" style={{ fontSize: 12 }}>{member?.name.split(' ')[0]}</span></div>
              <div>{r.id.startsWith('e_local') || r.id.startsWith('e_bulk') ? (
                <button className="btn ghost" style={{ width: 22, height: 22, padding: 0 }} onClick={(e) => { e.stopPropagation(); delRow(r.id); }} title="Delete">
                  <Icon name="trash" size={11} />
                </button>
              ) : <Icon name="more" size={12} />}</div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="empty">No emails match — try a different filter</div>}
      </div>

      <div className="row-flex" style={{ marginTop: 12 }}>
        <span className="faint" style={{ fontSize: 12 }}>{rows.length} of {EMAILS.length + extraRows.length} entries</span>
        <div className="spacer"></div>
        <div className="hint-line">
          <span className="kbd">N</span> new <span style={{ margin: '0 4px' }}>·</span>
          <span className="kbd">B</span> bulk paste <span style={{ margin: '0 4px' }}>·</span>
          <span className="kbd">/</span> search <span style={{ margin: '0 4px' }}>·</span>
          <span className="kbd">⌘ Z</span> undo
        </div>
      </div>

      {bulkOpen && (
        <div className="modal-back" onClick={() => setBulkOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Bulk paste from Missive</h2>
              <button className="btn ghost" onClick={() => setBulkOpen(false)}><Icon name="x" size={13} /></button>
            </div>
            <div className="modal-body">
              <div className="label">Paste lines · one per email</div>
              <textarea className="input" style={{ width: '100%', height: 220, padding: 12, fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.6 }}
                        placeholder={"Examples (any of these formats):\n\nAcme Imports — missive.app/8472634\nGlobex Wholesale | missive.app/8472711\nmissive.app/8472899 Northwind Apparel\nhttps://mail.missiveapp.com/threads/9912334"}
                        value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
              <div className="hint-line" style={{ marginTop: 10 }}>
                <Icon name="zap" size={11} />
                <span>Relay auto-extracts vendor + link. Duplicates within 7 days are flagged before save.</span>
              </div>
              <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
                <span className="muted">Preview · </span>
                <span className="mono">{bulkText.split('\n').filter(l => l.trim()).length} lines</span>
                <span className="muted"> · </span>
                <span className="mono">{bulkText.match(/missive\.app\/\d+/gi)?.length || 0} links detected</span>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setBulkOpen(false)}>Cancel</button>
              <button className="btn primary" onClick={submitBulk} disabled={!bulkText.trim()}>Import {bulkText.split('\n').filter(l => l.trim()).length || ''} entries</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
