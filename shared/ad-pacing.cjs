/* 仅调度开发广告位预览；不加载广告、不报告曝光、不发奖。
 * 同一实现供浏览器及小程序使用，日上限保存在本机，不能作为业务风控或平台观看凭据。 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AdPreviewPacing = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  const formats = ["native", "banner"];
  const number = (value, fallback = 0) =>
    Number.isFinite(value) && value >= 0 ? value : fallback;
  const dayOf = (now) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  class Pacing {
    constructor(policy, saved = {}) {
      if (!saved || typeof saved !== "object" || Array.isArray(saved))
        saved = {};
      this.elapsed = 0;
      this.lastSample = null;
      this.wasActive = false;
      this.current = null;
      this.sessionCount = 0;
      this.serial = 0;
      this.day = /^\d{4}-\d{2}-\d{2}$/.test(saved.day) ? saved.day : "";
      this.dayCount = Math.min(100, Math.floor(number(saved.dayCount)));
      this.blockUntil = number(saved.blockUntil);
      this.next = {};
      this.configure(policy);
    }
    configure(policy) {
      if (
        this.policy &&
        this.policy.version === policy?.version &&
        this.policy.mode === policy?.mode
      )
        return;
      this.policy = policy || { mode: "disabled" };
      this.current = null;
      for (const format of formats)
        this.next[format] =
          this.elapsed + number(this.policy[format]?.firstDelay, 15) * 1000;
    }
    sample(now, active, wallNow = now) {
      if (!Number.isFinite(now) || !Number.isFinite(wallNow))
        return this.view(false);
      const day = dayOf(wallNow);
      if (day > this.day) {
        this.day = day;
        this.dayCount = 0;
      }
      active = Boolean(active && this.policy.mode === "preview_only");
      // 最多接受一个正常心跳间隔；后台、阻塞和时钟跳变都不会补发错过的广告位。
      if (active && this.wasActive && this.lastSample !== null)
        this.elapsed += Math.max(0, Math.min(1500, now - this.lastSample));
      this.lastSample = now;
      this.wasActive = active;
      if (!active) return this.view(false);
      if (this.current && this.elapsed >= this.current.until)
        this.current = null;
      if (
        !this.current &&
        wallNow >= this.blockUntil &&
        this.sessionCount < this.policy.sessionLimit &&
        this.dayCount < this.policy.dailyLimit
      ) {
        const ready = formats
          .filter((format) => this.elapsed >= this.next[format])
          .sort((a, b) => this.next[a] - this.next[b]);
        if (ready.length) {
          const format = ready[0];
          this.current = {
            id: "preview-" + ++this.serial,
            format,
            until: this.elapsed + number(this.policy.duration, 20) * 1000,
          };
          this.sessionCount++;
          this.dayCount++;
          this.blockUntil = wallNow + number(this.policy.minGap, 30) * 1000;
          this.next[format] =
            this.elapsed + number(this.policy[format]?.interval, 90) * 1000;
        }
      }
      return this.view(true);
    }
    close(wallNow) {
      if (!this.current || !Number.isFinite(wallNow)) return;
      this.current = null;
      this.blockUntil = Math.max(
        this.blockUntil,
        wallNow + number(this.policy.closeCooldown, 120) * 1000,
      );
      // 本轮未出现的位置重新排队，关闭后不堆积过期计划。
      for (const format of formats)
        this.next[format] = Math.max(
          this.next[format],
          this.elapsed + number(this.policy[format]?.firstDelay, 15) * 1000,
        );
    }
    view(active = this.wasActive) {
      const enabled = this.policy.mode === "preview_only";
      const capped =
        this.sessionCount >= this.policy.sessionLimit ||
        this.dayCount >= this.policy.dailyLimit;
      return {
        enabled,
        current: active ? this.current : null,
        sessionCount: this.sessionCount,
        dayCount: this.dayCount,
        capped,
        elapsedSeconds: Math.floor(this.elapsed / 1000),
      };
    }
    snapshot() {
      return {
        day: this.day,
        dayCount: this.dayCount,
        blockUntil: this.blockUntil,
      };
    }
  }
  return { Pacing };
});
