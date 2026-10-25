import assert from "node:assert/strict";
import { resolve } from "node:path";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
import { openBrowser } from "./browser-utils.mjs";
const store = new YuanxiangStore();
const { server } = createYuanxiangApp({ store });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let b;
try {
  b = await openBrowser("http://127.0.0.1:" + server.address().port, 390, 844);
  await b.viewport(390, 844, true);
  const idle = () =>
    b.until(
      "document.querySelector('#app').getAttribute('aria-busy')==='false'",
    );
  const shot = async (name) => {
    if (!process.argv.includes("--screenshots")) return;
    await b.evaluate("document.querySelector('#toast').hidden=true");
    await b.screenshot(resolve("docs/screenshots/yuanxiang", name + ".png"));
  };
  // 真实指针命中，验证弹窗层级和点击区域，而非仅触发DOM回调。
  const click = async (selector) => {
    const point = await b.evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await b.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1,
    });
    await b.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1,
    });
  };
  await b.until("Boolean(document.querySelector('[data-claim=signin]'))");
  const id = store.adminOverview().users[0].id;
  await click("#navigation [data-nav=group]");
  await click("[data-action=advance]");
  await idle();
  await shot("mobile-packet-cover");
  await click("[data-claim=redpacket]");
  await b.until("document.querySelector('#reward-dialog').open");
  assert.equal(
    await b.evaluate("document.querySelector('#reward-confirm').textContent"),
    "开",
  );
  assert.equal(
    await b.evaluate("document.querySelector('#packet-total').textContent"),
    "410",
  );
  assert.equal(store.profile(id).balance, 0);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [600, 844],
  ]) {
    await b.viewport(width, height, true);
    const layout = await b.evaluate(
      `(()=>{const d=document.querySelector('#reward-dialog'),r=d.getBoundingClientRect(),c=document.querySelector('#reward-confirm').getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,buttonVisible:c.top>=r.top&&c.bottom<=r.bottom,focused:document.activeElement.id==='reward-confirm',overflow:d.scrollWidth>d.clientWidth}})()`,
    );
    assert.equal(layout.inside, true, `红包面板需在${width}×${height}可视区内`);
    assert.equal(layout.buttonVisible, true, `开字在${width}px可直接点击`);
    assert.equal(layout.overflow, false);
    assert.equal(layout.focused, true);
  }
  await b.viewport(390, 844, true);
  await shot("mobile-packet-open");
  await b.viewport(1440, 1000);
  await shot("desktop-packet-open");
  await b.viewport(390, 844, true);
  await click("#reward-dismiss");
  await idle();
  assert.equal(store.profile(id).balance, 0);
  assert.equal(
    store.group(id).banks.find((b) => b.kind === "redpacket").coins,
    390,
  );
  assert.equal(store.profile(id).pendingTask, null);
  // Escape与关闭按钮行为一致；已预留金币仍可继续叠加。
  await click("[data-claim=redpacket]");
  await b.until("document.querySelector('#reward-dialog').open");
  await b.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await b.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await b.until("!document.querySelector('#reward-dialog').open");
  await idle();
  assert.equal(store.profile(id).pendingTask, null);
  await click("[data-claim=redpacket]");
  await b.until("document.querySelector('#reward-dialog').open");
  await click("#reward-confirm");
  assert.equal(
    await b.evaluate("document.querySelector('#reward-dismiss').disabled"),
    true,
  );
  await click("#reward-confirm");
  await b.until(
    "document.querySelector('#reward-dialog').dataset.phase==='received'",
  );
  assert.equal(store.profile(id).balance, 410);
  assert.equal(store.profile(id).adsToday, 1);
  await shot("mobile-packet-received");
  await click("#reward-confirm");
  await idle();
  assert.equal(
    await b.evaluate("document.querySelector('#reward-dialog').open"),
    false,
  );
  // 切回普通签到弹窗时不能残留红包皮肤或开字。
  await click("#navigation [data-nav=home]");
  await click("[data-claim=signin]");
  await b.until("document.querySelector('#reward-dialog').open");
  assert.equal(
    await b.evaluate(
      "document.querySelector('#reward-dialog').classList.contains('packet-reveal')",
    ),
    false,
  );
  assert.equal(
    await b.evaluate("document.querySelector('#reward-confirm').textContent"),
    "开始3秒模拟",
  );
  await click("#reward-cancel");
  await idle();
  assert.equal(store.operations.reconcile().ok, true);
  assert.deepEqual(b.exceptions, []);
  console.log(
    "红包UI浏览器实测通过：真实指针点击封面→开字→领取结果；320/390/600px及短屏、焦点、关闭/Escape保留、连续点击防重、切回签到、内部对账。",
  );
} catch (e) {
  if (b) await b.screenshot("/tmp/yx-packet-ui-failure.png");
  throw e;
} finally {
  await b?.close();
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
