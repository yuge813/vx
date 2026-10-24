export const $ = (selector) => document.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  video: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-2 5 6 4-6 4V8Z",
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3V10Z",
  packet: "M4 4h16v17H4V4Zm0 2 8 7 8-7m-12 9h8",
  chest: "M3 10V7a9 5 0 0 1 18 0v3M3 10h18v11H3V10Zm7 0v7h4v-7",
  bag: "m8 8-2-5 6 2 6-2-2 5m-8 0h8c1 5 5 6 5 10 0 4-18 4-18 0 0-4 4-5 5-10Zm4 4v6m-3-4h6",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9v-2a8 5 0 0 1 16 0v2",
  wallet: "M4 6h15v15H4V6Zm0 0 12-3v3m-3 6h8v5h-8v-5Z",
  check: "m5 12 4 4L19 6",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2",
  gift: "M3 9h18v4H3V9Zm2 4v9h14v-9M12 9v13m0-13C3 10 4 1 8 3l4 6Zm0 0c9 1 8-8 4-6l-4 6Z",
  invite:
    "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 10v-3a6 5 0 0 1 12 0v3m4-11v8m-4-4h8",
  records: "M5 3h14v18H5V3Zm4 5h6m-6 4h6m-6 4h4",
  support: "M4 4h16v13H9l-5 4V4Zm4 4h8m-8 4h6",
  lock: "M6 11h12v10H6V11Zm3 0V7a3 3 0 0 1 6 0v4",
  refresh: "M19 8a8 8 0 1 0 1 8M19 3v5h-5",
  close: "m6 6 12 12M18 6 6 18",
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.packet}"/></svg>`;
export const date = (ms) =>
  new Date(ms).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
export const shortTime = (ms) =>
  new Date(ms).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
export function toast(text) {
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 4000);
}
