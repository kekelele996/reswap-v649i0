import { AppointmentStatus } from '@/constants/appointment';
import type {
  Appointment,
  AppointmentAuditEntry,
  AppointmentOccupancy,
  AppointmentStoreDoc,
} from '@/models/appointment';
import { readLocalPayload, storage, StorageConflictError, STORAGE_KEYS } from '@/utils/storage';

import { isConfirmedPastGrace, isProposalOverdue, isTimeOverlap } from '@/utils/appointmentTime';

const MAX_RETRIES = 5;
const MAX_AUDIT_LOG = 200;

let txChain: Promise<unknown> = Promise.resolve();

const emptyDoc = (): AppointmentStoreDoc => ({
  revision: 0,
  appointments: [],
  occupancy: [],
  audit_log: [],
});

const nowIso = () => new Date().toISOString();

export const createAuditEntry = (
  appointment: Pick<Appointment, 'id' | 'exchange_id'>,
  action: string,
  actorId: string,
  detail = '',
): AppointmentAuditEntry => ({
  id: storage.createId('audit'),
  appointment_id: appointment.id,
  exchange_id: appointment.exchange_id,
  action,
  actor_id: actorId,
  at: nowIso(),
  detail,
});

const cloneAppointments = (doc: AppointmentStoreDoc) =>
  doc.appointments.map((item) => ({
    ...item,
    history: item.history.map((entry) => ({ ...entry })),
  }));

// 由生效预约重算占用时段：每个 CONFIRMED 预约为双方各占一条
const rebuildOccupancy = (appointments: Appointment[]): AppointmentOccupancy[] =>
  appointments
    .filter((item) => item.status === AppointmentStatus.CONFIRMED)
    .flatMap((item) => [
      {
        appointment_id: item.id,
        exchange_id: item.exchange_id,
        user_id: item.from_user_id,
        start_at: item.start_at,
        end_at: item.end_at,
      },
      {
        appointment_id: item.id,
        exchange_id: item.exchange_id,
        user_id: item.to_user_id,
        start_at: item.start_at,
        end_at: item.end_at,
      },
    ]);

export interface ReconcileOptions {
  // 已终结（完成/拒绝）的交换 id：其上的任何活跃预约都应自动取消并释放时段
  terminalExchangeIds?: Set<string>;
}

// 不变量修复（重启回读 / 每次提交前都会跑）：
// 0. 交换已完成或被拒绝 → 关闭其活跃预约并释放时段；
// 1. 过期：待确认超过约定开始时间、生效超过宽限期 → 终结并释放时段；
// 2. 每段交换至多一条未终结预约，多余的最早之外的全部取消；
// 3. 状态与确认标记一致（只有 CONFIRMED 才能双方已确认；PROPOSED 不允许占时段）；
// 4. 同一参与者两个生效预约时间重叠：确认更早者保留，另一条退回待确认重走流程；
// 5. occupancy 必须且只能由 CONFIRMED 预约推导，任何漂移直接重算。
export const reconcileDoc = (
  doc: AppointmentStoreDoc,
  now: Date | number = Date.now(),
  options: ReconcileOptions = {},
): AppointmentStoreDoc => {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const appointments = cloneAppointments(doc);
  let touched = false;
  const log: AppointmentAuditEntry[] = [];

  const terminalize = (item: Appointment, status: AppointmentStatus, reason: string) => {
    touched = true;
    item.status = status;
    item.cancel_reason = reason;
    item.from_confirmed = false;
    item.to_confirmed = false;
    item.from_confirmed_at = '';
    item.to_confirmed_at = '';
    log.push(createAuditEntry(item, status, 'system', reason));
  };

  // 0. 交换本身已终结（完成/拒绝）：预约不再需要，立即释放时段
  if (options.terminalExchangeIds?.size) {
    appointments.forEach((item) => {
      if (
        (item.status === AppointmentStatus.PROPOSED || item.status === AppointmentStatus.CONFIRMED) &&
        options.terminalExchangeIds?.has(item.exchange_id)
      ) {
        terminalize(item, AppointmentStatus.CANCELLED, '交换流程已终结，交接预约自动关闭');
      }
    });
  }

  // 1. 过期释放
  appointments.forEach((item) => {
    if (item.status === AppointmentStatus.PROPOSED && isProposalOverdue(item.start_at, nowMs)) {
      terminalize(item, AppointmentStatus.EXPIRED, '约定时间已过，双方未完成确认');
    } else if (item.status === AppointmentStatus.CONFIRMED && isConfirmedPastGrace(item.start_at, nowMs)) {
      terminalize(item, AppointmentStatus.EXPIRED, '约定时间已过且未完成交接，自动释放时段');
    }
  });

  // 3. 标记与状态对齐（放在占用重算之前）
  // "第二个确认"与状态提升在同一事务提交；改约/取消对确认标记的清零由业务函数负责，
  // 这里不做猜测性清理，避免误杀"单方已确认、等待对方"的正常等待态。
  appointments.forEach((item) => {
    if (
      item.status === AppointmentStatus.CONFIRMED &&
      (!item.from_confirmed || !item.to_confirmed)
    ) {
      item.status = AppointmentStatus.PROPOSED;
      touched = true;
      log.push(createAuditEntry(item, AppointmentStatus.PROPOSED, 'system', '确认标记不完整，退回待确认'));
    }
    // 双方都确认同一方案即生效；由事务保证此时无时段重叠，占用在后面统一重算
    if (
      item.status === AppointmentStatus.PROPOSED &&
      item.from_confirmed &&
      item.to_confirmed &&
      !isProposalOverdue(item.start_at, nowMs)
    ) {
      item.status = AppointmentStatus.CONFIRMED;
      touched = true;
      log.push(createAuditEntry(item, AppointmentStatus.CONFIRMED, 'system', '补齐：双方确认完成，预约生效'));
    }
  });

  // 2. 单交换单活跃预约
  const activeByExchange = new Map<string, Appointment[]>();
  appointments.forEach((item) => {
    if (item.status === AppointmentStatus.PROPOSED || item.status === AppointmentStatus.CONFIRMED) {
      const list = activeByExchange.get(item.exchange_id) ?? [];
      list.push(item);
      activeByExchange.set(item.exchange_id, list);
    }
  });
  activeByExchange.forEach((list) => {
    if (list.length <= 1) return;
    list
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
      .slice(1)
      .forEach((item) => terminalize(item, AppointmentStatus.CANCELLED, '同一交换存在多个生效中预约，保留最早一条'));
  });

  // 4. 参与者时段重叠（只可能跨交换出现）
  const confirmed = appointments.filter((item) => item.status === AppointmentStatus.CONFIRMED);
  const resetIds = new Set<string>();
  for (let i = 0; i < confirmed.length; i += 1) {
    for (let j = i + 1; j < confirmed.length; j += 1) {
      const a = confirmed[i];
      const b = confirmed[j];
      if (resetIds.has(a.id) || resetIds.has(b.id)) continue;
      const sharedUser = [a.from_user_id, a.to_user_id].find((userId) =>
        [b.from_user_id, b.to_user_id].includes(userId),
      );
      if (!sharedUser) continue;
      if (!isTimeOverlap(a, b)) continue;
      // 先完成双方确认的保留；同刻则创建更早的保留
      const aReadyAt = Math.max(Date.parse(a.from_confirmed_at), Date.parse(a.to_confirmed_at));
      const bReadyAt = Math.max(Date.parse(b.from_confirmed_at), Date.parse(b.to_confirmed_at));
      const loser =
        Number.isFinite(aReadyAt) && Number.isFinite(bReadyAt)
          ? aReadyAt <= bReadyAt
            ? b
            : a
          : a.created_at <= b.created_at
            ? b
            : a;
      resetIds.add(loser.id);
      touched = true;
      log.push(
        createAuditEntry(
          loser,
          AppointmentStatus.PROPOSED,
          'system',
          `参与者 ${sharedUser} 存在两个时间重叠的生效预约，该条退回双方重新确认`,
        ),
      );
    }
  }
  resetIds.forEach((id) => {
    const target = appointments.find((item) => item.id === id);
    if (!target) return;
    target.status = AppointmentStatus.PROPOSED;
    target.from_confirmed = false;
    target.to_confirmed = false;
    target.from_confirmed_at = '';
    target.to_confirmed_at = '';
    target.cancel_reason = '';
  });
  // 冲突退回后占用必须再次重算
  const finalOccupancy = rebuildOccupancy(appointments);
  if (JSON.stringify(finalOccupancy) !== JSON.stringify(doc.occupancy)) touched = true;

  if (
    !touched &&
    !log.length &&
    JSON.stringify(finalOccupancy) === JSON.stringify(doc.occupancy)
  ) {
    return { ...doc, appointments };
  }
  const auditLog = [...log, ...(doc.audit_log ?? [])].slice(0, MAX_AUDIT_LOG);
  return {
    revision: doc.revision,
    appointments,
    occupancy: finalOccupancy,
    audit_log: auditLog,
  };
};

const normalizeShape = (snapshot: Partial<AppointmentStoreDoc> | null): AppointmentStoreDoc => ({
  revision: typeof snapshot?.revision === 'number' ? snapshot.revision : 0,
  appointments: Array.isArray(snapshot?.appointments) ? snapshot.appointments : [],
  occupancy: Array.isArray(snapshot?.occupancy) ? snapshot.occupancy : [],
  audit_log: Array.isArray(snapshot?.audit_log) ? snapshot.audit_log : [],
});

const loadDoc = (
  seed: () => AppointmentStoreDoc,
  options: ReconcileOptions,
): {
  raw: AppointmentStoreDoc;
  baseline: AppointmentStoreDoc;
  revision: number | null;
  seeded: boolean;
} => {
  const snapshot = readLocalPayload<AppointmentStoreDoc>(STORAGE_KEYS.appointments);
  if (snapshot && Array.isArray(snapshot.appointments)) {
    // raw：持久化原文（比较基准）；baseline：对账修复后的工作副本
    const raw = normalizeShape(snapshot);
    return { raw, baseline: reconcileDoc(raw, Date.now(), options), revision: raw.revision ?? 0, seeded: false };
  }
  // 首次使用：种子数据按不变量构造（无 CONFIRMED 即无占用），必须落盘
  return { raw: emptyDoc(), baseline: reconcileDoc(seed(), Date.now(), options), revision: null, seeded: true };
};

interface TransactionContext {
  doc: AppointmentStoreDoc;
  audit: (appointment: Pick<Appointment, 'id' | 'exchange_id'>, action: string, actorId: string, detail?: string) => void;
}

const comparable = (doc: AppointmentStoreDoc) =>
  JSON.stringify({
    appointments: doc.appointments,
    occupancy: doc.occupancy,
    audit_log: doc.audit_log,
  });

// 只读快照：跑一次不变量对账；有修复才落盘，无修复不产生写入（不会空转版本号）
export const readAppointmentDoc = async (
  seed: () => AppointmentStoreDoc,
  options: ReconcileOptions = {},
): Promise<AppointmentStoreDoc> =>
  runAppointmentTransaction(seed, ({ doc }) => doc, options);

// 串行化 + 乐观版本重试：同标签页的写操作排队执行；
// 与其他标签页发生版本冲突时，重新读取最新基线后整段重放（业务校验也会重跑）。
export const runAppointmentTransaction = async <T>(
  seed: () => AppointmentStoreDoc,
  mutate: (context: TransactionContext) => T,
  options: ReconcileOptions = {},
): Promise<T> => {
  const task = async (): Promise<T> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const { raw, baseline, revision, seeded } = loadDoc(seed, options);
      const next: AppointmentStoreDoc = {
        revision: baseline.revision,
        appointments: cloneAppointments(baseline),
        occupancy: baseline.occupancy.map((entry) => ({ ...entry })),
        audit_log: [...baseline.audit_log],
      };
      try {
        let result: T;
        // 业务函数只改 next；再次 reconcile 保证"预约/确认/占用"三者一次落盘且满足全部不变量
        const audit = (
          appointment: Pick<Appointment, 'id' | 'exchange_id'>,
          action: string,
          actorId: string,
          detail = '',
        ) => {
          next.audit_log.unshift(createAuditEntry(appointment, action, actorId, detail));
          if (next.audit_log.length > MAX_AUDIT_LOG) next.audit_log.length = MAX_AUDIT_LOG;
        };
        result = mutate({ doc: next, audit });
        const reconciled = reconcileDoc(next, Date.now(), options);
        // 以持久化原文为基准：业务无变更且无需修复时不落盘（刷新/轮询不空转版本号）；
        // reconcile 修复（过期释放/漂移自愈）必须与写操作一样提交，保证重启回读一致。
        if (!seeded && comparable(reconciled) === comparable(raw)) {
          return result;
        }
        const committed = await storage.commitChecked(
          STORAGE_KEYS.appointments,
          revision,
          reconciled,
        );
        if (committed.revision <= (revision ?? 0)) {
          throw new Error('提交版本未前进，已回滚');
        }
        return result;
      } catch (error) {
        lastError = error;
        if (!(error instanceof StorageConflictError)) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('预约事务冲突，多次重试后仍失败');
  };

  const result = txChain.then(task, task);
  txChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};
