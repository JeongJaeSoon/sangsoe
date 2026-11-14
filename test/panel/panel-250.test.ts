import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { PanelCore } from "../../orca-plugin/core-link.ts";
import { panelHandlers } from "../../orca-plugin/panel/requests.ts";
import { historyCard, type LoadHistory, readParts, renderResBody, type ResState } from "../../orca-plugin/panel/resources.ts";
import { STYLE } from "../../orca-plugin/panel/style.ts";
import { loadHistory } from "../fixtures/panel/load-history.ts";
import { NOW, PARTS_GOT } from "../fixtures/panel/rc3-state.ts";

// Decision 250: PC 부하 shows the last 24 hours of decision 241's 5-minute samples as one card of
// sparklines (load per core, used memory, free disk), each with its current value, 24h low and high
// in words, drawn from the load part's `history` field and nothing the panel keeps.

const ok = (h: LoadHistory) => ({ ok: true as const, value: h });
const svgs = (html: string) => [...html.matchAll(/<svg class="sp"[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => ({ label: m[1] ?? "", body: m[2] ?? "" }));
const paths = (body: string) => [...body.matchAll(/<path class="sp-line" d="([^"]*)"/g)].map((m) => m[1] ?? "");

test("a full day: three sparklines, each named with its last value, 24h low and high, sample count and lines", () => {
  const h = loadHistory(NOW);
  const html = historyCard(ok(h));
  assert.match(html, /^<div class="spark" role="group" aria-label="최근 24시간 부하">/);
  const s = svgs(html);
  assert.equal(s.length, 3);
  const cpu = h.points.map((p) => p.loadPerCpu as number);
  const last = h.points.at(-1);
  assert.equal(s[0]?.label, `CPU 부하 최근 24시간: 마지막 ${last?.loadPerCpu?.toFixed(2)}/코어, 최저 ${Math.min(...cpu).toFixed(2)}, 최고 ${Math.max(...cpu).toFixed(2)}, 표본 288개, 경고 1.3, 위험 2`);
  assert.match(s[1]?.label ?? "", /^사용 메모리 최근 24시간: 마지막 \d+%, 최저 \d+%, 최고 \d+%, 표본 288개, 경고 80%, 위험 90%$/);
  assert.match(s[2]?.label ?? "", /^디스크 여유 최근 24시간: 마지막 \d+ GB, 최저 \d+ GB, 최고 \d+ GB, 표본 288개, 경고 20 GB, 위험 10 GB$/);
  for (const x of s) assert.equal(paths(x.body).length, 1, "a day without a gap is one line");
  assert.deepEqual([...html.matchAll(/<span class="g-v sp-min">([^<]+)<\/span>/g)].map((m) => m[1]), [
    `${Math.min(...cpu).toFixed(2)}–${Math.max(...cpu).toFixed(2)}`,
    "54–70%",
    "66–72 GB",
  ], "the low and high are on screen too, the unit once");
  assert.match(html, /<div class="band-ax sp-ax"><span>24시간 전<\/span><span>표본 288개<\/span><span>지금<\/span><\/div>/);
});

test("scales and the warn line: load per core from 0 to the larger of 1.25 x danger and the peak, memory 0-100, disk 0 to the larger of the peak and 2 x warn", () => {
  const h = loadHistory(NOW);
  const s = svgs(historyCard(ok(h)));
  const y = (v: number, top: number) => (23 - (v / top) * 22).toFixed(1);
  const lines = (body: string) => [...body.matchAll(/<line class="sp-th" x1="0" x2="1000" y1="([\d.]+)"/g)].map((m) => m[1]);
  assert.deepEqual(lines(s[0]?.body ?? ""), [y(1.3, 2.5)], "one dashed line, at warn; the fixture's peak 1.65 is under 2.5");
  assert.deepEqual(lines(s[1]?.body ?? ""), [y(80, 100)]);
  assert.deepEqual(lines(s[2]?.body ?? ""), [y(20, 72)], "disk tops at its 72 GB peak");
  const hot = { ...h, points: h.points.map((p, i) => (i === 100 ? { ...p, loadPerCpu: 5 } : p)) };
  assert.deepEqual(lines(svgs(historyCard(ok(hot)))[0]?.body ?? ""), [y(1.3, 5)], "a peak above 2.5 sets the top");
});

test("partial (fresh install): x spans the whole 24 hours, the line starts where the samples do", () => {
  const h = loadHistory(NOW, 12);
  const html = historyCard(ok(h));
  const d = paths(svgs(html)[0]?.body ?? "")[0] ?? "";
  const x0 = Number(/^M([\d.]+)/.exec(d)?.[1]);
  assert.ok(Math.abs(x0 - (1000 * (1440 - 55)) / 1440) < 1, `first point at ${x0}`);
  assert.match(html, /<span>\d\d:\d\d부터 표본 12개<\/span>/);
});

test("a gap over 15 minutes breaks the line: no interpolation across a stretch nobody sampled", () => {
  const html = historyCard(ok(loadHistory(NOW, 288, [100, 104])));
  assert.equal((paths(svgs(html)[0]?.body ?? "")[0]?.match(/M/g) ?? []).length, 2, "20 minutes missing");
  const short = historyCard(ok(loadHistory(NOW, 288, [100, 102])));
  assert.equal((paths(svgs(short)[0]?.body ?? "")[0]?.match(/M/g) ?? []).length, 1, "15 minutes is still one line");
});

test("a lone sample between gaps gets a short stroke of its own; a run of two keeps its line", () => {
  const h = loadHistory(NOW, 288, [100, 110]);
  const lone = { ...h, points: h.points.filter((p) => p.at < Date.parse(NOW) - 192 * 5 * 60_000 || p.at >= Date.parse(NOW) - 188 * 5 * 60_000) };
  const d = paths(svgs(historyCard(ok(lone)))[0]?.body ?? "")[0] ?? "";
  const subs = d.split("M").filter(Boolean);
  assert.equal(subs.length, 3, "the run before, the lone sample, the run after");
  assert.match(subs[1] ?? "", /^[\d.]+ [\d.]+h3$/, "the lone sample is a point and a 3-unit stroke");
  assert.doesNotMatch(subs[0] ?? "", /h3/);
  assert.doesNotMatch(subs[2] ?? "", /h3/);
});

test("empty store: one quiet line and no drawing; a series never read: its row says so", () => {
  const empty = historyCard(ok({ ...loadHistory(NOW), points: [] }));
  assert.equal(empty, `<p class="empty sp-empty">부하 기록 없음. 감시가 5분마다 하나씩 남긴다.</p>`);
  const noDisk = loadHistory(NOW).points.map(({ diskFreeGb: _, ...p }) => p);
  const html = historyCard(ok({ ...loadHistory(NOW), points: noDisk }));
  assert.equal(svgs(html).length, 2);
  assert.match(html, /<span class="g-l">디스크 여유<\/span><span class="sp-none">기록 없음<\/span>/);
});

test("unread history says so in the card's place; a core without the field draws no card", () => {
  assert.match(historyCard({ ok: false, why: "database is locked" }), /<p class="ep">부하 기록을 <span class="unread" title="database is locked">읽지 못함<\/span><\/p>/);
  assert.equal(historyCard(undefined), "");
  assert.equal(historyCard(null), "");
});

test("the card sits in PC 부하 under the gauges and above the level band, and comes through readParts", async () => {
  assert.ok(PARTS_GOT.load.ok);
  const got = { ...PARTS_GOT, load: { ok: true as const, value: { ...PARTS_GOT.load.value, history: ok(loadHistory(NOW)) } } } as typeof PARTS_GOT;
  const s = await readParts(async (input) => got[input?.part ?? "load"], () => undefined);
  const html = renderResBody(s, Date.parse(NOW), 24);
  const gauge = html.lastIndexOf('class="gauge"');
  const card = html.indexOf('class="spark"');
  const band = html.indexOf('class="band"');
  assert.ok(gauge > 0 && card > gauge && band > card, "gauges, card, band");
  const old = renderResBody(await readParts(async (input) => PARTS_GOT[input?.part ?? "load"], () => undefined), Date.parse(NOW), 24);
  assert.doesNotMatch(old, /class="spark|sp-empty/, "no history field: no card");
  const reading = renderResBody({ kind: "reading", got: { load: got.load } } as ResState, Date.parse(NOW), 24);
  assert.match(reading, /class="spark"/, "the load part paints its card as soon as it comes");
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

test("decision 222: the card is a 1px rule with rounded corners, no fill; the lines are strokes only", () => {
  const rule = /\.spark \{([^}]*)\}/.exec(STYLE)?.[1] ?? "";
  assert.match(rule, /border: 1px solid var\(--rule\)/);
  assert.match(rule, /border-radius: var\(--r2\)/);
  assert.doesNotMatch(rule, /background/);
  assert.match(STYLE, /\.sp-line \{[^}]*fill: none/);
  assert.match(STYLE, /\.sp-line \{[^}]*vector-effect: non-scaling-stroke/);
});
