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
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const seen = () => {
    if (mode !== "first_open") return;
    for (const h of res.querySelectorAll(".res-body h3")) {
      const name = PARTS.find((p) => h.textContent.trim().startsWith(p));
      if (name && parts[name] === undefined && !h.nextElementSibling?.matches(".pending")) parts[name] = ms();
    }
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
