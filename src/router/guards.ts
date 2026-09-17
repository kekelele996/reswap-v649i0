import type { Router } from 'vue-router';

import { AppointmentStatus } from '@/constants/appointment';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import { LOG_MESSAGES } from '@/constants/messages';
import { useAppointmentStore } from '@/stores/appointmentStore';
import { useAuthStore } from '@/stores/authStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';

export const setupRouterGuards = (router: Router) => {
  router.beforeEach(async () => {
    const authStore = useAuthStore();
    const itemStore = useItemStore();
    const exchangeStore = useExchangeStore();
    const appointmentStore = useAppointmentStore();
    if (!authStore.currentUser) {
      await authStore.hydrate();
    }
    if (!itemStore.items.length) {
      await itemStore.hydrate();
    }
    if (!exchangeStore.exchanges.length) {
      await exchangeStore.hydrate();
    }
    if (!appointmentStore.appointments.length) {
      await appointmentStore.hydrate();
    }

    const statusProbe = itemStore.items.some((item) => item.status === ItemStatus.AVAILABLE);
    const exchangeProbe = exchangeStore.exchanges.some((item) => item.status === ExchangeStatus.PENDING);
    const appointmentProbe = appointmentStore.appointments.some(
      (item) => item.status === AppointmentStatus.PROPOSED || item.status === AppointmentStatus.CONFIRMED,
    );
    if (import.meta.env.DEV && (statusProbe || exchangeProbe || appointmentProbe)) {
      console.debug(LOG_MESSAGES.storageHydrated);
    }
    return true;
  });
};
