/* eslint-disable no-console */
/**
 * 交接预约核心不变量测试（纯逻辑层，无需浏览器）：
 * 运行：node scripts/test-appointments.mjs
 * 用 esbuild 把 TS 源码（含 @ 路径别名）打成单文件 ESM 后执行。
 */
import { build } from '/workspace/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const entry = `
import assert from 'node:assert/strict';
import {
  isTimeOverlap,
  validateProposal,
  createProposalHash,
  sweepExpired,
  hasOverlappingSlot,
} from '@/utils/appointmentRules';
import {
  applyProposal,
  applyConfirm,
  applyReschedule,
  applyCancel,
} from '@/api/appointmentApi';
import { AppointmentStatus } from '@/constants/appointment';

const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();

const exchange = (overrides = {}) => ({
  id: 'ex_a',
  from_user_id: 'u1',
  to_user_id: 'u2',
  from_item_id: 'i1',
  to_item_id: 'i2',
  status: 'accepted',
  message: '',
  created_at: iso(NOW - 2 * HOUR),
  updated_at: iso(NOW - HOUR),
  ...overrides,
});

const proposal = (startOffsetH, endOffsetH, location = '地点 A') => ({
  scheduled_start_at: iso(NOW + startOffsetH * HOUR),
  scheduled_end_at: iso(NOW + endOffsetH * HOUR),
  location,
  note: '',
});

let idSeq = 0;
const idFactory = () => 'apt_' + (++idSeq);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log('  ✓ ' + name);
};
// 断言计数：每条 assert 执行成功即 +1
const check = new Proxy(assert, {
  get(target, prop) {
    return (...args) => {
      target[prop](...args);
      passed += 1;
    };
  },
});
const empty = () => ({ revision: 0, appointments: [], occupied_slots: [] });

// 1. 时间重叠规则
check.equal(isTimeOverlap(
  { start_at: iso(0), end_at: iso(HOUR) },
  { start_at: iso(HOUR), end_at: iso(2 * HOUR) },
), false, '相邻不算重叠');
check.equal(isTimeOverlap(
  { start_at: iso(0), end_at: iso(HOUR + 1) },
  { start_at: iso(HOUR), end_at: iso(2 * HOUR) },
), true, '相交算重叠');

// 2. 提案校验
check.equal(validateProposal({ scheduled_start_at: iso(NOW + HOUR), scheduled_end_at: iso(NOW + 2 * HOUR), location: 'A地' }, NOW), '');
check.notEqual(validateProposal({ scheduled_start_at: iso(NOW - HOUR), scheduled_end_at: iso(NOW + HOUR), location: 'A地' }, NOW), '');
check.notEqual(validateProposal({ scheduled_start_at: iso(NOW + 2 * HOUR), scheduled_end_at: iso(NOW + HOUR), location: 'A地' }, NOW), '');
check.notEqual(validateProposal({ scheduled_start_at: iso(NOW + HOUR), scheduled_end_at: iso(NOW + 2 * HOUR), location: 'x' }, NOW), '');

// 3. 新建提案：只有提出方单方确认，状态 PENDING，不占用任何时段
{
  const data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  const apt = data.appointments[0];
  check.equal(apt.status, AppointmentStatus.PENDING);
  check.deepEqual(apt.confirmed_user_ids, ['u1']);
  check.equal(data.occupied_slots.length, 0, '待确认不占用时段');
}

// 4. 双方都确认后才生效，并一次写入双方两个时段
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  const apt = data.appointments[0];
  check.equal(apt.status, AppointmentStatus.ACTIVE);
  check.ok(apt.activated_at);
  check.equal(data.occupied_slots.length, 2);
  check.deepEqual(data.occupied_slots.map((s) => s.user_id).sort(), ['u1', 'u2']);
}

// 5. 重复确认幂等：ACTIVE 后再确认仍是 ACTIVE，时段仍只有两个
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  const revisionApt = data.appointments[0];
  const again = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  check.equal(again.occupied_slots.length, 2);
  check.equal(again.appointments[0].status, AppointmentStatus.ACTIVE);
  check.equal(again.appointments[0].activated_at, revisionApt.activated_at);
  // 第一方重复确认也一样
  const again2 = applyConfirm(again, { exchangeId: 'ex_a', userId: 'u1' });
  check.equal(again2.occupied_slots.length, 2);
}

// 6. 每段交换只能有一个非终态预约：相同方案重复提交直接幂等，不新增记录
{
  const p = proposal(24, 25);
  let data = applyProposal(empty(), { exchange: exchange(), proposal: p, proposerId: 'u1', idFactory });
  const beforeId = data.appointments[0].id;
  data = applyProposal(data, { exchange: exchange(), proposal: { ...p }, proposerId: 'u1', idFactory });
  check.equal(data.appointments.length, 1);
  check.equal(data.appointments[0].id, beforeId);
  check.equal(data.occupied_slots.length, 0);
}

// 7. 双方各自可提方案：u1 提案后 u2 提出不同方案，版本 +1，确认名单只剩 u2
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25, '地点A'), proposerId: 'u1', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' }); // 生效
  check.equal(data.appointments[0].status, AppointmentStatus.ACTIVE);
  data = applyProposal(data, { exchange: exchange(), proposal: proposal(28, 29, '地点B'), proposerId: 'u2', idFactory });
  const apt = data.appointments[0];
  check.equal(apt.status, AppointmentStatus.PENDING);
  check.equal(apt.proposal_version, 2);
  check.deepEqual(apt.confirmed_user_ids, ['u2']);
  check.equal(data.occupied_slots.length, 0, '改约后旧时段立即释放');
}

// 8. 时间重叠的新预约不得生效：u1/u2 已有 ACTIVE，u2/u3 相同时间确认时整体失败回滚
{
  const ex1 = exchange();
  const ex2 = exchange({ id: 'ex_b', from_user_id: 'u3', to_user_id: 'u2' });
  let data = applyProposal(empty(), { exchange: ex1, proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  check.equal(data.occupied_slots.length, 2);
  // u3 与 u2 提出完全重叠时段
  data = applyProposal(data, { exchange: ex2, proposal: proposal(24, 25, '另一个地方'), proposerId: 'u3', idFactory });
  check.throws(() => applyConfirm(data, { exchangeId: 'ex_b', userId: 'u2' }), /冲突/);
  // 回滚：第二条仍 PENDING，时段仍只有 ex_a 的两个，无任何 ex_b 时段
  check.equal(data.appointments.find((a) => a.exchange_id === 'ex_b').status, AppointmentStatus.PENDING);
  check.equal(data.occupied_slots.length, 2);
  check.equal(data.occupied_slots.filter((s) => s.exchange_id === 'ex_b').length, 0);
}

// 9. 非重叠（相邻）时段可以生效
{
  const ex1 = exchange();
  const ex2 = exchange({ id: 'ex_b', from_user_id: 'u3', to_user_id: 'u2' });
  let data = applyProposal(empty(), { exchange: ex1, proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  data = applyProposal(data, { exchange: ex2, proposal: proposal(25, 26), proposerId: 'u3', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_b', userId: 'u2' });
  check.equal(data.occupied_slots.length, 4);
}

// 10. 改约必须重新双方确认，旧时段释放
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  data = applyReschedule(data, { exchangeId: 'ex_a', proposal: proposal(30, 31, '新地点'), userId: 'u1' });
  const apt = data.appointments[0];
  check.equal(apt.status, AppointmentStatus.PENDING);
  check.equal(apt.proposal_version, 2);
  check.deepEqual(apt.confirmed_user_ids, ['u1']);
  check.equal(data.occupied_slots.length, 0);
  // 只确认一方不生效
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u1' }); // 幂等，u1 已确认
  check.equal(data.appointments[0].status, AppointmentStatus.PENDING);
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  check.equal(data.appointments[0].status, AppointmentStatus.ACTIVE);
  check.equal(data.occupied_slots.length, 2);
}

// 11. 取消释放原时段
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2' });
  data = applyCancel(data, { exchangeId: 'ex_a', userId: 'u2' });
  check.equal(data.appointments[0].status, AppointmentStatus.CANCELLED);
  check.equal(data.appointments[0].cancelled_by, 'u2');
  check.equal(data.occupied_slots.length, 0);
  // 取消后可以重新发起，且新时段与旧记录共存（历史保留）
  data = applyProposal(data, { exchange: exchange(), proposal: proposal(40, 41), proposerId: 'u1', idFactory });
  check.equal(data.appointments.length, 2);
  check.equal(data.appointments[1].proposal_version, 1);
}

// 12. 过期释放时段：sweepExpired 把过期 PENDING/ACTIVE 标记 EXPIRED 并移除占用
{
  let data = applyProposal(empty(), {
    exchange: exchange(),
    proposal: { scheduled_start_at: iso(NOW - 2 * HOUR), scheduled_end_at: iso(NOW - HOUR), location: '旧地点' },
    proposerId: 'u1',
    idFactory,
    at: NOW - 3 * HOUR,
  });
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u2', at: NOW - 3 * HOUR });
  check.equal(data.appointments[0].status, AppointmentStatus.ACTIVE);
  check.equal(data.occupied_slots.length, 2);
  const swept = sweepExpired(data, NOW);
  check.equal(swept.appointments[0].status, AppointmentStatus.EXPIRED);
  check.ok(swept.appointments[0].expired_at);
  check.equal(swept.occupied_slots.length, 0);
  // 幂等：再扫一次不变
  const swept2 = sweepExpired(swept, NOW);
  check.equal(swept2, swept);
}

// 13. 过期后可重新发起预约（不与旧 EXPIRED 冲突）
{
  let data = applyProposal(empty(), {
    exchange: exchange(),
    proposal: { scheduled_start_at: iso(NOW - 2 * HOUR), scheduled_end_at: iso(NOW - HOUR), location: '旧地点' },
    proposerId: 'u1',
    idFactory,
    at: NOW - 3 * HOUR,
  });
  data = sweepExpired(data, NOW);
  data = applyProposal(data, { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  check.equal(data.appointments.filter((a) => a.status === AppointmentStatus.PENDING).length, 1);
  check.equal(data.appointments.length, 2);
}

// 14. 非当事人不能提案/确认/改约/取消
{
  const data0 = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  check.throws(() => applyConfirm(data0, { exchangeId: 'ex_a', userId: 'u9' }), /双方/);
  check.throws(() => applyReschedule(data0, { exchangeId: 'ex_a', proposal: proposal(26, 27), userId: 'u9' }), /双方/);
  check.throws(() => applyCancel(data0, { exchangeId: 'ex_a', userId: 'u9' }), /双方/);
  check.throws(
    () => applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u9', idFactory }),
    /双方/,
  );
}

// 15. 非 accepted 交换不能发起预约
check.throws(
  () => applyProposal(empty(), { exchange: exchange({ status: 'pending' }), proposal: proposal(24, 25), proposerId: 'u1', idFactory }),
  /已同意/,
);

// 16. proposal_hash 对相同内容稳定、不同内容不同
{
  const p1 = proposal(24, 25, '同地点');
  const p2 = proposal(24, 25, '同地点  '); // trim 后等价
  check.equal(createProposalHash(p1), createProposalHash(p2));
  check.notEqual(createProposalHash(p1), createProposalHash(proposal(24, 26, '同地点')));
}

// 17. hasOverlappingSlot 只针对同一参与者：别人占用不影响我
{
  const slots = [{ appointment_id: 'a', exchange_id: 'e', user_id: 'u2', start_at: iso(NOW + 24 * HOUR), end_at: iso(NOW + 25 * HOUR) }];
  check.equal(hasOverlappingSlot(slots, 'u1', proposal(24, 25)), false);
  check.equal(hasOverlappingSlot(slots, 'u2', proposal(24, 25)), true);
}

// 18. 双方各自确认：先 u1（提案方已自动确认），u2 确认前不生效
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u2', idFactory });
  check.deepEqual(data.appointments[0].confirmed_user_ids, ['u2']);
  check.equal(data.appointments[0].status, AppointmentStatus.PENDING);
  data = applyConfirm(data, { exchangeId: 'ex_a', userId: 'u1' });
  check.equal(data.appointments[0].status, AppointmentStatus.ACTIVE);
}

// 19. 改约相同内容幂等，不增版本
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  const v = data.appointments[0].proposal_version;
  const same = applyReschedule(data, { exchangeId: 'ex_a', proposal: proposal(24, 25), userId: 'u1' });
  check.equal(same.appointments[0].proposal_version, v);
  check.equal(same.occupied_slots.length, data.occupied_slots.length);
}

// 20. 待确认预约取消后重新提案，版本从 1 重新计数（旧记录保留为 CANCELLED）
{
  let data = applyProposal(empty(), { exchange: exchange(), proposal: proposal(24, 25), proposerId: 'u1', idFactory });
  data = applyCancel(data, { exchangeId: 'ex_a', userId: 'u1' });
  data = applyProposal(data, { exchange: exchange(), proposal: proposal(26, 27), proposerId: 'u2', idFactory });
  check.equal(data.appointments.length, 2);
  check.equal(data.appointments[1].proposal_version, 1);
  check.equal(data.appointments[1].proposed_by, 'u2');
}

console.log('全部 ' + passed + ' 组断言通过（含 20 个场景，约 60 条断言）');
`;

const NOW = new Date('2026-09-17T12:00:00.000Z').getTime();
globalThis.NOW = NOW;

const dir = mkdtempSync(join(tmpdir(), 'reswap-appt-test-'));
const entryPath = join(dir, 'entry.ts');
writeFileSync(entryPath, entry, 'utf8');

const result = await build({
  entryPoints: [entryPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  alias: { '@': join(process.cwd(), 'src') },
  define: { 'globalThis.NOW': String(NOW) },
});

const outPath = join(dir, 'bundle.mjs');
writeFileSync(outPath, result.outputFiles[0].text, 'utf8');

await import(pathToFileURL(outPath).href);
