import dayjs from 'dayjs';

import { AppointmentStatus } from '@/constants/appointment';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import { APPOINTMENT_STATUS_MESSAGE_MAP, STATUS_MESSAGE_MAP } from '@/constants/messages';

export const formatDate = (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm');

export const formatItemStatus = (status: ItemStatus) => {
  const map: Record<ItemStatus, string> = {
    [ItemStatus.AVAILABLE]: '可交换',
    [ItemStatus.EXCHANGED]: '已交换',
    [ItemStatus.OFFLINE]: '已下架',
  };
  return map[status];
};

export const formatExchangeStatus = (status: ExchangeStatus) => {
  const map: Record<ExchangeStatus, string> = {
    [ExchangeStatus.PENDING]: '待确认',
    [ExchangeStatus.ACCEPTED]: '已同意',
    [ExchangeStatus.REJECTED]: '已拒绝',
    [ExchangeStatus.COMPLETED]: '已完成',
  };
  return map[status];
};

export const formatCondition = (condition: ItemCondition) => {
  const map: Record<ItemCondition, string> = {
    [ItemCondition.NEW]: '全新',
    [ItemCondition.LIKE_NEW]: '九成新',
    [ItemCondition.GOOD]: '八成新',
    [ItemCondition.WORN]: '战损',
  };
  return map[condition];
};

export const formatCreditLevel = (score: number) => {
  if (score >= 90) return '守约达人';
  if (score >= 75) return '稳定交换';
  if (score >= 60) return '新晋用户';
  return '需谨慎';
};

export const statusToneClass = (status: ItemStatus | ExchangeStatus) => {
  if (status === ItemStatus.AVAILABLE || status === ExchangeStatus.ACCEPTED) return 'status-good';
  if (status === ItemStatus.OFFLINE || status === ExchangeStatus.REJECTED) return 'status-muted';
  if (status === ItemStatus.EXCHANGED || status === ExchangeStatus.COMPLETED) return 'status-done';
  return 'status-wait';
};

export const formatStatusMessage = (status: ItemStatus | ExchangeStatus) => STATUS_MESSAGE_MAP[status];

export const formatAppointmentStatus = (status: AppointmentStatus) => {
  const map: Record<AppointmentStatus, string> = {
    [AppointmentStatus.PENDING]: '待双方确认',
    [AppointmentStatus.ACTIVE]: '已生效',
    [AppointmentStatus.CANCELLED]: '已取消',
    [AppointmentStatus.EXPIRED]: '已过期',
  };
  return map[status];
};

export const formatAppointmentSlot = (startAt: string, endAt: string) =>
  `${dayjs(startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(endAt).format('HH:mm')}`;

export const appointmentStatusToneClass = (status: AppointmentStatus) => {
  if (status === AppointmentStatus.ACTIVE) return 'status-good';
  if (status === AppointmentStatus.PENDING) return 'status-wait';
  return 'status-muted';
};

export const formatAppointmentStatusMessage = (status: AppointmentStatus) =>
  APPOINTMENT_STATUS_MESSAGE_MAP[status];
