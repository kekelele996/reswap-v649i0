<template>
  <section class="appointment-panel">
    <header class="appointment-panel__head">
      <div>
        <p class="eyebrow">交接预约</p>
        <strong>线下交接时间地点</strong>
      </div>
      <span v-if="appointment" class="status-pill" :class="appointmentStatusToneClass(appointment.status)">
        {{ formatAppointmentStatus(appointment.status) }}
      </span>
    </header>

    <!-- 已有预约：展示当前方案 + 双方确认进度 -->
    <template v-if="appointment && isOpen">
      <dl class="appointment-panel__slot">
        <div>
          <dt>时间</dt>
          <dd>{{ formatAppointmentSlot(appointment.scheduled_start_at, appointment.scheduled_end_at) }}</dd>
        </div>
        <div>
          <dt>地点</dt>
          <dd>{{ appointment.location }}</dd>
        </div>
        <div v-if="appointment.note">
          <dt>备注</dt>
          <dd>{{ appointment.note }}</dd>
        </div>
      </dl>
      <ul class="appointment-panel__parties">
        <li v-for="party in parties" :key="party.id" :class="{ confirmed: party.confirmed }">
          <span class="appointment-panel__dot" />
          {{ party.nickname }}
          <em>{{ party.confirmed ? `已确认 v${appointment.proposal_version}` : '待确认' }}</em>
        </li>
      </ul>
      <p v-if="appointment.status === AppointmentStatus.PENDING" class="appointment-panel__hint">
        {{ hintText }}
      </p>
      <p v-else class="appointment-panel__hint">时段已锁定，改约或取消会立即释放原时段并需双方重新确认。</p>

      <div class="exchange-card__actions">
        <button
          v-if="appointment.status === AppointmentStatus.PENDING && !iConfirmed"
          type="button"
          :disabled="working"
          @click="onConfirm"
        >
          确认该方案
        </button>
        <button
          v-if="appointment.status === AppointmentStatus.PENDING && iConfirmed"
          type="button"
          class="is-disabled"
          disabled
        >
          我已确认，等待对方
        </button>
        <button type="button" :disabled="working" @click="toggleForm('reschedule')">
          {{ editing === 'reschedule' ? '收起改约' : '改约' }}
        </button>
        <button type="button" class="secondary-button" :disabled="working" @click="onCancel">取消预约</button>
      </div>
    </template>

    <!-- 终态：保留历史记录，允许重新发起 -->
    <template v-else-if="appointment">
      <p class="appointment-panel__hint">
        {{ formatAppointmentSlot(appointment.scheduled_start_at, appointment.scheduled_end_at) }} ·
        {{ appointment.location }} — {{ formatAppointmentStatusMessage(appointment.status) }}
      </p>
      <div class="exchange-card__actions">
        <button type="button" :disabled="working" @click="toggleForm('create')">
          {{ editing === 'create' ? '收起' : '重新发起预约' }}
        </button>
      </div>
    </template>

    <!-- 还没有预约记录 -->
    <template v-else>
      <p class="appointment-panel__hint">{{ PAGE_MESSAGES.appointmentIntro }}</p>
      <div class="exchange-card__actions">
        <button type="button" :disabled="working" @click="toggleForm('create')">
          {{ editing === 'create' ? '收起提案' : '提出交接时间地点' }}
        </button>
      </div>
    </template>

    <!-- 提案 / 改约表单 -->
    <form v-if="editing" class="appointment-panel__form" @submit.prevent="submitProposal">
      <label>
        开始时间
        <input v-model="form.startAt" type="datetime-local" :min="minDateTime" required />
      </label>
      <label>
        交接时长
        <select v-model="form.durationMin">
          <option :value="30">30 分钟</option>
          <option :value="60">1 小时</option>
          <option :value="90">1.5 小时</option>
          <option :value="120">2 小时</option>
        </select>
      </label>
      <label>
        交接地点
        <input v-model="form.location" type="text" maxlength="40" placeholder="如：漕河泾地铁站 B 口" required />
      </label>
      <label>
        备注（可选）
        <input v-model="form.note" type="text" maxlength="60" placeholder="如：我会背一个灰色双肩包" />
      </label>
      <div class="exchange-card__actions">
        <button class="primary-button" type="submit" :disabled="working">
          {{ editing === 'reschedule' ? '提交改约' : '提交提案' }}
        </button>
        <button type="button" class="secondary-button" @click="editing = null">取消</button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import dayjs from 'dayjs';

import { AppointmentStatus } from '@/constants/appointment';
import { FORM_MESSAGES, PAGE_MESSAGES } from '@/constants/messages';
import { isTerminalAppointment } from '@/models/appointment';
import type { Appointment } from '@/models/appointment';
import type { Exchange } from '@/models/exchange';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import { useAppointmentStore } from '@/stores/appointmentStore';
import {
  appointmentStatusToneClass,
  formatAppointmentSlot,
  formatAppointmentStatus,
  formatAppointmentStatusMessage,
} from '@/utils/formatters';
import { message } from '@/utils/message';

const props = defineProps<{
  exchange: Exchange;
  users: User[];
}>();

const authStore = useAuthStore();
const appointmentStore = useAppointmentStore();

const appointment = computed<Appointment | undefined>(() =>
  appointmentStore.forExchange(props.exchange.id),
);
const isOpen = computed(() => appointment.value !== undefined && !isTerminalAppointment(appointment.value));

const editing = ref<null | 'create' | 'reschedule'>(null);
const working = ref(false);

const minDateTime = dayjs().add(5, 'minute').format('YYYY-MM-DDTHH:mm');

const form = reactive({
  startAt: '',
  durationMin: 60,
  location: '',
  note: '',
});

const resetForm = () => {
  form.startAt = dayjs().add(1, 'day').hour(14).minute(0).second(0).format('YYYY-MM-DDTHH:mm');
  form.durationMin = 60;
  form.location = authStore.currentUser?.location ?? '';
  form.note = '';
};

const toggleForm = (mode: 'create' | 'reschedule') => {
  editing.value = editing.value === mode ? null : mode;
  if (editing.value) {
    if (mode === 'reschedule' && appointment.value) {
      form.startAt = dayjs(appointment.value.scheduled_start_at).format('YYYY-MM-DDTHH:mm');
      form.durationMin = Math.max(
        30,
        dayjs(appointment.value.scheduled_end_at).diff(appointment.value.scheduled_start_at, 'minute'),
      );
      form.location = appointment.value.location;
      form.note = appointment.value.note;
    } else {
      resetForm();
    }
  }
};

watch(
  () => appointment.value?.proposal_version,
  () => {
    if (editing.value === 'reschedule') editing.value = null;
  },
);

const parties = computed(() =>
  [props.exchange.from_user_id, props.exchange.to_user_id].map((userId) => {
    const user = props.users.find((entry) => entry.id === userId);
    return {
      id: userId,
      nickname: user?.nickname ?? '未知用户',
      confirmed: appointment.value?.confirmed_user_ids.includes(userId) ?? false,
    };
  }),
);

const iConfirmed = computed(() =>
  Boolean(authStore.currentUser && appointment.value?.confirmed_user_ids.includes(authStore.currentUser.id)),
);

const hintText = computed(() => {
  if (!appointment.value) return '';
  if (iConfirmed.value) return '你已确认该方案，对方确认后预约立即生效并锁定时段。';
  return `${appointment.value.proposed_by === authStore.currentUser?.id ? '你' : '对方'}已提出方案，确认后双方一致即生效。`;
});

const buildProposal = () => {
  if (!form.startAt) {
    message(FORM_MESSAGES.appointmentTimeRequired, 'error');
    return null;
  }
  if (!form.location.trim()) {
    message(FORM_MESSAGES.appointmentLocationRequired, 'error');
    return null;
  }
  const start = dayjs(form.startAt);
  return {
    scheduled_start_at: start.second(0).millisecond(0).toISOString(),
    scheduled_end_at: start.add(form.durationMin, 'minute').toISOString(),
    location: form.location,
    note: form.note,
  };
};

const submitProposal = async () => {
  if (!authStore.currentUser) return;
  const proposal = buildProposal();
  if (!proposal) return;
  working.value = true;
  try {
    if (editing.value === 'reschedule') {
      await appointmentStore.reschedule(props.exchange.id, proposal, authStore.currentUser.id);
    } else {
      await appointmentStore.propose(props.exchange, proposal, authStore.currentUser.id);
    }
    editing.value = null;
  } catch (error) {
    message(error instanceof Error ? error.message : '提案失败', 'error');
  } finally {
    working.value = false;
  }
};

const onConfirm = async () => {
  if (!authStore.currentUser) return;
  working.value = true;
  try {
    await appointmentStore.confirm(props.exchange.id, authStore.currentUser.id);
  } catch (error) {
    message(error instanceof Error ? error.message : '确认失败', 'error');
  } finally {
    working.value = false;
  }
};

const onCancel = async () => {
  if (!authStore.currentUser) return;
  if (!window.confirm('确定取消该交接预约？取消后原时段将立即释放。')) return;
  working.value = true;
  try {
    await appointmentStore.cancel(props.exchange.id, authStore.currentUser.id);
    editing.value = null;
  } catch (error) {
    message(error instanceof Error ? error.message : '取消失败', 'error');
  } finally {
    working.value = false;
  }
};
</script>
