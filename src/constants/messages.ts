import { AppointmentStatus } from './appointment';
import { ExchangeStatus } from './exchange';
import { ItemStatus } from './item';

export const PAGE_MESSAGES = {
  homeEmpty: '暂时没有符合条件的闲置物品',
  publishReady: '发布后会同步写入 localStorage 和 IndexedDB',
  exchangeEmpty: '还没有交换请求，先去首页挑一件合眼缘的物品',
  profileUpdated: '个人资料已更新',
  appointmentIntro: '已同意的交换可以预约线下交接，双方各自可提出时间地点，都确认后才生效',
  appointmentCreate: '约个时间地点完成当面交接',
};

export const FORM_MESSAGES = {
  requiredTitle: '物品标题不能为空',
  requiredDescription: '请描述你希望交换的物品',
  requiredPhone: '请填写联系方式',
  imageLimit: '最多上传 4 张图片',
  exchangeNeedOwnItem: '请先发布一件可交换物品',
  appointmentTimeRequired: '请选择交接开始时间',
  appointmentDurationRequired: '请选择交接时长',
  appointmentLocationRequired: '请填写交接地点',
};

export const LOG_MESSAGES = {
  storageHydrated: 'storage hydrated with status maps',
  itemStatusUsed: `ItemStatus includes ${ItemStatus.AVAILABLE}, ${ItemStatus.EXCHANGED}, ${ItemStatus.OFFLINE}`,
  exchangeStatusUsed: `ExchangeStatus includes ${ExchangeStatus.PENDING}, ${ExchangeStatus.ACCEPTED}, ${ExchangeStatus.REJECTED}, ${ExchangeStatus.COMPLETED}`,
  appointmentStatusUsed: `AppointmentStatus includes ${AppointmentStatus.PENDING}, ${AppointmentStatus.ACTIVE}, ${AppointmentStatus.CANCELLED}, ${AppointmentStatus.EXPIRED}`,
  appointmentSlotCommitted: 'appointment, both confirmations and occupied slots committed in one write',
};

export const STATUS_MESSAGE_MAP = {
  [ItemStatus.AVAILABLE]: '这件物品可发起交换',
  [ItemStatus.EXCHANGED]: '这件物品已完成交换',
  [ItemStatus.OFFLINE]: '这件物品已下架',
  [ExchangeStatus.PENDING]: '等待对方确认',
  [ExchangeStatus.ACCEPTED]: '交换已同意，可确认完成',
  [ExchangeStatus.REJECTED]: '交换请求已拒绝',
  [ExchangeStatus.COMPLETED]: '交换流程已完成',
};

// AppointmentStatus 与 ExchangeStatus 都存在 'pending' 等相同字符串值，
// 故交接预约文案独立成表，避免对象键互相覆盖。
export const APPOINTMENT_STATUS_MESSAGE_MAP: Record<AppointmentStatus, string> = {
  [AppointmentStatus.PENDING]: '方案待双方确认，未占用时段',
  [AppointmentStatus.ACTIVE]: '双方已确认，时段已锁定',
  [AppointmentStatus.CANCELLED]: '预约已取消，时段已释放',
  [AppointmentStatus.EXPIRED]: '预约已过期，时段已释放',
};
