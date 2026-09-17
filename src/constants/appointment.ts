// 交接预约状态机：
// PROPOSED  已创建/有人提出新方案，等待双方确认（未占用时段）
// CONFIRMED 双方均已确认当前方案，预约生效（占用时段）
// CANCELLED 任一方取消（释放原时段，终态）
// EXPIRED   约定时间已过且未走完确认/交接（释放原时段，终态）
export enum AppointmentStatus {
  PROPOSED = 'proposed',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export const APPOINTMENT_STATUS_OPTIONS = [
  { label: '待双方确认', value: AppointmentStatus.PROPOSED },
  { label: '已生效', value: AppointmentStatus.CONFIRMED },
  { label: '已取消', value: AppointmentStatus.CANCELLED },
  { label: '已过期', value: AppointmentStatus.EXPIRED },
];

// 每个交换只能有一个未终结预约；终结后可用同 exchange_id 再约
export const ACTIVE_APPOINTMENT_STATUSES = [AppointmentStatus.PROPOSED, AppointmentStatus.CONFIRMED];

export const OCCUPYING_APPOINTMENT_STATUSES = [AppointmentStatus.CONFIRMED];

// 默认交接时长（分钟），用于把"开始时间"换算成占用时段 [start_at, end_at)
export const DEFAULT_HANDOVER_MINUTES = 60;

// 已生效预约在约定开始时间过后多久自动过期（分钟），过期即释放时段
export const CONFIRMED_GRACE_MINUTES = 120;

// 最早可约：当前时间 + 该最小提前量（分钟）
export const MIN_APPOINTMENT_LEAD_MINUTES = 30;

export const APPOINTMENT_ACTION_FLOW: Record<AppointmentStatus, AppointmentStatus[]> = {
  // PROPOSED 可：双方确认生效、任一方取消、过期、任一方提出新方案（回到 PROPOSED，清空旧确认）
  [AppointmentStatus.PROPOSED]: [
    AppointmentStatus.PROPOSED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.EXPIRED,
  ],
  // CONFIRMED 可：改约退回 PROPOSED、取消、过期
  [AppointmentStatus.CONFIRMED]: [AppointmentStatus.PROPOSED, AppointmentStatus.CANCELLED, AppointmentStatus.EXPIRED],
  [AppointmentStatus.CANCELLED]: [AppointmentStatus.PROPOSED],
  [AppointmentStatus.EXPIRED]: [AppointmentStatus.PROPOSED],
};

export const APPOINTMENT_STORAGE_HINTS = {
  statusKey: 'reswap:appointments',
  statusTouchedBy: [
    'models/appointment.ts',
    'api/appointmentApi.ts',
    'stores/appointmentStore.ts',
    'components/common/AppointmentPanel.vue',
    'components/common/ExchangeCard.vue',
  ],
};
