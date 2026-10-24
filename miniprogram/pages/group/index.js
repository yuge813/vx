const api = require("../../services/client");
Page({
  data: {
    group: null,
    config: null,
    rows: [],
    busy: false,
    error: "",
    hidden: {},
    adHidden: false,
    scrollTarget: "",
  },
  onShow() {
    this.load();
    this._timer = setInterval(() => this.tick(), 1000);
    this._poll = setInterval(() => {
      if (!this.data.busy) this.load();
    }, 5000);
  },
  onHide() {
    clearInterval(this._timer);
    clearInterval(this._poll);
  },
  onUnload() {
    clearInterval(this._timer);
    clearInterval(this._poll);
  },
  async load() {
    try {
      await getApp().ready();
      const [group, config] = await Promise.all([
        api.request("/api/group"),
        api.request("/api/config"),
      ]);
      this._offset = group.serverTime - Date.now();
      const signature = group.messages
        .map((r) => r.id + ":" + (r.bank?.coins || 0))
        .join(",");
      const changed = signature !== this._signature;
      this._signature = signature;
      this.setData({ group, config, error: "" });
      this.tick();
      if (changed && this._follow !== false) {
        this.setData({ scrollTarget: "" });
        wx.nextTick(() => this.setData({ scrollTarget: "room-end" }));
      }
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  tick() {
    if (!this.data.group) return;
    const now = Date.now() + (this._offset || 0),
      { group, config } = this.data;
    const rows = group.messages
      .filter((r) => r.type !== "ad" || !this.data.adHidden)
      .map((r) => {
        const row = {
          ...r,
          time: r.createdAt ? api.time(r.createdAt) : "系统",
        };
        if (r.type !== "packet") return row;
        const b = r.bank,
          left = Math.max(0, Math.ceil((b.nextAt - now) / 1000));
        row.bank = {
          ...b,
          saved: this.data.hidden[b.kind] === b.generation + ":" + b.coins,
          ready: b.coins > 0,
          disabled:
            this.data.busy ||
            config.adProvider !== "demo" ||
            (group.user.pendingTask
              ? group.user.pendingTask.kind !== b.kind
              : !b.coins ||
                group.user.status !== "active" ||
                !group.remaining[b.kind]),
          timer: b.atCap
            ? "已到上限"
            : b.locked
              ? "金额已锁定"
              : b.paused
                ? "累计暂停"
                : String(Math.floor(left / 60)).padStart(2, "0") +
                  ":" +
                  String(left % 60).padStart(2, "0"),
          progress: b.atCap
            ? 100
            : Math.min(100, Math.max(0, 100 - (left / b.interval) * 100)),
          art: b.kind === "redpacket" ? "packet" : "chest",
          greeting: b.coins
            ? b.kind === "redpacket"
              ? "恭喜发财，大吉大利"
              : "宝箱已准备，惊喜等你开"
            : b.kind === "redpacket"
              ? "下一份红包正在准备"
              : "下一份宝箱正在准备",
          action: b.locked
            ? "继续上次领取任务"
            : b.coins
              ? b.kind === "redpacket"
                ? "点击领取红包"
                : "点击开启宝箱"
              : "倒计时结束后生成待领金额",
          hint: b.atCap
            ? "已达本轮上限，可选择打开"
            : b.paused
              ? "新增累计暂停，已叠金币保留"
              : "每轮＋" + b.increment + " · 本轮上限" + b.cap,
        };
        return row;
      });
    this.setData({ rows });
  },
  onScroll(e) {
    const query = this.createSelectorQuery();
    query
      .select(".room-scroll")
      .boundingClientRect((rect) => {
        if (rect)
          this._follow =
            e.detail.scrollHeight - e.detail.scrollTop - rect.height < 60;
      })
      .exec();
  },
  async claim(e) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    this.tick();
    try {
      const r = await api.claim(e.currentTarget.dataset.kind);
      if (r) wx.showToast({ title: "开发金币已入账" });
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
      this.tick();
    }
  },
  async skip(e) {
    try {
      const kind = e.currentTarget.dataset.kind,
        b = this.data.group.banks.find((b) => b.kind === kind);
      await api.request("/api/group/skip", "POST", { kind });
      this.setData({
        hidden: { ...this.data.hidden, [kind]: b.generation + ":" + b.coins },
      });
      await this.load();
    } catch (e) {
      api.toast(e);
    }
  },
  restore(e) {
    const hidden = { ...this.data.hidden };
    delete hidden[e.currentTarget.dataset.kind];
    this.setData({ hidden });
    this.tick();
  },
  hideAd() {
    this.setData({ adHidden: true });
    this.tick();
  },
  wallet() {
    wx.navigateTo({ url: "/pages/wallet/index" });
  },
  bag() {
    wx.switchTab({ url: "/pages/bag/index" });
  },
  rules() {
    const banks = this.data.group ? this.data.group.banks : [];
    const summary = banks
      .map(
        (b) =>
          `${b.title}：每${b.interval}秒增加${b.increment}金币，本轮上限${b.cap}。`,
      )
      .join("\n");
    wx.showModal({
      title: "红包与宝箱规则",
      content:
        summary +
        "\n关闭只暂存，取消或中断保留累计金额；完成后按任务确认金额入账，重新开始下一轮。开发模拟金币不可兑现。",
      showCancel: false,
    });
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
