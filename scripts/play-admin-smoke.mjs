import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { YuanxiangStore } from "../server/yuanxiang.mjs";
import { createYuanxiangApp } from "../server/index.mjs";
import { openBrowser } from "./browser-utils.mjs";

const store = new YuanxiangStore(),
  admin = randomBytes(32).toString("hex");
const { server } = createYuanxiangApp({ store, adminToken: admin });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
let b;
try {
  const request = async (
    path,
    method = "GET",
    body,
    token = admin,
    expected = 200,
  ) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await r.json();
    assert.equal(r.status, expected, result.error?.message || path);
    return result;
  };
  const question = async (id) =>
    (await request("/api/admin/play/questions")).items.find((q) => q.id === id);
  b = await openBrowser(base + "/admin");
  b.socket.addEventListener("message", (e) => {
    const d = JSON.parse(e.data);
    if (d.method === "Page.javascriptDialogOpening")
      b.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  });
  await b.until("document.body.dataset.adminReady==='true'");
  await b.evaluate(
    `document.querySelector('#admin-token').value=${JSON.stringify(admin)};document.querySelector('#login-form').requestSubmit()`,
  );
  await b.until("Boolean(document.querySelector('#play-question-form'))");
  const idle = () =>
    b.until(
      "document.querySelector('#play-admin')?.getAttribute('aria-busy')==='false'",
    );
  const fill = async (selector, values) =>
    b.evaluate(
      `{const f=document.querySelector(${JSON.stringify(selector)});for(const[k,v]of Object.entries(${JSON.stringify(values)})){const e=f.elements.namedItem(k);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}}`,
    );
  const submit = async (selector) =>
    b.evaluate(
      `document.querySelector(${JSON.stringify(selector)}).requestSubmit()`,
    );
  const original = {
    category: "生活",
    prompt: "验收原创题：不考虑闰年时，一年有多少天？",
    options: ["360天", "365天", "366天", "400天"],
    correctIndex: 1,
    explanation: "平年二月有28天，将十二个月的天数相加得到365天。",
    sourceNote: "内部验收自编题；依据平年历法常识核对。",
  };
  await fill("#play-question-form", {
    category: original.category,
    prompt: original.prompt,
    ...Object.fromEntries(original.options.map((v, i) => ["option" + i, v])),
    correctIndex: original.correctIndex,
    explanation: original.explanation,
    sourceNote: original.sourceNote,
  });
  await submit("#play-question-form");
  await idle();
  await b.until(
    "document.querySelector('#play-admin').textContent.includes('验收原创题：')",
  );
  let q = (
    await request(
      "/api/admin/play/questions?q=" + encodeURIComponent("验收原创题："),
    )
  ).items[0];
  assert.equal(q.state, "draft");
  assert.equal(q.published, null);
  await request(
    "/api/admin/play/questions/" + q.id + "/publish",
    "POST",
    { version: q.version, reviewNote: "未勾选权利和答案，必须拒绝" },
    admin,
    400,
  );
  await b.click(`[data-play-publish="${q.id}"]`);
  await b.until("document.querySelector('#play-publish-dialog').open");
  await b.evaluate(
    "document.querySelector('#play-publish-form').requestSubmit()",
  );
  assert.equal(
    (await question(q.id)).published,
    null,
    "没有勾选时浏览器校验不能发布",
  );
  const publish = async (id) => {
    if (
      !(await b.evaluate("document.querySelector('#play-publish-dialog').open"))
    )
      await b.click(`[data-play-publish="${id}"]`);
    await b.evaluate(
      "{const f=document.querySelector('#play-publish-form');f.elements.rightsConfirmed.checked=true;f.elements.answerChecked.checked=true;f.elements.reviewNote.value='验收题为自编，正确选项与解析已逐项核对';f.requestSubmit();}",
    );
    await b.until("!document.querySelector('#play-publish-dialog').open");
    await b.until(
      `document.querySelector('[data-play-question="${id}"] .play-state')?.textContent==='已发布'`,
    );
  };
  await publish(q.id);
  await idle();
  q = await question(q.id);
  assert.equal(q.enabled, true);
  assert.equal(q.published.prompt, original.prompt);
  // 构造恰好五道已发布题，保证真实用户题单包含待编辑题。
  const all = (await request("/api/admin/play/questions")).items;
  for (const item of all.filter((v) => v.enabled && v.id !== q.id))
    await request("/api/admin/play/questions/" + item.id + "/disable", "POST", {
      version: item.version,
    });
  const companions = [];
  const addCompanion = async (i) => {
    let item = await request("/api/admin/play/questions", "POST", {
      category: "逻辑",
      prompt: `验收配套题${i}：一个整数加零，结果与原数是什么关系？`,
      options: ["相等", "一定更大", "一定更小", "一定变成零"],
      correctIndex: 0,
      explanation: "零是加法单位元，任一整数与零相加都保持原值。",
      sourceNote: "内部验收自编题；依据整数加法定义核对。",
    });
    // 创建接口可返回题目本身；列表查询用于统一读取服务端version。
    item = (
      await request(
        "/api/admin/play/questions?q=" + encodeURIComponent(`验收配套题${i}：`),
      )
    ).items[0];
    await request("/api/admin/play/questions/" + item.id + "/publish", "POST", {
      version: item.version,
      reviewNote: "自编整数运算题，答案解析已核对",
      rightsConfirmed: true,
      answerChecked: true,
    });
    companions.push(item.id);
  };
  for (let i = 1; i <= 4; i++) await addCompanion(i);
  const user = store.login("play_admin_old_snapshot_fixture");
  let old = await request("/api/play/quiz", "GET", undefined, user.token);
  assert.equal(old.total, 5);
  await b.click("[data-play-refresh]");
  await idle();
  await b.until(
    `Boolean(document.querySelector('[data-play-question="${q.id}"]'))`,
  );
  await b.click(`[data-play-edit="${q.id}"]`);
  const revised = {
    ...original,
    prompt: "验收新版题：以下哪个整数是偶数？",
    options: ["3", "5", "8", "9"],
    correctIndex: 2,
    explanation: "8能被2整除，因此8是偶数；其他三个数都是奇数。",
  };
  await fill("#play-question-form", {
    prompt: revised.prompt,
    ...Object.fromEntries(revised.options.map((v, i) => ["option" + i, v])),
    correctIndex: revised.correctIndex,
    explanation: revised.explanation,
  });
  await submit("#play-question-form");
  await idle();
  await b.until(
    `document.querySelector('[data-play-question="${q.id}"] .play-state')?.textContent==='待发布草稿'`,
  );
  q = await question(q.id);
  assert.equal(q.prompt, revised.prompt);
  assert.equal(q.published.prompt, original.prompt);
  assert.equal(q.enabled, true);
  // 两个运营窗口的同一version冲突：旧编辑不得覆盖服务器版本，本地输入仍保留。
  await b.click(`[data-play-edit="${q.id}"]`);
  await request("/api/admin/play/questions/" + q.id, "PUT", {
    ...revised,
    version: q.version,
    explanation: "服务端并发校对：8除以2得4，余数为0，所以8是偶数。",
  });
  await fill("#play-question-form", {
    prompt: "本地旧版本编辑，不能覆盖服务器新内容",
  });
  await submit("#play-question-form");
  await idle();
  await b.until("Boolean(document.querySelector('#play-admin [role=alert]'))");
  assert.equal((await question(q.id)).prompt, revised.prompt);
  assert.equal(
    await b.evaluate(
      "document.querySelector('#play-question-form [name=prompt]').value",
    ),
    "本地旧版本编辑，不能覆盖服务器新内容",
  );
  await b.click("[data-play-refresh]");
  await idle();
  await b.until(
    `Boolean(document.querySelector('[data-play-reload="${q.id}"]'))`,
  );
  await b.click(`[data-play-reload="${q.id}"]`);
  await b.click(`[data-play-publish="${q.id}"]`);
  await publish(q.id);
  await idle();
  q = await question(q.id);
  assert.equal(q.published.prompt, revised.prompt);
  await addCompanion(5);
  await b.click(`[data-play-disable="${q.id}"]`);
  await idle();
  await b.until(
    `document.querySelector('[data-play-question="${q.id}"] .play-state')?.textContent==='已停用'`,
  );
  assert.equal((await question(q.id)).enabled, false);
  assert.equal(
    Number(
      await b.evaluate(
        "document.querySelector('#play-question-form [name=version]').value",
      ),
    ),
    (await question(q.id)).version,
    "自己发布/停用后的编辑版本同步，不制造虚假并发冲突",
  );
  let sawOriginal = false;
  while (!old.completed) {
    const current = old.current;
    assert.ok(current);
    if (current.id === q.id) {
      assert.equal(current.prompt, original.prompt);
      sawOriginal = true;
    }
    const result = await request(
      "/api/play/quiz/" + old.id + "/answer",
      "POST",
      {
        questionId: current.id,
        choice: current.options.indexOf(current.id === q.id ? "365天" : "相等"),
      },
      user.token,
    );
    old = result.session;
  }
  assert.equal(sawOriginal, true);
  assert.equal(old.correct, 5, "停用与重新发布不破坏旧题单快照");
  const nextUser = store.login("play_admin_new_snapshot_fixture");
  let next = await request("/api/play/quiz", "GET", undefined, nextUser.token);
  while (!next.completed) {
    assert.notEqual(next.current.id, q.id);
    next = (
      await request(
        "/api/play/quiz/" + next.id + "/answer",
        "POST",
        {
          questionId: next.current.id,
          choice: next.current.options.indexOf("相等"),
        },
        nextUser.token,
      )
    ).session;
  }
  await b.click("[data-play-refresh]");
  await idle();
  assert.equal(store.play.summary().answers, 10);
  assert.equal(
    await b.evaluate(
      "document.querySelectorAll('#play-admin .stat strong')[2].textContent",
    ),
    "10",
  );
  await fill("#play-question-filter", {
    q: "验收新版题",
    state: "disabled",
    category: "生活",
  });
  await submit("#play-question-filter");
  await idle();
  assert.equal(
    await b.evaluate(
      "document.querySelectorAll('[data-play-question]').length",
    ),
    1,
  );
  assert.equal(
    await b.evaluate(
      "document.querySelector('[data-play-question]').dataset.playQuestion",
    ),
    q.id,
  );
  await fill("#play-question-filter", { q: "", state: "", category: "" });
  await submit("#play-question-filter");
  await idle();
  for (const width of [320, 390, 600]) {
    await b.viewport(width, 844, true);
    assert.equal(
      await b.evaluate("document.documentElement.scrollWidth<=" + width),
      true,
      "题库后台不横向溢出" + width,
    );
  }
  await b.viewport(1440, 1100);
  await b.evaluate(
    "document.querySelector('#play-admin').scrollIntoView({block:'start'})",
  );
  if (process.argv.includes("--screenshots"))
    await b.evaluate("document.querySelector('#toast').hidden=true");
  if (process.argv.includes("--screenshots"))
    await b.screenshot(
      resolve("docs/screenshots/yuanxiang/desktop-play-admin.png"),
    );
  assert.deepEqual(b.exceptions, []);
  console.log(
    "趣玩后台浏览器验收通过：草稿新增/筛选结构、双勾审核发布、草稿与发布分离、并发冲突保留输入、重新载入、停用与旧题单快照、真实统计及320/390/600px布局。",
  );
} catch (e) {
  if (b) {
    await b.screenshot("/tmp/yx-play-admin-failure.png");
    console.error(
      "溢出诊断",
      await b.evaluate(
        "({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>320+1).sort((a,b)=>b.right-a.right).slice(0,18)})",
      ),
    );
  }
  console.error(
    "趣玩后台诊断",
    b
      ? await b.evaluate(
          "({login:document.querySelector('#login-error')?.textContent,toast:document.querySelector('#toast')?.textContent,alert:document.querySelector('#play-admin [role=alert]')?.textContent})",
        )
      : null,
  );
  throw e;
} finally {
  await b?.close();
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
