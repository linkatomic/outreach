import { useState, useEffect, useRef } from 'react'
import { Icon } from '../data.jsx'
import { loadNotes, createNote, updateNote, deleteNote } from '../lib/supabase.js'

const SAVE_DELAY = 1400   // ms debounce before auto-save

// ── Markdown helpers ──────────────────────────────────

function inline(raw) {
  return raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/~~(.+?)~~/g,     '<s>$1</s>')
    .replace(/`(.+?)`/g,       '<code style="background:var(--surface-3);border-radius:4px;padding:1px 6px;font-size:.88em;font-family:var(--font-mono)">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noreferrer" style="color:var(--accent);text-decoration:underline">$1</a>')
}

function MarkdownPreview({ content }) {
  const nodes = []
  const lines = (content || '').split('\n')
  let ulBuf = [], olBuf = []

  const flushUl = () => {
    if (!ulBuf.length) return
    nodes.push(
      <ul key={nodes.length} style={{ paddingLeft: 22, margin: '6px 0' }}>
        {ulBuf.map((x, i) => <li key={i} style={{ margin: '2px 0', lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: inline(x) }}/>)}
      </ul>
    )
    ulBuf = []
  }
  const flushOl = () => {
    if (!olBuf.length) return
    nodes.push(
      <ol key={nodes.length} style={{ paddingLeft: 22, margin: '6px 0' }}>
        {olBuf.map((x, i) => <li key={i} style={{ margin: '2px 0', lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: inline(x) }}/>)}
      </ol>
    )
    olBuf = []
  }
  const flush = () => { flushUl(); flushOl() }

  lines.forEach((line, i) => {
    if      (/^# /.test(line))   { flush(); nodes.push(<h1 key={i} style={{ fontSize:22, fontWeight:800, margin:'20px 0 8px', paddingBottom:6, borderBottom:'1px solid var(--border)' }} dangerouslySetInnerHTML={{ __html: inline(line.slice(2)) }}/>) }
    else if (/^## /.test(line))  { flush(); nodes.push(<h2 key={i} style={{ fontSize:17, fontWeight:700, margin:'16px 0 6px' }}   dangerouslySetInnerHTML={{ __html: inline(line.slice(3)) }}/>) }
    else if (/^### /.test(line)) { flush(); nodes.push(<h3 key={i} style={{ fontSize:14, fontWeight:700, margin:'12px 0 4px' }}   dangerouslySetInnerHTML={{ __html: inline(line.slice(4)) }}/>) }
    else if (/^[-*] /.test(line))      { flushOl(); ulBuf.push(line.replace(/^[-*] /, '')) }
    else if (/^\d+\. /.test(line))     { flushUl(); olBuf.push(line.replace(/^\d+\. /, '')) }
    else if (/^> /.test(line))   { flush(); nodes.push(<blockquote key={i} style={{ borderLeft:'3px solid var(--accent)', paddingLeft:14, margin:'10px 0', color:'var(--text-dim)', fontStyle:'italic' }} dangerouslySetInnerHTML={{ __html: inline(line.slice(2)) }}/>) }
    else if (/^---+$/.test(line)){ flush(); nodes.push(<hr key={i} style={{ border:'none', borderTop:'1px solid var(--border)', margin:'18px 0' }}/>) }
    else if (line === '')         { flush(); nodes.push(<div key={i} style={{ height: 8 }}/>) }
    else                          { flush(); nodes.push(<p key={i} style={{ margin:'2px 0', lineHeight:1.75 }} dangerouslySetInnerHTML={{ __html: inline(line) }}/>) }
  })
  flush()

  return (
    <div style={{ flex:1, overflowY:'auto', padding:'16px 28px 32px',
                  fontSize:14.5, lineHeight:1.75, color:'var(--text)' }}>
      {nodes.length
        ? nodes
        : <p style={{ color:'var(--text-faint)', fontStyle:'italic' }}>Nothing to preview yet.</p>}
    </div>
  )
}

// ── Format toolbar ────────────────────────────────────

function applyFormat(ta, type, content, setContent) {
  if (!ta) return
  const s    = ta.selectionStart
  const e    = ta.selectionEnd
  const sel  = content.slice(s, e)
  const ls   = content.lastIndexOf('\n', s - 1) + 1
  const le   = content.indexOf('\n', s)
  const line = content.slice(ls, le === -1 ? content.length : le)

  const wrap = (m) => {
    const txt  = sel || 'text'
    const next = content.slice(0, s) + m + txt + m + content.slice(e)
    setContent(next)
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + m.length, s + m.length + txt.length) }, 0)
  }

  const prefixLine = (prefix) => {
    const PREFIXES = ['# ', '## ', '### ', '- ', '> ']
    let clean = line
    for (const p of PREFIXES) if (clean.startsWith(p)) { clean = clean.slice(p.length); break }
    const toggle = line.startsWith(prefix)
    const end    = le === -1 ? content.length : le
    const next   = content.slice(0, ls) + (toggle ? clean : prefix + clean) + content.slice(end)
    setContent(next)
    const cursor = ls + (toggle ? 0 : prefix.length) + clean.length
    setTimeout(() => { ta.focus(); ta.setSelectionRange(cursor, cursor) }, 0)
  }

  switch (type) {
    case 'bold':   wrap('**'); break
    case 'italic': wrap('*');  break
    case 'strike': wrap('~~'); break
    case 'code':   wrap('`');  break
    case 'h1':    prefixLine('# ');  break
    case 'h2':    prefixLine('## '); break
    case 'h3':    prefixLine('### ');break
    case 'quote': prefixLine('> ');  break
    case 'ul':    prefixLine('- ');  break
    case 'hr': {
      const ins  = (s > 0 && content[s - 1] !== '\n' ? '\n' : '') + '---\n'
      const next = content.slice(0, s) + ins + content.slice(e)
      setContent(next)
      setTimeout(() => { ta.focus(); ta.setSelectionRange(s + ins.length, s + ins.length) }, 0)
      break
    }
    default: break
  }
}

const TOOLS = [
  { id:'bold',   label:'B',    title:'Bold (Ctrl+B)',   style:{ fontWeight:800 } },
  { id:'italic', label:'I',    title:'Italic (Ctrl+I)', style:{ fontStyle:'italic' } },
  { id:'strike', label:'S',    title:'Strikethrough',   style:{ textDecoration:'line-through' } },
  null,
  { id:'h1',    label:'H1',   title:'Heading 1',       style:{ fontWeight:800, fontSize:11 } },
  { id:'h2',    label:'H2',   title:'Heading 2',       style:{ fontWeight:700, fontSize:11 } },
  { id:'h3',    label:'H3',   title:'Heading 3',       style:{ fontWeight:600, fontSize:11 } },
  null,
  { id:'ul',    label:'• List', title:'Bullet list',   style:{} },
  { id:'quote', label:'" "',   title:'Blockquote',     style:{ fontStyle:'italic' } },
  { id:'code',  label:'</>',   title:'Inline code',    style:{ fontFamily:'var(--font-mono)', fontSize:10 } },
  { id:'hr',    label:'——',    title:'Divider line',   style:{ letterSpacing:-2, fontSize:10 } },
]

function FormatBar({ onFormat, preview, setPreview }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:1, padding:'4px 12px',
                  borderBottom:'1px solid var(--border)', background:'var(--surface-2)',
                  flexShrink:0, flexWrap:'wrap' }}>
      {TOOLS.map((t, i) =>
        t === null
          ? <div key={i} style={{ width:1, height:16, background:'var(--border)', margin:'0 5px' }}/>
          : <button key={t.id} onClick={() => onFormat(t.id)} title={t.title}
                    style={{ padding:'3px 8px', borderRadius:5, border:'none',
                             background:'transparent', color:'var(--text-dim)',
                             cursor:'pointer', fontSize:12, ...t.style }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {t.label}
            </button>
      )}
      {/* Edit / Preview toggle */}
      <div style={{ marginLeft:'auto', display:'flex', border:'1px solid var(--border)', borderRadius:6, overflow:'hidden' }}>
        {[{ id:false, label:'Edit' }, { id:true, label:'Preview' }].map((v, i) => (
          <button key={v.label} onClick={() => setPreview(v.id)}
                  style={{ padding:'2px 12px', border:'none',
                           borderLeft: i > 0 ? '1px solid var(--border)' : 'none',
                           fontSize:11, fontWeight:600, cursor:'pointer',
                           background: preview === v.id ? 'var(--accent)' : 'transparent',
                           color:      preview === v.id ? 'var(--accent-ink)' : 'var(--text-faint)' }}>
            {v.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Sidebar note item ─────────────────────────────────

function NoteItem({ note, selected, onClick, onDelete }) {
  const [hov, setHov] = useState(false)
  const preview = (note.content || '').replace(/[#*`>~\-_\[\]]/g, '').trim().slice(0, 55) || 'No content'

  return (
    <div onClick={onClick}
         onMouseEnter={() => setHov(true)}
         onMouseLeave={() => setHov(false)}
         style={{ padding:'10px 14px', cursor:'pointer', borderBottom:'1px solid var(--border)',
                  background: selected ? 'var(--accent)' : hov ? 'var(--surface-2)' : 'transparent',
                  transition:'background .1s', position:'relative', userSelect:'none' }}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:3, overflow:'hidden',
                    whiteSpace:'nowrap', textOverflow:'ellipsis',
                    color: selected ? 'var(--accent-ink)' : 'var(--text)' }}>
        {note.title || 'Untitled'}
      </div>
      <div style={{ fontSize:11, marginBottom:4, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis',
                    color: selected ? 'rgba(0,0,0,0.55)' : 'var(--text-faint)' }}>
        {preview}
      </div>
      <div style={{ fontSize:10, color: selected ? 'rgba(0,0,0,0.4)' : 'var(--text-faint)' }}>
        {new Date(note.updated_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}
      </div>
      {hov && !selected && (
        <button onClick={ev => { ev.stopPropagation(); onDelete(note) }}
                style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)',
                         background:'transparent', border:'none', cursor:'pointer',
                         color:'var(--text-faint)', padding:4, borderRadius:4, display:'flex' }}
                onMouseEnter={ev => ev.currentTarget.style.color = '#fb7185'}
                onMouseLeave={ev => ev.currentTarget.style.color = 'var(--text-faint)'}>
          <Icon name="trash" size={12}/>
        </button>
      )}
    </div>
  )
}

// ── Main notes page ───────────────────────────────────

export function NotesPage({ me, showToast }) {
  const [notes,         setNotes]        = useState([])
  const [loading,       setLoading]      = useState(true)
  const [selected,      setSelected]     = useState(null)
  const [title,         setTitle]        = useState('')
  const [content,       setContent]      = useState('')
  const [saveStatus,    setSaveStatus]   = useState('')   // '' | 'unsaved' | 'saving' | 'saved' | 'error'
  const [preview,       setPreview]      = useState(false)
  const [search,        setSearch]       = useState('')
  const [confirmDel,    setConfirmDel]   = useState(null)
  const [creating,      setCreating]     = useState(false)

  const taRef       = useRef(null)
  const titleRef    = useRef('')
  const contentRef  = useRef('')
  const selectedRef = useRef(null)
  const dirtyRef    = useRef(false)
  const timerRef    = useRef(null)

  // ── Load ──────────────────────────────────────────────
  useEffect(() => {
    loadNotes(me.id)
      .then(data => { setNotes(data); setLoading(false) })
      .catch(err  => { showToast('Could not load notes: ' + err.message); setLoading(false) })
  }, [me.id]) // eslint-disable-line

  // ── Auto-save debounce ───────────────────────────────
  useEffect(() => {
    if (!selectedRef.current || !dirtyRef.current) return
    setSaveStatus('unsaved')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(doSave, SAVE_DELAY)
    return () => clearTimeout(timerRef.current)
  }, [title, content]) // eslint-disable-line

  async function doSave(t = titleRef.current, c = contentRef.current) {
    const id = selectedRef.current
    if (!id) return
    setSaveStatus('saving')
    try {
      await updateNote(id, { title: t, content: c })
      const now = new Date().toISOString()
      setNotes(prev =>
        prev.map(n => n.id === id ? { ...n, title: t, content: c, updated_at: now } : n)
            .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      )
      dirtyRef.current = false
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 2000)
    } catch {
      setSaveStatus('error')
    }
  }

  function flushSave() {
    if (dirtyRef.current && selectedRef.current) {
      clearTimeout(timerRef.current)
      doSave()
    }
  }

  function pickNote(note) {
    flushSave()
    setSelected(note)
    selectedRef.current = note?.id || null
    const t = note?.title   || ''
    const c = note?.content || ''
    titleRef.current   = t; contentRef.current = c
    setTitle(t); setContent(c)
    dirtyRef.current = false
    setSaveStatus(''); setPreview(false)
    setTimeout(() => taRef.current?.focus(), 60)
  }

  function changeTitle(v)   { setTitle(v);   titleRef.current   = v; dirtyRef.current = true }
  function changeContent(v) { setContent(v); contentRef.current = v; dirtyRef.current = true }

  // ── Create note ───────────────────────────────────────
  async function handleNew() {
    if (creating) return
    setCreating(true)
    try {
      flushSave()
      const note = await createNote({ memberId: me.id, title: 'Untitled', content: '' })
      setNotes(prev => [note, ...prev])
      pickNote(note)
      setTimeout(() => {
        const el = document.getElementById('note-title')
        el?.focus(); el?.select()
      }, 80)
    } catch (err) { showToast('Failed to create note: ' + err.message) }
    finally { setCreating(false) }
  }

  // ── Keyboard shortcuts in textarea ───────────────────
  function handleKeyDown(e) {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key === 'b') { e.preventDefault(); applyFormat(taRef.current, 'bold',   contentRef.current, changeContent); return }
    if (mod && e.key === 'i') { e.preventDefault(); applyFormat(taRef.current, 'italic', contentRef.current, changeContent); return }

    // Tab → 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = taRef.current
      const s  = ta.selectionStart
      changeContent(contentRef.current.slice(0, s) + '  ' + contentRef.current.slice(ta.selectionEnd))
      setTimeout(() => ta.setSelectionRange(s + 2, s + 2), 0)
    }

    // Enter → auto-continue bullet list
    if (e.key === 'Enter') {
      const ta  = taRef.current
      const s   = ta.selectionStart
      const c   = contentRef.current
      const ls  = c.lastIndexOf('\n', s - 1) + 1
      const cur = c.slice(ls, s)
      if (/^- .+/.test(cur)) {
        e.preventDefault()
        const ins = '\n- '
        changeContent(c.slice(0, s) + ins + c.slice(s))
        setTimeout(() => ta.setSelectionRange(s + ins.length, s + ins.length), 0)
      } else if (/^- $/.test(cur)) {
        // Empty list item → exit list
        e.preventDefault()
        changeContent(c.slice(0, ls) + '\n' + c.slice(s))
        setTimeout(() => ta.setSelectionRange(ls + 1, ls + 1), 0)
      }
    }
  }

  // ── Delete ────────────────────────────────────────────
  async function execDelete() {
    if (!confirmDel) return
    try {
      await deleteNote(confirmDel.id)
      const rest = notes.filter(n => n.id !== confirmDel.id)
      setNotes(rest)
      if (selected?.id === confirmDel.id) pickNote(rest[0] || null)
      showToast('Note deleted')
    } catch (err) { showToast('Delete failed: ' + err.message) }
    finally { setConfirmDel(null) }
  }

  // ── Derived ───────────────────────────────────────────
  const filteredNotes = search
    ? notes.filter(n =>
        (n.title   || '').toLowerCase().includes(search.toLowerCase()) ||
        (n.content || '').toLowerCase().includes(search.toLowerCase())
      )
    : notes

  const words = content.trim() ? content.trim().split(/\s+/).length : 0
  const chars = content.length

  return (
    <div className="page" style={{ padding:0, display:'flex', flexDirection:'column' }}>
      <div style={{ display:'flex', minHeight:600 }}>

        {/* ── Sidebar ─────────────────────────────────── */}
        <div style={{ width:240, flexShrink:0, borderRight:'1px solid var(--border)',
                      display:'flex', flexDirection:'column' }}>

          {/* Header */}
          <div style={{ padding:'14px 12px 10px', borderBottom:'1px solid var(--border)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
              <span style={{ fontSize:15, fontWeight:800 }}>Notes</span>
              <button onClick={handleNew} disabled={creating} title="New note"
                      style={{ marginLeft:'auto', background:'var(--accent)', color:'var(--accent-ink)',
                               border:'none', borderRadius:6, width:26, height:26,
                               display:'grid', placeItems:'center', cursor:'pointer', flexShrink:0 }}>
                <Icon name="plus" size={13}/>
              </button>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
                   placeholder="Search notes…" className="input"
                   style={{ width:'100%', height:30, fontSize:12, padding:'0 10px' }}/>
          </div>

          {/* List */}
          <div style={{ flex:1, overflowY:'auto' }}>
            {loading && (
              <div style={{ padding:24, textAlign:'center', fontSize:12, color:'var(--text-faint)' }}>Loading…</div>
            )}
            {!loading && filteredNotes.length === 0 && (
              <div style={{ padding:24, textAlign:'center', fontSize:12, color:'var(--text-faint)', lineHeight:1.6 }}>
                {search ? 'No notes match your search.' : 'No notes yet.\nClick + to create one.'}
              </div>
            )}
            {filteredNotes.map(note => (
              <NoteItem key={note.id} note={note}
                        selected={selected?.id === note.id}
                        onClick={() => pickNote(note)}
                        onDelete={n => setConfirmDel(n)}/>
            ))}
          </div>

          {/* Footer count */}
          <div style={{ padding:'7px 14px', borderTop:'1px solid var(--border)',
                        fontSize:10, color:'var(--text-faint)', textAlign:'center' }}>
            {notes.length} note{notes.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* ── Editor ──────────────────────────────────── */}
        {!selected ? (
          <div style={{ flex:1, display:'grid', placeItems:'center' }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:44, marginBottom:14, opacity:0.12 }}>📝</div>
              <div style={{ fontSize:15, fontWeight:600, color:'var(--text-dim)', marginBottom:6 }}>
                No note selected
              </div>
              <div style={{ fontSize:12, color:'var(--text-faint)', marginBottom:22 }}>
                Select a note from the sidebar or create a new one
              </div>
              <button className="btn primary" onClick={handleNew} disabled={creating}>
                <Icon name="plus" size={13}/> New note
              </button>
            </div>
          </div>
        ) : (
          <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>

            {/* Title bar */}
            <div style={{ padding:'20px 28px 12px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
              <input id="note-title"
                     value={title}
                     onChange={e => changeTitle(e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); taRef.current?.focus() }}}
                     placeholder="Untitled"
                     style={{ width:'100%', border:'none', outline:'none', background:'transparent',
                              fontSize:24, fontWeight:800, color:'var(--text)', lineHeight:1.3,
                              padding:0, caretColor:'var(--accent)' }}/>
            </div>

            {/* Toolbar */}
            <FormatBar
              onFormat={type => applyFormat(taRef.current, type, contentRef.current, changeContent)}
              preview={preview}
              setPreview={setPreview}/>

            {/* Content */}
            {preview ? (
              <MarkdownPreview content={content}/>
            ) : (
              <textarea ref={taRef}
                        value={content}
                        onChange={e => changeContent(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={'Start writing…\n\nTip: Markdown is supported\n  # Heading 1   ## Heading 2\n  **bold**   *italic*   `code`\n  - Bullet   > Blockquote\n  [link text](url)'}
                        style={{ flex:1, border:'none', outline:'none', resize:'none',
                                 padding:'18px 28px 24px', fontSize:14.5, lineHeight:1.8,
                                 background:'transparent', color:'var(--text)',
                                 fontFamily:'var(--font-sans)', caretColor:'var(--accent)',
                                 minHeight:400 }}/>
            )}

            {/* Status bar */}
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'5px 28px',
                          borderTop:'1px solid var(--border)', fontSize:10.5,
                          color:'var(--text-faint)', background:'var(--surface-2)', flexShrink:0 }}>
              <span style={{
                color: saveStatus === 'unsaved' ? '#fb923c'
                     : saveStatus === 'saving'  ? 'var(--text-faint)'
                     : saveStatus === 'saved'   ? '#34d399'
                     : saveStatus === 'error'   ? '#fb7185'
                     : 'var(--text-faint)'
              }}>
                {saveStatus === 'unsaved' ? '● Unsaved changes'
               : saveStatus === 'saving'  ? 'Saving…'
               : saveStatus === 'saved'   ? '✓ Saved'
               : saveStatus === 'error'   ? '✕ Save failed'
               : ''}
              </span>
              <span style={{ marginLeft:'auto' }}>
                {words.toLocaleString()} word{words !== 1 ? 's' : ''} · {chars.toLocaleString()} chars
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDel && (
        <div className="modal-back" onClick={() => setConfirmDel(null)}>
          <div className="modal" style={{ maxWidth:360 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h2 style={{ color:'#fb7185' }}>🗑 Delete note?</h2>
              <button className="btn ghost" onClick={() => setConfirmDel(null)}><Icon name="x" size={13}/></button>
            </div>
            <div className="modal-body">
              <p style={{ margin:0, fontSize:13.5, lineHeight:1.65 }}>
                Delete <strong>"{confirmDel.title || 'Untitled'}"</strong>? This cannot be undone.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button onClick={execDelete}
                      style={{ background:'#fb7185', color:'#fff', border:'none', borderRadius:6,
                               padding:'0 16px', height:32, fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
