const api = require("../../services/client");
const { Pacing } = require("../../services/ad-pacing");
Page({
  data: {
    group: null,
    config: null,
    rows: [],
    busy: false,
    error: "",
    hidden: {},
    adPreview: { enabled: false, current: null },
    scrollTarget: "",
  },
  onShow() {
    this._visible = true;
    clearInterval(this._timer);
    clearInterval(this._poll);
    this.load();
    this._timer = setInterval(() => this.tick(), 1000);
    this._poll = setInterval(() => {
      if (!this.data.busy) this.load();
    }, 5000);
  },
  onHide() {
    this._visible = false;
    this.tick();
    clearInterval(this._timer);
    clearInterval(this._poll);
  },
  onUnload() {
    this._visible = false;
    this.tick();
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
    const key = "yx_ad_preview_" + group.user.id;
    if (!this._pacer || this._pacerAccount !== group.user.id) {
      let saved = {};
      try {
        saved = wx.getStorageSync(key) || {};
      } catch {}
      this._pacer = new Pacing(config.adPacing, saved);
      this._pacerAccount = group.user.id;
    }
    this._pacer.configure(config.adPacing);
    const adPreview = this._pacer.sample(
      Date.now(),
      this._visible !== false && !this.data.busy && !group.user.pendingTask,
      now,
    );
    const signature = JSON.stringify([adPreview.current, adPreview.dayCount]);
    if (signature !== this._adSignature) {
      this._adSignature = signature;
      try {
        wx.setStorageSync(key, this._pacer.snapshot());
      } catch {}
    }
    const messages = [...group.messages];
    if (adPreview.current?.format === "native")
      messages.splice(Math.max(1, messages.length - 1), 0, {
        id: adPreview.current.id,
        type: "ad",
        actor: "广告位预览",
        mark: "告",
        text: "信息流位置预览",
        detail: "未加载广告，不产生曝光或收入。",
      });
    const rows = messages.map((r) => {
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
    this.setData({ rows, adPreview });
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
    if (this._pacer) this._pacer.close(Date.now() + (this._offset || 0));
    this.tick();
  },
  adSchedule() {
    const p = this.data.config.adPacing;
    wx.showModal({
      title: "等待期广告位预览",
      content: `信息流首次${p.native.firstDelay}秒，间隔至少${p.native.interval}秒；横幅首次${p.banner.firstDelay}秒，间隔至少${p.banner.interval}秒。每次位置预览${p.duration}秒，类型错开至少${p.minGap}秒；关闭冷却${p.closeCooldown}秒。\n每会话最多${p.sessionLimit}次，本机本账户每日最多${p.dailyLimit}次。只累计群页面前台空闲时间，离开、切后台或有奖励任务时暂停，不补弹。\n插屏关闭。秒数为开发设计，不是微信许可频次；预览不计广告曝光、收入或奖励，本机次数不作为后端反作弊。`,
      showCancel: false,
    });
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
