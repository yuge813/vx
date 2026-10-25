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
  assert.equal(
    await b.evaluate("document.querySelectorAll('#navigation button').length"),
    5,
  );
  assert.equal(
    await b.evaluate(
      "Boolean(document.querySelector('.room-top') && document.querySelector('.room-scroll'))",
    ),
    true,
  );
  await b.click("[data-action=advance]");
  await idle();
  assert.equal(
    store.group(u).banks.find((x) => x.kind === "redpacket").coins,
    390,
  );
  await b.evaluate("document.querySelector('.room-scroll').scrollTop=0");
  await b.until(
    "Boolean(document.querySelector('[data-ad-preview=native]'))",
    20000,
  );
  assert.equal(
    await b.evaluate(
      "document.querySelectorAll('.portrait-avatar').length>=2 && document.querySelectorAll('.assistant-badge').length>=2",
    ),
    true,
  );
  await shot("mobile-group-chat");
  await shot("mobile-group-first");
  const toolbarBefore = await b.evaluate(
    "document.querySelector('.room-top').getBoundingClientRect().top",
  );
  await b.evaluate("document.querySelector('.room-scroll').scrollTop=10000");
  assert.equal(
    await b.evaluate(
      "document.querySelector('.room-top').getBoundingClientRect().top",
    ),
    toolbarBefore,
  );
  await b.until(
    "Boolean(document.querySelector('[data-ad-preview=banner]'))",
    40000,
  );
  await shot("mobile-group-ad-banner");
  await shot("mobile-group-actors");
  assert.equal(
    await b.evaluate("document.querySelectorAll('[data-ad-preview]').length"),
    1,
  );
  await b.click("[data-action=hide-ad]");
  assert.equal(
    await b.evaluate("Boolean(document.querySelector('[data-ad-preview]'))"),
    false,
  );
  assert.equal(
    await b.evaluate(
      "Boolean(document.querySelector('[data-claim=redpacket]') && !document.querySelector('[data-claim=redpacket]').disabled)",
    ),
    true,
  );
  await b.click(".lucky-float");
  assert.equal(
    await b.evaluate("Boolean(document.querySelector('#bag-open'))"),
    true,
  );
  await b.click("#navigation [data-nav=group]");
  await b.click(".room-withdraw");
  assert.equal(
    await b.evaluate("Boolean(document.querySelector('#withdraw-form'))"),
    true,
  );
  await b.click("#navigation [data-nav=group]");
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
  assert.equal(
    await b.evaluate("document.querySelector('#reward-confirm').textContent"),
    "开",
  );
  assert.equal(
    store.profile(u).balance,
    620,
    "点击封面只显示开字面板，不发金币",
  );
  assert.equal(
    await b.evaluate("document.querySelector('#packet-total').textContent"),
    "8908",
  );
  await shot("mobile-packet-open");
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
    "document.querySelector('#reward-dialog').dataset.phase==='received'",
  );
  await shot("mobile-packet-received");
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
  await b.click("#navigation [data-nav=invite]");
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
    for (const page of ["home", "group", "bag", "invite", "profile"]) {
      await b.click("#navigation [data-nav=" + page + "]");
      assert.equal(
        await b.evaluate("document.documentElement.scrollWidth<=" + width),
        true,
        page + "在" + width + "px不应横向溢出",
      );
    }
  }
  await b.viewport(390, 844, true);
  await b.click("#navigation [data-nav=group]");
  await b.evaluate("document.querySelector('.room-scroll').scrollTop=10000");
  await shot("mobile-group-claimed");
  await b.viewport(1440, 1100);
  await shot("desktop-group-chat");
  await b.send("Page.navigate", { url: base + "/admin" });
  await b.until("document.body.dataset.adminReady==='true'");
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
  await b.evaluate(
    "document.querySelector('#room-actor-form [name=nickname]').value='清禾浏览器助手';document.querySelector('#room-actor-form [name=avatar]').value='avatar-leaf';document.querySelector('#room-actor-form [name=sortOrder]').value='5';document.querySelector('#room-actor-form').requestSubmit()",
  );
  await b.until(
    "Boolean([...document.querySelectorAll('.room-actor-row')].find(r=>r.textContent.includes('清禾浏览器助手')))",
  );
  let roomData = store.roomContent.admin();
  const actor = roomData.actors.find((a) => a.nickname === "清禾浏览器助手");
  assert.equal(actor.avatar, "avatar-leaf");
  await b.click(`[data-room-edit=actor][data-id="${actor.id}"]`);
  await b.evaluate(
    "document.querySelector('#room-actor-form [name=nickname]').value='清禾';document.querySelector('#room-actor-form').requestSubmit()",
  );
  await b.until(
    "Boolean([...document.querySelectorAll('.room-actor-row')].find(r=>r.textContent.includes('清禾')&&!r.textContent.includes('浏览器助手')))",
  );
  assert.equal(
    store.roomContent.admin().actors.find((a) => a.id === actor.id).nickname,
    "清禾",
  );
  // 将现有消息移后，使新加的消息可在下一轮首先发布。
  const first = roomData.messages[0];
  await b.click(`[data-room-edit=message][data-id="${first.id}"]`);
  await b.evaluate(
    "document.querySelector('#room-message-form [name=sortOrder]').value='1000';document.querySelector('#room-message-form').requestSubmit()",
  );
  await b.until(
    "document.querySelector('#room-message-form [name=recordId]').value===''",
  );
  await b.evaluate(
    `{const f=document.querySelector('#room-message-form');f.elements.actorId.value=${JSON.stringify(actor.id)};f.elements.kind.value='treasure';f.elements.content.value='后台管理的小惊喜，金币以实际待领为准';f.elements.delaySeconds.value='5';f.elements.sortOrder.value='0';f.requestSubmit();}`,
  );
  await b.until(
    "Boolean([...document.querySelectorAll('.room-message-row')].find(r=>r.textContent.includes('后台管理的小惊喜')))",
  );
  const managed = store.roomContent
    .admin()
    .messages.find((m) => m.content.includes("后台管理的小惊喜"));
  await b.click(`[data-room-toggle=message][data-id="${managed.id}"]`);
  await b.until(
    `document.querySelector('[data-room-toggle=message][data-id="${managed.id}"]').textContent==='启用'`,
  );
  assert.equal(
    store.roomContent.admin().messages.find((m) => m.id === managed.id).enabled,
    false,
  );
  await b.click(`[data-room-toggle=message][data-id="${managed.id}"]`);
  await b.until(
    `document.querySelector('[data-room-toggle=message][data-id="${managed.id}"]').textContent==='停用'`,
  );
  await b.evaluate(
    "document.querySelector('#room-content').scrollIntoView({block:'start'})",
  );
  await shot("desktop-room-admin");
  await shot("desktop-admin", true);
  await b.click("#logout");
  assert.equal(
    await b.evaluate(
      "document.querySelector('#dashboard').hidden && !document.querySelector('#admin-token').value",
    ),
    true,
  );
  await b.send("Page.navigate", { url: base + "/" });
  await b.until(
    "Boolean(document.querySelector('#navigation [data-nav=group]'))",
  );
  await b.viewport(390, 844, true);
  await b.click("#navigation [data-nav=group]");
  await b.until(
    "document.querySelector('.room-scroll')?.textContent.includes('后台管理的小惊喜')",
    17000,
  );
  assert.equal(
    await b.evaluate(
      "Boolean([...document.querySelectorAll('.room-message')].find(r=>r.textContent.includes('后台管理的小惊喜')&&r.textContent.includes('清禾')&&r.querySelector('.portrait-avatar')&&r.querySelector('.assistant-badge')) )",
    ),
    true,
  );
  await b.evaluate("document.querySelector('.room-scroll').scrollTop=10000");
  await shot("mobile-group-managed");
  assert.deepEqual(b.exceptions, []);
  console.log(
    "元享式新版浏览器实测通过：活动助手头像、后台角色新增编辑、消息新增排序停启及前台真实发布、15秒信息流/45秒横幅错峰预览、关闭后保留红包操作、签到、390→780→8888叠包、暂存与取消保留、红包入账、概率福袋与冷却、提现冻结审核模拟完成、真实邀请绑定、反馈回复、补贴配置及320/390/600px布局。",
  );
} finally {
  await b?.close();
  await new Promise((r) => server.close(r));
  store.close();
}
