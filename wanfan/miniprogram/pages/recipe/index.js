const api = require("../../services/client");
Page({
  data: { r: null, error: "", busy: false },
  onLoad(options) {
    this.recipeId = options.id;
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const r = await api.request("/recipes/" + this.recipeId);
      this.setData({ r, error: "" });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async plan() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.request("/plans", "POST", {
        recipeId: this.recipeId,
        servings: this.data.r.servings,
      });
      wx.showToast({ title: "已加入今晚菜单" });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async favorite() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.request("/recipes/" + this.recipeId + "/favorite", "PUT", {
        favorite: !this.data.r.favorite,
      });
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
});
