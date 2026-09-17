import { defineStore } from 'pinia';

import { appointmentApi } from '@/api/appointmentApi';
import { AppointmentStatus } from '@/constants/appointment';
import type { Appointment, AppointmentProposal } from '@/models/appointment';
import type { Exchange } from '@/models/exchange';
import { latestAppointmentByExchange } from '@/utils/appointmentRules';
import { message } from '@/utils/message';

export const useAppointmentStore = defineStore('appointments', {
  state: () => ({
    appointments: [] as Appointment[],
    loading: false,
  }),
  getters: {
    /** exchange_id -> 最新一条预约 */
    latestByExchange(state): Map<string, Appointment> {
      return latestAppointmentByExchange(state.appointments);
    },
    activeCount(state) {
      return state.appointments.filter((item) => item.status === AppointmentStatus.ACTIVE).length;
    },
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        this.appointments = await appointmentApi.list();
      } finally {
        this.loading = false;
      }
    },
    async refresh() {
      this.appointments = await appointmentApi.list();
    },
    forExchange(exchangeId: string): Appointment | undefined {
      return this.latestByExchange.get(exchangeId);
    },
    async propose(exchange: Exchange, proposal: AppointmentProposal, proposerId: string) {
      const appointment = await appointmentApi.propose(exchange, proposal, proposerId);
      await this.refresh();
      message(
        appointment.status === AppointmentStatus.PENDING
          ? appointment.confirmed_user_ids.length === 2
            ? '交接预约已生效'
            : '方案已提交，等待对方确认'
          : '交接预约已生效',
        'success',
      );
      return appointment;
    },
    async confirm(exchangeId: string, userId: string) {
      const before = this.forExchange(exchangeId);
      const appointment = await appointmentApi.confirm(exchangeId, userId);
      await this.refresh();
      if (before && before.status === appointment.status && before.activated_at === appointment.activated_at) {
        message('已确认过，无需重复操作', 'info');
      } else if (appointment.status === AppointmentStatus.ACTIVE) {
        message('双方已确认，交接预约生效，时段已锁定', 'success');
      } else {
        message('已确认，等待对方确认后预约生效', 'success');
      }
      return appointment;
    },
    async reschedule(exchangeId: string, proposal: AppointmentProposal, userId: string) {
      await appointmentApi.reschedule(exchangeId, proposal, userId);
      await this.refresh();
      message('改约方案已提交，需要双方重新确认', 'success');
    },
    async cancel(exchangeId: string, userId: string) {
      await appointmentApi.cancel(exchangeId, userId);
      await this.refresh();
      message('预约已取消，原时段已释放', 'success');
    },
  },
});
