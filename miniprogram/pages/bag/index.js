const api = require("../../services/client");
Page({
  data: {
    user: null,
    config: null,
    busy: false,
    error: "",
    remaining: 0,
    timer: "",
  },
  onShow() {
    this.load();
    this._timer = setInterval(() => this.tick(), 1000);
  },
  onHide() {
    clearInterval(this._timer);
  },
  onUnload() {
    clearInterval(this._timer);
  },
  async load() {
    try {
      await getApp().ready();
      const [user, config] = await Promise.all([
        api.request("/api/me"),
        api.request("/api/config"),
      ]);
      this._offset = user.serverTime - Date.now();
      this.setData({
        user,
        config,
        resumable: !!user.pendingTask && user.pendingTask.kind === "bag",
        error: "",
      });
      this.tick();
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  tick() {
    if (!this.data.user) return;
    const remaining = Math.max(
      0,
      Math.ceil(
        (this.data.user.nextBagAt - Date.now() - (this._offset || 0)) / 1000,
      ),
    );
    this.setData({
      remaining,
      timer: remaining
        ? String(Math.floor(remaining / 60)).padStart(2, "0") +
          ":" +
          String(remaining % 60).padStart(2, "0")
        : "福袋已准备好",
    });
  },
  async claim() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await api.claim("bag");
      if (r)
        wx.showModal({
          title: "开发奖励已入账",
          content:
            r.task.total +
            "金币（基础" +
            r.task.base +
            "＋补贴" +
            r.task.subsidy +
            "），不可兑现。",
          showCancel: false,
        });
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async advance() {
    try {
      await api.request("/api/dev/ready", "POST", {});
      await this.load();
    } catch (e) {
      api.toast(e);
    }
  },
});
