import { AppointmentStatus } from '@/constants/appointment';

/**
 * 一次交换（Exchange）可产生多条交接预约记录（改约 / 取消 / 过期均保留历史），
 * 但任意时刻同一段交换至多只有一条处于「非终态」（pending / active）的预约。
 */
export interface Appointment {
  id: string;
  exchange_id: string;
  from_user_id: string;
  to_user_id: string;
  status: AppointmentStatus;
  /** 当前方案的版本：新建为 1，每改约一次 +1，改约后需要双方重新确认 */
  proposal_version: number;
  scheduled_start_at: string;
  scheduled_end_at: string;
  location: string;
  note: string;
  /** 最新方案的提出方 */
  proposed_by: string;
  /** 已对当前 proposal_version 确认的用户 id；达到双方即生效 */
  confirmed_user_ids: string[];
  /** 最新方案内容指纹，用于刷新/重试时幂等去重 */
  proposal_hash: string;
  /** 生效（双方确认完成）时间，仅 ACTIVE / CANCELLED / EXPIRED 会有值 */
  activated_at: string | null;
  /** 取消方；取消后原时段立即释放 */
  cancelled_by: string | null;
  cancelled_at: string | null;
  /** 过期扫描写入，仅用于审计展示 */
  expired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentProposal {
  scheduled_start_at: string;
  scheduled_end_at: string;
  location: string;
  note?: string;
}

export type AppointmentDraft = Omit<
  Appointment,
  | 'id'
  | 'status'
  | 'proposal_version'
  | 'proposed_by'
  | 'confirmed_user_ids'
  | 'proposal_hash'
  | 'activated_at'
  | 'cancelled_by'
  | 'cancelled_at'
  | 'expired_at'
  | 'created_at'
  | 'updated_at'
> &
  Partial<Pick<Appointment, 'note'>>;

/** 一个已生效预约占用的时段；与预约整体一次落盘，取消 / 过期后随之移除 */
export interface OccupiedSlot {
  appointment_id: string;
  exchange_id: string;
  user_id: string;
  start_at: string;
  end_at: string;
}

/** 预约存储整体结构：预约记录 + 时段占用 + 乐观锁版本，三者必须一起提交 */
export interface AppointmentStoreData {
  revision: number;
  appointments: Appointment[];
  occupied_slots: OccupiedSlot[];
}

export const isTerminalAppointment = (appointment: Appointment) =>
  appointment.status === AppointmentStatus.CANCELLED || appointment.status === AppointmentStatus.EXPIRED;
