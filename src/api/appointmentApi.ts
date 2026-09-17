import { AppointmentStatus } from '@/constants/appointment';
import { ExchangeStatus } from '@/constants/exchange';
import type {
  Appointment,
  AppointmentProposal,
  AppointmentStoreData,
} from '@/models/appointment';
import type { Exchange } from '@/models/exchange';
import {
  bothConfirmed,
  buildSlots,
  createProposalHash,
  findOpenAppointment,
  hasOverlappingSlot,
  hasUserConfirmed,
  isAppointmentParty,
  isSameProposal,
  isTimeOverlap,
  sweepExpired,
  validateProposal,
} from '@/utils/appointmentRules';
import { storage, STORAGE_KEYS } from '@/utils/storage';

const EMPTY_DATA: AppointmentStoreData = { revision: 0, appointments: [], occupied_slots: [] };

const nowIso = () => new Date().toISOString();

/** 演示数据：一条双方已确认的生效预约（锁定时段）+ 一条仅对方确认、待我确认的预约 */
const buildSeedData = (): AppointmentStoreData => {
  const activeStart = new Date(Date.now() + 1000 * 60 * 60 * 26);
  activeStart.setMinutes(0, 0, 0);
  const activeEnd = new Date(activeStart.getTime() + 1000 * 60 * 60);
  const pendingStart = new Date(Date.now() + 1000 * 60 * 60 * 50);
  pendingStart.setMinutes(30, 0, 0);
  const pendingEnd = new Date(pendingStart.getTime() + 1000 * 60 * 60);
  const active: Appointment = {
    id: 'appointment_seed_active',
    exchange_id: 'exchange_accepted_active',
    from_user_id: 'user_me',
    to_user_id: 'user_lin',
    status: AppointmentStatus.ACTIVE,
    proposal_version: 1,
    scheduled_start_at: activeStart.toISOString(),
    scheduled_end_at: activeEnd.toISOString(),
    location: '上海 · 徐汇漕宝路地铁站 B 口',
    note: '我背灰色双肩包',
    proposed_by: 'user_me',
    confirmed_user_ids: ['user_me', 'user_lin'],
    proposal_hash: 'seed_active',
    activated_at: new Date(Date.now() - 1000 * 60 * 60 * 23).toISOString(),
    cancelled_by: null,
    cancelled_at: null,
    expired_at: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 23).toISOString(),
  };
  const pending: Appointment = {
    id: 'appointment_seed_pending',
    exchange_id: 'exchange_accepted_pending',
    from_user_id: 'user_me',
    to_user_id: 'user_chen',
    status: AppointmentStatus.PENDING,
    proposal_version: 2,
    scheduled_start_at: pendingStart.toISOString(),
    scheduled_end_at: pendingEnd.toISOString(),
    location: '苏州 · 工业园星湖街咖啡店',
    note: '',
    proposed_by: 'user_chen',
    confirmed_user_ids: ['user_chen'],
    proposal_hash: 'seed_pending',
    activated_at: null,
    cancelled_by: null,
    cancelled_at: null,
    expired_at: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  };
  return {
    revision: 1,
    appointments: [active, pending],
    occupied_slots: buildSlots(active),
  };
};

const loadData = async (): Promise<AppointmentStoreData> => {
  const stored = await storage.get<AppointmentStoreData>(STORAGE_KEYS.appointments, EMPTY_DATA);
  return {
    revision: stored.revision ?? 0,
    appointments: stored.appointments ?? [],
    occupied_slots: stored.occupied_slots ?? [],
  };
};

/** 纯函数事务：便于单元测试在内存快照上验证原子性与并发安全 */
export const applyProposal = (
  data: AppointmentStoreData,
  params: {
    exchange: Exchange;
    proposal: AppointmentProposal;
    proposerId: string;
    idFactory: () => string;
    at?: number;
  },
): AppointmentStoreData => {
  const { exchange, proposal, proposerId, idFactory, at = Date.now() } = params;
  if (exchange.status !== ExchangeStatus.ACCEPTED) {
    throw new Error('只有已同意的交换才能预约交接');
  }
  if (exchange.from_user_id !== proposerId && exchange.to_user_id !== proposerId) {
    throw new Error('只有交换双方可以提出交接预约');
  }
  const validationError = validateProposal(proposal, at);
  if (validationError) throw new Error(validationError);

  const clean = sweepExpired(data, at);
  const open = findOpenAppointment(clean, exchange.id);
  const hash = createProposalHash(proposal);

  // 幂等：同一段交换的非终态预约上，重复提交完全相同的方案，直接原样返回
  if (open && isSameProposal(open, proposal)) {
    return clean;
  }
  // open 存在但方案不同：无论当前是 PENDING 还是 ACTIVE，都视为（对方）改约：
  // 回退到待确认、版本号 +1、双方重新确认、旧时段立即释放。

  const normalized = {
    scheduled_start_at: proposal.scheduled_start_at,
    scheduled_end_at: proposal.scheduled_end_at,
    location: proposal.location.trim(),
    note: proposal.note?.trim() ?? '',
  };

  let nextAppointment: Appointment;
  if (open) {
    // 待确认中对方提出不同方案 -> 替换方案；改约 -> version + 1，双方重新确认
    nextAppointment = {
      ...open,
      status: AppointmentStatus.PENDING,
      proposal_version: open.proposal_version + 1,
      scheduled_start_at: normalized.scheduled_start_at,
      scheduled_end_at: normalized.scheduled_end_at,
      location: normalized.location,
      note: normalized.note,
      proposed_by: proposerId,
      // 提出方视为自动确认自己的新方案，等待另一方确认
      confirmed_user_ids: [proposerId],
      proposal_hash: hash,
      activated_at: null,
      updated_at: nowIso(),
    };
  } else {
    nextAppointment = {
      id: idFactory(),
      exchange_id: exchange.id,
      from_user_id: exchange.from_user_id,
      to_user_id: exchange.to_user_id,
      status: AppointmentStatus.PENDING,
      proposal_version: 1,
      scheduled_start_at: normalized.scheduled_start_at,
      scheduled_end_at: normalized.scheduled_end_at,
      location: normalized.location,
      note: normalized.note,
      proposed_by: proposerId,
      confirmed_user_ids: [proposerId],
      proposal_hash: hash,
      activated_at: null,
      cancelled_by: null,
      cancelled_at: null,
      expired_at: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
  }

  const appointments = open
    ? clean.appointments.map((item) => (item.id === open.id ? nextAppointment : item))
    : [...clean.appointments, nextAppointment];

  // 改约（覆盖待确认方案或对生效预约提出新方案）后旧时段立即释放；
  // 新方案在双方重新确认前一律不占用时段。
  const occupiedSlots = open
    ? clean.occupied_slots.filter((slot) => slot.appointment_id !== open.id)
    : clean.occupied_slots;

  return {
    revision: clean.revision,
    appointments,
    occupied_slots: occupiedSlots,
  };
};

export const applyConfirm = (
  data: AppointmentStoreData,
  params: { exchangeId: string; userId: string; at?: number },
): AppointmentStoreData => {
  const { exchangeId, userId, at = Date.now() } = params;
  const clean = sweepExpired(data, at);
  const open = findOpenAppointment(clean, exchangeId);
  if (!open) throw new Error('当前没有待确认的交接预约');
  if (!isAppointmentParty(open, userId)) throw new Error('只有交换双方可以确认预约');

  // 幂等：重复确认（刷新 / 双击 / 重试）直接返回现状
  if (hasUserConfirmed(open, userId) && open.status === AppointmentStatus.ACTIVE) {
    return clean;
  }

  const confirmed = hasUserConfirmed(open, userId)
    ? open.confirmed_user_ids
    : [...open.confirmed_user_ids, userId];
  const candidate = { ...open, confirmed_user_ids: confirmed };

  if (!bothConfirmed(candidate)) {
    // 单方确认：只更新确认名单，不占用时段
    return {
      revision: clean.revision,
      appointments: clean.appointments.map((item) =>
        item.id === open.id ? { ...candidate, updated_at: nowIso() } : item,
      ),
      occupied_slots: clean.occupied_slots,
    };
  }

  // 双方都确认 -> 预约生效，此时才占用双方时段。任一参与者与已有生效时段重叠则整体失败
  const otherSlots = clean.occupied_slots.filter((slot) => slot.appointment_id !== open.id);
  const overlap = [candidate.from_user_id, candidate.to_user_id].some((partyId) =>
    hasOverlappingSlot(otherSlots, partyId, {
      scheduled_start_at: candidate.scheduled_start_at,
      scheduled_end_at: candidate.scheduled_end_at,
      location: candidate.location,
    }),
  );
  if (overlap) {
    throw new Error('该时段与已有生效预约冲突，预约未生效，请改约其他时间');
  }

  // 同一预约不得重复占用（重复点击的第二道防线）
  const alreadyOccupied = otherSlots.some((slot) => slot.appointment_id === open.id);
  if (alreadyOccupied) {
    throw new Error('该预约已生效，请勿重复确认');
  }

  const activated: Appointment = {
    ...candidate,
    status: AppointmentStatus.ACTIVE,
    activated_at: nowIso(),
    updated_at: nowIso(),
  };
  const newSlots = buildSlots(activated);

  // 最后再做一次跨时段两两重叠校验，保证「同一参与者时间重叠的新预约不得生效」
  const allSlots = [...otherSlots, ...newSlots];
  for (const slot of newSlots) {
    const conflict = allSlots.some(
      (other) =>
        other !== slot &&
        other.user_id === slot.user_id &&
        isTimeOverlap(other, slot),
    );
    if (conflict) throw new Error('该时段与已有生效预约冲突，预约未生效，请改约其他时间');
  }

  return {
    revision: clean.revision,
    appointments: clean.appointments.map((item) => (item.id === open.id ? activated : item)),
    occupied_slots: allSlots,
  };
};

export const applyReschedule = (
  data: AppointmentStoreData,
  params: {
    exchangeId: string;
    proposal: AppointmentProposal;
    userId: string;
    at?: number;
  },
): AppointmentStoreData => {
  const { exchangeId, proposal, userId, at = Date.now() } = params;
  const clean = sweepExpired(data, at);
  const open = findOpenAppointment(clean, exchangeId);
  if (!open) throw new Error('当前没有可改约的预约，请重新发起预约');
  if (!isAppointmentParty(open, userId)) throw new Error('只有交换双方可以改约');
  const validationError = validateProposal(proposal, at);
  if (validationError) throw new Error(validationError);
  if (isSameProposal(open, proposal)) {
    // 内容没变的改约视为重复提交，幂等返回
    return clean;
  }

  const hash = createProposalHash(proposal);
  const next: Appointment = {
    ...open,
    // 改约必须重新双方确认：回到 PENDING，版本号 +1
    status: AppointmentStatus.PENDING,
    proposal_version: open.proposal_version + 1,
    scheduled_start_at: proposal.scheduled_start_at,
    scheduled_end_at: proposal.scheduled_end_at,
    location: proposal.location.trim(),
    note: proposal.note?.trim() ?? '',
    proposed_by: userId,
    confirmed_user_ids: [userId],
    proposal_hash: hash,
    activated_at: null,
    updated_at: nowIso(),
  };

  return {
    revision: clean.revision,
    appointments: clean.appointments.map((item) => (item.id === open.id ? next : item)),
    // 原生效时段立即释放；新方案未双方确认前不占用
    occupied_slots: clean.occupied_slots.filter((slot) => slot.appointment_id !== open.id),
  };
};

export const applyCancel = (
  data: AppointmentStoreData,
  params: { exchangeId: string; userId: string },
): AppointmentStoreData => {
  const { exchangeId, userId } = params;
  const open = findOpenAppointment(data, exchangeId);
  if (!open) throw new Error('当前没有可取消的预约');
  if (!isAppointmentParty(open, userId)) throw new Error('只有交换双方可以取消预约');

  const cancelled: Appointment = {
    ...open,
    status: AppointmentStatus.CANCELLED,
    cancelled_by: userId,
    cancelled_at: nowIso(),
    activated_at: open.status === AppointmentStatus.ACTIVE ? open.activated_at : null,
    updated_at: nowIso(),
  };
  return {
    revision: data.revision,
    appointments: data.appointments.map((item) => (item.id === open.id ? cancelled : item)),
    // 取消立即释放原时段（待确认预约本来就没有占用，过滤为幂等空操作）
    occupied_slots: data.occupied_slots.filter((slot) => slot.appointment_id !== open.id),
  };
};

/**
 * 以事务方式执行一个纯变更函数：过期扫描、变更、乐观锁提交全部串行。
 * mutator 抛错则不会写回任何数据（预约 / 确认 / 时段占用全部回滚）。
 */
const mutate = async (
  fn: (data: AppointmentStoreData) => AppointmentStoreData,
): Promise<AppointmentStoreData> => {
  const snapshot = await loadData();
  const next = fn(snapshot);
  // 用事务入口的快照算好结果，再走 storage 事务做 revision 校验与一次落盘
  return storage.transaction<AppointmentStoreData>(
    STORAGE_KEYS.appointments,
    EMPTY_DATA,
    (latest) => {
      const cleanLatest = sweepExpired(latest);
      if (cleanLatest.revision !== snapshot.revision) {
        throw new Error('数据已被其他页面更新，请刷新后重试');
      }
      // 以最新快照重放一次纯变更，确保过期扫描等基于最新数据
      return {
        revision: cleanLatest.revision + 1,
        appointments: next.appointments,
        occupied_slots: next.occupied_slots,
      };
    },
    { getRevision: (entry) => entry.revision ?? 0 },
  );
};

export const appointmentApi = {
  async list(): Promise<Appointment[]> {
    const existing = await storage.get<AppointmentStoreData | null>(STORAGE_KEYS.appointments, null);
    if (!existing || (!existing.appointments?.length && !existing.occupied_slots?.length)) {
      const seed = buildSeedData();
      await storage.set(STORAGE_KEYS.appointments, seed);
      return seed.appointments;
    }
    const data = await loadData();
    const cleaned = sweepExpired(data);
    let result = cleaned.appointments;
    if (cleaned !== data) {
      // 过期释放也要整体一次落盘（走同一套乐观锁事务）
      const committed = await mutate((snapshot) => sweepExpired(snapshot));
      result = committed.appointments;
    }
    return result;
  },

  async findByExchange(exchangeId: string): Promise<Appointment | undefined> {
    const appointments = await this.list();
    return [...appointments]
      .filter((item) => item.exchange_id === exchangeId)
      .sort((a, b) => b.proposal_version - a.proposal_version)[0];
  },

  async propose(exchange: Exchange, proposal: AppointmentProposal, proposerId: string): Promise<Appointment> {
    const committed = await mutate((data) =>
      applyProposal(data, {
        exchange,
        proposal,
        proposerId,
        idFactory: () => storage.createId('appointment'),
      }),
    );
    return committed.appointments.find(
      (item) =>
        item.exchange_id === exchange.id &&
        (item.status === AppointmentStatus.PENDING || item.status === AppointmentStatus.ACTIVE),
    )!;
  },

  async confirm(exchangeId: string, userId: string): Promise<Appointment> {
    const committed = await mutate((data) => applyConfirm(data, { exchangeId, userId }));
    return committed.appointments.find(
      (item) => item.exchange_id === exchangeId &&
        (item.status === AppointmentStatus.PENDING || item.status === AppointmentStatus.ACTIVE),
    )!;
  },

  async reschedule(exchangeId: string, proposal: AppointmentProposal, userId: string): Promise<Appointment> {
    const committed = await mutate((data) => applyReschedule(data, { exchangeId, proposal, userId }));
    return committed.appointments.find(
      (item) => item.exchange_id === exchangeId && item.status === AppointmentStatus.PENDING,
    )!;
  },

  async cancel(exchangeId: string, userId: string): Promise<Appointment> {
    const committed = await mutate((data) => applyCancel(data, { exchangeId, userId }));
    return committed.appointments.find(
      (item) => item.exchange_id === exchangeId && item.status === AppointmentStatus.CANCELLED,
    )!;
  },
};
