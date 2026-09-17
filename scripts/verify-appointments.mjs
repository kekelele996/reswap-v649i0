// 预约事务核心不变量的端到端验证（Node 环境，模拟 localStorage / IndexedDB）。
// 运行：node --experimental-vm-modules 不需要；直接 tsx 未安装，故用 esbuild 即时转译。
import assert from 'node:assert';

// ---- 最小浏览器 API 模拟 ----
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
};
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `uuid_${Math.random().toString(16).slice(2)}` },
    configurable: true,
  });
}
globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };

// idb-keyval 的内存模拟（拦截 ESM 说明见 package 内无对应模块，这里直接打桩）
const idbMemory = new Map();
async function idbSet(key, value) {
  idbMemory.set(key, structuredClone(value));
}
async function idbGet(key) {
  return idbMemory.has(key) ? structuredClone(idbMemory.get(key)) : undefined;
}
async function idbDel(key) {
  idbMemory.delete(key);
}

// ---- 用 esbuild 把 TS 源码 bundle 成单个 ESM 临时文件执行 ----
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const root = path.resolve(process.cwd(), 'src');

const idbStubPlugin = {
  name: 'idb-stub',
  setup(b) {
    b.onResolve({ filter: /^idb-keyval$/ }, () => ({ path: 'idb-keyval', namespace: 'stub' }));
    b.onLoad({ namespace: 'stub', filter: /.*/ }, () => ({
      contents:
        'export const set = globalThis.__idbSet; export const get = globalThis.__idbGet; export const del = globalThis.__idbDel;',
      loader: 'js',
    }));
    b.onResolve({ filter: /^@\/.+/ }, (args) => ({
      path: path.join(root, `${args.path.slice(2)}.ts`),
    }));
    b.onResolve({ filter: /^dayjs$/ }, (args) => ({ path: require.resolve(args.path) }));
  },
};
globalThis.__idbSet = idbSet;
globalThis.__idbGet = idbGet;
globalThis.__idbDel = idbDel;

const compile = async (entry) => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [idbStubPlugin],
  });
  const tmp = path.resolve(process.cwd(), 'node_modules/.cache-test.mjs');
  await writeFile(tmp, result.outputFiles[0].text);
  return import(`${pathToFileURL(tmp).href}?t=${Date.now()}_${Math.random()}`);
};

const { appointmentApi } = await compile(path.join(root, 'api/appointmentApi.ts'));
const { storage, STORAGE_KEYS } = await compile(path.join(root, 'utils/storage.ts'));

// 注入空种子，避免演示数据干扰不变量校验（浏览器端永不设置该钩子）
globalThis.__RESEED_APPOINTMENTS__ = () => ({
  revision: 0,
  appointments: [],
  occupancy: [],
  audit_log: [],
});
memory.delete(STORAGE_KEYS.appointments);
idbMemory.delete(STORAGE_KEYS.appointments);

const A = 'user_alpha';
const B = 'user_beta';
const C = 'user_gamma';

await storage.set(STORAGE_KEYS.exchanges, [
  {
    id: 'ex_ab', from_user_id: A, to_user_id: B, from_item_id: 'i1', to_item_id: 'i2',
    status: 'accepted', message: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'ex_ac', from_user_id: A, to_user_id: C, from_item_id: 'i1', to_item_id: 'i3',
    status: 'accepted', message: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  {
    id: 'ex_pending', from_user_id: A, to_user_id: B, from_item_id: 'i1', to_item_id: 'i2',
    status: 'pending', message: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
]);

const inDays = (day, hour = 14, minute = 0) => {
  const d = new Date(Date.now() + day * 864e5);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

// 1. 非当事人不能建预约；未同意交换不能建
await assert.rejects(
  () => appointmentApi.create({
    exchange_id: 'ex_pending', from_user_id: A, to_user_id: B,
    start_at: inDays(1), location: '车站', proposed_by: A,
  }),
  /已同意/,
);
await assert.rejects(
  () => appointmentApi.create({
    exchange_id: 'ex_ab', from_user_id: A, to_user_id: B,
    start_at: inDays(1), location: '车站', proposed_by: C,
  }),
  /双方/,
);

// 2. A 建预约 -> PROPOSED，A 自动确认；不产生占用
const ap1 = await appointmentApi.create({
  exchange_id: 'ex_ab', from_user_id: A, to_user_id: B,
  start_at: inDays(1), location: '人民广场站', proposed_by: A,
});
assert.equal(ap1.status, 'proposed');
assert.equal(ap1.from_confirmed, true);
assert.equal(ap1.to_confirmed, false);
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(raw.payload.occupancy.length, 0, '待确认不应产生占用');
}

// 3. 重复确认在待对方阶段幂等：A 再确认不报错，且不产生任何变更/占用
await appointmentApi.confirm(ap1.id, A);
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(raw.payload.occupancy.length, 0, '重复确认不得写入占用');
  const self = raw.payload.appointments.find((x) => x.id === ap1.id);
  assert.equal(self.status, 'proposed');
  assert.equal(self.to_confirmed, false);
}
check('待确认阶段重复确认幂等，刷新/重试安全', () => {});

// 4. 单交换唯一进行中预约
await assert.rejects(
  () => appointmentApi.create({
    exchange_id: 'ex_ab', from_user_id: A, to_user_id: B,
    start_at: inDays(2), location: '别处', proposed_by: B,
  }),
  /进行中/,
);

// 5. B 确认 -> CONFIRMED，占用随同一事务落盘（双方各一条）
const confirmed1 = await appointmentApi.confirm(ap1.id, B);
assert.equal(confirmed1.status, 'confirmed');
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(raw.payload.occupancy.length, 2, '生效后应占用双方各一条');
  assert.deepEqual(raw.payload.occupancy.map((o) => o.user_id).sort(), [A, B]);
}
check('双方确认后一次落盘：预约生效 + 双方时段占用', () => {});

// 6. 生效后重复确认同样被拒
await assert.rejects(() => appointmentApi.confirm(ap1.id, B), /重复确认/);

// 7. 时间重叠：A 与 C 的交换约在同一时段，A 先确认、C 最后确认时应整体失败回滚
const ap2 = await appointmentApi.create({
  exchange_id: 'ex_ac', from_user_id: A, to_user_id: C,
  start_at: inDays(1, 14, 30), // 与 ap1 的 14:00-15:00 重叠
  location: '徐家汇站', proposed_by: C,
});
// C 是 to_user，建约时 C 自动确认，等待 A；A 确认触发冲突
await assert.rejects(() => appointmentApi.confirm(ap2.id, A), /重叠/);
{
  // 回滚验证：ap2 仍是 proposed 且 A 未确认；占用仍只有 ap1 两条
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  const ap2Now = raw.payload.appointments.find((x) => x.id === ap2.id);
  assert.equal(ap2Now.status, 'proposed');
  assert.equal(ap2Now.from_confirmed, false, '冲突失败必须回滚确认标记');
  assert.equal(raw.payload.occupancy.length, 2, '冲突失败不得写入新占用');
}
check('时间重叠确认失败：预约/确认/占用全部回滚', () => {});

// 8. C 改约到不重叠时间（自动确认），A 确认后成功
const docBefore = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
await appointmentApi.propose(ap2.id, C, {
  exchange_id: 'ex_ac', from_user_id: A, to_user_id: C,
  start_at: inDays(3, 10), location: '徐家汇站', note: '改期', proposed_by: C,
});
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  const ap2Now = raw.payload.appointments.find((x) => x.id === ap2.id);
  assert.equal(ap2Now.proposal_version, 2);
  assert.equal(ap2Now.to_confirmed, true);
  assert.equal(ap2Now.from_confirmed, false, '改约必须清空对方确认');
  assert.equal(ap2Now.history.length, 1, '旧方案进入历史');
}
await appointmentApi.confirm(ap2.id, A);
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  const ap2Now = raw.payload.appointments.find((x) => x.id === ap2.id);
  assert.equal(ap2Now.status, 'confirmed');
  assert.equal(raw.payload.occupancy.length, 4);
}
check('改约后双方重新确认才生效', () => {});

// 9. 对已生效预约改约：立即释放原占用，回到 PROPOSED 等双方重认
await appointmentApi.propose(ap1.id, A, {
  exchange_id: 'ex_ab', from_user_id: A, to_user_id: B,
  start_at: inDays(5, 9), location: '新地点', proposed_by: A,
});
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  const ap1Now = raw.payload.appointments.find((x) => x.id === ap1.id);
  assert.equal(ap1Now.status, 'proposed');
  assert.equal(ap1Now.to_confirmed, false);
  // ap1 的占用应消失，只剩 ap2（ex_ac）两条
  assert.deepEqual(
    raw.payload.occupancy.map((o) => o.exchange_id),
    ['ex_ac', 'ex_ac'],
  );
}
check('改约释放原时段，需要双方重新确认', () => {});

// 10. 取消释放时段（幂等）
await appointmentApi.cancel(ap2.id, A);
await appointmentApi.cancel(ap2.id, A); // 重复取消不报错
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(raw.payload.occupancy.length, 0, '取消后占用全部释放');
  const ap2Now = raw.payload.appointments.find((x) => x.id === ap2.id);
  assert.equal(ap2Now.status, 'cancelled');
}
check('取消预约释放原时段，重复取消幂等', () => {});

// 11. 取消后同一交换可以重新发起
const ap3 = await appointmentApi.create({
  exchange_id: 'ex_ac', from_user_id: A, to_user_id: C,
  start_at: inDays(6), location: '火车站', proposed_by: A,
});
assert.ok(ap3.id);
check('终结后同段交换可重新预约', () => {});

// 12. 过期释放：构造一个已过宽限期的 CONFIRMED，回读（list 触发 reconcile）后应变 EXPIRED
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  raw.payload.appointments.push({
    id: 'old_confirmed', exchange_id: 'ex_ab_legacy', from_user_id: A, to_user_id: B,
    status: 'confirmed', start_at: inDays(-1), end_at: inDays(-1),
    location: 'x', note: '', proposal_version: 1, proposed_by: A,
    from_confirmed: true, to_confirmed: true,
    from_confirmed_at: inDays(-2), to_confirmed_at: inDays(-2),
    cancel_reason: '', history: [], created_at: inDays(-2), updated_at: inDays(-2),
  });
  raw.payload.occupancy.push(
    { appointment_id: 'old_confirmed', exchange_id: 'ex_ab_legacy', user_id: A, start_at: inDays(-1), end_at: inDays(-1) },
    { appointment_id: 'old_confirmed', exchange_id: 'ex_ab_legacy', user_id: B, start_at: inDays(-1), end_at: inDays(-1) },
  );
  localStorage.setItem(STORAGE_KEYS.appointments, JSON.stringify(raw));
}
const listAfterExpiry = await appointmentApi.list();
assert.equal(listAfterExpiry.find((x) => x.id === 'old_confirmed').status, 'expired');
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(raw.payload.occupancy.filter((o) => o.appointment_id === 'old_confirmed').length, 0);
}
check('过期自动终结并释放时段，重启回读一致', () => {});

// 13. 漂移占用自愈：手工塞入脏占用（PROPOSED 却有 occupancy），回读后被清除
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  raw.payload.occupancy.push({
    appointment_id: ap3.id, exchange_id: 'ex_ac', user_id: A,
    start_at: inDays(6), end_at: inDays(6),
  });
  localStorage.setItem(STORAGE_KEYS.appointments, JSON.stringify(raw));
}
await appointmentApi.list();
{
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(raw.payload.occupancy.filter((o) => o.appointment_id === ap3.id).length, 0);
}
check('占用漂移在回读对账时自愈', () => {});

// 14. 版本冲突：提交前重读发现 revision 被外部抬高，必须自动重试成功
// ex_ab 上 ap1 改约后仍待双方确认，先取消腾出这一段交换
await appointmentApi.cancel(ap1.id, B);
{
  const origGetItem = localStorage.getItem.bind(localStorage);
  let reads = 0;
  let bumped = false;
  localStorage.getItem = (key) => {
    const value = origGetItem(key);
    if (key === STORAGE_KEYS.appointments && value) {
      reads += 1;
      // 本事务第 2 次读 = commitChecked 的提交前重读：模拟另一标签页已提交
      if (reads === 2 && !bumped) {
        bumped = true;
        const env = JSON.parse(value);
        env.revision += 3;
        env.payload.revision += 3;
        return JSON.stringify(env);
      }
    }
    return value;
  };
  const ap4 = await appointmentApi.create({
    exchange_id: 'ex_ab', from_user_id: A, to_user_id: B,
    start_at: inDays(8), location: '静安寺', proposed_by: B,
  });
  localStorage.getItem = origGetItem;
  assert.equal(bumped, true, '必须真实经历一次版本冲突');
  assert.equal(ap4.status, 'proposed');
  const raw2 = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.ok(raw2.payload.appointments.some((x) => x.location === '静安寺'), '重试后业务结果不得丢失');
}
check('跨标签页版本冲突自动重试，业务操作不丢失', () => {});

// 15. 交换完成（或拒绝）后，对账自动关闭其活跃预约并释放时段
{
  // 新建一段全新已同意交换并约到双方确认
  await storage.set(STORAGE_KEYS.exchanges, [
    ...JSON.parse(localStorage.getItem(STORAGE_KEYS.exchanges)).payload,
    {
      id: 'ex_finish', from_user_id: A, to_user_id: C, from_item_id: 'i9', to_item_id: 'i8',
      status: 'accepted', message: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ]);
  const fin = await appointmentApi.create({
    exchange_id: 'ex_finish', from_user_id: A, to_user_id: C,
    start_at: inDays(9), location: '终点站', proposed_by: A,
  });
  await appointmentApi.confirm(fin.id, C);
  const beforeRaw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(beforeRaw.payload.appointments.find((x) => x.id === fin.id).status, 'confirmed');
  assert.ok(beforeRaw.payload.occupancy.some((o) => o.appointment_id === fin.id));

  // 交换流转为 completed
  const exchangesNow = JSON.parse(localStorage.getItem(STORAGE_KEYS.exchanges));
  exchangesNow.payload = exchangesNow.payload.map((x) =>
    x.id === 'ex_finish' ? { ...x, status: 'completed' } : x,
  );
  localStorage.setItem(STORAGE_KEYS.exchanges, JSON.stringify(exchangesNow));

  await appointmentApi.list();
  const afterRaw = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments));
  assert.equal(afterRaw.payload.appointments.find((x) => x.id === fin.id).status, 'cancelled');
  assert.equal(afterRaw.payload.occupancy.filter((o) => o.appointment_id === fin.id).length, 0);
}
check('交换完成后自动关闭预约并释放时段', () => {});

console.log(`\n全部 ${passed} 项核心检查通过（另含 10+ 条 assert 隐式断言）`);
