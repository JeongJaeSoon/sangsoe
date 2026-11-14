// sangsoe panel measurement (U116). Paste the whole file into the DevTools console of the sangsoe
// panel's frame and press Enter; it logs one line that starts with SANGSOE_MEASURE.
//
// Before it, for a first read:
//   1. Close the 리소스 fold (the closed state is saved).
//   2. Close the sangsoe panel and open it again, then open DevTools on it.
//   3. Run this. It opens the fold the way a click does and times each part from that click.
// With the fold already open it presses 새로 고침 and times the re-read instead; the parts cannot be
// told apart then, because the last reading stays in place until each new answer comes.
//
// It refuses, with an error field and no times, when the frame has read once already (step 2 skipped)
// or a read is still running. Only PC 부하 and 정리 후보 get a time of their own: the made part draws
// nothing while it is read, so the page cannot see it arrive; `all` covers it.
//
// It is done when 새로 고침 is enabled again and no part shows a reading row, or after 8 s
// (timed_out). The panel's `orca` bridge is frozen, so nothing here wraps a request: every time is
// read from the page, from the click to the paint.
(() => {
  const PARTS = ["PC 부하", "정리 후보"];
  const LIMIT_MS = 8000;
  const res = document.getElementById("res");
  const fold = res?.querySelector("details.res-fold");
  if (!res || !fold) {
    console.log("SANGSOE_MEASURE", JSON.stringify({ error: "no 리소스 section: run this in the sangsoe panel's frame" }));
    return;
  }
  const mode = fold.open ? "refresh" : "first_open";
  const parts = {};
  const paints = [];
  const refresh = () => res.querySelector('[data-res="refresh"]');
  const done = () => {
    const b = refresh();
    return !!b && !b.disabled && !res.querySelector(".pending");
  };
  // A fold closed after a read keeps that reading; opening it again only repaints it, with no request.
  const refused =
    mode === "first_open" && fold.querySelector(".res-body")?.childElementCount
      ? "already_read: this frame has read once; close the panel, open it again and rerun"
      : mode === "refresh" && !done()
        ? "busy: a read is running; rerun once 새로 고침 is enabled"
        : null;
  if (refused) {
    window.sangsoeMeasure = { mode, error: refused };
    console.log("SANGSOE_MEASURE", JSON.stringify(window.sangsoeMeasure));
    return;
  }
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const seen = () => {
    if (mode !== "first_open") return;
    for (const h of res.querySelectorAll(".res-body h3")) {
      const name = PARTS.find((p) => h.textContent.trim().startsWith(p));
      if (name && parts[name] === undefined && !h.nextElementSibling?.matches(".pending")) parts[name] = ms();
    }
  };

  // Spacing is read from ink, not boxes: a line box adds half-leading the eye does not see. A text
  // node's ink comes from its glyphs' canvas metrics on the baseline its line box holds.
  const pen = document.createElement("canvas").getContext("2d");
  const ink = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = [...range.getClientRects()].filter((x) => x.width > 1);
    if (!lines.length) return null;
    const s = getComputedStyle(node.parentElement);
    pen.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const m = pen.measureText(node.textContent.trim());
    const base = lines[0].top + m.fontBoundingBoxAscent;
    return { base, top: base - m.actualBoundingBoxAscent, bottom: lines.at(-1).top + m.fontBoundingBoxAscent + m.actualBoundingBoxDescent };
  };
  /**
   * The highest and lowest text ink inside `box`. Glyphs only: the eye pairs the first line of text
   * with the last (the owner's rc.4 read), so an outlined control such as 6시간/24시간 is left out.
   */
  const drawn = (box) => {
    const b = box.getBoundingClientRect();
    const ys = [];
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const k = n.textContent.trim() ? ink(n) : null;
      if (k) ys.push(k.top, k.bottom);
    }
    // .res-h sits in the body's DOM but on the 리소스 row, above the card.
    const inside = ys.filter((y) => y >= b.top && y <= b.bottom);
    return inside.length ? { top: Math.min(...inside), bottom: Math.max(...inside) } : null;
  };
  const arrowY = (sum, title) => {
    const chev = sum.querySelector(".chev");
    if (chev) {
      const r = chev.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    }
    // 0.1.6-rc.4 and earlier draw it as a ::after glyph on the title's baseline.
    const s = getComputedStyle(sum, "::after");
    pen.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const m = pen.measureText(s.content.replace(/^"|"$/g, ""));
    return title.base - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  };
  const px = (n) => Math.round(n * 10) / 10;
  /**
   * Above: the section's top line to the 리소스 title's ink. Below: the title's ink (closed) or the
   * card's bottom line (open) to the section's end. The card's padding is from its lines to the ink
   * inside, and the arrow's offset is its centre less the title's, positive when it sits lower.
   */
  const spacing = () => {
    const sum = fold.querySelector("summary");
    const t = ink([...sum.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
    const r = res.getBoundingClientRect();
    const card = fold.open ? fold.querySelector(".res-body") : null;
    const c = card?.getBoundingClientRect();
    const cs = card && getComputedStyle(card);
    const e = card && drawn(card);
    return {
      res_space_above: px(t.top - r.top - parseFloat(getComputedStyle(res).borderTopWidth)),
      res_space_below: px(r.bottom - (c ? c.bottom : t.bottom)),
      res_card_pad_top: e ? px(e.top - c.top - parseFloat(cs.borderTopWidth)) : null,
      res_card_pad_bottom: e ? px(c.bottom - parseFloat(cs.borderBottomWidth) - e.bottom) : null,
      res_arrow_off: px(arrowY(sum, t) - (t.top + t.bottom) / 2),
    };
  };
  // A first open starts folded: that is the only time the closed section can be read.
  const folded = mode === "first_open" ? spacing() : undefined;

  const layout = () => {
    const d = document.documentElement;
    const r = res.getBoundingClientRect();
    const bottom = r.bottom + scrollY;
    const sum = fold.querySelector("summary").getBoundingClientRect();
    const stamp = res.querySelector(".res-h")?.getBoundingClientRect();
    const scrollers = [...document.querySelectorAll("*")].filter((e) => {
      const s = getComputedStyle(e);
      return /(auto|scroll)/.test(s.overflowX + s.overflowY) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth);
    });
    const foot = document.querySelector("#root .foot") ?? document.querySelector("#root main > :last-child");
    return {
      width: innerWidth,
      height: innerHeight,
      hscroll: d.scrollWidth - d.clientWidth,
      doc_scrolls: d.scrollHeight > innerHeight,
      doc_over: d.scrollHeight - innerHeight,
      nested_scrollers: scrollers.length,
      res_gap_to_viewport_bottom: Math.round(innerHeight - bottom),
      res_gap_to_page_end: Math.round(d.scrollHeight - bottom),
      stamp_on_heading: !!stamp && stamp.top + stamp.height / 2 > sum.top && stamp.top + stamp.height / 2 < sum.bottom,
      tail: foot?.textContent.trim().slice(0, 80) ?? "",
      ...spacing(),
      folded,
    };
  };

  const finish = (timedOut) => {
    observer.disconnect();
    clearTimeout(timer);
    seen();
    const out = { mode, first_read_ms: { ...parts, all: timedOut ? null : ms() }, paints_ms: paints, timed_out: timedOut, ...layout() };
    const line = `SANGSOE_MEASURE ${JSON.stringify(out)}`;
    console.log(line);
    window.sangsoeMeasure = out;
    if (typeof copy === "function") copy(line);
  };
  const observer = new MutationObserver(() => {
    paints.push(ms());
    seen();
    if (done()) finish(false);
  });
  observer.observe(res, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "open"] });
  const timer = setTimeout(() => finish(true), LIMIT_MS);

  if (mode === "first_open") fold.querySelector("summary").click();
  else refresh()?.click();
})();
