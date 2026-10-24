const api = require("../../services/client");
Page({
  data: { records: [], error: "" },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const rows = await api.request("/api/ledger");
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
        error: "",
      });
    } catch (error) {
      this.setData({ error: error.message });
      api.toast(error);
    }
  },
});
