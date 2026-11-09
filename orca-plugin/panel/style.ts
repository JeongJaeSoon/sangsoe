// hallmark-final's tokens and table rules (decision 92①): no row background for owner rows, one
// data-row height of 40px, AA contrast measured on these tokens (the mockup README's table).
export const STYLE = `
:root {
  --font-sans: system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --text-xs: 11px; --text-sm: 12px; --text-base: 13px; --text-md: 15px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
  --r1: 4px; --r2: 6px; --r3: 8px; --dur: 120ms;
  --paper: oklch(98.6% 0.004 255); --paper-2: oklch(96.2% 0.005 255); --paper-3: oklch(94% 0.006 255);
  --ink: oklch(21% 0.01 255); --ink-2: oklch(41% 0.012 255); --muted: oklch(50% 0.012 255);
  --rule: oklch(91.5% 0.006 255); --rule-2: oklch(82% 0.008 255);
  --accent: oklch(52% 0.17 255); --accent-ink: oklch(99% 0.005 255); --accent-soft: oklch(95% 0.03 255);
  --focus: oklch(52% 0.19 255); --bad: oklch(50% 0.18 27);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: oklch(17% 0.008 255); --paper-2: oklch(21% 0.009 255); --paper-3: oklch(25% 0.01 255);
    --ink: oklch(94% 0.005 255); --ink-2: oklch(80% 0.01 255); --muted: oklch(69% 0.012 255);
    --rule: oklch(29% 0.01 255); --rule-2: oklch(40% 0.012 255);
    --accent: oklch(70% 0.15 255); --accent-ink: oklch(15% 0.03 255); --accent-soft: oklch(26% 0.05 255);
    --focus: oklch(74% 0.17 255); --bad: oklch(72% 0.16 25);
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --paper: oklch(17% 0.008 255); --paper-2: oklch(21% 0.009 255); --paper-3: oklch(25% 0.01 255);
  --ink: oklch(94% 0.005 255); --ink-2: oklch(80% 0.01 255); --muted: oklch(69% 0.012 255);
  --rule: oklch(29% 0.01 255); --rule-2: oklch(40% 0.012 255);
  --accent: oklch(70% 0.15 255); --accent-ink: oklch(15% 0.03 255); --accent-soft: oklch(26% 0.05 255);
  --focus: oklch(74% 0.17 255); --bad: oklch(72% 0.16 25);
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { overflow-x: clip; }
body { margin: 0; background: var(--paper); color: var(--ink); font: var(--text-base)/20px var(--font-sans); font-variant-numeric: tabular-nums; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 2px; }
code { font-family: var(--font-mono); font-size: var(--text-xs); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.01em; overflow-wrap: break-word; min-width: 0; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
#root { padding: var(--s3) var(--s5) var(--s6); container: panel / inline-size; }
.top { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--s1) var(--s3); padding-bottom: var(--s3); }
.brand { font-weight: 600; font-size: var(--text-md); }
.brand small { color: var(--muted); font-weight: 400; font-size: var(--text-xs); margin-left: var(--s1); }
.fresh { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
.crumbs { color: var(--muted); font-size: var(--text-sm); margin: 0 0 var(--s2); }
button.link { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; cursor: pointer; }
h1 { font-size: var(--text-md); line-height: 24px; margin-bottom: var(--s3); }
h1 .dim { color: var(--ink-2); font-weight: 400; }
h3 { font-size: var(--text-sm); color: var(--muted); font-weight: 500; padding: var(--s1) 0; }
.sumline { margin: var(--s2) 0 var(--s5); padding: var(--s2) var(--s3); background: var(--accent-soft); border-radius: var(--r2); font-size: var(--text-sm); font-weight: 600; overflow-wrap: anywhere; }
section { margin: 0 0 var(--s5); }
.sec-h { display: flex; align-items: baseline; gap: var(--s2); padding-bottom: var(--s2); border-bottom: 1px solid var(--rule-2); }
.sec-h h2 { font-size: var(--text-md); line-height: 24px; }
.sec-h .count { color: var(--muted); font-weight: 400; }
.sec-h .hint { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-weight: 500; font-size: var(--text-xs); line-height: 16px; color: var(--muted); padding: var(--s2) var(--s3); white-space: nowrap; border-bottom: 1px solid var(--rule); }
.tbl td { height: 40px; padding: var(--s1) var(--s3); border-bottom: 1px solid var(--rule); vertical-align: middle; overflow-wrap: anywhere; line-height: 20px; }
.tbl th:first-child, .tbl td:first-child { padding-left: var(--s1); width: 64px; }
.tbl tbody tr:hover { background: var(--paper-2); }
.tbl tr[data-nav] { cursor: pointer; }
.tbl .id { white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--muted); margin-right: var(--s1); }
.tbl td.title { font-weight: 500; }
.tbl tr.lead td { background: var(--paper-2); font-weight: 600; border-top: 1px solid var(--rule-2); }
.tbl tr.lead:hover td { background: var(--paper-3); }
.tbl tr.item td.title::before { content: "└"; color: var(--rule-2); margin-right: var(--s1); }
.tbl .brk { display: none; }
.pri { display: inline-block; margin-left: var(--s1); padding: 0 6px; border: 1px solid var(--rule-2); border-radius: var(--r1); font-family: var(--font-mono); font-size: var(--text-xs); font-weight: 600; line-height: 16px; vertical-align: 1px; }
.dash { color: var(--muted); }
.empty { padding: var(--s3) var(--s1); color: var(--muted); margin: 0; }
.btn { display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 var(--s3); border: 1px solid var(--rule-2); border-radius: var(--r2); background: var(--paper); color: var(--ink); font: inherit; font-size: var(--text-sm); white-space: nowrap; cursor: pointer; transition: background-color var(--dur) ease-out; }
.btn:hover { background: var(--paper-2); border-color: var(--muted); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
.btn:disabled { opacity: 0.5; cursor: default; }
td.acts { white-space: nowrap; text-align: right; }
td.acts .btn + .btn { margin-left: var(--s2); }
.tbl tr[hidden] { display: none; }
tr.other form { display: flex; gap: var(--s2); }
tr.other input { flex: 1; height: 28px; padding: 0 var(--s2); border: 1px solid var(--rule-2); border-radius: var(--r2); background: var(--paper); color: var(--ink); font: inherit; }
.foot { margin: var(--s5) 0 0; color: var(--ink-2); font-size: var(--text-xs); line-height: 16px; }
.msg { margin: 0 0 var(--s3); padding: var(--s2) var(--s3); border: 1px solid var(--rule-2); border-radius: var(--r2); font-size: var(--text-sm); }
.msg.bad { color: var(--bad); border-color: var(--bad); }
.gwrap { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s5) var(--s6); margin: 0 0 var(--s5); }
.dag { display: block; width: 100%; height: auto; }
.dag text { fill: var(--ink); font-family: var(--font-sans); }
.dag .nd rect { fill: var(--paper); stroke: var(--muted); stroke-width: 1.5; }
.dag .nd.cp rect { stroke-width: 3; stroke: var(--ink); }
.dag .n1 { font-size: 11.5px; font-weight: 700; }
.dag .ed { fill: none; stroke: var(--ink-2); stroke-width: 1.5; marker-end: url(#ah); }
.dag .ed.cp { stroke: var(--ink); stroke-width: 3; }
.dag .ed.after, .gt line.after { stroke-dasharray: 2 3; }
.dag .ed.stacked_on, .gt line.stacked_on { stroke-dasharray: 7 3; }
.dag .ed.deploys_after, .gt line.deploys_after { stroke-dasharray: 9 3 2 3; }
.dag .ed.broken { stroke: var(--bad); stroke-dasharray: 3 3; marker-end: url(#ahb); }
.dag .ah { fill: var(--ink-2); }
.dag .ahb { fill: var(--bad); }
.dag .badge circle { fill: var(--ink); }
.dag .badge text { fill: var(--paper); font-size: 10px; font-weight: 700; text-anchor: middle; }
.gt td { font-size: var(--text-sm); }
.gt svg { display: block; width: 40px; height: 8px; }
.gt line { stroke: var(--ink-2); stroke-width: 1.5; }
.gt .step { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--ink); color: var(--paper); font-size: var(--text-xs); font-weight: 700; }
.legend { margin-top: var(--s3); }
@container panel (min-width: 900px) {
  .gwrap { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
@container panel (max-width: 639px) {
  .tbl, .tbl tbody { display: block; }
  .tbl thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .tbl tr { display: flex; flex-wrap: wrap; align-items: baseline; padding: var(--s2) var(--s1); border-bottom: 1px solid var(--rule); }
  .tbl td { display: block; height: auto; padding: 0; border: 0; font-size: var(--text-sm); line-height: 16px; color: var(--ink-2); min-width: 0; width: auto; }
  .tbl td:first-child { flex: none; margin-right: var(--s2); width: auto; }
  .tbl td.title { flex: 1 1 0; font-size: var(--text-base); line-height: 20px; color: var(--ink); font-weight: 500; }
  .tbl td.brk { display: block; flex: 0 0 100%; height: var(--s1); }
  .tbl td[data-l] { margin-right: var(--s3); }
  .tbl td[data-l]::before { content: attr(data-l); color: var(--muted); margin-right: var(--s1); }
  .tbl tr.item { padding-left: var(--s4); }
  .tbl tr.item td.title::before { content: none; }
  .tbl tr.lead { background: var(--paper-2); border-top: 1px solid var(--rule-2); }
  .tbl tr.lead td { background: none; border: 0; }
  .tbl td.acts { flex: 1 0 100%; display: flex; gap: var(--s2); margin: var(--s2) 0 0; }
  .tbl td.acts:empty { display: none; }
  .tbl td.acts .btn { flex: 1 1 0; min-width: 0; height: 32px; margin: 0; }
  .tbl tbody tr:hover { background: none; }
  .sec-h .hint { display: none; }
  #root { padding: var(--s3); }
}
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
`;
