const api = require("../../services/client");
Page({
  data: { d: null, error: "", checked: 0, busy: false },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const d = await api.dashboard();
      this.setData({
        d,
        checked: d.shopping.filter((i) => i.checked).length,
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async toggle(e) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const item = this.data.d.shopping.find(
        (i) => i.id === e.currentTarget.dataset.id,
      );
      await api.request("/shopping/" + item.id, "PUT", {
        checked: !item.checked,
      });
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  today() {
    wx.switchTab({ url: "/pages/today/index" });
  },
  pantry() {
    wx.switchTab({ url: "/pages/pantry/index" });
  },
});
