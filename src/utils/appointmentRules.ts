import { APPOINTMENT_GRACE_MS, AppointmentStatus } from '@/constants/appointment';
import type {
  Appointment,
  AppointmentProposal,
  AppointmentStoreData,
  OccupiedSlot,
} from '@/models/appointment';

/** 两个时间区间是否重叠：相邻（前一段结束 == 后一段开始）不算重叠 */
export const isTimeOverlap = (
  a: { start_at: string; end_at: string },
  b: { start_at: string; end_at: string },
) => {
  const aStart = Date.parse(a.start_at);
  const aEnd = Date.parse(a.end_at);
  const bStart = Date.parse(b.start_at);
  const bEnd = Date.parse(b.end_at);
  return aStart < bEnd && bStart < aEnd;
};

/** 该参与者是否已存在时间重叠的生效时段占用 */
export const hasOverlappingSlot = (slots: OccupiedSlot[], userId: string, proposal: AppointmentProposal) =>
  slots.some(
    (slot) =>
      slot.user_id === userId &&
      isTimeOverlap(slot, {
        start_at: proposal.scheduled_start_at,
        end_at: proposal.scheduled_end_at,
      }),
  );

/** 预约当前是否已过期（含宽限期）。只有非终态预约需要判断。 */
export const isAppointmentExpired = (appointment: Appointment, at: number = Date.now()) => {
  if (appointment.status !== AppointmentStatus.PENDING && appointment.status !== AppointmentStatus.ACTIVE) {
    return false;
  }
  return Date.parse(appointment.scheduled_end_at) + APPOINTMENT_GRACE_MS < at;
};

/**
 * 方案指纹：同一参与者在同一预约上刷新 / 重试提交完全相同的方案时，
 * 依靠该指纹识别为重复请求（幂等），不会新建预约或重复确认。
 */
export const createProposalHash = (proposal: AppointmentProposal) => {
  const raw = [
    proposal.scheduled_start_at,
    proposal.scheduled_end_at,
    proposal.location.trim(),
    (proposal.note ?? '').trim(),
  ].join('|');
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(index);
    hash |= 0;
  }
  return `pp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

export const isSameProposal = (appointment: Appointment, proposal: AppointmentProposal) =>
  appointment.proposal_hash === createProposalHash(proposal);

/** 校验提案的时间地点，返回错误文案；合法返回空串 */
export const validateProposal = (proposal: AppointmentProposal, at: number = Date.now()) => {
  const start = Date.parse(proposal.scheduled_start_at);
  const end = Date.parse(proposal.scheduled_end_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return '请选择有效的交接时间';
  if (end <= start) return '结束时间必须晚于开始时间';
  if (start < at) return '交接开始时间不能早于当前时间';
  if (!proposal.location?.trim()) return '请填写交接地点';
  if (proposal.location.trim().length < 2) return '交接地点至少 2 个字';
  if (end - start > 1000 * 60 * 60 * 4) return '单次交接时长不能超过 4 小时';
  return '';
};

/** 一段交换当前是否已有非终态（待确认 / 已生效）预约 —— 每段交换至多一个 */
export const findOpenAppointment = (data: AppointmentStoreData, exchangeId: string) =>
  data.appointments.find(
    (appointment) =>
      appointment.exchange_id === exchangeId &&
      (appointment.status === AppointmentStatus.PENDING || appointment.status === AppointmentStatus.ACTIVE),
  );

/** 某条非终态预约是否已被该用户确认过当前版本 —— 重复确认直接幂等返回 */
export const hasUserConfirmed = (appointment: Appointment, userId: string) =>
  appointment.confirmed_user_ids.includes(userId);

/** 双方都确认后预约才生效 */
export const bothConfirmed = (appointment: Appointment) =>
  appointment.confirmed_user_ids.includes(appointment.from_user_id) &&
  appointment.confirmed_user_ids.includes(appointment.to_user_id);

/** 计算预约双方各自占用的时段 */
export const buildSlots = (appointment: Appointment): OccupiedSlot[] => [
  {
    appointment_id: appointment.id,
    exchange_id: appointment.exchange_id,
    user_id: appointment.from_user_id,
    start_at: appointment.scheduled_start_at,
    end_at: appointment.scheduled_end_at,
  },
  {
    appointment_id: appointment.id,
    exchange_id: appointment.exchange_id,
    user_id: appointment.to_user_id,
    start_at: appointment.scheduled_start_at,
    end_at: appointment.scheduled_end_at,
  },
];

/** 参与者是否是该预约的当事人 */
export const isAppointmentParty = (appointment: Appointment, userId: string) =>
  appointment.from_user_id === userId || appointment.to_user_id === userId;

/** 清理过期预约并同步释放其时段占用，返回新的数据快照（不改动入参） */
export const sweepExpired = (data: AppointmentStoreData, at: number = Date.now()): AppointmentStoreData => {
  const expiredIds = data.appointments
    .filter((appointment) => isAppointmentExpired(appointment, at))
    .map((appointment) => appointment.id);
  if (!expiredIds.length) return data;
  const expiredAtIso = new Date(at).toISOString();
  return {
    revision: data.revision,
    appointments: data.appointments.map((appointment) =>
      expiredIds.includes(appointment.id)
        ? {
            ...appointment,
            status: AppointmentStatus.EXPIRED,
            expired_at: expiredAtIso,
            updated_at: expiredAtIso,
          }
        : appointment,
    ),
    occupied_slots: data.occupied_slots.filter((slot) => !expiredIds.includes(slot.appointment_id)),
  };
};

/** 按交换 id 聚合最新一条预约（用于列表展示） */
export const latestAppointmentByExchange = (appointments: Appointment[]) => {
  const map = new Map<string, Appointment>();
  appointments.forEach((appointment) => {
    const existing = map.get(appointment.exchange_id);
    if (!existing || appointment.proposal_version > existing.proposal_version ||
        Date.parse(appointment.created_at) > Date.parse(existing.created_at)) {
      map.set(appointment.exchange_id, appointment);
    }
  });
  return map;
};
