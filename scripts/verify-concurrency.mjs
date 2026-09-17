// 并发场景验证：
// 1) 同一预约双方并发确认 -> 恰好生效一次；
// 2) 同一参与者作为两段交换的第二确认人，时段重叠并发确认 -> 最多一个生效。
const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};
globalThis.window = { setTimeout };
const idbMemory = new Map();
globalThis.__idbSet = async (k, v) => idbMemory.set(k, v);
globalThis.__idbGet = async (k) => idbMemory.get(k);
globalThis.__idbDel = async (k) => idbMemory.delete(k);

const assert = (await import('node:assert')).default;
const esbuild = await import('/workspace/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js');
const path = await import('node:path');
const { pathToFileURL } = await import('node:url');
const { writeFile } = await import('node:fs/promises');
const root = '/workspace/src';
const esbuildOpts = (entry) => ({
  entryPoints: [path.join(root, entry)],
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{
    name: 's',
    setup(b) {
      b.onResolve({ filter: /^idb-keyval$/ }, () => ({ path: 'x', namespace: 'st' }));
      b.onLoad({ namespace: 'st', filter: /.*/ }, () => ({
        contents: 'export const set=globalThis.__idbSet;export const get=globalThis.__idbGet;export const del=globalThis.__idbDel;',
        loader: 'js',
      }));
      b.onResolve({ filter: /^@\/.+/ }, (a) => ({ path: path.join(root, a.path.slice(2) + '.ts') }));
    },
  }],
});
const r = await esbuild.build(esbuildOpts('api/appointmentApi.ts'));
const rs = await esbuild.build(esbuildOpts('utils/storage.ts'));
await writeFile('/tmp/api-conc.mjs', r.outputFiles[0].text);
await writeFile('/tmp/storage-conc.mjs', rs.outputFiles[0].text);
const m = await import(pathToFileURL('/tmp/api-conc.mjs').href);
globalThis.__RESEED_APPOINTMENTS__ = () => ({ revision: 0, appointments: [], occupancy: [], audit_log: [] });
const { storage, STORAGE_KEYS } = await import(pathToFileURL('/tmp/storage-conc.mjs').href);

const A = 'A', B = 'B', C = 'C';
const now = new Date().toISOString();
await storage.set(STORAGE_KEYS.exchanges, [
  { id: 'e1', from_user_id: A, to_user_id: B, from_item_id: 'i1', to_item_id: 'i2', status: 'accepted', message: '', created_at: now, updated_at: now },
  { id: 'e2', from_user_id: C, to_user_id: A, from_item_id: 'i3', to_item_id: 'i1', status: 'accepted', message: '', created_at: now, updated_at: now },
]);
const inDays = (d, h = 14, min = 0) => { const x = new Date(Date.now() + d * 864e5); x.setHours(h, min, 0, 0); return x.toISOString(); };

// ---------- 场景 1：同一预约，双方并发点"确认" ----------
const ap1 = await m.appointmentApi.create({
  exchange_id: 'e1', from_user_id: A, to_user_id: B,
  start_at: inDays(1), location: '广场', proposed_by: A,
});
// 制造双方都未确认的瞬时状态（模拟两人同时点击前各自看到的页面）
{
  const env = JSON.parse(memory.get(STORAGE_KEYS.appointments));
  const t = env.payload.appointments.find((x) => x.id === ap1.id);
  t.from_confirmed = false; t.from_confirmed_at = '';
  memory.set(STORAGE_KEYS.appointments, JSON.stringify(env));
}
const [r1, r2] = await Promise.allSettled([
  m.appointmentApi.confirm(ap1.id, A),
  m.appointmentApi.confirm(ap1.id, B),
]);
console.log('A:', r1.status, r1.reason?.message ?? r1.value?.status);
console.log('B:', r2.status, r2.reason?.message ?? r2.value?.status);
{
  const env = JSON.parse(memory.get(STORAGE_KEYS.appointments));
  const t = env.payload.appointments.find((x) => x.id === ap1.id);
  assert.equal(t.status, 'confirmed');
  assert.equal(t.from_confirmed, true);
  assert.equal(t.to_confirmed, true);
  assert.equal(env.payload.occupancy.length, 2, '双方各占一条，无重复');
}
console.log('✓ 场景1：双方并发确认恰好生效一次，时段占用无重复\n');

// ---------- 场景 2：A 是两段交换的第二确认人，两个确认并发且时段重叠 ----------
// ap2: C<->A，C 已确认等 A；ap3: B<->A（新交换 e3），B 已确认等 A
await storage.set(STORAGE_KEYS.exchanges, [
  { id: 'e1', from_user_id: A, to_user_id: B, from_item_id: 'i1', to_item_id: 'i2', status: 'accepted', message: '', created_at: now, updated_at: now },
  { id: 'e2', from_user_id: C, to_user_id: A, from_item_id: 'i3', to_item_id: 'i1', status: 'accepted', message: '', created_at: now, updated_at: now },
  { id: 'e3', from_user_id: B, to_user_id: A, from_item_id: 'i2', to_item_id: 'i1', status: 'accepted', message: '', created_at: now, updated_at: now },
]);
const ap2 = await m.appointmentApi.create({
  exchange_id: 'e2', from_user_id: C, to_user_id: A,
  start_at: inDays(3, 9), location: '南站', proposed_by: C,
});
const ap3 = await m.appointmentApi.create({
  exchange_id: 'e3', from_user_id: B, to_user_id: A,
  start_at: inDays(5, 9), location: '北站', proposed_by: B,
});
// 把两者改成重叠时段、都只差 A 确认
{
  const env = JSON.parse(memory.get(STORAGE_KEYS.appointments));
  env.payload.appointments.forEach((x) => {
    if (x.id === ap2.id) {
      x.start_at = inDays(6, 10, 0); x.end_at = inDays(6, 11, 0);
      x.from_confirmed = true; x.from_confirmed_at = now;
      x.to_confirmed = false; x.to_confirmed_at = ''; x.status = 'proposed';
    }
    if (x.id === ap3.id) {
      x.start_at = inDays(6, 10, 30); x.end_at = inDays(6, 11, 30);
      x.from_confirmed = true; x.from_confirmed_at = now;
      x.to_confirmed = false; x.to_confirmed_at = ''; x.status = 'proposed';
    }
  });
  memory.set(STORAGE_KEYS.appointments, JSON.stringify(env));
}
const [c1, c2] = await Promise.allSettled([
  m.appointmentApi.confirm(ap2.id, A),
  m.appointmentApi.confirm(ap3.id, A),
]);
console.log('ap2:', c1.status, c1.reason?.message ?? c1.value?.status);
console.log('ap3:', c2.status, c2.reason?.message ?? c2.value?.status);
{
  const env = JSON.parse(memory.get(STORAGE_KEYS.appointments));
  const ts = env.payload.appointments.filter((x) => [ap2.id, ap3.id].includes(x.id));
  const confirmed = ts.filter((x) => x.status === 'confirmed');
  const proposed = ts.filter((x) => x.status === 'proposed');
  console.log('生效:', confirmed.map((x) => x.exchange_id).join(','), '| 待确认:', proposed.map((x) => x.exchange_id).join(','));
  assert.equal(confirmed.length, 1, '重叠时段只能有一个生效');
  assert.equal(proposed.length, 1, '另一个必须留在待确认，不能同时占用');
  // 生效预约占用 2 人（A 与对方）；待确认不占
  const slotStart = inDays(6, 10).slice(0, 13);
  const aOccupancy = env.payload.occupancy.filter(
    (o) => o.user_id === A && o.start_at.slice(0, 13) === slotStart,
  );
  assert.equal(aOccupancy.length, 1, 'A 在竞争时段只有一条占用');
}
console.log('✓ 场景2：同一参与者重叠时段并发确认，最多一个预约生效，另一个回退待确认');
