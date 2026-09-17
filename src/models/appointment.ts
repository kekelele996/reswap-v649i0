import type { AppointmentStatus } from '@/constants/appointment';

// 一段交换的交接预约。每段交换任意时刻至多有一条未终结（PROPOSED/CONFIRMED）预约。
// 双方都可以提出时间地点：每次提出都会刷新当前方案并清空双方确认；
// 只有双方都确认同一方案，status 才变为 CONFIRMED 并占用 [start_at, end_at) 时段。
export interface Appointment {
  id: string;
  exchange_id: string;
  from_user_id: string;
  to_user_id: string;
  status: AppointmentStatus;
  // 当前方案（最新一次提议）
  start_at: string;
  end_at: string;
  location: string;
  note: string;
  // 方案指纹：时间 + 地点 + 备注，确认标记始终绑定该指纹
  proposal_version: number;
  proposed_by: string;
  from_confirmed: boolean;
  to_confirmed: boolean;
  from_confirmed_at: string;
  to_confirmed_at: string;
  // 取消 / 过期原因说明，用于回读与审计
  cancel_reason: string;
  // 历史方案留痕（改约时追加），不参与占用
  history: AppointmentProposal[];
  created_at: string;
  updated_at: string;
}

export interface AppointmentProposal {
  start_at: string;
  end_at: string;
  location: string;
  note: string;
  proposal_version: number;
  proposed_by: string;
  from_confirmed: boolean;
  to_confirmed: boolean;
  proposed_at: string;
}

// 任一方提交的时间地点草案
export interface AppointmentProposalInput {
  start_at: string;
  end_at?: string;
  location: string;
  note?: string;
}

export type AppointmentDraft = Pick<
  Appointment,
  'exchange_id' | 'from_user_id' | 'to_user_id'
> &
  AppointmentProposalInput & {
    proposed_by: string;
  };

// 持久化在单个 key 下的整库文档：预约 + 时段占用 + 审计日志一次落盘
export interface AppointmentStoreDoc {
  revision: number;
  appointments: Appointment[];
  occupancy: AppointmentOccupancy[];
  audit_log: AppointmentAuditEntry[];
}

export interface AppointmentOccupancy {
  appointment_id: string;
  exchange_id: string;
  user_id: string;
  start_at: string;
  end_at: string;
}

export interface AppointmentAuditEntry {
  id: string;
  appointment_id: string;
  exchange_id: string;
  action: string;
  actor_id: string;
  at: string;
  detail: string;
}
