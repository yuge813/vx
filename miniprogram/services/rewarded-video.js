/* 官方客户端SDK适配器；结果不是服务端观看证明，不会发奖。
 * 仅在取得具体场景许可、配置自己的广告单元并完成真机验收后，才可接入业务。
 * 每个页面独立创建，在页面退出时dispose，不跨页面复用实例。 */
function createRewardedVideoDriver(platform, adUnitId, options = {}) {
  if (!platform || typeof platform.createRewardedVideoAd !== "function")
    throw new Error("当前微信环境不支持激励视频");
  if (typeof adUnitId !== "string" || !/^adunit-[a-zA-Z0-9_-]+$/.test(adUnitId))
    throw new Error("请配置自己的有效广告单元");
  const ad = platform.createRewardedVideoAd({ adUnitId });
  let pending = null,
    disposed = false;
  function play() {
    if (disposed) return Promise.reject(new Error("广告实例已销毁"));
    if (pending) return pending.promise;
    let resolve, operation;
    const promise = new Promise((r) => (resolve = r)),
      timeoutMs = options.timeoutMs || 180000;
    const finish = (result) => {
      if (pending !== operation) return;
      clearTimeout(pending.timer);
      ad.offClose(close);
      ad.offError(error);
      pending = null;
      resolve({ ...result, serverVerified: false });
    };
    const close = (result) =>
      finish({
        state: result?.isEnded === true ? "client_completed" : "cancelled",
        clientCompleted: result?.isEnded === true,
      });
    const error = (result) =>
      finish({
        state: "failed",
        clientCompleted: false,
        code: result?.errCode || "SDK_ERROR",
      });
    operation = pending = {
      promise,
      finish,
      timer: setTimeout(
        () =>
          finish({
            state: "failed",
            clientCompleted: false,
            code: "CLIENT_TIMEOUT",
          }),
        timeoutMs,
      ),
    };
    ad.onClose(close);
    ad.onError(error);
    Promise.resolve()
      .then(() => {
        if (pending === operation && !disposed) return ad.load();
      })
      .then(() => {
        if (pending === operation && !disposed) return ad.show();
      })
      .catch(error);
    return promise;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (pending) pending.finish({ state: "cancelled", clientCompleted: false });
    if (typeof ad.destroy === "function") ad.destroy();
  }
  return { play, dispose };
}
module.exports = { createRewardedVideoDriver };
