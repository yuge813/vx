import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
function fixture() {
  const module = { exports: {} },
    callbacks = {},
    calls = { load: 0, show: 0, destroy: 0 };
  const ad = {
    load: async () => {
      calls.load++;
    },
    show: async () => {
      calls.show++;
    },
    destroy: () => calls.destroy++,
    onClose: (f) => (callbacks.close = f),
    offClose: (f) => {
      if (callbacks.close === f) delete callbacks.close;
    },
    onError: (f) => (callbacks.error = f),
    offError: (f) => {
      if (callbacks.error === f) delete callbacks.error;
    },
  };
  vm.runInNewContext(
    readFileSync("miniprogram/services/rewarded-video.js", "utf8"),
    { module, setTimeout, clearTimeout },
  );
  return {
    factory: module.exports.createRewardedVideoDriver,
    platform: { createRewardedVideoAd: () => ad },
    ad,
    callbacks,
    calls,
  };
}
const settle = () => new Promise((r) => setImmediate(r));
test("SDK完整关闭只返回客户端结果，不伪造服务端证明；重复关闭只结算一次", async () => {
  const { factory, platform, callbacks, calls } = fixture(),
    d = factory(platform, "adunit-fixture"),
    p = d.play();
  assert.equal(d.play(), p);
  await settle();
  assert.equal(calls.show, 1);
  const close = callbacks.close;
  close({ isEnded: true });
  close({ isEnded: true });
  const result = await p;
  assert.equal(result.clientCompleted, true);
  assert.equal(result.serverVerified, false);
  assert.equal(callbacks.close, undefined);
  d.dispose();
  assert.equal(calls.destroy, 1);
});
test("取消、缺少完整观看标志、加载失败均不能作为完成", async () => {
  for (const result of [{ isEnded: false }, undefined]) {
    const { factory, platform, callbacks } = fixture(),
      d = factory(platform, "adunit-fixture"),
      p = d.play();
    await settle();
    callbacks.close(result);
    assert.equal((await p).clientCompleted, false);
    d.dispose();
  }
  const { factory, platform, ad } = fixture();
  ad.load = async () => {
    throw { errCode: 1004 };
  };
  const d = factory(platform, "adunit-fixture"),
    r = await d.play();
  assert.equal(r.state, "failed");
  assert.equal(r.code, 1004);
  d.dispose();
});
test("页面退出清理回调并销毁，未获广告能力或单元时明确报错", async () => {
  const { factory, platform, callbacks, calls } = fixture();
  assert.throws(() => factory({}, "adunit-fixture"));
  assert.throws(() => factory(platform, ""));
  const d = factory(platform, "adunit-fixture"),
    p = d.play();
  d.dispose();
  assert.equal((await p).state, "cancelled");
  assert.equal(callbacks.close, undefined);
  assert.equal(calls.destroy, 1);
  await settle();
  assert.equal(calls.load, 0);
  await assert.rejects(d.play());
});
test("取消后重试不被旧播放的迟到回调或加载失败打断", async () => {
  const { factory, platform, callbacks, ad, calls } = fixture();
  let rejectFirst;
  ad.load = () => {
    calls.load++;
    return calls.load === 1
      ? new Promise((_, reject) => (rejectFirst = reject))
      : Promise.resolve();
  };
  const d = factory(platform, "adunit-fixture"),
    first = d.play();
  await settle();
  const oldClose = callbacks.close;
  oldClose({ isEnded: false });
  assert.equal((await first).state, "cancelled");
  const second = d.play();
  await settle();
  const newClose = callbacks.close;
  oldClose({ isEnded: true });
  rejectFirst({ errCode: 1004 });
  await settle();
  assert.equal(d.play(), second);
  assert.equal(callbacks.close, newClose);
  assert.equal(calls.show, 1);
  newClose({ isEnded: true });
  assert.equal((await second).clientCompleted, true);
  d.dispose();
});
