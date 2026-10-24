const api = require("../../services/client");
Page({
  data: {
    group: null,
    config: null,
    banks: [],
    busy: false,
    error: "",
    hidden: {},
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
      group.feed = group.feed.map((f) => ({
        ...f,
        time: api.time(f.created_at),
      }));
      this.setData({ group, config, error: "" });
      this.tick();
    } catch (e) {
      this.setData({ error: e.message });
    }
  },
  tick() {
    if (!this.data.group) return;
    const now = Date.now() + (this._offset || 0);
    const banks = this.data.group.banks.map((b) => {
      const left = Math.max(0, Math.ceil((b.nextAt - now) / 1000));
      return {
        ...b,
        saved: this.data.hidden[b.kind] === b.generation + ":" + b.coins,
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
      };
    });
    this.setData({ banks });
  },
  async claim(e) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const r = await api.claim(e.currentTarget.dataset.kind);
      if (r) wx.showToast({ title: "开发金币已入账" });
      await this.load();
    } catch (e) {
      api.toast(e);
    } finally {
      this.setData({ busy: false });
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
  async advance() {
    try {
      await api.request("/api/dev/ready", "POST", {});
      await this.load();
    } catch (e) {
      api.toast(e);
    }
  },
});
