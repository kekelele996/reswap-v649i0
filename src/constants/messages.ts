import { AppointmentStatus } from './appointment';
import { ExchangeStatus } from './exchange';
import { ItemStatus } from './item';

export const PAGE_MESSAGES = {
  homeEmpty: '暂时没有符合条件的闲置物品',
  publishReady: '发布后会同步写入 localStorage 和 IndexedDB',
  exchangeEmpty: '还没有交换请求，先去首页挑一件合眼缘的物品',
  profileUpdated: '个人资料已更新',
  appointmentTitle: '交接预约',
  appointmentEmpty: '交换同意后，双方可在此约定交接时间和地点',
  appointmentRequiredLocation: '请填写交接地点',
  appointmentSlotConflict: '该时段与你已生效的其他交接预约时间重叠，请换个时间',
  appointmentNeedAccepted: '只有双方已同意的交换才能预约交接',
  appointmentSingleActive: '这段交换已有进行中的预约，请先改约或取消',
  appointmentDuplicateConfirm: '你已确认过当前方案，无需重复确认',
  appointmentNotParticipant: '只有交换双方可以操作该预约',
  appointmentRescheduleReset: '改约方案已提交，需要双方重新确认',
  appointmentCancelled: '预约已取消，原时段已释放',
  appointmentConfirmed: '双方已确认，预约生效，时段已锁定',
  appointmentCreated: '预约已创建，等待双方确认',
  appointmentExpired: '预约已过期，原时段已释放',
};

export const FORM_MESSAGES = {
  requiredTitle: '物品标题不能为空',
  requiredDescription: '请描述你希望交换的物品',
  requiredPhone: '请填写联系方式',
  imageLimit: '最多上传 4 张图片',
  exchangeNeedOwnItem: '请先发布一件可交换物品',
};

export const LOG_MESSAGES = {
  storageHydrated: 'storage hydrated with status maps',
  itemStatusUsed: `ItemStatus includes ${ItemStatus.AVAILABLE}, ${ItemStatus.EXCHANGED}, ${ItemStatus.OFFLINE}`,
  exchangeStatusUsed: `ExchangeStatus includes ${ExchangeStatus.PENDING}, ${ExchangeStatus.ACCEPTED}, ${ExchangeStatus.REJECTED}, ${ExchangeStatus.COMPLETED}`,
  appointmentStatusUsed: `AppointmentStatus includes ${AppointmentStatus.PROPOSED}, ${AppointmentStatus.CONFIRMED}, ${AppointmentStatus.CANCELLED}, ${AppointmentStatus.EXPIRED}`,
};

export const STATUS_MESSAGE_MAP = {
  [ItemStatus.AVAILABLE]: '这件物品可发起交换',
  [ItemStatus.EXCHANGED]: '这件物品已完成交换',
  [ItemStatus.OFFLINE]: '这件物品已下架',
  [ExchangeStatus.PENDING]: '等待对方确认',
  [ExchangeStatus.ACCEPTED]: '交换已同意，可确认完成',
  [ExchangeStatus.REJECTED]: '交换请求已拒绝',
  [ExchangeStatus.COMPLETED]: '交换流程已完成',
  [AppointmentStatus.PROPOSED]: '等待双方确认时间地点',
  [AppointmentStatus.CONFIRMED]: '预约已生效，请按时到场交接',
  [AppointmentStatus.CANCELLED]: '预约已取消，原时段已释放',
  [AppointmentStatus.EXPIRED]: '预约已过期，原时段已释放',
};
