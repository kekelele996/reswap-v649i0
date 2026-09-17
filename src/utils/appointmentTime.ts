import dayjs from 'dayjs';

import {
  CONFIRMED_GRACE_MINUTES,
  DEFAULT_HANDOVER_MINUTES,
  MIN_APPOINTMENT_LEAD_MINUTES,
} from '@/constants/appointment';
import type { AppointmentOccupancy } from '@/models/appointment';

export interface TimeRange {
  start_at: string;
  end_at: string;
}

const toTime = (value: string) => dayjs(value).valueOf();

// 两个半开区间 [start, end) 是否重叠（首尾相接不算重叠）
export const isTimeOverlap = (a: TimeRange, b: TimeRange): boolean => {
  const aStart = toTime(a.start_at);
  const aEnd = toTime(a.end_at);
  const bStart = toTime(b.start_at);
  const bEnd = toTime(b.end_at);
  return aStart < bEnd && bStart < aEnd;
};

// 该参与者是否已存在时间重叠的占用时段
export const hasOccupyingOverlap = (
  occupancies: AppointmentOccupancy[],
  userId: string,
  range: TimeRange,
  ignoreAppointmentId = '',
): boolean =>
  occupancies.some(
    (entry) =>
      entry.appointment_id !== ignoreAppointmentId &&
      entry.user_id === userId &&
      isTimeOverlap(entry, range),
  );

export const computeEndAt = (startAt: string, minutes = DEFAULT_HANDOVER_MINUTES): string =>
  dayjs(startAt).add(minutes, 'minute').toISOString();

export const isFutureSlot = (startAt: string, now = Date.now()): boolean =>
  toTime(startAt) >= now + MIN_APPOINTMENT_LEAD_MINUTES * 60 * 1000;

// 待确认方案：约定开始时间一过即失效
export const isProposalOverdue = (startAt: string, now = Date.now()): boolean =>
  toTime(startAt) <= now;

// 已生效预约：超过约定开始时间 + 宽限期仍未完成交接，视为过期并释放时段
export const isConfirmedPastGrace = (startAt: string, now = Date.now()): boolean =>
  toTime(startAt) + CONFIRMED_GRACE_MINUTES * 60_000 <= now;

export const validateTimeRange = (startAt: string, endAt: string): string => {
  if (!startAt) return '请选择交接时间';
  if (!dayjs(startAt).isValid()) return '交接时间格式不正确';
  if (!isFutureSlot(startAt)) return `预约时间至少需要提前 ${MIN_APPOINTMENT_LEAD_MINUTES} 分钟`;
  if (!dayjs(endAt).isValid()) return '结束时间格式不正确';
  if (toTime(endAt) <= toTime(startAt)) return '结束时间必须晚于开始时间';
  return '';
};

// 用于 <input type="datetime-local"> 的当前时间 + 偏移默认值
export const defaultStartAtInputValue = (offsetHours = 24): string =>
  dayjs().add(offsetHours, 'hour').minute(0).second(0).format('YYYY-MM-DDTHH:mm');

// datetime-local 的本地时间字符串 -> ISO
export const inputToIso = (value: string): string => dayjs(value).toISOString();
