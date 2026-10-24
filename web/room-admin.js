import { esc } from "./shared.js";
const kinds = { text: "文字消息", redpacket: "金币红包", treasure: "金币宝箱" };
export function roomAdminView(room) {
  const { actors, messages, avatars } = room;
  const avatarChoices = avatars
    .map((avatar, i) => `<option value="${avatar}">原创头像 ${i + 1}</option>`)
    .join("");
  const actorChoices = actors
    .map(
      (a) =>
        `<option value="${a.id}">${esc(a.nickname)}${a.enabled ? "" : "（停用）"}</option>`,
    )
    .join("");
  return `<section id="room-content" class="room-admin"><div class="row section"><div><h2>群角色与消息管理</h2><p class="caption">${esc(room.notice)}</p></div><span class="pill">内容版本 ${room.revision}</span></div><div class="room-admin-grid">
 <section class="card"><h3>活动助手 · ${actors.length}个</h3><p class="caption">选择原创头像并设置昵称；前台统一标注“活动助手”，不计入真实账户数。</p><form id="room-actor-form"><input type="hidden" name="recordId"><input type="hidden" name="version"><label class="field-label">昵称<input class="field" name="nickname" maxlength="16" required placeholder="例如：清禾"></label><div class="field-row"><label class="field-label">头像<select class="field" name="avatar">${avatarChoices}</select></label><label class="field-label">排序<input class="field" name="sortOrder" type="number" min="0" max="10000" step="1" value="0" required></label></div><label class="room-checkbox"><input type="checkbox" name="enabled" checked>启用该助手</label><div class="row"><button class="button small" type="submit">保存助手</button><button class="button small light" type="button" data-room-reset="actor">取消编辑 / 新增</button></div></form><div class="room-admin-list">${actors.map((a) => `<div class="room-actor-row" data-room-actor="${a.id}"><img src="/assets/${a.avatar}.svg" alt="${esc(a.nickname)}头像"><div><strong>${esc(a.nickname)}</strong><small>活动助手 · 排序${a.sortOrder} · ${a.enabled ? "启用" : "停用"}</small></div><div class="room-row-actions"><button class="link" data-room-edit="actor" data-id="${a.id}">编辑</button><button class="link" data-room-toggle="actor" data-id="${a.id}">${a.enabled ? "停用" : "启用"}</button><button class="link danger-text" data-room-delete="actor" data-id="${a.id}">删除</button></div></div>`).join("") || '<p class="empty">暂无活动助手，可在上方新增。</p>'}</div></section>
 <section class="card"><h3>轮播消息 · ${messages.length}条</h3><p class="caption">按排序循环，每条间隔指距上一条发布的前台使用秒数。红包关联现有奖励池，新增消息不增加或伪造金币。</p><form id="room-message-form"><input type="hidden" name="recordId"><input type="hidden" name="version"><div class="field-row"><label class="field-label">发布助手<select class="field" name="actorId" required>${actorChoices}</select></label><label class="field-label">消息类型<select class="field" name="kind">${Object.entries(
   kinds,
 )
   .map(([k, v]) => `<option value="${k}">${v}</option>`)
   .join(
     "",
   )}</select></label></div><label class="field-label">消息文字 / 红包祝福<textarea class="field" name="content" maxlength="240" rows="3" required placeholder="发布有用的活动说明或红包祝福，不编造到账或用户好评"></textarea></label><div class="field-row"><label class="field-label">距上一条间隔秒<input class="field" name="delaySeconds" type="number" min="5" max="3600" value="20" required></label><label class="field-label">排序<input class="field" name="sortOrder" type="number" min="0" max="10000" value="0" required></label></div><label class="room-checkbox"><input type="checkbox" name="enabled" checked>启用该消息</label><div class="row"><button class="button small" type="submit" ${actors.length ? "" : "disabled"}>保存消息</button><button class="button small light" type="button" data-room-reset="message">取消编辑 / 新增</button></div></form><div class="room-admin-list">${
   messages
     .map((m) => {
       const a = actors.find((a) => a.id === m.actorId);
       return `<div class="room-message-row" data-room-message="${m.id}"><div class="row"><span class="room-kind kind-${m.kind}">${kinds[m.kind]}</span><small>${m.enabled ? "启用" : "停用"} · ${m.delaySeconds}秒 · 排序${m.sortOrder}</small></div><p>${esc(m.content)}</p><div class="row"><small>${esc(a?.nickname || "助手已删除")}</small><div class="room-row-actions"><button class="link" data-room-edit="message" data-id="${m.id}">编辑</button><button class="link" data-room-toggle="message" data-id="${m.id}">${m.enabled ? "停用" : "启用"}</button><button class="link danger-text" data-room-delete="message" data-id="${m.id}">删除</button></div></div></div>`;
     })
     .join("") || '<p class="empty">暂无轮播消息，可在上方新增。</p>'
 }</div></section></div></section>`;
}
export function bindRoomAdmin({ api, run, getRoom, toast }) {
  const collection = (type) => (type === "actor" ? "actors" : "messages");
  const record = (type, id) =>
    getRoom()[collection(type)].find((r) => r.id === id);
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.roomReset) {
      document.querySelector(`#room-${b.dataset.roomReset}-form`).reset();
      const f = document.querySelector(`#room-${b.dataset.roomReset}-form`);
      f.elements.recordId.value = "";
      f.elements.version.value = "";
    }
    if (b.dataset.roomEdit) {
      const type = b.dataset.roomEdit,
        r = record(type, b.dataset.id),
        form = document.querySelector(`#room-${type}-form`);
      for (const [key, value] of Object.entries(r)) {
        const el = form.elements.namedItem(key === "id" ? "recordId" : key);
        if (el) {
          if (el.type === "checkbox") el.checked = value;
          else el.value = value;
        }
      }
      form.scrollIntoView({ block: "center", behavior: "smooth" });
      form.querySelector("input:not([type=hidden])")?.focus();
    }
    if (b.dataset.roomToggle) {
      const type = b.dataset.roomToggle,
        r = record(type, b.dataset.id);
      run(() =>
        api(`/room/${collection(type)}/${r.id}`, "PUT", {
          version: r.version,
          enabled: !r.enabled,
        }),
      );
    }
    if (b.dataset.roomDelete) {
      const type = b.dataset.roomDelete,
        r = record(type, b.dataset.id);
      if (
        window.confirm(
          "删除后停止后续发布并撤下关联活动消息，用户已叠金币保留。确认删除？",
        )
      )
        run(() =>
          api(`/room/${collection(type)}/${r.id}`, "DELETE", {
            version: r.version,
          }),
        );
    }
  });
  document.addEventListener("submit", (e) => {
    const type =
      e.target.id === "room-actor-form"
        ? "actor"
        : e.target.id === "room-message-form"
          ? "message"
          : null;
    if (!type) return;
    e.preventDefault();
    const form = e.target,
      id = form.elements.recordId.value,
      raw = Object.fromEntries(new FormData(form)),
      payload = {
        ...raw,
        enabled: form.elements.enabled.checked,
        sortOrder: Number(raw.sortOrder),
      };
    delete payload.recordId;
    delete payload.version;
    if (id) payload.version = Number(raw.version);
    if (type === "message") payload.delaySeconds = Number(raw.delaySeconds);
    run(async () => {
      await api(
        `/room/${collection(type)}${id ? "/" + id : ""}`,
        id ? "PUT" : "POST",
        payload,
      );
      toast(type === "actor" ? "活动助手已保存" : "群消息已保存，按新排序发布");
    });
  });
}
