const api = require("../../services/client");
Page({
  data: { message: "", tickets: [], error: "", busy: false },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const tickets = await api.request("/api/support");
      this.setData({
        tickets: tickets.map((t) => ({ ...t, time: api.time(t.created_at) })),
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  input(e) {
    this.setData({ message: e.detail.value });
  },
  async submit() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.request("/api/support", "POST", { message: this.data.message });
      this.setData({ message: "" });
      await this.load();
      wx.showToast({ title: "反馈已保存" });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
