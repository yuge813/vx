// 群信息流的展示模型；不改变任务、叠包或金币账务。
export function buildRoomMessages(group, { adPreview = false } = {}) {
  const records = group.feed.slice(-12);
  const liveByEvent = new Map();
  const used = new Set();
  for (const bank of group.banks) {
    if (!bank.coins) continue;
    const last = [...records]
      .reverse()
      .find(
        (event) =>
          event.kind === bank.kind &&
          event.coins === bank.coins &&
          event.title.includes("已更新"),
      );
    if (last) {
      liveByEvent.set(last.id, bank);
      used.add(bank.kind);
    }
  }
  const rows = [
    {
      id: "room-rules",
      type: "notice",
      actor: "群公告",
      mark: "公",
      text: "红包和宝箱按倒计时继续累计。可先看金额，暂不打开继续叠包；任务完成后入账，取消保留已叠金额。",
      detail: "开发联调：金币不可兑现，消息是本账户的真实系统动态。",
    },
  ];
  let inserted = false;
  const ad = () => {
    if (adPreview && !inserted) {
      rows.push({
        id: "ad-preview",
        type: "ad",
        actor: "开发广告位",
        mark: "告",
        text: "原生广告展示位置",
        detail: "未接入广告组件，不产生曝光或收入。",
      });
      inserted = true;
    }
  };
  const packet = (bank, event = null) => ({
    id: "packet-" + bank.generation,
    type: "packet",
    actor: bank.kind === "redpacket" ? "红包助手" : "宝箱助手",
    mark: bank.kind === "redpacket" ? "红" : "箱",
    createdAt: event?.created_at || null,
    bank,
  });
  for (const event of records) {
    const bank = liveByEvent.get(event.id);
    if (bank) {
      ad();
      rows.push(packet(bank, event));
    } else
      rows.push({
        id: "event-" + event.id,
        type: "text",
        actor: "系统动态",
        mark: "享",
        createdAt: event.created_at,
        text: event.title,
        coins: event.coins,
      });
  }
  ad();
  for (const bank of group.banks)
    if (!used.has(bank.kind)) rows.push(packet(bank));
  return rows;
}
