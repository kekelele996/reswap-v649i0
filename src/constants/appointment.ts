export enum AppointmentStatus {
  /** 已有方案，等待双方确认；此状态不占用时段 */
  PENDING = 'pending',
  /** 双方均已确认，预约生效并占用时段 */
  ACTIVE = 'active',
  /** 任一方取消，原时段释放 */
  CANCELLED = 'cancelled',
  /** 开始时间已过仍未完成交接，过期释放原时段 */
  EXPIRED = 'expired',
}

export const APPOINTMENT_STATUS_OPTIONS = [
  { label: '待双方确认', value: AppointmentStatus.PENDING },
  { label: '已生效', value: AppointmentStatus.ACTIVE },
  { label: '已取消', value: AppointmentStatus.CANCELLED },
  { label: '已过期', value: AppointmentStatus.EXPIRED },
];

/** 交接预约状态机：ACTIVE 只能由 PENDING 双方确认后进入，不可逆向跳转 */
export const APPOINTMENT_ACTION_FLOW: Record<AppointmentStatus, AppointmentStatus[]> = {
  [AppointmentStatus.PENDING]: [AppointmentStatus.ACTIVE, AppointmentStatus.CANCELLED, AppointmentStatus.EXPIRED],
  [AppointmentStatus.ACTIVE]: [AppointmentStatus.PENDING, AppointmentStatus.CANCELLED, AppointmentStatus.EXPIRED],
  [AppointmentStatus.CANCELLED]: [AppointmentStatus.PENDING],
  [AppointmentStatus.EXPIRED]: [AppointmentStatus.PENDING],
};

/** 预约开始时间之后允许迟到完成交接的宽限期；超过该时刻仍视为过期 */
export const APPOINTMENT_GRACE_MS = 1000 * 60 * 30;

export const APPOINTMENT_STORAGE_HINTS = {
  statusKey: 'reswap:appointments',
  statusTouchedBy: [
    'models/appointment.ts',
    'stores/appointmentStore.ts',
    'components/common/AppointmentPanel.vue',
    'utils/appointmentRules.ts',
  ],
};
