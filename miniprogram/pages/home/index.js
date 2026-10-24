const api = require("../../services/client");
Page({
  data: {
    user: null,
    config: null,
    group: null,
    ledger: [],
    busy: false,
    error: "",
  },
  onLoad(options) {
    if (options.invite) getApp().pendingInvite = options.invite;
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const [user, config, group, ledger] = await Promise.all([
        api.request("/api/me"),
        api.request("/api/config"),
        api.request("/api/group"),
        api.request("/api/ledger"),
      ]);
      this.setData({
        user: group.user,
        canSignin:
          config.adProvider === "demo" &&
          !group.user.signedToday &&
          (group.user.pendingTask
            ? group.user.pendingTask.kind === "signin"
            : group.user.status === "active" &&
              group.user.remaining.signin > 0),
        config,
        group,
        ledger: ledger.slice(0, 4).map((l) => ({
          ...l,
          time: api.time(l.created_at),
          delta:
            l.available_delta > 0
              ? "+" + l.available_delta
              : String(l.available_delta),
        })),
        money: api.money(user.balance),
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async claim(e) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const result = await api.claim(e.currentTarget.dataset.kind || "signin");
      if (result) wx.showToast({ title: "开发金币已入账" });
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  group() {
    wx.switchTab({ url: "/pages/group/index" });
  },
  bag() {
    wx.switchTab({ url: "/pages/bag/index" });
  },
  wallet() {
    wx.navigateTo({ url: "/pages/wallet/index" });
  },
  invite() {
    wx.switchTab({ url: "/pages/invite/index" });
  },
  records() {
    wx.navigateTo({ url: "/pages/records/index" });
  },
});
