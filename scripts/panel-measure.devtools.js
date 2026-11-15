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
//
// With the fold open it also reads the drawer (decision 262): drawer_top and drawer_bottom, the board's
// scrollTop and height before and after, drawer_max_height against viewport_height, and drawer_pass,
// true when the board did not move or grow and the drawer lies inside the viewport.
//
// card_second_line_max and card_second_line_pass: the most lines any card's status text takes (rule: 1).
//
// It also reads the section's spacing from the glyphs' ink (decision 253), each pair even within 2px:
// res_space_above and res_space_below, res_card_pad_top and res_card_pad_bottom, and res_arrow_off
// (the arrow's centre less the title's). They describe the open section; the closed one is read only
// on a first read, before the click, and is the `folded` object.
//
// emoji_gap (decision 259) is the gap after an emoji at each place the panel draws one (sumline, foot,
// fold_title, group_head, state_cell; null where this width does not draw it), and emoji_gap_spread
// the largest less the smallest. It is done when the spread is 1px or less.
//
// And the cost of the section's last read on the panel's 30-second tick (decision 257), as the panel
// itself timed it: periodic_read_ms from the tick to its paint, periodic_parts what it asked
// (load+made, or all three when 정리 후보 was due), periodic_paint the pieces it rewrote (none when the
// answer was unchanged). Pass: periodic_read_ms under 7500 (a quarter of the tick) and, on a machine
// whose load did not move, periodic_paint none or stamp. With the section not yet open and shown for
// a tick, periodic_read_ms is null.
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
  const last = res.dataset;
  const periodic =
    last.tickMs === undefined
      ? { periodic_read_ms: null, periodic_note: "no tick read yet: keep the section open and the panel shown for 30 s, then rerun" }
      : { periodic_read_ms: Number(last.tickMs), periodic_parts: last.tickParts, periodic_paint: last.tickPaint };
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
    // The path's own box is its ink, turned with the svg when the fold is open.
    const chev = sum.querySelector(".chev path") ?? sum.querySelector(".chev");
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
    const title = [...sum.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    const t = title && ink(title);
    // A spacing that cannot be read must not cost the times this script also logs.
    if (!t) return { spacing_error: "no 리소스 title text to read" };
    // Open, the section is the sheet (decision 262), which ends at the panel's bottom edge: nothing under it.
    const r = (fold.open ? fold : res).getBoundingClientRect();
    const card = fold.open ? fold.querySelector(".res-body") : null;
    const c = card?.getBoundingClientRect();
    const cs = card && getComputedStyle(card);
    const e = card && drawn(card);
    return {
      res_space_above: px(t.top - r.top - parseFloat(getComputedStyle(fold.open ? fold : res).borderTopWidth)),
      res_space_below: px(r.bottom - (c ? c.bottom : t.bottom)),
      res_card_pad_top: e ? px(e.top - c.top - parseFloat(cs.borderTopWidth)) : null,
      res_card_pad_bottom: e ? px(c.bottom - parseFloat(cs.borderBottomWidth) - e.bottom) : null,
      res_arrow_off: px(arrowY(sum, t) - (t.top + t.bottom) / 2),
    };
  };
  // A first open starts folded: that is the only time the closed section can be read. Read before
  // t0, so its layout work is in no time.
  const folded = mode === "first_open" ? spacing() : undefined;
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const seen = () => {
    if (mode !== "first_open") return;
    for (const h of res.querySelectorAll(".res-body h3")) {
      const name = PARTS.find((p) => h.textContent.trim().startsWith(p));
      if (name && parts[name] === undefined && !h.nextElementSibling?.matches(".pending")) parts[name] = ms();
    }
  };

  // Decision 262: the open section is a sheet over the board, so opening it moves nothing under it.
  // drawer_pass: the board's scrollTop is where it was, the page is no taller, and the sheet lies in the
  // viewport with its body's max-height below the viewport's. Read before t0 when the fold opens now.
  const board = document.scrollingElement ?? document.documentElement;
  const scrollBefore = board.scrollTop;
  const heightBefore = board.scrollHeight;
  const drawer = () => {
    if (!fold.open) return { drawer_open: false };
    const s = fold.getBoundingClientRect();
    const maxHeight = parseFloat(getComputedStyle(fold.querySelector(".res-body")).maxHeight);
    const out = {
      drawer_open: true,
      drawer_top: Math.round(s.top),
      drawer_bottom: Math.round(s.bottom),
      board_scroll_before: Math.round(scrollBefore),
      board_scroll_after: Math.round(board.scrollTop),
      board_height_before: heightBefore,
      board_height_after: board.scrollHeight,
      drawer_max_height: Number.isNaN(maxHeight) ? null : Math.round(maxHeight),
      viewport_height: innerHeight,
    };
    const pass = out.board_scroll_before === out.board_scroll_after && out.board_height_before === out.board_height_after && s.top >= 0 && s.bottom <= innerHeight && out.drawer_max_height !== null && out.drawer_max_height < innerHeight;
    return { ...out, drawer_pass: pass };
  };

  // Owner UI 10 (decision 262): a card's status text is one line. Counted only for rows drawn as cards
  // (a flex row), by the text cell's height over its line height.
  const cardLines = () => {
    const lines = [...document.querySelectorAll("#root tr[data-id]")]
      .filter((tr) => getComputedStyle(tr).display === "flex")
      .flatMap((tr) => [...tr.querySelectorAll("td.mid")])
      .filter((td) => getComputedStyle(td).display !== "none")
      .map((td) => Math.round(td.getBoundingClientRect().height / (parseFloat(getComputedStyle(td).lineHeight) || 16)));
    const max = Math.max(1, ...lines);
    return { card_second_line_max: max, card_second_line_pass: max === 1 };
  };

  /**
   * The gap after an emoji (decision 259), per place, in px: from the emoji's right edge to the left
   * edge of what is drawn next (a badge's border, a label's first glyph). Each place is null when the
   * panel does not draw it at this width (a narrow card hides the state mark, a wide row has no head).
   * They are drawn by one rule, so they differ by at most 1px.
   */
  const emojiGaps = () => {
    const shown = (e) => !!e && getComputedStyle(e).display !== "none" && getComputedStyle(e).position !== "absolute" && e.getClientRects().length > 0;
    const left = (n) => {
      if (n?.nodeType === Node.TEXT_NODE) {
        const i = n.textContent.search(/\S/);
        if (i < 0) return null;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        return r.getClientRects()[0]?.left ?? null;
      }
      return n?.nodeType === Node.ELEMENT_NODE && shown(n) ? n.getBoundingClientRect().left : null;
    };
    const after = (em) => {
      const l = em && shown(em) ? left(em.nextSibling) : null;
      return l === null ? null : px(l - em.getBoundingClientRect().right);
    };
    const mark = [...document.querySelectorAll("tbody .mk")].find(shown);
    const head = mark?.closest("tr.lead");
    const title = head?.querySelector("td.title");
    const next = mark?.nextElementSibling;
    const out = {
      sumline: after(document.querySelector(".sumline .em")),
      foot: after(document.querySelector(".foot .em")),
      fold_title: after(document.querySelector("details.fold:not(.res-fold) > summary .em")),
      // A narrow head's mark ends its cell: its label is the next cell's first glyph.
      group_head: head && title && shown(title) && !shown(next) ? px(title.getBoundingClientRect().left + parseFloat(getComputedStyle(title).paddingLeft) - mark.getBoundingClientRect().right) : null,
      state_cell: shown(next) ? px(next.getBoundingClientRect().left - mark.getBoundingClientRect().right) : null,
    };
    const seen = Object.values(out).filter((v) => v !== null);
    return { emoji_gap: out, emoji_gap_spread: seen.length ? px(Math.max(...seen) - Math.min(...seen)) : null };
  };

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
      ...drawer(),
      ...cardLines(),
      ...emojiGaps(),
      folded,
    };
  };

  const finish = (timedOut) => {
    observer.disconnect();
    clearTimeout(timer);
    seen();
    const out = { mode, first_read_ms: { ...parts, all: timedOut ? null : ms() }, paints_ms: paints, timed_out: timedOut, ...periodic, ...layout() };
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
