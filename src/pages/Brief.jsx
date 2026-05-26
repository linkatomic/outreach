import { Icon } from '../data.jsx'

export function BriefPage() {
  const sections = [
    { id: 'strategy',    label: '1 · Strategy' },
    { id: 'ia',          label: '2 · Information Architecture' },
    { id: 'flows',       label: '3 · User Flows' },
    { id: 'screens',     label: '4 · Screen Concepts' },
    { id: 'system',      label: '5 · Design System' },
    { id: 'interaction', label: '6 · Interaction Design' },
    { id: 'productivity',label: '7 · Productivity Optimizations' },
    { id: 'mvp',         label: '8 · MVP Recommendation' },
    { id: 'figma',       label: '9 · Figma Handoff Brief' },
  ];

  return (
    <div className="page" style={{ maxWidth: 1080 }}>
      <div className="page-head">
        <div>
          <h1>Relay — Design Brief</h1>
          <div className="sub">Implementation-ready spec for the outreach ops platform · v0.4 · May 26, 2026</div>
        </div>
        <div className="actions">
          <button className="btn ghost"><Icon name="copy" size={12} />Copy link</button>
          <button className="btn"><Icon name="download" size={12} />Export PDF</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 32 }}>
        <nav style={{ position: 'sticky', top: 0, alignSelf: 'start', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`} className="nav-item" style={{ fontSize: 12 }}>{s.label}</a>
          ))}
        </nav>

        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-dim)' }}>
          <style>{`
            .brief h2 { font-size: 18px; font-weight: 600; color: var(--text); letter-spacing: -0.02em; margin: 40px 0 8px; scroll-margin-top: 60px; }
            .brief h2:first-child { margin-top: 0; }
            .brief h3 { font-size: 14px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; margin: 24px 0 6px; }
            .brief p { margin: 0 0 12px; }
            .brief ul { margin: 0 0 14px; padding-left: 18px; }
            .brief li { margin-bottom: 4px; }
            .brief b, .brief strong { color: var(--text); font-weight: 500; }
            .brief code { font-family: var(--font-mono); font-size: 12px; background: var(--surface-2); padding: 1px 6px; border-radius: 4px; color: var(--text); }
            .brief hr { margin: 32px 0; }
            .brief .callout { padding: 14px 16px; background: var(--surface); border-left: 2px solid var(--accent); border-radius: 0 8px 8px 0; margin: 16px 0; }
            .brief .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
            .brief .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 16px 0; }
            .brief .stat-card { padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
            .brief .stat-card .l { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-faint); margin-bottom: 4px; }
            .brief .stat-card .v { font-size: 18px; font-weight: 500; color: var(--text); font-family: var(--font-mono); letter-spacing: -0.02em; }
            .brief table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin: 12px 0; }
            .brief th, .brief td { padding: 8px 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
            .brief th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-faint); font-weight: 500; }
            .brief .flow-step { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border); }
            .brief .flow-step .n { width: 22px; height: 22px; border-radius: 50%; background: var(--surface-3); color: var(--text); display: grid; place-items: center; font-family: var(--font-mono); font-size: 11px; flex-shrink: 0; }
            .brief .flow-step .n.acc { background: var(--accent); color: var(--accent-ink); }
            .brief .flow-step .sec { color: var(--text-faint); font-family: var(--font-mono); font-size: 11px; margin-left: auto; }
            .brief .swatch { width: 100%; height: 56px; border-radius: 6px; border: 1px solid var(--border); display: flex; align-items: flex-end; justify-content: space-between; padding: 8px 10px; font-family: var(--font-mono); font-size: 10px; }
          `}</style>

          <div className="brief">
            <h2 id="strategy">1 · Strategy</h2>
            <h3>The current problem, concretely</h3>
            <p>The outreach team's workday is currently fragmented across Google Chat, Google Sheets, Missive, Microsoft Teams, and WhatsApp. Reports have no standard shape. There is <b>no auditable history</b>, no productivity signal beyond gut feel.</p>
            <div className="grid-3">
              <div className="stat-card"><div className="l">Daily friction</div><div className="v">~9 min</div><div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 4 }}>typing the chat update + logging emails</div></div>
              <div className="stat-card"><div className="l">Auditability</div><div className="v">none</div><div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 4 }}>messy chat text isn't queryable</div></div>
              <div className="stat-card"><div className="l">Tools in play</div><div className="v">5</div><div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 4 }}>chat, sheets, Missive, teams, WhatsApp</div></div>
            </div>
            <h3>Product goals (v1)</h3>
            <ul>
              <li><b>Standardize the day's output</b> into structured, queryable data — without making it slower than chat.</li>
              <li><b>Cut email-logging time from ~30s/entry to ~4s/entry</b> via keyboard-first quick add + bulk paste.</li>
              <li><b>Give the team lead a single glance</b> for "who's on track, who needs a nudge, what's blocked."</li>
              <li><b>Replace nothing the team doesn't want replaced</b>. Missive keeps owning inbox; Relay just pulls links in.</li>
            </ul>
            <h3>User problems → opportunities</h3>
            <table>
              <thead><tr><th>Pain</th><th>Today</th><th>Relay</th></tr></thead>
              <tbody>
                <tr><td>Messy report text</td><td>Free-form Google Chat</td><td>Structured numpad · 14 named metrics</td></tr>
                <tr><td>Slow email logging</td><td>Tabbing through 4 sheet cells</td><td>Quick-add bar · bulk paste · grid mode</td></tr>
                <tr><td>No comparison view</td><td>Reading 5 Chat messages</td><td>Leaderboard + heatmap + line chart</td></tr>
                <tr><td>"Did Preeti file today?"</td><td>Scroll Chat</td><td>Status dots in sidebar + review queue</td></tr>
                <tr><td>"How many emails this week?"</td><td>Sum cells across tabs</td><td>One KPI tile, exportable in 1 click</td></tr>
                <tr><td>Duplicate vendor entries</td><td>Eyeball it</td><td>Inline dup-warning chip on quick-add</td></tr>
              </tbody>
            </table>
            <div className="callout">
              <b>Design principle:</b> If a task takes more than 5 seconds in Relay, it's a bug. The bar isn't "better than Sheets" — it's "as fast as muscle memory."
            </div>

            <h2 id="ia">2 · Information Architecture</h2>
            <h3>Module map</h3>
            <table>
              <thead><tr><th>Module</th><th>v1?</th><th>Owner</th><th>Replaces</th></tr></thead>
              <tbody>
                <tr><td><b>Home</b> · role-aware dashboard</td><td>✓</td><td>Both</td><td>—</td></tr>
                <tr><td><b>Daily Report</b> · numpad quick-log</td><td>✓</td><td>Member</td><td>Google Chat updates</td></tr>
                <tr><td><b>Email Log</b> · 3 entry modes</td><td>✓</td><td>Member</td><td>Google Sheets tabs</td></tr>
                <tr><td><b>Analytics</b> · trends, mix, hour-of-day</td><td>✓</td><td>Lead</td><td>Manual cell-summing</td></tr>
                <tr><td><b>Team</b> · directory + member detail</td><td>✓</td><td>Both</td><td>Team header in chat</td></tr>
                <tr><td><b>Review Queue</b> · approve/flag reports</td><td>✓</td><td>Lead</td><td>—</td></tr>
                <tr><td><b>Leaderboard</b></td><td>✓</td><td>Both</td><td>—</td></tr>
                <tr><td><b>Command Palette</b> · ⌘ K</td><td>✓</td><td>Both</td><td>—</td></tr>
                <tr><td><b>Settings</b> · targets, theme, reminders</td><td>✓</td><td>Both</td><td>—</td></tr>
              </tbody>
            </table>
            <h3>Navigation hierarchy</h3>
            <p>Two-level only. The sidebar is split into <b>Workspace</b> (everyone) and <b>Manage</b> (lead-only), with a third <b>More</b> group for utility pages. Everything is also reachable from the command palette in 2 keystrokes.</p>

            <h2 id="flows">3 · User Flows</h2>
            <h3>Flow A — Member files daily report</h3>
            <div>
              {[['1','17:30 IST · push notification: "File today\'s report — 45s in Relay"','0s'],['2','Click reminder → lands on /report with numpad mode, first metric focused','<1s'],['3','Type "31" → ↵ · auto-advances · type 5 → ↵ · skip the next 3 with TAB','~25s'],['4','Reach note field — optional: "Power cut delayed start"','~38s'],['5','Submit · success screen shows totals and "Log emails next" CTA','~45s'],['6','Click through: lands on /emails with cursor in the quick-add bar','+0s']].map(([n, label, t]) => (
                <div className="flow-step" key={n}>
                  <span className={`n ${n === '6' ? 'acc' : ''}`}>{n}</span>
                  <span>{label}</span>
                  <span className="sec">{t}</span>
                </div>
              ))}
            </div>

            <h3>Flow B — Member logs emails through the day</h3>
            <div>
              {[['1','During work: presses N anywhere in Relay → cursor lands in quick-add bar'],['2','Types vendor (autocomplete from past 90 days), Tab, pastes Missive link, ↵'],['3','Row appears at top of grid with a 1s accent flash. Duplicate warning if vendor was emailed in last 7 days.'],['4','For batched work: presses B → bulk paste modal → pastes 20 lines → Import.'],['5','Day end: today\'s count shown in KPI tile, no need to "submit" anything.']].map(([n, label]) => (
                <div className="flow-step" key={n}><span className="n">{n}</span><span>{label}</span></div>
              ))}
            </div>

            <h3>Flow C — Team lead morning review (5 minutes)</h3>
            <div>
              {[['1','09:00 · opens Relay → Home (lead variant). KPIs: emails today, reports filed N/5, week trend.'],['2','Scans heatmap — one cell looks low: clicks → drills into that member\'s 30-day chart.'],['3','Cmd-K → "review" → Review Queue. Sees 3 pending reports, 1 flagged.'],['4','Two clicks each: Approve, Approve, Approve. Flagged report: writes a comment, sends back.'],['5','Cmd-K → "export" → CSV with this week\'s numbers for management.']].map(([n, label]) => (
                <div className="flow-step" key={n}><span className="n">{n}</span><span>{label}</span></div>
              ))}
            </div>

            <h2 id="screens">4 · Screen-by-screen Concepts</h2>
            <p className="muted">Every screen is implemented live in this prototype. The summaries below are the design-intent layer.</p>
            <h3>Home · Member</h3>
            <p><b>Purpose:</b> answer "what do I need to do right now" in under 2 seconds. 4-up KPI strip → 2-col main → activity feed. Hero CTA: "File today's report" pinned top-right.</p>
            <h3>Home · Lead</h3>
            <p>Same KPI grammar with team-level metrics, plus team-status panel, 5×26 reporting heatmap, and mini leaderboard.</p>
            <h3>Daily Report (numpad)</h3>
            <p>One giant number readout, one metric at a time, with on-screen 3×4 numpad. Queue rail on the right shows all 14 metrics. Keyboard-first: ↵ saves, Tab skips, +/− nudges.</p>
            <h3>Email Log</h3>
            <p>Three modes share one keyboard-grade table: <b>Quick add</b>, <b>Keyboard grid</b>, <b>Bulk paste</b>. Vendor autocomplete fed from past 90 days. Duplicate detection runs in real-time.</p>

            <h2 id="system">5 · Design System Direction</h2>
            <h3>Type</h3>
            <table>
              <thead><tr><th>Token</th><th>Size · Weight</th><th>Use</th></tr></thead>
              <tbody>
                <tr><td>Display</td><td>90 · 400 · −0.05em mono</td><td>Numpad readout</td></tr>
                <tr><td>H1</td><td>22 · 600 · −0.02em</td><td>Page titles</td></tr>
                <tr><td>H3 / Card</td><td>13 · 500</td><td>Card headers</td></tr>
                <tr><td>Body</td><td>13 · 400</td><td>Default</td></tr>
                <tr><td>Caption</td><td>11 · 500 · 0.06em uppercase</td><td>Labels, KPI legends</td></tr>
                <tr><td>Mono</td><td>12 · 400</td><td>Counts, codes, kbd</td></tr>
              </tbody>
            </table>
            <h3>Color</h3>
            <p>Pure greys for surface scale, one neon lime accent (<code>#D2FE5C</code>) reserved for primary CTAs, accent rank, charted "now," and accent chips. Light theme mirrors the same structure with <code>#9CE600</code>.</p>
            <div className="grid-3">
              <div className="swatch" style={{ background: '#000', color: '#FAFAFA' }}><span style={{ color: '#FAFAFA', fontWeight: 600 }}>bg</span><span style={{ color: '#FAFAFA', opacity: 0.7 }}>#000000</span></div>
              <div className="swatch" style={{ background: '#0A0A0A', color: '#FAFAFA' }}><span style={{ color: '#FAFAFA', fontWeight: 600 }}>surface</span><span style={{ color: '#FAFAFA', opacity: 0.7 }}>#0A0A0A</span></div>
              <div className="swatch" style={{ background: '#D2FE5C', color: '#0A1500' }}><span style={{ fontWeight: 600 }}>accent</span><span style={{ opacity: 0.7 }}>#D2FE5C</span></div>
            </div>

            <h2 id="interaction">6 · Interaction Design</h2>
            <h3>Micro-interactions worth building</h3>
            <ul>
              <li><b>Numpad commit:</b> ↵ saves the value, persists in the queue rail with a 200ms accent flash, next metric slides in.</li>
              <li><b>Email log entry:</b> ↵ pushes a new row at top with a 1s accent-tinted background that fades to surface.</li>
              <li><b>Duplicate warning:</b> when vendor matches a vendor emailed in past 7 days, a warn chip slides in. Never blocks save.</li>
              <li><b>Approve action:</b> the row collapses to a 1-line success state for 800ms, then disappears with a height-collapse.</li>
              <li><b>Theme toggle:</b> crossfade root colors in 200ms, no flicker. Persisted via Tweaks.</li>
            </ul>

            <h2 id="productivity">7 · Productivity Optimizations</h2>
            <h3>Keyboard shortcuts</h3>
            <table>
              <thead><tr><th>Scope</th><th>Key</th><th>Action</th></tr></thead>
              <tbody>
                <tr><td>Global</td><td><code>⌘K</code></td><td>Command palette</td></tr>
                <tr><td>Global</td><td><code>/</code></td><td>Focus search</td></tr>
                <tr><td>Global</td><td><code>?</code></td><td>Show shortcut overlay</td></tr>
                <tr><td>Global</td><td><code>G H/R/E/A/T</code></td><td>Go to Home / Report / Emails / Analytics / Team</td></tr>
                <tr><td>Report</td><td><code>↵</code></td><td>Save & next metric</td></tr>
                <tr><td>Report</td><td><code>TAB</code></td><td>Skip metric</td></tr>
                <tr><td>Emails</td><td><code>N</code></td><td>Focus quick-add</td></tr>
                <tr><td>Emails</td><td><code>B</code></td><td>Bulk paste modal</td></tr>
                <tr><td>Review</td><td><code>⌘ A</code></td><td>Approve all clean</td></tr>
              </tbody>
            </table>

            <h2 id="mvp">8 · MVP Recommendation</h2>
            <h3>v1 — ship to the 6 of us in 6 weeks</h3>
            <table>
              <thead><tr><th>Include</th><th>Defer</th></tr></thead>
              <tbody>
                <tr><td>Auth (Google SSO) + 2 roles (member/lead)</td><td>Admin role · permissions matrix</td></tr>
                <tr><td>Home (both variants)</td><td>Customizable dashboard tiles</td></tr>
                <tr><td>Daily Report — numpad + grid modes</td><td>Custom metric editor</td></tr>
                <tr><td>Email Log — quick add + bulk paste + grid</td><td>Missive OAuth integration</td></tr>
                <tr><td>Analytics — line, comparison, mix</td><td>Cohort / funnel analytics</td></tr>
                <tr><td>Review Queue · Leaderboard</td><td>Comments / threads on reports</td></tr>
                <tr><td>Command palette · keyboard shortcuts</td><td>Slash-commands inline</td></tr>
                <tr><td>Dark/light mode · settings page</td><td>Per-user themes beyond dark/light</td></tr>
                <tr><td>CSV export</td><td>Live Google Sheet sync</td></tr>
              </tbody>
            </table>
            <div className="callout">
              <b>The cut:</b> anything that requires another vendor's API in v1 is deferred. Manual Missive-link paste in v1 → Missive OAuth in v1.5.
            </div>

            <h2 id="figma">9 · Figma Handoff Brief</h2>
            <h3>Files to set up</h3>
            <ul>
              <li><code>Relay / 00 — Foundations</code> — colors, type, spacing, motion tokens.</li>
              <li><code>Relay / 01 — Components</code> — KPI tile, card, chip, segmented, table row, button, modal, detail panel, sidebar item, command-item, numpad-key.</li>
              <li><code>Relay / 02 — Screens</code> — one page per route.</li>
              <li><code>Relay / 03 — Flows</code> — frame chains for the 4 flows above, with overlay annotations.</li>
              <li><code>Relay / 04 — States</code> — empty / loading / error / success per surface.</li>
            </ul>
            <h3>Variables to define first</h3>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>color/bg · color/surface · color/surface-2 · color/surface-3 · color/border · color/border-strong · color/text · color/text-dim · color/text-faint · color/accent · color/accent-ink · color/ok · color/warn · color/danger · color/info · space/1..8 · radius/xs..xl · font/sans · font/mono</p>
            <h3>Hand-off acceptance</h3>
            <ul>
              <li>Every primitive is a Figma component with variants matching the prototype's CSS classes 1:1.</li>
              <li>Token names in Figma === CSS custom property names. <code>--accent</code> ↔ <code>color/accent</code>.</li>
              <li>Each screen exists in dark <i>and</i> light, with empty/loading/error/success states.</li>
              <li>Engineers can read this prototype's source as a parallel spec.</li>
            </ul>
            <hr />
            <p className="faint">End of brief · v0.4 · Author: design @ Relay</p>
          </div>
        </div>
      </div>
    </div>
  );
}
