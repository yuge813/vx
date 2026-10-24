// 群消息展示模型；运营角色显式标识，历史红包不产生新的可领奖励。
export function buildRoomMessages(group) {
  const records = group.feed.slice(-12),
    content = group.roomContent || { actors: [], posts: [] };
  const liveByEvent = new Map(),
    liveByPost = new Map(),
    fallback = new Map();
  const actorFor = (bank, post) => {
    if (post)
      return {
        actor: post.actor,
        avatar: post.avatar,
        badge: "活动助手",
        mark: post.actor.slice(0, 1),
        text: post.text,
      };
    const actors = content.actors || [],
      index =
        Math.floor(bank.coins / Math.max(1, bank.increment)) +
        (bank.kind === "treasure" ? 1 : 0),
      actor = actors[index % actors.length];
    return actor
      ? {
          actor: actor.nickname,
          avatar: actor.avatar,
          badge: "活动助手",
          mark: actor.nickname.slice(0, 1),
        }
      : {
          actor: bank.kind === "redpacket" ? "红包助手" : "宝箱助手",
          mark: bank.kind === "redpacket" ? "红" : "箱",
          badge: "活动助手",
        };
  };
  const packet = (bank, event, post) => ({
    id: "packet-" + bank.generation,
    type: "packet",
    ...actorFor(bank, post),
    createdAt: post?.createdAt || event?.created_at || null,
    bank,
  });
  for (const bank of group.banks) {
    const post = [...(content.posts || [])]
      .reverse()
      .find(
        (p) => p.kind === bank.kind && p.bankGeneration === bank.generation,
      );
    const event = bank.coins
      ? [...records]
          .reverse()
          .find(
            (e) =>
              e.kind === bank.kind &&
              e.coins === bank.coins &&
              e.title.includes("已更新"),
          )
      : null;
    if (post) liveByPost.set(post.id, packet(bank, event, post));
    else if (event) liveByEvent.set(event.id, packet(bank, event));
    else fallback.set(bank.kind, packet(bank));
  }
  const rows = records.map(
    (e) =>
      liveByEvent.get(e.id) || {
        id: "event-" + e.id,
        type: "text",
        actor: "系统动态",
        mark: "享",
        createdAt: e.created_at,
        text: e.title,
        coins: e.coins,
      },
  );
  for (const post of content.posts || [])
    rows.push(
      liveByPost.get(post.id) || {
        id: "post-" + post.id,
        type: post.kind === "text" ? "text" : "packet_history",
        actor: post.actor,
        avatar: post.avatar,
        badge: "活动助手",
        mark: post.actor.slice(0, 1),
        createdAt: post.createdAt,
        text: post.text,
        packetKind: post.kind,
        detail:
          post.kind === "text" ? null : "历史活动消息 · 已合并至当前待领奖励",
      },
    );
  rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const visible = rows.slice(-30),
    kinds = new Set(
      visible.filter((r) => r.type === "packet").map((r) => r.bank.kind),
    );
  for (const bank of group.banks)
    if (!kinds.has(bank.kind))
      visible.push(fallback.get(bank.kind) || packet(bank));
  return [
    {
      id: "room-rules",
      type: "notice",
      actor: "群公告",
      mark: "公",
      text: "红包和宝箱按倒计时继续累计。可先看金额，暂不打开继续叠包；任务完成后入账，取消保留已叠金额。",
      detail: "活动助手由运营方管理，非真实群友聊天。开发金币不可兑现。",
    },
    ...visible,
  ];
}
