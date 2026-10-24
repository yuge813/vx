const api = require("../../services/client");
Page({
  data: { j: null, error: "", busy: false, week: null },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const [j, week] = await Promise.all([
        api.request("/journal"),
        api.request("/week"),
      ]);
      this.setData({ j, week, error: "" });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  async checkin() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.request("/checkin", "POST", {});
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  recipe(e) {
    wx.navigateTo({
      url: "/pages/recipe/index?id=" + e.currentTarget.dataset.id,
    });
  },
  async generate() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const week = await api.request("/week/generate", "POST", {});
      this.setData({ week });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async feedback() {
    const answer = await api.modal({
      title: "反馈与建议",
      content: "反馈保存到内部运营后台。请勿提供密码等敏感信息。",
      editable: true,
      placeholderText: "输入2—1000字问题",
    });
    if (answer.confirm)
      try {
        await api.request("/feedback", "POST", {
          message: answer.content || "",
        });
        await this.load();
        wx.showToast({ title: "反馈已保存" });
      } catch (e) {
        api.toast(e);
      }
  },
  privacy() {
    api.modal({
      title: "内部原型数据说明",
      content:
        "记录登录标识、偏好、食材、菜单、签到和反馈。只记录必要的使用事件，不读取通讯录、位置、相册或剪贴板。删除账户可删除相关记录。正式运营主体、数据保留期限和企业客服仍待配置。",
      showCancel: false,
    });
  },
  capabilities() {
    api.modal({
      title: "广告与奖励状态",
      content:
        "真实广告、现金和实物兑换均关闭。周计划助手只提供管理员授予的内部体验，不来自广告且不可兑换。",
      showCancel: false,
    });
  },
  async removeAccount() {
    const answer = await api.modal({
      title: "删除账户与全部记录？",
      content: "将删除食材、菜单、签到、收藏、权益及反馈，无法恢复。",
      confirmText: "确认删除",
      confirmColor: "#aa775a",
    });
    if (answer.confirm)
      try {
        await api.request("/account", "DELETE", { confirm: "DELETE" });
        api.logoutLocal();
        wx.reLaunch({ url: "/pages/today/index" });
      } catch (e) {
        api.toast(e);
      }
  },
});
