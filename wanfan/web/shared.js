export const $ = (s) => document.querySelector(s);
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  bowl: "M3 11h18c-1 7-5 10-9 10S4 18 3 11Zm4-4 1-3m4 3 1-4m4 4 1-3",
  fridge: "M6 2h12v20H6V2Zm0 8h12M9 5v2m0 6v3",
  bag: "M5 7h14l2 14H3L5 7Zm3 0V5a4 4 0 0 1 8 0v2",
  journal: "M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
  people:
    "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 0a3 3 0 1 0 0-6m-7 15v-3a5 5 0 0 0-10 0v3m15 0v-3a5 5 0 0 0-4-4",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  plus: "M12 5v14M5 12h14",
  leaf: "M19 4C6 1 1 12 8 17c7 5 15-4 11-13ZM7 19 16 8",
  heart: "M12 20 4 12a5 5 0 1 1 8-6 5 5 0 1 1 8 6l-8 8Z",
  refresh: "M19 8a8 8 0 1 0 1 8M19 3v5h-5",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  close: "m6 6 12 12M18 6 6 18",
  chevron: "m9 5 7 7-7 7",
  calendar: "M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4",
  spark: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7",
  note: "M4 4h16v13H9l-5 4V4Zm4 4h8m-8 4h6",
};
export const icon = (name, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}><path d="${paths[name] || paths.leaf}"/></svg>`;
export const stamp = (ms) =>
  new Date(ms).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
export function notify(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    t.hidden = true;
  }, 4000);
}
