import dayjs from 'dayjs';

import { AppointmentStatus } from '@/constants/appointment';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import { STATUS_MESSAGE_MAP } from '@/constants/messages';

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

export const formatAppointmentStatus = (status: AppointmentStatus) => {
  const map: Record<AppointmentStatus, string> = {
    [AppointmentStatus.PROPOSED]: '待双方确认',
    [AppointmentStatus.CONFIRMED]: '预约已生效',
    [AppointmentStatus.CANCELLED]: '已取消',
    [AppointmentStatus.EXPIRED]: '已过期',
  };
  return map[status];
};

export const formatAppointmentRange = (startAt: string, endAt: string) =>
  `${dayjs(startAt).format('YYYY-MM-DD HH:mm')} - ${dayjs(endAt).format('HH:mm')}`;

export const formatConfirmParties = (fromConfirmed: boolean, toConfirmed: boolean) => {
  if (fromConfirmed && toConfirmed) return '双方均已确认';
  if (fromConfirmed) return '发起方已确认，等待对方确认';
  if (toConfirmed) return '接收方已确认，等待发起方确认';
  return '双方均未确认';
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

export const statusToneClass = (status: ItemStatus | ExchangeStatus | AppointmentStatus) => {
  if (status === AppointmentStatus.CONFIRMED) return 'status-good';
  if (status === AppointmentStatus.PROPOSED) return 'status-wait';
  if (status === AppointmentStatus.CANCELLED || status === AppointmentStatus.EXPIRED) return 'status-muted';
  if (status === ItemStatus.AVAILABLE || status === ExchangeStatus.ACCEPTED) return 'status-good';
  if (status === ItemStatus.OFFLINE || status === ExchangeStatus.REJECTED) return 'status-muted';
  if (status === ItemStatus.EXCHANGED || status === ExchangeStatus.COMPLETED) return 'status-done';
  return 'status-wait';
};

export const formatStatusMessage = (status: ItemStatus | ExchangeStatus | AppointmentStatus) =>
  STATUS_MESSAGE_MAP[status];
