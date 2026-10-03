/**
 * 验收脚本：在 data/amazon.db 的副本上模拟重跑 collect.sh 的搜索阶段，
 * 检查详情专属字段（variants / seller / shipping / review_count / buy box / prime / stock）
 * 是否被搜索路径的 upsert 抹掉。原库只读，全部写入发生在 /tmp 副本上。
 *
 * 用法（需先 npm run build）：
 *   node .scratch/detail-field-preservation/verify-detail-fields.mjs
 *
 * 期望：全部字段 KEEP。任一 LOST 表示搜索路径重新获得了覆盖详情字段的能力。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { SqlitePersistence } from '../../dist/db/persistence.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../data/amazon.db');
const DST = '/tmp/amazon-verify.db';

const FIELDS = [
  ['variants', 'variants IS NOT NULL'],
  ['seller_name', 'seller_name IS NOT NULL'],
  ['shipping_text', 'shipping_text IS NOT NULL'],
  ['review_count', 'review_count IS NOT NULL'],
  ['has_buy_box', 'has_buy_box = 1'],
  ['is_prime', 'is_prime = 1'],
  ['in_stock', 'in_stock = 1'],
];

const snapshot = (db) =>
  Object.fromEntries(
    FIELDS.map(([name, cond]) => [
      name,
      db.prepare(`SELECT COUNT(*) AS c FROM listings WHERE ${cond}`).get().c,
    ])
  );

const src = new Database(SRC, { readonly: true });
const total = src.prepare('SELECT COUNT(*) AS c FROM listings').get().c;
const before = snapshot(src);
await src.backup(DST);
src.close();

const db = new Database(DST);
const store = new SqlitePersistence(db);
const rows = db
  .prepare('SELECT marketplace, asin, title, href, image, rating, price_text, price_num FROM listings')
  .all();

const byMarket = new Map();
for (const r of rows) {
  if (!byMarket.has(r.marketplace)) byMarket.set(r.marketplace, []);
  byMarket.get(r.marketplace).push({
    marketplace: r.marketplace,
    asin: r.asin,
    title: r.title,
    href: r.href,
    image: r.image,
    rating: r.rating,
    priceText: r.price_text ?? '无价格',
    hasPrice: r.price_num !== null,
    priceNum: r.price_num,
  });
}

let saved = 0;
for (const [marketplace, listings] of byMarket) saved += store.saveScrapeResult(marketplace, listings);
db.close();

const verify = new Database(DST, { readonly: true });
const after = snapshot(verify);
verify.close();

console.log(`库中 listing 总数: ${total}`);
console.log(`搜索阶段 upsert: ${saved} 条\n`);
console.log('字段             重跑前 -> 重跑后   结论');
let lost = 0;
for (const [name] of FIELDS) {
  const b = before[name];
  const a = after[name];
  const keep = b === a;
  if (!keep) lost += 1;
  console.log(`${name.padEnd(16)} ${String(b).padStart(5)} -> ${String(a).padStart(5)}   ${keep ? 'KEEP' : 'LOST'}`);
}
console.log(`\n结果: ${lost === 0 ? '全部保留' : `${lost} 个字段丢失`}`);
process.exit(lost === 0 ? 0 : 1);
