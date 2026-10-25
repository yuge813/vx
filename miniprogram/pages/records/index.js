const api = require("../../services/client");
Page({
  data: { records: [], error: "", cursor: null, busy: false },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const result = await api.request("/api/history?type=ledger");
      const rows = result.items;
      this.setData({
        records: rows.map((row) => ({
          ...row,
          time: api.time(row.created_at),
          delta:
            row.available_delta > 0
              ? "+" + row.available_delta
              : String(row.available_delta),
          isMinus: row.available_delta < 0,
        })),
        cursor: result.nextCursor,
        error: "",
      });
    } catch (error) {
      this.setData({ error: error.message });
      api.toast(error);
    }
  },
  async more() {
    if (!this.data.cursor || this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await api.request(
        "/api/history?type=ledger&cursor=" + this.data.cursor,
      );
      this.setData({
        records: [
          ...this.data.records,
          ...r.items.map((row) => ({
            ...row,
            time: api.time(row.created_at),
            delta:
              row.available_delta > 0
                ? "+" + row.available_delta
                : String(row.available_delta),
            isMinus: row.available_delta < 0,
          })),
        ],
        cursor: r.nextCursor,
      });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
