const api = require("../../services/client");
Page({
  data: {
    d: null,
    error: "",
    ingredientIndex: 0,
    amount: "2",
    expires: "",
    busy: false,
    names: [],
  },
  onShow() {
    this.load();
  },
  async load() {
    try {
      const d = await api.dashboard();
      this.setData({
        d,
        names: d.config.ingredients.map((i) => i.name + "（" + i.unit + "）"),
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  ingredient(e) {
    const i = Number(e.detail.value),
      item = this.data.d.config.ingredients[i];
    this.setData({
      ingredientIndex: i,
      amount: ["g", "ml"].includes(item.unit) ? "100" : "1",
    });
  },
  amount(e) {
    this.setData({ amount: e.detail.value });
  },
  date(e) {
    this.setData({ expires: e.detail.value });
  },
  clearDate() {
    this.setData({ expires: "" });
  },
  edit(e) {
    const p = this.data.d.pantry.find(
      (i) => i.id === e.currentTarget.dataset.id,
    );
    this.setData({
      ingredientIndex: this.data.d.config.ingredients.findIndex(
        (i) => i.id === p.id,
      ),
      amount: String(p.amount),
      expires: p.expires || "",
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.request("/pantry", "PUT", {
        ingredientId:
          this.data.d.config.ingredients[this.data.ingredientIndex].id,
        amount: Number(this.data.amount),
        expires: this.data.expires || null,
      });
      await this.load();
      wx.showToast({ title: "食材已保存" });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async remove(e) {
    try {
      await api.request("/pantry/" + e.currentTarget.dataset.id, "DELETE");
      await this.load();
    } catch (e) {
      api.toast(e);
    }
  },
});
