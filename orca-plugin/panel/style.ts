// hallmark-final's table rules (decision 92①): no row background for owner rows, one data-row
// height of 40px. Colours come from Orca's frame variables (`--orca-*`, decision 169) so the panel
// follows Orca's theme like its own panels; the hallmark values are only the fallback outside Orca.
export const STYLE = `
:root {
  --font-sans: system-ui, -apple-system, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --text-xs: 11px; --text-sm: 12px; --text-base: 13px; --text-md: 15px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
  --r1: 4px; --r2: 6px; --r3: 8px; --dur: 120ms;
  --h-paper: oklch(98.6% 0.004 255); --h-paper-2: oklch(96.2% 0.005 255); --h-paper-3: oklch(94% 0.006 255);
  --h-ink: oklch(21% 0.01 255); --h-muted: oklch(50% 0.012 255);
  --h-rule: oklch(91.5% 0.006 255); --h-rule-2: oklch(82% 0.008 255);
  --h-accent: oklch(52% 0.17 255); --h-accent-ink: oklch(99% 0.005 255);
  --h-focus: oklch(52% 0.19 255); --h-bad: oklch(50% 0.18 27);
  --link: oklch(52% 0.17 255);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not(.light):not([data-theme="light"]) {
    --h-paper: oklch(17% 0.008 255); --h-paper-2: oklch(21% 0.009 255); --h-paper-3: oklch(25% 0.01 255);
    --h-ink: oklch(94% 0.005 255); --h-muted: oklch(69% 0.012 255);
    --h-rule: oklch(29% 0.01 255); --h-rule-2: oklch(40% 0.012 255);
    --h-accent: oklch(70% 0.15 255); --h-accent-ink: oklch(15% 0.03 255);
    --h-focus: oklch(74% 0.17 255); --h-bad: oklch(72% 0.16 25);
    --link: oklch(72% 0.14 255);
    color-scheme: dark;
  }
}
:root.dark, :root[data-theme="dark"] {
  --h-paper: oklch(17% 0.008 255); --h-paper-2: oklch(21% 0.009 255); --h-paper-3: oklch(25% 0.01 255);
  --h-ink: oklch(94% 0.005 255); --h-muted: oklch(69% 0.012 255);
  --h-rule: oklch(29% 0.01 255); --h-rule-2: oklch(40% 0.012 255);
  --h-accent: oklch(70% 0.15 255); --h-accent-ink: oklch(15% 0.03 255);
  --h-focus: oklch(74% 0.17 255); --h-bad: oklch(72% 0.16 25);
  --link: oklch(72% 0.14 255);
  color-scheme: dark;
}
:root {
  --paper: var(--orca-background, var(--h-paper));
  --paper-2: var(--orca-muted, var(--h-paper-2));
  --paper-3: var(--orca-accent, var(--h-paper-3));
  --ink: var(--orca-foreground, var(--h-ink));
  --ink-2: color-mix(in oklab, var(--ink) 80%, var(--paper));
  --muted: var(--orca-muted-foreground, var(--h-muted));
  --rule: var(--orca-border, var(--h-rule));
  --rule-2: var(--orca-input, var(--h-rule-2));
  --accent: var(--orca-primary, var(--h-accent));
  --accent-ink: var(--orca-primary-foreground, var(--h-accent-ink));
  --accent-soft: var(--orca-muted, var(--h-paper-2));
  --pop: var(--orca-popover, var(--h-paper));
  --pop-ink: var(--orca-popover-foreground, var(--h-ink));
  --focus: var(--orca-ring, var(--h-focus));
  --bad: var(--orca-destructive, var(--h-bad));
}
* { box-sizing: border-box; }
html, body { overflow-x: clip; }
body { margin: 0; background: var(--paper); color: var(--ink); font: var(--text-base)/20px var(--font-sans); font-variant-numeric: tabular-nums; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; text-underline-offset: 2px; }
code { font-family: var(--font-mono); font-size: var(--text-xs); }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
h1, h2, h3 { margin: 0; font-weight: 600; letter-spacing: -0.01em; overflow-wrap: break-word; min-width: 0; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
#root { padding: 0 0 var(--s4); container: panel / inline-size; }
.top { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: var(--s2); height: 36px; padding: 0 var(--s1) 0 var(--s3); border-bottom: 1px solid var(--rule); background: var(--paper); }
.brand { display: inline-flex; align-items: center; gap: var(--s2); font-weight: 600; font-size: var(--text-base); white-space: nowrap; }
.brand .ic { width: 16px; height: 16px; color: var(--muted); }
.brand small { color: var(--muted); font-weight: 400; font-size: var(--text-xs); }
.fresh { color: var(--muted); font-size: var(--text-xs); white-space: nowrap; }
.tools { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.ibtn { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--r2); background: none; color: var(--muted); cursor: pointer; list-style: none; }
.ibtn::-webkit-details-marker { display: none; }
.ibtn:hover, details[open] > .ibtn { background: var(--paper-3); color: var(--ink); }
.ibtn .ic { width: 16px; height: 16px; }
details.menu { position: relative; }
.pop { position: absolute; right: 0; top: 32px; z-index: 3; display: flex; flex-direction: column; min-width: 208px; padding: var(--s1); background: var(--pop); color: var(--pop-ink); border: 1px solid var(--rule); border-radius: var(--r3); box-shadow: 0 4px 16px rgb(0 0 0 / 0.12); }
.pop button { height: 28px; padding: 0 var(--s2); border: 0; border-radius: var(--r1); background: none; color: inherit; font: inherit; font-size: var(--text-sm); text-align: left; white-space: nowrap; cursor: pointer; }
.pop button:hover { background: var(--paper-3); }
.seg { display: flex; gap: 2px; margin: var(--s2) var(--s3) 0; padding: 2px; border: 1px solid var(--rule); border-radius: var(--r2); }
.seg button { flex: 1 1 0; height: 24px; padding: 0 var(--s2); border: 0; border-radius: var(--r1); background: none; color: var(--muted); font: inherit; font-size: var(--text-sm); white-space: nowrap; cursor: pointer; }
.seg button:hover { color: var(--ink); }
.seg button[aria-selected="true"] { background: var(--paper-3); color: var(--ink); font-weight: 600; }
.seg .count { font-weight: 400; color: var(--muted); }
main { padding: var(--s2) var(--s3) 0; }
main[data-view="todo"] section[data-tab="prog"], main[data-view="prog"] section[data-tab="todo"] { display: none; }
.crumbs { color: var(--muted); font-size: var(--text-sm); margin: var(--s2) var(--s3) 0; }
button.link { border: 0; background: none; padding: 0; color: var(--link); font: inherit; cursor: pointer; }
h1 { font-size: var(--text-base); line-height: 20px; margin-bottom: var(--s2); }
h1 .dim { color: var(--ink-2); font-weight: 400; }
h3 { font-size: var(--text-sm); color: var(--muted); font-weight: 500; padding: var(--s1) 0; }
.sumline { margin: 0 0 var(--s3); padding: var(--s1) var(--s2); background: var(--accent-soft); border-radius: var(--r2); font-size: var(--text-sm); font-weight: 600; overflow-wrap: anywhere; }
section { margin: 0 0 var(--s3); }
.sec-h { display: flex; align-items: baseline; gap: var(--s2); padding: var(--s1) 0; border-bottom: 1px solid var(--rule); }
.sec-h h2 { font-size: var(--text-sm); line-height: 20px; }
.sec-h .count { color: var(--muted); font-weight: 400; }
.sec-h .hint, .sec-h .none { margin-left: auto; color: var(--muted); font-size: var(--text-xs); }
section.nil { margin: 0; }
section.nil .sec-h { border-bottom: 0; }
section.nil h2 { color: var(--muted); font-weight: 500; }
section.nil + section:not(.nil) { margin-top: var(--s2); }
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
.foot { margin: var(--s3) 0 0; color: var(--ink-2); font-size: var(--text-xs); line-height: 16px; }
.msg { margin: var(--s2) var(--s3) 0; padding: var(--s2) var(--s3); border: 1px solid var(--rule-2); border-radius: var(--r2); font-size: var(--text-sm); }
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
/* Orca's sidebar is about 665px wide; without the old side padding it still folds rows (decision 169). */
@container panel (max-width: 719px) {
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
}
@media (prefers-reduced-motion: reduce) { .btn { transition: none; } }
`;
