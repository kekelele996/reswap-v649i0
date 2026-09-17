/* eslint-disable no-console */
/**
 * storage.transaction 事务语义测试（内存 shim，无需浏览器）：
 * 运行：node scripts/test-transaction.mjs
 * 验证：1) 同 key 事务串行；2) 快照过期（revision 变化）整体回滚；3) mutator 抛错不写盘。
 */
import { build } from '/workspace/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const shimDir = mkdtempSync(join(tmpdir(), 'reswap-txn-shim-'));
const idbShim = join(shimDir, 'idb-keyval.js');
writeFileSync(
  idbShim,
  `
const mem = new Map();
export const get = async (k) => mem.get(k);
export const set = async (k, v) => { mem.set(k, v); };
export const del = async (k) => { mem.delete(k); };
export const _mem = mem;
`,
  'utf8',
);

const entry = join(shimDir, 'entry.ts');
writeFileSync(
  entry,
  `
import assert from 'node:assert/strict';
import { storage, STORAGE_KEYS } from '@/utils/storage';

const key = STORAGE_KEYS.appointments;
const empty = { revision: 0, appointments: [], occupied_slots: [] };
const getRev = (s) => s.revision;

// 1. 并发事务串行化：10 个并发 +1 不丢失更新
const jobs = [];
for (let i = 0; i < 10; i += 1) {
  jobs.push(storage.transaction(key, empty, (s) => ({ ...s, revision: s.revision + 1 }), { getRevision: getRev }));
}
const results = await Promise.all(jobs);
const finalRevisions = results.map((r) => r.revision).sort((a, b) => a - b);
assert.deepEqual(finalRevisions, Array.from({ length: 10 }, (_, i) => i + 1));
const finalData = await storage.get(key, empty);
assert.equal(finalData.revision, 10, '10 个并发 +1 全部生效，无丢失更新');

// 2. mutator 抛错 -> 不写盘（回滚）
const before = await storage.get(key, empty);
await assert.rejects(
  storage.transaction(key, empty, () => {
    throw new Error('业务失败，如时段冲突');
  }, { getRevision: getRev }),
  /业务失败/,
);
const after = await storage.get(key, empty);
assert.equal(after.revision, before.revision, '失败事务不改写任何数据');

// 3. 模拟过期快照：另一条写入推进 revision 后，旧快照提交被拒
await storage.transaction(key, empty, async (snapshot) => {
  // 在事务挂起期间，另一个标签页/路径已经写入新 revision
  await storage.set(key, { ...snapshot, revision: snapshot.revision + 1 });
  return { ...snapshot, revision: snapshot.revision + 999 };
}, { getRevision: getRev }).then(
  () => { throw new Error('应当因 revision 不匹配而失败'); },
  (err) => assert.match(err.message, /其他页面/),
);
const latest = await storage.get(key, empty);
assert.equal(latest.revision, 11, '过期快照被拒绝，未写入 revision 999');

console.log('事务层 3 个场景、5 条断言全部通过');
`,
  'utf8',
);

// 提供 localStorage 全局 shim
const localStorageShim = `
globalThis.localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
};
`;
const preludePath = join(shimDir, 'prelude.js');
writeFileSync(preludePath, localStorageShim, 'utf8');

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  alias: {
    '@': join(process.cwd(), 'src'),
    'idb-keyval': idbShim,
  },
  banner: { js: localStorageShim },
});

const outPath = join(shimDir, 'bundle.mjs');
writeFileSync(outPath, result.outputFiles[0].text, 'utf8');
await import(pathToFileURL(outPath).href);
