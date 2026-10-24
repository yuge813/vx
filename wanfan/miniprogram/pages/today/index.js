const api = require("../../services/client");
Page({
  data: {
    d: null,
    busy: false,
    error: "",
    servings: [1, 2, 3, 4, 5, 6],
    times: [15, 20, 30, 45, 60],
    servingIndex: 1,
    timeIndex: 2,
    vegetarian: false,
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const d = await api.dashboard();
      this.setData({
        d,
        servingIndex: d.user.prefs.servings - 1,
        timeIndex: this.data.times.indexOf(d.user.prefs.maxMinutes),
        vegetarian: d.user.prefs.vegetarian,
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  serving(e) {
    this.setData({ servingIndex: Number(e.detail.value) });
  },
  time(e) {
    this.setData({ timeIndex: Number(e.detail.value) });
  },
  vegetarian(e) {
    this.setData({ vegetarian: e.detail.value });
  },
  async act(fn) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await fn();
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  save() {
    this.act(() =>
      api.request("/preferences", "PUT", {
        servings: this.data.servingIndex + 1,
        maxMinutes: this.data.times[this.data.timeIndex],
        vegetarian: this.data.vegetarian,
      }),
    );
  },
  rotate() {
    this.act(() => api.request("/recommendations/rotate", "POST", {}));
  },
  recipe(e) {
    wx.navigateTo({
      url: "/pages/recipe/index?id=" + e.currentTarget.dataset.id,
    });
  },
  plan(e) {
    this.act(async () => {
      await api.request("/plans", "POST", {
        recipeId: e.currentTarget.dataset.id,
        servings: this.data.d.user.prefs.servings,
      });
      wx.showToast({ title: "已加入今晚菜单" });
    });
  },
  async complete(e) {
    const answer = await api.modal({
      title: "这顿饭完成了吗？",
      content: "确认后按配方扣减已记录且未过日期的库存，不足部分按0处理。",
    });
    if (answer.confirm)
      this.act(() =>
        api.request(
          "/plans/" + e.currentTarget.dataset.id + "/complete",
          "POST",
          {},
        ),
      );
  },
  remove(e) {
    this.act(() =>
      api.request("/plans/" + e.currentTarget.dataset.id, "DELETE"),
    );
  },
  checkin() {
    this.act(() => api.request("/checkin", "POST", {}));
  },
  pantry() {
    wx.switchTab({ url: "/pages/pantry/index" });
  },
  shopping() {
    wx.switchTab({ url: "/pages/shopping/index" });
  },
});
