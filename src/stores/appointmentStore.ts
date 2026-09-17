import { defineStore } from 'pinia';

import { appointmentApi } from '@/api/appointmentApi';
import { AppointmentStatus } from '@/constants/appointment';
import { PAGE_MESSAGES } from '@/constants/messages';
import type { Appointment, AppointmentDraft } from '@/models/appointment';
import { message, messageAsync } from '@/utils/message';

export const useAppointmentStore = defineStore('appointments', {
  state: () => ({
    appointments: [] as Appointment[],
    loading: false,
  }),
  getters: {
    // 每段交换至多一条进行中预约；列表按 updated_at 倒序，取第一条即可
    // 该交换最近一条预约（含已取消/已过期），列表按 updated_at 倒序，取第一条
    latestByExchange: (state) => (exchangeId: string) =>
      state.appointments.find((item) => item.exchange_id === exchangeId),
    // 是否存在进行中预约（用于单活跃判定与入口控制）
    activeByExchange: (state) => (exchangeId: string) =>
      state.appointments.find(
        (item) =>
          item.exchange_id === exchangeId &&
          (item.status === AppointmentStatus.PROPOSED ||
            item.status === AppointmentStatus.CONFIRMED),
      ),
    // 某参与者当前已生效（占用时段）的预约
    occupyingFor: (state) => (userId: string) =>
      state.appointments.filter(
        (item) =>
          item.status === AppointmentStatus.CONFIRMED &&
          (item.from_user_id === userId || item.to_user_id === userId),
      ),
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        // 回读即对账：过期释放、重复/漂移占用等不变量在 API 层修复后再进入内存
        this.appointments = await appointmentApi.list();
      } finally {
        this.loading = false;
      }
    },
    async create(draft: AppointmentDraft) {
      try {
        const appointment = await messageAsync(
          () => appointmentApi.create(draft),
          PAGE_MESSAGES.appointmentCreated,
        );
        await this.hydrate();
        return appointment;
      } catch {
        return null;
      }
    },
    async propose(appointmentId: string, actorId: string, draft: AppointmentDraft) {
      try {
        await messageAsync(
          () => appointmentApi.propose(appointmentId, actorId, draft),
          PAGE_MESSAGES.appointmentRescheduleReset,
        );
        await this.hydrate();
        return true;
      } catch {
        return false;
      }
    },
    async confirm(appointmentId: string, actorId: string) {
      try {
        const appointment = await appointmentApi.confirm(appointmentId, actorId);
        if (appointment.status === AppointmentStatus.CONFIRMED) {
          message(PAGE_MESSAGES.appointmentConfirmed, 'success');
        } else {
          message('已确认，等待对方确认', 'success');
        }
        await this.hydrate();
        return true;
      } catch (error) {
        message(error instanceof Error ? error.message : '确认失败', 'error');
        return false;
      }
    },
    async cancel(appointmentId: string, actorId: string, reason = '') {
      try {
        await messageAsync(
          () => appointmentApi.cancel(appointmentId, actorId, reason),
          PAGE_MESSAGES.appointmentCancelled,
        );
        await this.hydrate();
        return true;
      } catch {
        return false;
      }
    },
  },
});
