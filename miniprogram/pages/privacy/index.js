const api = require("../../services/client");
Page({
  data: {
    user: null,
    name: "",
    reason: "",
    agreed: false,
    busy: false,
    error: "",
    loggedOut: false,
    exportText: "",
  },
  onLoad(options) {
    this.setData({ loggedOut: options.loggedOut === "1" });
  },
  onShow() {
    if (!this.data.loggedOut) this.load();
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
        closureLabel:
          { pending: "待审核", approved: "已注销", rejected: "已退回" }[
            user.closureRequest?.state
          ] || "",
        name: user.name,
        error: "",
        loggedOut: false,
      });
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  nameInput(e) {
    this.setData({ name: e.detail.value });
  },
  reasonInput(e) {
    this.setData({ reason: e.detail.value });
  },
  agree(e) {
    this.setData({ agreed: e.detail.value.length > 0 });
  },
  async rename() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await api.request("/api/profile", "PUT", { name: this.data.name });
      await this.load();
      wx.showToast({ title: "昵称已更新" });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async exportData() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const data = await api.request("/api/account/export"),
        text = JSON.stringify(data, null, 2);
      this.setData({ exportText: text });
      if (
        typeof wx.shareFileMessage === "function" &&
        typeof wx.getFileSystemManager === "function"
      ) {
        const filePath =
          wx.env.USER_DATA_PATH + "/account-export-" + Date.now() + ".json";
        await new Promise((resolve, reject) =>
          wx.getFileSystemManager().writeFile({
            filePath,
            data: text,
            encoding: "utf8",
            success: resolve,
            fail: reject,
          }),
        );
        await new Promise((resolve, reject) =>
          wx.shareFileMessage({
            filePath,
            fileName: "我的最近账户记录.json",
            success: resolve,
            fail: reject,
          }),
        );
      } else
        wx.showModal({
          title: "导出记录已生成",
          content:
            "当前环境不支持分享文件，可点击下方按钮复制JSON记录。请仅保存到你信任的位置。",
          showCancel: false,
        });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  copyExport() {
    if (this.data.exportText)
      wx.setClipboardData({ data: this.data.exportText });
  },
  async closure() {
    if (this.data.busy || !this.data.agreed) return;
    const answer = await api.modal({
      title: "确认申请注销？",
      content:
        "必须先处理余额、冻结及未完成任务。确认放弃未领取的开发奖励；审核后移除登录关联和非账务文本，必要账务及审计保留。",
      confirmText: "提交申请",
    });
    if (!answer.confirm) return;
    this.setData({ busy: true });
    try {
      await api.request("/api/account/closure", "POST", {
        reason: this.data.reason,
        discardUnclaimed: true,
      });
      await this.load();
      wx.showToast({ title: "注销申请已提交" });
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
    }
  },
  async logout() {
    try {
      const r = await api.modal({
        title: "退出所有会话？",
        content: "会撤销当前账户所有已有登录会话，账户金币和记录保留。",
        confirmText: "退出会话",
      });
      if (!r.confirm) return;
      await api.logout(true);
      this.setData({ loggedOut: true, user: null, exportText: "" });
    } catch (e) {
      api.toast(e);
    }
  },
  login() {
    this.load();
  },
});
