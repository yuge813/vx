const api = require("../../services/client");
Page({
  data: { user: null, config: null, error: "" },
  onShow() {
    this.load();
  },
  async load() {
    try {
      await getApp().ready();
      const [user, config] = await Promise.all([
        api.request("/api/me"),
        api.request("/api/config"),
      ]);
      this.setData({
        user,
        config,
        shortId: user.id.slice(0, 8),
        money: api.money(user.balance),
        error: "",
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  wallet() {
    wx.navigateTo({ url: "/pages/wallet/index" });
  },
  records() {
    wx.navigateTo({ url: "/pages/records/index" });
  },
  invite() {
    wx.switchTab({ url: "/pages/invite/index" });
  },
  support() {
    wx.navigateTo({ url: "/pages/support/index" });
  },
  async resume() {
    try {
      await api.claim(
        this.data.user.pendingTask ? this.data.user.pendingTask.kind : "signin",
      );
      await this.load();
    } catch (e) {
      api.toast(e);
    }
  },
  rules() {
    wx.showModal({
      title: "开发版玩法规则",
      content:
        "签到完成激励任务后每日一次；红包与宝箱分别每120秒叠加，默认390、上限8888；可暂存，取消任务保留金额；福袋60秒冷却、概率公开，补贴单独入账。以上是开发规则，未核实元享真实算法。",
      showCancel: false,
    });
  },
  capabilities() {
    wx.showModal({
      title: "实际能力状态",
      content:
        "真实激励、横幅、插屏和原生广告未接入；模拟观看不产生收入。手机权重及单次收益API未核实。真实微信零钱转账和现金邀请返佣关闭。",
      showCancel: false,
    });
  },
  privacy() {
    wx.showModal({
      title: "数据说明",
      content:
        "后端保存账户、任务、流水、演示申请、邀请关系和反馈；本机保存广告位预览次数和关闭冷却，不上报为广告曝光或收入。不读取通讯录、位置、相册或剪贴板。正式运营仍需完善企业隐私声明、保留期限、注销及客服流程。",
      showCancel: false,
    });
  },
});
