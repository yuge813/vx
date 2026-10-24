import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
import { openBrowser } from "./browser-utils.mjs";
let clockOffset = 0;
const store = new YuanxiangStore({
    draw: () => 0,
    now: () => Date.now() + clockOffset,
  }),
  admin = randomBytes(32).toString("hex");
const { server } = createYuanxiangApp({ store, adminToken: admin });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let b;
try {
  const base = "http://127.0.0.1:" + server.address().port;
  b = await openBrowser(base);
  const idle = () =>
    b.until(
      "document.querySelector('#app').getAttribute('aria-busy')==='false'",
    );
  const shot = async (name, full = false) => {
    if (!process.argv.includes("--screenshots")) return;
    await b.evaluate("document.querySelector('#toast').hidden=true");
    await b.screenshot(
      resolve("docs/screenshots/yuanxiang", name + ".png"),
      full,
    );
  };
  b.socket.addEventListener("message", (e) => {
    const d = JSON.parse(e.data);
    if (d.method === "Page.javascriptDialogOpening")
      b.send("Page.handleJavaScriptDialog", {
        accept: true,
        promptText: d.params.message.includes("个人每日")
          ? "5"
          : "开发复核已记录，请查询原任务。",
      }).catch(() => {});
  });
  await b.until("Boolean(document.querySelector('[data-claim=signin]'))");
  const u = store.adminOverview().users[0].id;
  assert.equal(store.profile(u).balance, 0);
  await shot("desktop-home", true);
  await b.viewport(390, 844, true);
  await shot("mobile-home");
  await b.click("[data-claim=signin]");
  await b.until("document.querySelector('#reward-dialog').open");
  await b.click("#reward-confirm");
  await b.until(
    "!document.querySelector('#reward-dialog').open && document.querySelector('[data-claim=signin]')?.textContent.includes('已签到')",
  );
  assert.equal(store.profile(u).balance, 620);
  await b.click("#navigation [data-nav=group]");
  await b.click("[data-action=advance]");
  await idle();
  assert.equal(
    store.group(u).banks.find((x) => x.kind === "redpacket").coins,
    390,
  );
  await shot("mobile-group-first");
  await b.click("[data-skip=redpacket]");
  await idle();
  await b.until("Boolean(document.querySelector('[data-restore=redpacket]'))");
  assert.equal(
    store.group(u).banks.find((x) => x.kind === "redpacket").coins,
    390,
  );
  await b.click("[data-action=advance]");
  await idle();
  assert.equal(
    store.group(u).banks.find((x) => x.kind === "redpacket").coins,
    780,
  );
  assert.equal(
    await b.evaluate(
      "Boolean(document.querySelector('[data-skip=redpacket]'))",
    ),
    true,
  );
  clockOffset += 21 * 120000;
  await b.until(
    "document.querySelector('[data-bank=redpacket] .reward-value')?.textContent.includes('8888')",
  );
  assert.ok(store.group(u).banks.every((x) => x.coins === 8888));
  await shot("mobile-group-stacked");
  await b.click("[data-claim=redpacket]");
  await b.until("document.querySelector('#reward-dialog').open");
  await b.click("#reward-cancel");
  await idle();
  assert.equal(
    store.group(u).banks.find((x) => x.kind === "redpacket").coins,
    8888,
  );
  await b.click("[data-claim=redpacket]");
  await b.until("document.querySelector('#reward-dialog').open");
  await b.click("#reward-confirm");
  await b.until(
    "!document.querySelector('#reward-dialog').open && document.querySelector('#app').getAttribute('aria-busy')==='false'",
  );
  assert.equal(store.profile(u).balance, 9528);
  await b.click("#navigation [data-nav=bag]");
  await shot("mobile-bag");
  await b.click("#bag-open");
  await b.until("document.querySelector('#reward-dialog').open");
  await b.click("#reward-confirm");
  await b.until(
    "!document.querySelector('#reward-dialog').open && document.querySelector('#app').getAttribute('aria-busy')==='false'",
  );
  assert.equal(store.profile(u).balance, 9628);
  assert.equal(
    await b.evaluate("document.querySelector('#bag-open').disabled"),
    true,
  );
  await b.click("#navigation [data-nav=profile]");
  await b.click("[data-nav=wallet]");
  await b.evaluate("document.querySelector('#withdraw-form').requestSubmit()");
  await idle();
  assert.equal(store.profile(u).balance, 8628);
  assert.equal(store.profile(u).frozen, 1000);
  await shot("mobile-wallet");
  await b.click("#navigation [data-nav=profile]");
  await b.click("[data-nav=invite]");
  const other = store.login("browser_real_referral_fixture").user.id,
    code = store.referral(other).code;
  await b.evaluate(
    `document.querySelector('#bind-code').value=${JSON.stringify(code)};document.querySelector('#bind-form').requestSubmit()`,
  );
  await idle();
  assert.equal(store.referral(other).invitedCount, 1);
  await shot("mobile-invite");
  await b.click("#navigation [data-nav=profile]");
  await b.click("[data-nav=support]");
  await b.evaluate(
    "document.querySelector('#support-message').value='请协助核对红包任务和模拟提现状态';document.querySelector('#support-form').requestSubmit()",
  );
  await idle();
  assert.equal(store.supportList(u).length, 1);
  for (const width of [320, 390, 600]) {
    await b.viewport(width, 844, true);
    for (const page of ["home", "group", "bag", "profile"]) {
      await b.click("#navigation [data-nav=" + page + "]");
      assert.equal(
        await b.evaluate("document.documentElement.scrollWidth<=" + width),
        true,
        page + "在" + width + "px不应横向溢出",
      );
    }
  }
  await b.viewport(1440, 1100);
  await b.send("Page.navigate", { url: base + "/admin" });
  await b.until("Boolean(document.querySelector('#admin-token'))");
  await b.evaluate(
    `document.querySelector('#admin-token').value=${JSON.stringify(admin)};document.querySelector('#login-form').requestSubmit()`,
  );
  await b.until("!document.querySelector('#dashboard').hidden");
  await b.click("[data-review=approve]");
  await b.until(
    "Boolean(document.querySelector('[data-review=simulate_pay]'))",
  );
  await b.click("[data-review=simulate_pay]");
  await b.until(
    "document.querySelector('#dashboard').textContent.includes('模拟完成，未付款')",
  );
  assert.equal(store.profile(u).frozen, 0);
  assert.equal(store.profile(u).paid, 1000);
  await b.evaluate(
    "document.querySelector('[name=subsidyCoins]').value='35';document.querySelector('#settings-form').requestSubmit()",
  );
  await b.until(
    "document.querySelector('#dashboard').textContent.includes('规则版本v2')",
  );
  assert.equal(store.settings().subsidyCoins, 35);
  await b.click("[data-reply]");
  await b.until(
    "document.querySelector('#dashboard').textContent.includes('已回复')",
  );
  assert.equal(store.supportList(u)[0].state, "resolved");
  await shot("desktop-admin", true);
  await b.click("#logout");
  assert.equal(
    await b.evaluate(
      "document.querySelector('#dashboard').hidden && !document.querySelector('#admin-token').value",
    ),
    true,
  );
  assert.deepEqual(b.exceptions, []);
  console.log(
    "元享式新版浏览器实测通过：签到、390→780→8888叠包、暂存与取消保留、红包入账、概率福袋与冷却、提现冻结审核模拟完成、真实邀请绑定、反馈回复、补贴配置及320/390/600px布局。",
  );
} finally {
  await b?.close();
  await new Promise((r) => server.close(r));
  store.close();
}
