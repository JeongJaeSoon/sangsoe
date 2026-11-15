import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PanelCore } from "../../orca-plugin/core-link.ts";
import { panelHandlers } from "../../orca-plugin/panel/requests.ts";
import { type LoadHistory, loadRows, readParts, renderResBody, type ResState } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { loadHistory } from "../fixtures/panel/load-history.ts";
import { NOW, PARTS_GOT } from "../fixtures/panel/rc3-state.ts";

// Decisions 250 · 281: PC 부하 is one row per metric (load per core, used memory, free disk): its
// name, the line of decision 241's 5-minute samples over the last 6 or 24 hours, and the value read
// now. The samples come in the load part's `history` field; the panel keeps nothing.

const ok = (h: LoadHistory) => ({ ok: true as const, value: h });
const LIVE = { level: "warn" as const, reasons: ["load/CPU 1.50 (경고 1.3 이상)"], loadPerCpu: 1.5, memFreePct: 40, diskFreeGb: 120 };
const svgs = (html: string) => [...html.matchAll(/<svg class="sp"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => ({ label: m[1] ?? "", body: m[2] ?? "" }));
const paths = (body: string) => [...body.matchAll(/<path class="sp-line" d="([^"]*)"/g)].map((m) => m[1] ?? "");
const rows = (html: string) => [...html.matchAll(/<div class="lrow"( title="([^"]*)")?><span class="g-l">([^<]+)<\/span>([\s\S]*?)<span class="g-v ([^"]*)">([^<]+)<\/span><\/div>/g)].map((m) => ({ title: m[2] ?? "", label: m[3], mid: m[4] ?? "", tone: m[5], value: m[6] }));

test("a full day: three rows of name, line and the value read now; the range is the row's title, not on screen", () => {
  const h = loadHistory(NOW);
  const html = loadRows(ok(h), LIVE, 24);
  assert.match(html, /^<div class="lrows" role="group" aria-label="PC 부하: 지금 값과 최근 24시간">/);
  const r = rows(html);
  assert.deepEqual(r.map((x) => [x.label, x.value, x.tone]), [
    ["CPU", "1.50 / 코어", "t-warn"],
    ["메모리 사용", "60%", ""],
    ["디스크 여유", "120 GB", ""],
  ], "CPU is load per core, memory the used share, disk the free amount");
  const cpu = h.points.map((p) => p.loadPerCpu as number);
  assert.deepEqual(r.map((x) => x.title), [`최근 24시간 ${Math.min(...cpu).toFixed(2)}–${Math.max(...cpu).toFixed(2)} / 코어`, "최근 24시간 54–70%", "최근 24시간 66–72 GB"]);
  const s = svgs(html);
  assert.equal(s.length, 3);
  assert.equal(s[0]?.label, `CPU 최근 24시간 ${Math.min(...cpu).toFixed(2)}–${Math.max(...cpu).toFixed(2)} / 코어, 표본 288개`);
  for (const x of s) assert.equal(paths(x.body).length, 1, "a day without a gap is one line");
  assert.doesNotMatch(html, /sp-th|sp-ax|sp-min|sp-from|g-bar|표본 288개<|24시간 전/, "no guide line, no footer, no bar, no range column");
});

test("the 6 hours switch: the lines hold the last 6 hours only, from the window's left edge", () => {
  const h = loadHistory(NOW);
  const html = loadRows(ok(h), LIVE, 6);
  const s = svgs(html);
  const recent = h.points.slice(-73).map((p) => p.loadPerCpu as number);
  assert.equal(s[0]?.label, `CPU 최근 6시간 ${Math.min(...recent).toFixed(2)}–${Math.max(...recent).toFixed(2)} / 코어, 표본 73개`);
  const d = paths(s[0]?.body ?? "")[0] ?? "";
  assert.match(d, /^M0\.0 /, "the sample six hours ago is at the left edge");
  assert.match(d, /L1000\.0 [\d.]+$/, "the newest at the right");
  assert.doesNotMatch(html, /sp-from/, "samples reach the window's start: no note");
});

test("scales: load per core from 0 to the larger of 1.25 x danger and the peak, memory 0-100, disk 0 to the larger of the peak and 2 x warn", () => {
  const h = loadHistory(NOW);
  const y = (v: number, top: number) => (23 - (v / top) * 22).toFixed(1);
  const lastY = (html: string, i: number) => / ([\d.]+)$/.exec(paths(svgs(html)[i]?.body ?? "")[0] ?? "")?.[1];
  const last = h.points.at(-1);
  const html = loadRows(ok(h), LIVE, 24);
  assert.equal(lastY(html, 0), y(last?.loadPerCpu as number, 2.5), "the fixture's peak 1.65 is under 2.5");
  assert.equal(lastY(html, 1), y(last?.memUsedPct as number, 100));
  assert.equal(lastY(html, 2), y(last?.diskFreeGb as number, 72), "disk tops at its 72 GB peak");
  const hot = { ...h, points: h.points.map((p, i) => (i === 100 ? { ...p, loadPerCpu: 5 } : p)) };
  assert.equal(lastY(loadRows(ok(hot), LIVE, 24), 0), y(last?.loadPerCpu as number, 5), "a peak above 2.5 sets the top");
});

test("partial (fresh install): x spans the whole window, the line starts where the samples do, and a note says when", () => {
  const h = loadHistory(NOW, 12);
  const html = loadRows(ok(h), LIVE, 24);
  const d = paths(svgs(html)[0]?.body ?? "")[0] ?? "";
  const x0 = Number(/^M([\d.]+)/.exec(d)?.[1]);
  assert.ok(Math.abs(x0 - (1000 * (1440 - 55)) / 1440) < 1, `first point at ${x0}`);
  assert.match(html, /<div class="lrow sp-from"><span><\/span><span>\d\d:\d\d부터<\/span><\/div><\/div>$/, "under the rows, in the lines' column");
  const six = loadRows(ok(h), LIVE, 6);
  assert.ok(Math.abs(Number(/^M([\d.]+)/.exec(paths(svgs(six)[0]?.body ?? "")[0] ?? "")?.[1]) - (1000 * (360 - 55)) / 360) < 1);
  assert.match(six, /sp-from/);
});

test("a gap over 15 minutes breaks the line: no interpolation across a stretch nobody sampled", () => {
  const html = loadRows(ok(loadHistory(NOW, 288, [100, 104])), LIVE, 24);
  assert.equal((paths(svgs(html)[0]?.body ?? "")[0]?.match(/M/g) ?? []).length, 2, "20 minutes missing");
  const short = loadRows(ok(loadHistory(NOW, 288, [100, 102])), LIVE, 24);
  assert.equal((paths(svgs(short)[0]?.body ?? "")[0]?.match(/M/g) ?? []).length, 1, "15 minutes is still one line");
});

test("a lone sample between gaps gets a short stroke of its own; a run of two keeps its line", () => {
  const h = loadHistory(NOW, 288, [100, 110]);
  const lone = { ...h, points: h.points.filter((p) => p.at < Date.parse(NOW) - 192 * 5 * 60_000 || p.at >= Date.parse(NOW) - 188 * 5 * 60_000) };
  const d = paths(svgs(loadRows(ok(lone), LIVE, 24))[0]?.body ?? "")[0] ?? "";
  const subs = d.split("M").filter(Boolean);
  assert.equal(subs.length, 3, "the run before, the lone sample, the run after");
  assert.match(subs[1] ?? "", /^[\d.]+ [\d.]+h3$/, "the lone sample is a point and a 3-unit stroke");
  assert.doesNotMatch(subs[0] ?? "", /h3/);
  assert.doesNotMatch(subs[2] ?? "", /h3/);
});

test("a first sample at the right edge draws its stroke back into the row; the late note starts past three periods", () => {
  const one = loadRows(ok(loadHistory(NOW, 1)), LIVE, 6);
  assert.match(paths(svgs(one)[0]?.body ?? "")[0] ?? "", /^M1000\.0 [\d.]+h-3$/);
  assert.equal(rows(one)[1]?.title, "최근 6시간 62%", "one value is not written as a range");
  // 6 hours hold 72 periods: 70 samples begin 15 minutes after the window's start, 69 begin 20 minutes after.
  assert.doesNotMatch(loadRows(ok(loadHistory(NOW, 70)), LIVE, 6), /sp-from/, "three periods late is not late");
  assert.match(loadRows(ok(loadHistory(NOW, 69)), LIVE, 6), /sp-from/);
});

test("the value takes the tone of the load judgment's reason for its metric", () => {
  const reasons = ["load/CPU 2.10 ≥ 위험 2", "메모리 여유 18% ≤ 경고 20%", "디스크 여유 8 GB ≤ 위험 10 GB"];
  const html = loadRows(null, { level: "danger", reasons, loadPerCpu: 2.1, memFreePct: 18, diskFreeGb: 8 }, 6);
  assert.deepEqual(rows(html).map((x) => [x.label, x.tone, x.value]), [["CPU", "t-bad", "2.10 / 코어"], ["메모리 사용", "t-warn", "82%"], ["디스크 여유", "t-bad", "8 GB"]]);
  assert.match(STYLE, /\.g-v\.t-warn \{ color: var\(--accent\); \}/);
  assert.match(STYLE, /\.g-v\.t-bad \{ color: var\(--bad\); \}/);
});

test("an unread load keeps the rows under its notice, each value 모름", async () => {
  assert.ok(PARTS_GOT.load.ok);
  const got = { ...PARTS_GOT, load: { ok: true as const, value: { ...PARTS_GOT.load.value, load: { ok: false as const, why: "sysctl failed" }, history: ok(loadHistory(NOW)) } } } as typeof PARTS_GOT;
  const html = renderResBody(await readParts(async (input) => got[input?.part ?? "load"], () => undefined), Date.parse(NOW), 6);
  assert.match(html, /<h3>PC 부하<\/h3>.*<p class="ep"><span class="unread" title="sysctl failed">읽지 못함<\/span><\/p><div class="lrows"/);
  assert.deepEqual(rows(html).map((x) => x.value), ["모름", "모름", "모름"]);
  assert.equal(svgs(html).length, 3);
});

test("no sample in the window: each row says so in its line's place and still shows the value read now", () => {
  const empty = loadRows(ok({ ...loadHistory(NOW), points: [] }), LIVE, 24);
  assert.equal(svgs(empty).length, 0);
  assert.deepEqual(rows(empty).map((x) => [x.mid, x.value, x.title]), Array.from({ length: 3 }, (_, i) => [`<span class="sp-none">표본 없음</span>`, ["1.50 / 코어", "60%", "120 GB"][i], ""]));
  assert.doesNotMatch(empty, /부하 기록 없음|sp-from/, "no line that says the load has no record beside a drawn level strip");
  const stale = { ...loadHistory(NOW), points: loadHistory(NOW).points.slice(0, 100) };
  assert.equal(svgs(loadRows(ok(stale), LIVE, 6)).length, 0, "samples older than the 6 hours are not drawn in them");
  const noDisk = loadHistory(NOW).points.map(({ diskFreeGb: _, ...p }) => p);
  const html = loadRows(ok({ ...loadHistory(NOW), points: noDisk }), LIVE, 24);
  assert.equal(svgs(html).length, 2);
  assert.match(html, /<span class="g-l">디스크 여유<\/span><span class="sp-none">표본 없음<\/span><span class="g-v ">120 GB<\/span>/);
});

test("unread history says so under the rows; a core without the field, or an unread load, still draws the rows", () => {
  const unread = loadRows({ ok: false, why: "database is locked" }, LIVE, 24);
  assert.match(unread, /<\/div><p class="ep">부하 기록을 <span class="unread" title="database is locked">읽지 못함<\/span><\/p>$/);
  assert.deepEqual(rows(unread).map((x) => [x.mid, x.value]), [["<span></span>", "1.50 / 코어"], ["<span></span>", "60%"], ["<span></span>", "120 GB"]]);
  for (const none of [undefined, null]) {
    const html = loadRows(none, LIVE, 24);
    assert.match(html, /^<div class="lrows" role="group" aria-label="PC 부하: 지금 값"><div class="lrow">.*<\/div>$/);
    assert.equal(rows(html).length, 3);
  }
  const noLoad = loadRows(ok(loadHistory(NOW)), null, 24);
  assert.deepEqual(rows(noLoad).map((x) => x.value), ["모름", "모름", "모름"], "a sample is not shown as the value read now");
  assert.equal(svgs(noLoad).length, 3);
  assert.deepEqual(rows(loadRows(null, { level: "ok", reasons: [] }, 24)).map((x) => x.value), ["모름", "모름", "모름"]);
});

test("the rows sit in PC 부하 above the level band, the switch drives both, and they come through readParts", async () => {
  assert.ok(PARTS_GOT.load.ok);
  const got = { ...PARTS_GOT, load: { ok: true as const, value: { ...PARTS_GOT.load.value, history: ok(loadHistory(NOW)) } } } as typeof PARTS_GOT;
  const s = await readParts(async (input) => got[input?.part ?? "load"], () => undefined);
  const html = renderResBody(s, Date.parse(NOW), 24);
  const rowsAt = html.indexOf('class="lrows"');
  const band = html.indexOf('class="band"');
  assert.ok(rowsAt > 0 && band > rowsAt, "rows, band");
  assert.equal((html.match(/class="lrow"/g) ?? []).length, 3, "one row per metric and no second set");
  assert.match(html, /aria-label="CPU 최근 24시간 /);
  assert.match(html, /<span>24시간 전<\/span><span>지금<\/span>/, "the level strip keeps its own axis");
  const six = renderResBody(s, Date.parse(NOW), 6);
  assert.match(six, /aria-label="CPU 최근 6시간 /);
  assert.match(six, /<span>6시간 전<\/span><span>지금<\/span>/);
  const old = renderResBody(await readParts(async (input) => PARTS_GOT[input?.part ?? "load"], () => undefined), Date.parse(NOW), 24);
  assert.doesNotMatch(old, /class="sp"|sp-none/, "no history field: values only");
  assert.equal((old.match(/class="lrow"/g) ?? []).length, 3);
  const reading = renderResBody({ kind: "reading", got: { load: got.load } } as ResState, Date.parse(NOW), 24);
  assert.match(reading, /class="sp"/, "the load part paints its lines as soon as it comes");
});

test("the switch shows with samples alone: a core that sends history and no band can still pick the span", async () => {
  assert.ok(PARTS_GOT.load.ok);
  const got = { ...PARTS_GOT, load: { ok: true as const, value: { ...PARTS_GOT.load.value, band: null, history: ok(loadHistory(NOW)) } } } as typeof PARTS_GOT;
  const html = renderResBody(await readParts(async (input) => got[input?.part ?? "load"], () => undefined), Date.parse(NOW), 6);
  assert.doesNotMatch(html, /class="band"/);
  assert.match(html, /data-res="h6" aria-pressed="true">6시간<\/button><button type="button" data-res="h24" aria-pressed="false">24시간/);
  const neither = { ...PARTS_GOT, load: { ok: true as const, value: { ...PARTS_GOT.load.value, band: null } } } as typeof PARTS_GOT;
  assert.doesNotMatch(renderResBody(await readParts(async (input) => neither[input?.part ?? "load"], () => undefined), Date.parse(NOW), 6), /class="rng"/, "nothing to span: no switch");
});

test("the worker passes history through untouched; the panel opens no database", async () => {
  const h = loadHistory(NOW, 3);
  const core = { resourcePart: async () => ({ ok: true, value: { part: "load", history: ok(h) } }) } as unknown as PanelCore;
  const r = (await panelHandlers(async () => core)["panel.resources"]({ part: "load" })) as { value: { history: unknown } };
  assert.deepEqual(r.value.history, ok(h));
  const dir = join(import.meta.dirname, "../../orca-plugin/panel");
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
  for (const f of files) assert.doesNotMatch(readFileSync(join(dir, f), "utf8"), /node:sqlite|load_sample/, `${f} reads no store`);
});

test("decision 281: no box around the lines and no guide line; a row is 24px high, its line 16px and a stroke only", () => {
  assert.doesNotMatch(STYLE, /\.spark\b|\.sp-th\b|\.g-bar\b|\.sp-ax\b/);
  const row = /\n\.lrow \{([^}]*)\}/.exec(STYLE)?.[1] ?? "";
  assert.match(row, /align-items: center/);
  assert.match(row, /(^|[; ])height: 24px/);
  const line = /\n\.sp \{([^}]*)\}/.exec(STYLE)?.[1] ?? "";
  assert.match(line, /height: 16px/);
  assert.doesNotMatch(line, /overflow|border/);
  assert.match(STYLE, /\.sp-line \{[^}]*fill: none/);
  assert.match(STYLE, /\.sp-line \{[^}]*vector-effect: non-scaling-stroke/);
});
