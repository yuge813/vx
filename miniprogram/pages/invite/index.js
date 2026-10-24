const api = require("../../services/client");
Page({
  data: { referral: null, code: "", error: "", busy: false },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const referral = await api.request("/api/referral");
      this.setData({ referral, error: "" });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  input(e) {
    this.setData({ code: e.detail.value.toUpperCase() });
  },
  async bind() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.request("/api/referral/bind", "POST", { code: this.data.code });
      await this.load();
      wx.showToast({ title: "邀请关系已绑定" });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  onShareAppMessage() {
    return {
      title: "一起体验签到、红包群与福袋（开发版）",
      path:
        "/pages/home/index?invite=" +
        (this.data.referral ? this.data.referral.code : ""),
    };
  },
});
