import test from "node:test";
import assert from "node:assert/strict";
import pacing from "../shared/ad-pacing.cjs";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
const { Pacing } = pacing;
const policy = {
  mode: "preview_only",
  version: 1,
  native: { firstDelay: 15, interval: 90 },
  banner: { firstDelay: 45, interval: 120 },
  duration: 20,
  closeCooldown: 120,
  minGap: 30,
  sessionLimit: 6,
  dailyLimit: 20,
};
const origin = Date.parse("2026-10-25T02:00:00Z");
function fixture(saved = {}) {
  const p = new Pacing(policy, saved);
  let now = origin;
  p.sample(now, true);
  return {
    p,
    tick(seconds, active = true) {
      let view;
      for (let i = 0; i < seconds; i++) {
        now += 1000;
        view = p.sample(now, active);
      }
      return view;
    },
    now: () => now,
  };
}
test("信息流15秒首次展示，横幅45秒错开，不把预览当广告收益", () => {
  const { p, tick } = fixture();
  assert.equal(tick(14).current, null);
  assert.equal(tick(1).current.format, "native");
  assert.equal(tick(20).current, null);
  assert.equal(tick(10).current.format, "banner");
  assert.equal(p.dayCount, 2);
  assert.deepEqual(Object.keys(p.snapshot()).sort(), [
    "blockUntil",
    "day",
    "dayCount",
  ]);
});
test("关闭后立即消失，跨类型冷却两分钟且不妨碍后续调度", () => {
  const { p, tick, now } = fixture();
  tick(15);
  p.close(now());
  assert.equal(p.view().current, null);
  assert.equal(tick(119).current, null);
  assert.ok(tick(1).current);
  assert.equal(p.dayCount, 2);
});
test("切后台和奖励流程暂停计时，回来不把后台时间补算成展示", () => {
  const { p, tick } = fixture();
  tick(10);
  tick(600, false);
  assert.equal(p.elapsed, 10000);
  assert.equal(tick(1).current, null);
  assert.equal(tick(4).current, null);
  assert.equal(tick(1).current.format, "native");
  p.sample(origin + 10000000, false);
  assert.equal(p.view(false).current, null);
});
test("进程冻结、时钟前跳不产生追赶循环，一次最多展示一个位置", () => {
  const { p } = fixture();
  const view = p.sample(origin + 86400000, true);
  assert.equal(view.current, null);
  assert.equal(p.elapsed, 1500);
  assert.equal(p.sessionCount, 0);
});
test("本机本账户日计数与关闭冷却可恢复，次日重置计数", () => {
  const { p, tick, now } = fixture();
  tick(15);
  p.close(now());
  const restored = new Pacing(policy, p.snapshot());
  restored.sample(now(), true);
  assert.equal(restored.dayCount, 1);
  assert.equal(restored.sample(now() + 1000, true).current, null);
  restored.sample(origin + 86400000, false);
  assert.equal(restored.dayCount, 0);
});
test("每会话与每日上限阻止新增预览，不截断已经出现的位置", () => {
  const { p, tick } = fixture();
  p.configure({ ...policy, version: 2, sessionLimit: 1 });
  assert.equal(tick(15).current.format, "native");
  assert.equal(p.view().capped, true);
  assert.equal(tick(20).current, null);
  assert.equal(tick(300).current, null);
  const capped = new Pacing(
    { ...policy, dailyLimit: 2 },
    { day: "2026-10-25", dayCount: 2 },
  );
  capped.sample(origin, true);
  capped.sample(origin + 1000, true);
  assert.equal(capped.view().capped, true);
  assert.equal(capped.view().current, null);
});
test("关闭总开关和正式模式均不会生成广告位；配置更新不重置日计数", () => {
  const { p, tick } = fixture();
  tick(15);
  p.configure({ ...policy, version: 2, mode: "disabled" });
  assert.equal(tick(100).current, null);
  assert.equal(p.dayCount, 1);
  p.configure({ ...policy, version: 3 });
  assert.equal(tick(16).current.format, "native");
  assert.equal(p.dayCount, 2);
});
test("后台预览参数持久化与审计，不改变真实广告权限或金币账务", (t) => {
  const store = new YuanxiangStore();
  t.after(() => store.close());
  const user = store.login("ad_preview_admin_fixture").user.id;
  const before = store.ledger(user);
  store.updateSettings({ nativePreviewDelaySeconds: 20, adPreviewEnabled: 0 });
  assert.equal(store.publicConfig().adPacing.native.firstDelay, 20);
  assert.equal(store.publicConfig().adPacing.mode, "disabled");
  assert.equal(store.publicConfig().adSlots.native, "disabled");
  assert.deepEqual(store.ledger(user), before);
  assert.equal(store.adminOverview().audit[0].action, "settings.update");
  assert.throws(() =>
    store.updateSettings({ nativePreviewIntervalSeconds: 10 }),
  );
  const prod = new YuanxiangStore({
    development: false,
    adProvider: "disabled",
  });
  t.after(() => prod.close());
  prod.updateSettings({ adPreviewEnabled: 1 });
  assert.equal(prod.publicConfig().adPacing.mode, "disabled");
  assert.equal(prod.publicConfig().adPacing.interstitial.enabled, false);
});

test("旧版服务缺少调度配置或本机存储损坏时默认关闭，不影响页面", () => {
  for (const saved of [null, "broken", []]) {
    const p = new Pacing(undefined, saved);
    const view = p.sample(origin, true);
    assert.equal(view.enabled, false);
    assert.equal(view.current, null);
  }
});
