import { DatabaseSync, backup } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
const [from, to] = process.argv.slice(2);
if (!from || !to)
  throw new Error(
    "用法：npm run restore -- 备份.sqlite 新数据库.sqlite（不覆盖现有文件）",
  );
const source = resolve(from),
  target = resolve(to);
if (
  existsSync(target) ||
  existsSync(target + "-wal") ||
  existsSync(target + "-shm")
)
  throw new Error("目标或WAL/SHM已存在，不覆盖运行中的数据");
const db = new DatabaseSync(source, { readOnly: true });
let created = false;
try {
  if (
    db.prepare("PRAGMA quick_check").get().quick_check !== "ok" ||
    !db
      .prepare("SELECT name FROM sqlite_master WHERE name='yuanxiang_meta'")
      .get()
  )
    throw new Error("备份文件无效");
  mkdirSync(dirname(target), { recursive: true });
  closeSync(openSync(target, "wx", 0o600));
  created = true;
  await backup(db, target);
  chmodSync(target, 0o600);
  console.log(
    "已恢复到新文件：" +
      target +
      "。停止自己管理的服务后，将DB_PATH指向该文件并重新核对。",
  );
} catch (e) {
  if (created) unlinkSync(target);
  throw e;
} finally {
  db.close();
}
