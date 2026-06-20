import { useState } from 'react'

const accent = 'var(--accent)'
const faint  = 'var(--text-faint)'
const border = 'var(--border)'

function Section({ id, title, icon, children, activeId, setActiveId }) {
  const open = activeId === id
  return (
    <div style={{ borderRadius: 10, border: `1px solid ${border}`, overflow: 'hidden', marginBottom: 10 }}>
      <button
        onClick={() => setActiveId(open ? null : id)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: open ? 'rgba(255,255,255,.04)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', flex: 1 }}>{title}</span>
        <span style={{ fontSize: 12, color: faint }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 18px 20px', borderTop: `1px solid ${border}` }}>
          {children}
        </div>
      )}
    </div>
  )
}

function H2({ children }) {
  return <div style={{ fontWeight: 700, fontSize: 13, color: accent, marginTop: 22, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{children}</div>
}

function H3({ children }) {
  return <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginTop: 16, marginBottom: 6 }}>{children}</div>
}

function P({ children }) {
  return <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, marginBottom: 6 }}>{children}</div>
}

function Note({ children }) {
  return (
    <div style={{ fontSize: 12, color: faint, lineHeight: 1.6, padding: '10px 14px', background: 'rgba(255,255,255,.03)', borderRadius: 7, border: `1px solid ${border}`, marginTop: 10 }}>
      {children}
    </div>
  )
}

function Tip({ children }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, padding: '10px 14px', background: 'rgba(96,165,250,.07)', borderRadius: 7, border: '1px solid rgba(96,165,250,.2)', marginTop: 10, color: '#93c5fd' }}>
      {children}
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
      <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: 'rgba(96,165,250,.15)', border: '1px solid rgba(96,165,250,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#60a5fa' }}>
        {n}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: faint, lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  )
}

function FieldRow({ name, type, children }) {
  const typeColor = {
    text:   '#a78bfa',
    select: '#60a5fa',
    status: '#fb923c',
    url:    '#34d399',
    number: '#f59e0b',
    date:   '#e879f9',
    people: '#f472b6',
  }[type] || faint
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: `1px solid ${border}`, alignItems: 'flex-start' }}>
      <div style={{ minWidth: 160, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--text)', paddingTop: 1 }}>{name}</div>
      <div style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 4, background: `${typeColor}18`, color: typeColor, border: `1px solid ${typeColor}40`, marginTop: 1 }}>{type}</div>
      <div style={{ fontSize: 12, color: faint, lineHeight: 1.55, flex: 1 }}>{children}</div>
    </div>
  )
}

function ModeCard({ icon, title, subtitle, children }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 8, border: `1px solid ${border}`, background: 'rgba(255,255,255,.02)', marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{title}</div>
          <div style={{ fontSize: 11, color: faint }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: faint, lineHeight: 1.65 }}>{children}</div>
    </div>
  )
}

export function LcGuide() {
  const [activeId, setActiveId] = useState('clients')

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1>Guide</h1>
          <div className="sub">How every Live Chat tool works — step by step</div>
        </div>
      </div>

      {/* ── CLIENTS ─────────────────────────────────────────────── */}
      <Section id="clients" title="Clients" icon="👥" activeId={activeId} setActiveId={setActiveId}>

        <H2>What it is</H2>
        <P>The Clients module is a directory of all your Live Chat clients. Each client stores their billing preferences and niche configuration so you don't have to re-enter details every time you create an order.</P>
        <P>Clients are used as the starting point in the <strong>Order Sheet</strong> tool — you pick a client, and the tool knows which Google Sheet to write to and which pricing tier to use.</P>

        <H2>Creating a Client</H2>
        <P>Click <strong>+ New Client</strong> and fill in the form. All fields except the niche selection are free-form text.</P>

        <H2>Fields</H2>
        <div style={{ marginTop: 8 }}>
          <FieldRow name="Client Name" type="text">The display name used everywhere in Relay (Order Sheet picker, Notion History, etc.).</FieldRow>
          <FieldRow name="Email" type="text">Client's contact email. For reference only — not used programmatically.</FieldRow>
          <FieldRow name="Google Sheet URL" type="url">The client's order tracking spreadsheet. This is where Order Sheet will create new tabs or fill existing ones.</FieldRow>
          <FieldRow name="Buyer Type" type="select">How the client buys — e.g. <em>Buyer</em>, <em>Reseller</em>. Determines which GPL price tier is shown.</FieldRow>
          <FieldRow name="$/Article" type="number">Default price per article charged to this client. Shown as context in the Order Sheet wizard.</FieldRow>
          <FieldRow name="Discount %" type="number">Discount applied to this client. Shown alongside the price as a reminder.</FieldRow>
          <FieldRow name="Niches" type="select">Which niches this client orders (General, Casino, CBD, Crypto, etc.). These appear as niche buttons in the Order Sheet wizard.</FieldRow>
        </div>

        <Tip>After saving a client, they instantly appear in the Order Sheet client picker. No page reload needed.</Tip>

      </Section>

      {/* ── ORDER SHEET ─────────────────────────────────────────── */}
      <Section id="orders" title="Order Sheet" icon="📋" activeId={activeId} setActiveId={setActiveId}>

        <H2>What it is</H2>
        <P>The Order Sheet tool reads a list of domains, looks up their publisher data from the GPL API (vendor name, pricing, currency), and writes it into the client's Google Spreadsheet — either creating a brand-new dated tab or filling in an existing one.</P>

        <H2>Step-by-step workflow</H2>

        <Step n="1" title="Select a Client">
          Pick the client from the dropdown. Their niche options, sheet URL, buyer type, and pricing will load automatically. If no clients appear, add one in the Clients section first.
        </Step>

        <Step n="2" title="Choose a Niche">
          Select which niche this order belongs to — General, Casino, CBD, Crypto, etc. This determines which GPL price column is used when fetching vendor data. Only niches configured for the selected client appear here.
        </Step>

        <Step n="3" title="Choose a Mode">
          <div style={{ marginTop: 8 }}>
            <ModeCard icon="➕" title="New Tab" subtitle="Creates a fresh dated tab in the client's sheet">
              Paste a list of domains (one per line, or comma-separated). The tool fetches GPL publisher data for each domain and creates a new tab named with today's date (e.g. <em>20-Jun-2026</em>) in the client's Google Sheet, pre-filled with vendor name, prices, currency, and status columns.
            </ModeCard>
            <ModeCard icon="✏️" title="Fill Existing" subtitle="Finds domains in an existing tab and fills their data">
              Paste the URL of a specific tab already in the client's sheet. The tool scans that tab for the domain column, looks up each domain in the GPL API, and fills in the publisher data for any domain it finds. Domains not found in GPL are skipped. Existing data in other columns is untouched.
            </ModeCard>
          </div>
        </Step>

        <Step n="4" title="Paste Domains (New Tab) or Tab URL (Fill Existing)">
          For <strong>New Tab</strong>: paste your domain list — one per line, space-separated, or comma-separated. Duplicates are automatically removed.<br/>
          For <strong>Fill Existing</strong>: copy the URL of the specific sheet tab from your browser address bar (it must include the <code>#gid=</code> part to identify the tab).
        </Step>

        <Step n="5" title="Click Continue and Review">
          A preview shows how many domains were detected. Click <strong>Fill Sheet</strong> to start the process. A progress bar tracks the GPL API lookups (done in batches of 5). When complete, a link to open the sheet appears.
        </Step>

        <H2>Sheet History</H2>
        <P>Every successful run is automatically saved to Sheet History (accessible from the sidebar under Order Sheet). Each entry records:</P>
        <div style={{ marginTop: 8 }}>
          <FieldRow name="Client" type="text">Which client this run was for.</FieldRow>
          <FieldRow name="Type" type="select"><em>New</em> for new tab runs, <em>Fill</em> for fill-existing runs.</FieldRow>
          <FieldRow name="Domains" type="number">How many domains were processed.</FieldRow>
          <FieldRow name="Niche" type="select">The niche selected for this run.</FieldRow>
          <FieldRow name="Created by" type="text">Which team member ran it.</FieldRow>
          <FieldRow name="Timestamp" type="date">When it was run. Hover to see the exact date and time.</FieldRow>
        </div>
        <Note>Sheet History is read-only — it's a log, not editable. The "Open Sheet" link takes you directly to the client's spreadsheet.</Note>

      </Section>

      {/* ── NOTION CARD CREATOR ─────────────────────────────────── */}
      <Section id="notion" title="Notion Card Creator" icon="🃏" activeId={activeId} setActiveId={setActiveId}>

        <H2>What it is</H2>
        <P>The Notion Card Creator bulk-creates pages in your Notion database from an order sheet tab. You load a Google Sheet tab that contains <strong>Order ID</strong> and <strong>Domain</strong> columns, fill in common batch settings, and the tool creates one Notion page per row — with vendor data auto-fetched from the GPL API.</P>

        <H2>Test Notion Connection</H2>
        <P>Before creating cards, use the <strong>Test Notion Connection</strong> button to verify your Notion token and database ID are correctly configured. It will show the database name on success, or an error message if something is wrong.</P>
        <Note>If you get a "multiple data sources" error: your Notion database uses a connected/linked database feature that the Notion API doesn't support. Create a plain (non-connected) database and update the Database ID in your environment variables.</Note>

        <H2>Step 1 — Load Sheet</H2>
        <P>Paste the Google Sheet URL and click <strong>Load Sheet</strong>. If the sheet has multiple tabs, a tab picker appears — select the tab that contains your order rows. The tool looks for an <strong>Order ID</strong> column and a <strong>Domain</strong> column automatically.</P>
        <P>Once loaded, a green confirmation shows how many rows were detected (e.g. <em>10 rows loaded</em>). Only rows that have both an Order ID and a domain are included.</P>

        <H2>Step 2 — Batch Settings (Common Fields)</H2>
        <P>These settings apply to <strong>every card</strong> in the batch. Fill them in once; they don't vary per row.</P>

        <H3>Identity & Order Details</H3>
        <div>
          <FieldRow name="Customer Name" type="text">The client's name. Appears in Notion as the <em>Customer Name</em> field. <strong>Required</strong> — you can't create cards without this.</FieldRow>
          <FieldRow name="Order URL" type="url">Link to the original order (e.g. on GuestPostLinks). Fills the <em>Order URL</em> field in Notion.</FieldRow>
        </div>

        <H3>Status Fields</H3>
        <div>
          <FieldRow name="Order Status" type="status">Current state of the order. Notion Status type (has a coloured dot). Defaults to <em>Sent For Publication</em>.</FieldRow>
          <FieldRow name="Payment Status" type="status">Payment tracking. Notion Status type. Defaults to <em>Need to Check</em>.</FieldRow>
        </div>

        <H3>Order Classification</H3>
        <div>
          <FieldRow name="Order From" type="select">Source of the order — GUESTPOSTLINKS, DIRECT, FIVERR, or OTHER.</FieldRow>
          <FieldRow name="Order Type" type="select">Article Publication, Link Insertion, or Press Release.</FieldRow>
          <FieldRow name="Order In" type="select">Single or Bulk order.</FieldRow>
          <FieldRow name="Post Type" type="select">The content niche — Casino, Finance, CBD, Crypto, etc. Also used to pick the right GPL price tier per domain.</FieldRow>
        </div>

        <H3>Sheet & Notes</H3>
        <div>
          <FieldRow name="Client Sheet" type="url">URL or name of the client's master sheet. Fills the <em>Client Sheet</em> field in Notion.</FieldRow>
          <FieldRow name="Note" type="text">Free-form note. Defaults to <em>Master Sheet</em>.</FieldRow>
          <FieldRow name="Publication Cost" type="number">Cost per publication (if applicable).</FieldRow>
        </div>

        <H3>People & Dates</H3>
        <div>
          <FieldRow name="Order Process By" type="text">Who is processing this order. Auto-defaults to your name when you open the page. Stored as plain text in Notion.</FieldRow>
          <FieldRow name="Sent for Publication" type="people">Which team member is handling publication. Uses real Notion user accounts — the dropdown loads from your Notion workspace. Stored as a Notion People field (linked to their account).</FieldRow>
          <FieldRow name="Date of Publication" type="date">Pick a date from the calendar. Sent to Notion as a Date property (displays as e.g. <em>Jun 20, 2026</em>).</FieldRow>
        </div>

        <H2>Auto-fetched Per Card (GPL API)</H2>
        <P>These fields are <strong>not</strong> in the form — they're fetched automatically for each domain from the GPL API before cards are created:</P>
        <div>
          <FieldRow name="Vendor" type="text">The publisher/vendor name from GPL.</FieldRow>
          <FieldRow name="Vendor Price" type="number">Admin price from the GPL vendor's addon for the selected niche.</FieldRow>
          <FieldRow name="Actual Paid" type="number">The actual price paid (actualPrice from GPL).</FieldRow>
          <FieldRow name="Currency Type" type="select">Currency of the vendor (USD, GBP, etc.).</FieldRow>
        </div>
        <Note>If a domain isn't found in GPL, those 4 fields are left blank in Notion — the card is still created with all other fields filled.</Note>

        <H2>Creating Cards</H2>
        <P>Click <strong>Create N Notion Cards →</strong>. The tool creates cards 3 at a time (Notion's API rate limit is 3 requests/second). A progress bar shows how many have been created. If a card hits a rate-limit error (429), it automatically retries up to 3 times with back-off.</P>
        <P>When done, a success message shows how many cards were created vs. failed. Click <strong>New Batch</strong> to reset and start another batch.</P>
        <Tip>Each successful batch is automatically saved to Notion History so you can find all the pages later.</Tip>

      </Section>

      {/* ── NOTION HISTORY ──────────────────────────────────────── */}
      <Section id="notion-history" title="Notion History" icon="📜" activeId={activeId} setActiveId={setActiveId}>

        <H2>What it is</H2>
        <P>Notion History is a log of every batch ever created with the Notion Card Creator. Each entry shows the client, member who created it, post type, number of cards, and a timestamp. Expand any batch to see the individual cards with links to open them in Notion.</P>

        <H2>Search</H2>
        <P>The search box filters by client name, member name, or post type. Results update as you type.</P>

        <H2>Actions Bar</H2>
        <P>Each batch has an actions bar with three tools:</P>

        <H3>Fill Article Docs</H3>
        <P>Reads the <strong>Article Doc</strong> column from the original order sheet and fills the <em>Article DOC</em> URL field in each matching Notion page (matched by domain).</P>
        <Step n="1" title="Click Fill Article Docs">The tool reads the saved sheet URL + tab for this batch.</Step>
        <Step n="2" title="Sheet scan">Finds the Article Doc column header (looks for a column containing "article doc") and builds a domain → URL map.</Step>
        <Step n="3" title="Notion update">PATCHes each Notion page that has a matching domain. Shows a progress bar, then a summary (✓ N filled · X skipped · Y failed).</Step>
        <Note>Only works on batches created after the sheet URL saving was implemented. Older batches show the button dimmed.</Note>

        <H3>Sync Live Links → Sheet</H3>
        <P>The reverse flow: reads the <em>Live link</em> field from each Notion page in the batch and writes those URLs back into the <strong>Live Link column</strong> of the original order sheet.</P>
        <Step n="1" title="Reads Notion pages">Fetches each card's Notion page and extracts the Live link URL (3 at a time, rate-limited).</Step>
        <Step n="2" title="Scans the sheet">Finds the domain column and the Live Link column in the sheet.</Step>
        <Step n="3" title="Writes to sheet">Matches by domain and updates the corresponding cells in one batch write call.</Step>
        <Tip>Use this after manually filling Live links in Notion — it syncs them back to the client's sheet automatically.</Tip>

        <H3>Update Status</H3>
        <P>Bulk-updates the <em>Order Status</em> field on <strong>every card</strong> in the batch at once.</P>
        <P>Select the new status from the dropdown (e.g. <em>Published</em>, <em>Pending Publication</em>), then click <strong>Update All</strong>. A progress bar shows the update across all cards. After completion you can pick a different status and update again.</P>

        <H2>Expanded Card List</H2>
        <P>Click the ▼ arrow (or anywhere on the batch header row) to expand the batch and see every card that was created. Each row shows the card title (Order ID — Domain) and an <strong>Open →</strong> button that links directly to that page in Notion.</P>

      </Section>

    </div>
  )
}
