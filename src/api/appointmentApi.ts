import { exchangeApi } from '@/api/exchangeApi';
import {
  APPOINTMENT_ACTION_FLOW,
  AppointmentStatus,
} from '@/constants/appointment';
import { ExchangeStatus } from '@/constants/exchange';
import { PAGE_MESSAGES } from '@/constants/messages';
import type {
  Appointment,
  AppointmentDraft,
  AppointmentStoreDoc,
} from '@/models/appointment';
import { storage } from '@/utils/storage';
import {
  computeEndAt,
  hasOccupyingOverlap,
  isProposalOverdue,
} from '@/utils/appointmentTime';
import { isAppointmentParticipant } from '@/utils/appointmentValidators';
import { readAppointmentDoc, runAppointmentTransaction } from '@/utils/appointmentTx';

const DAY = 1000 * 60 * 60 * 24;
const isoAt = (offsetMs: number, hour: number, minute = 0) => {
  const date = new Date(Date.now() + offsetMs);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};

// 演示种子：
// - 与陈木木的交换已有双方确认、时间在三天后的预约（生效 + 占用）
// - 林小雨刚对另一段交换提出方案，等待 user_me 确认
const seedDoc = (): AppointmentStoreDoc => {
  const reseed = (globalThis as unknown as { __RESEED_APPOINTMENTS__?: () => AppointmentStoreDoc })
    .__RESEED_APPOINTMENTS__;
  return reseed ? reseed() : demoSeedDoc();
};

const demoSeedDoc = (): AppointmentStoreDoc => {
  const confirmedStart = isoAt(3 * DAY, 14);
  const proposedStart = isoAt(2 * DAY, 10, 30);
  const created = new Date(Date.now() - 1000 * 60 * 60 * 17).toISOString();
  const proposed = new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString();
  const appointments: Appointment[] = [
    {
      id: 'appointment_seed_confirmed',
      exchange_id: 'exchange_seed_accepted_1',
      from_user_id: 'user_me',
      to_user_id: 'user_chen',
      status: AppointmentStatus.CONFIRMED,
      start_at: confirmedStart,
      end_at: computeEndAt(confirmedStart),
      location: '苏州工业园 · 星湖街地铁站 A 口',
      note: '站内便利店面交，双方核对物品。',
      proposal_version: 1,
      proposed_by: 'user_me',
      from_confirmed: true,
      to_confirmed: true,
      from_confirmed_at: created,
      to_confirmed_at: new Date(Date.now() - 1000 * 60 * 60 * 16).toISOString(),
      cancel_reason: '',
      history: [],
      created_at: created,
      updated_at: new Date(Date.now() - 1000 * 60 * 60 * 16).toISOString(),
    },
    {
      id: 'appointment_seed_proposed',
      exchange_id: 'exchange_seed_accepted_2',
      from_user_id: 'user_lin',
      to_user_id: 'user_me',
      status: AppointmentStatus.PROPOSED,
      start_at: proposedStart,
      end_at: computeEndAt(proposedStart),
      location: '杭州西湖 · 凤起路地铁站',
      note: '我上午顺路，可以的话大家站内见。',
      proposal_version: 1,
      proposed_by: 'user_lin',
      from_confirmed: true,
      to_confirmed: false,
      from_confirmed_at: proposed,
      to_confirmed_at: '',
      cancel_reason: '',
      history: [],
      created_at: proposed,
      updated_at: proposed,
    },
  ];
  return {
    revision: 0,
    appointments,
    occupancy: [
      {
        appointment_id: 'appointment_seed_confirmed',
        exchange_id: 'exchange_seed_accepted_1',
        user_id: 'user_me',
        start_at: confirmedStart,
        end_at: computeEndAt(confirmedStart),
      },
      {
        appointment_id: 'appointment_seed_confirmed',
        exchange_id: 'exchange_seed_accepted_1',
        user_id: 'user_chen',
        start_at: confirmedStart,
        end_at: computeEndAt(confirmedStart),
      },
    ],
    audit_log: [],
  };
};

const findActiveByExchange = (doc: AppointmentStoreDoc, exchangeId: string) =>
  doc.appointments.find(
    (item) =>
      item.exchange_id === exchangeId &&
      (item.status === AppointmentStatus.PROPOSED || item.status === AppointmentStatus.CONFIRMED),
  );

// 交换一旦完成或被拒绝，其交接预约必须在对账中自动关闭并释放时段
const loadReconcileOptions = async () =>
  exchangeApi
    .list()
    .then((exchanges) => ({
      terminalExchangeIds: new Set(
        exchanges
          .filter(
            (exchange) =>
              exchange.status === ExchangeStatus.COMPLETED || exchange.status === ExchangeStatus.REJECTED,
          )
          .map((exchange) => exchange.id),
      ),
    }))
    .catch(() => ({}));

const applyProposal = (
  target: Appointment,
  draft: AppointmentDraft,
  actorId: string,
  isReschedule: boolean,
) => {
  if (isReschedule) {
    target.history.unshift({
      start_at: target.start_at,
      end_at: target.end_at,
      location: target.location,
      note: target.note,
      proposal_version: target.proposal_version,
      proposed_by: target.proposed_by,
      from_confirmed: target.from_confirmed,
      to_confirmed: target.to_confirmed,
      proposed_at: target.updated_at,
    });
    if (target.history.length > 10) target.history.length = 10;
  }
  target.start_at = draft.start_at;
  target.end_at = draft.end_at ?? computeEndAt(draft.start_at);
  target.location = draft.location.trim();
  target.note = draft.note?.trim() ?? '';
  target.proposal_version += 1;
  target.proposed_by = actorId;
  // 新方案必须双方重新确认：提议者自身确认，对方待确认
  target.from_confirmed = actorId === target.from_user_id;
  target.to_confirmed = actorId === target.to_user_id;
  const stamp = new Date().toISOString();
  target.from_confirmed_at = target.from_confirmed ? stamp : '';
  target.to_confirmed_at = target.to_confirmed ? stamp : '';
  target.status = AppointmentStatus.PROPOSED;
  target.cancel_reason = '';
  target.updated_at = stamp;
};

export const appointmentApi = {
  async list(): Promise<Appointment[]> {
    const doc = await readAppointmentDoc(seedDoc, await loadReconcileOptions());
    return [...doc.appointments].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  },

  async listByExchange(exchangeId: string): Promise<Appointment | undefined> {
    const doc = await readAppointmentDoc(seedDoc, await loadReconcileOptions());
    return findActiveByExchange(doc, exchangeId);
  },

  // 新建预约（接入已同意交换）。
  // 校验：交换存在且已同意、操作者是当事人、每段交换至多一个进行中预约。
  async create(draft: AppointmentDraft): Promise<Appointment> {
    const exchange = await exchangeApi.detail(draft.exchange_id);
    if (!exchange) throw new Error('交换记录不存在');
    if (exchange.status !== 'accepted') throw new Error(PAGE_MESSAGES.appointmentNeedAccepted);
    if (![exchange.from_user_id, exchange.to_user_id].includes(draft.proposed_by)) {
      throw new Error(PAGE_MESSAGES.appointmentNotParticipant);
    }

    const reconcileOptions = await loadReconcileOptions();
    return runAppointmentTransaction(seedDoc, ({ doc, audit }) => {
      const actorId = draft.proposed_by;
      if (findActiveByExchange(doc, draft.exchange_id)) {
        throw new Error(PAGE_MESSAGES.appointmentSingleActive);
      }
      const now = new Date().toISOString();
      const startAt = draft.start_at;
      const appointment: Appointment = {
        id: storage.createId('appointment'),
        exchange_id: draft.exchange_id,
        from_user_id: draft.from_user_id,
        to_user_id: draft.to_user_id,
        status: AppointmentStatus.PROPOSED,
        start_at: startAt,
        end_at: draft.end_at ?? computeEndAt(startAt),
        location: draft.location.trim(),
        note: draft.note?.trim() ?? '',
        proposal_version: 1,
        proposed_by: actorId,
        from_confirmed: actorId === draft.from_user_id,
        to_confirmed: actorId === draft.to_user_id,
        from_confirmed_at: actorId === draft.from_user_id ? now : '',
        to_confirmed_at: actorId === draft.to_user_id ? now : '',
        cancel_reason: '',
        history: [],
        created_at: now,
        updated_at: now,
      };
      doc.appointments.unshift(appointment);
      // 新建时未生效，不产生 occupancy；占用只可能在双方确认后随同一事务落盘
      audit(appointment, 'create', actorId, '新建交接预约，等待双方确认');
      return appointment;
    }, reconcileOptions);
  },

  // 任一方提出（或修改）时间地点：方案刷新、双方确认清零，需重新确认才生效
  async propose(appointmentId: string, actorId: string, draft: AppointmentDraft): Promise<Appointment> {
    const reconcileOptions = await loadReconcileOptions();
    return runAppointmentTransaction(seedDoc, ({ doc, audit }) => {
      const target = doc.appointments.find((item) => item.id === appointmentId);
      if (!target) throw new Error('预约不存在');
      if (!isAppointmentParticipant(target, actorId)) {
        throw new Error(PAGE_MESSAGES.appointmentNotParticipant);
      }
      if (!APPOINTMENT_ACTION_FLOW[target.status].includes(AppointmentStatus.PROPOSED)) {
        throw new Error('预约已终结，请重新发起预约');
      }
      if (isProposalOverdue(target.start_at)) throw new Error('原方案时间已过，请直接发起新预约');
      applyProposal(target, draft, actorId, true);
      // 改约即释放原占用：occupancy 由事务提交前的 reconcile 根据状态重算
      audit(target, 'reschedule', actorId, '提出新的时间地点，等待双方重新确认');
      return target;
    }, reconcileOptions);
  },

  // 一方确认当前方案；第二个人确认且无任何时段冲突时，整笔生效并落盘占用
  async confirm(appointmentId: string, actorId: string): Promise<Appointment> {
    const reconcileOptions = await loadReconcileOptions();
    return runAppointmentTransaction(seedDoc, ({ doc, audit }) => {
      const target = doc.appointments.find((item) => item.id === appointmentId);
      if (!target) throw new Error('预约不存在');
      if (!isAppointmentParticipant(target, actorId)) {
        throw new Error(PAGE_MESSAGES.appointmentNotParticipant);
      }
      if (target.status === AppointmentStatus.CANCELLED) throw new Error('预约已取消，请重新发起');
      if (target.status === AppointmentStatus.EXPIRED) throw new Error('预约已过期，请重新发起');
      if (isProposalOverdue(target.start_at)) {
        throw new Error('约定时间已过，不能再确认，请改约或重新发起');
      }

      const stamp = new Date().toISOString();
      if (actorId === target.from_user_id) {
        // 已生效后重复确认直接拒绝；待对方确认阶段重复点击视为幂等重试
        if (target.from_confirmed && target.status === AppointmentStatus.CONFIRMED) {
          throw new Error(PAGE_MESSAGES.appointmentDuplicateConfirm);
        }
        if (target.from_confirmed) return target;
        target.from_confirmed = true;
        target.from_confirmed_at = stamp;
      } else {
        if (target.to_confirmed && target.status === AppointmentStatus.CONFIRMED) {
          throw new Error(PAGE_MESSAGES.appointmentDuplicateConfirm);
        }
        if (target.to_confirmed) return target;
        target.to_confirmed = true;
        target.to_confirmed_at = stamp;
      }

      if (target.from_confirmed && target.to_confirmed) {
        // 生效前做最终冲突判定：任何一方已有时间重叠的生效预约，整笔回滚
        const range = { start_at: target.start_at, end_at: target.end_at };
        if (hasOccupyingOverlap(doc.occupancy, target.from_user_id, range, target.id)) {
          throw new Error(PAGE_MESSAGES.appointmentSlotConflict);
        }
        if (hasOccupyingOverlap(doc.occupancy, target.to_user_id, range, target.id)) {
          throw new Error(PAGE_MESSAGES.appointmentSlotConflict);
        }
        target.status = AppointmentStatus.CONFIRMED;
        target.updated_at = stamp;
        // occupancy 不手工追加：由提交前 reconcile 按 CONFIRMED 状态统一重算并随同一事务落盘
        audit(target, 'confirm', actorId, '双方确认完成，预约生效并锁定时段');
      } else {
        target.status = AppointmentStatus.PROPOSED;
        target.updated_at = stamp;
        audit(target, 'confirm', actorId, '单方已确认，等待对方');
      }
      return target;
    }, reconcileOptions);
  },

  // 取消：立即释放原时段
  async cancel(appointmentId: string, actorId: string, reason = ''): Promise<Appointment> {
    const reconcileOptions = await loadReconcileOptions();
    return runAppointmentTransaction(seedDoc, ({ doc, audit }) => {
      const target = doc.appointments.find((item) => item.id === appointmentId);
      if (!target) throw new Error('预约不存在');
      if (!isAppointmentParticipant(target, actorId)) {
        throw new Error(PAGE_MESSAGES.appointmentNotParticipant);
      }
      if (target.status === AppointmentStatus.CANCELLED || target.status === AppointmentStatus.EXPIRED) {
        return target; // 幂等：刷新/重复点击取消直接返回当前状态
      }
      target.status = AppointmentStatus.CANCELLED;
      target.cancel_reason = reason || (actorId === target.from_user_id ? '发起方取消' : '接收方取消');
      target.from_confirmed = false;
      target.to_confirmed = false;
      target.from_confirmed_at = '';
      target.to_confirmed_at = '';
      target.updated_at = new Date().toISOString();
      audit(target, 'cancel', actorId, target.cancel_reason);
      return target;
    }, reconcileOptions);
  },
};
