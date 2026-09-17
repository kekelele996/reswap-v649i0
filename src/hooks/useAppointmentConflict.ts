import { computed } from 'vue';

import type { TimeRange } from '@/utils/appointmentTime';
import { isTimeOverlap } from '@/utils/appointmentTime';
import { useAppointmentStore } from '@/stores/appointmentStore';

// 查询某参与者与拟议时段时间重叠的生效预约（用于预约面板实时提示与二次拦截）
export const useAppointmentConflict = (userId: () => string | undefined, range: () => TimeRange | null) => {
  const appointmentStore = useAppointmentStore();

  const conflicts = computed(() => {
    const currentUserId = userId();
    const tentative = range();
    if (!currentUserId || !tentative || !tentative.start_at || !tentative.end_at) return [];
    return appointmentStore
      .occupyingFor(currentUserId)
      .filter((item) => isTimeOverlap(item, tentative));
  });

  const hasConflict = computed(() => conflicts.value.length > 0);

  return { conflicts, hasConflict };
};
