<template>
  <section class="appointment-panel">
    <header class="appointment-panel__head">
      <strong>{{ PAGE_MESSAGES.appointmentTitle }}</strong>
      <span v-if="appointment" class="status-pill" :class="statusToneClass(appointment.status)">
        {{ formatAppointmentStatus(appointment.status) }}
      </span>
    </header>

    <!-- 无进行中预约：发起（含终结后重新预约） -->
    <form v-if="showCreateForm" class="appointment-form" @submit.prevent="submitCreate">
      <p class="appointment-hint">{{ PAGE_MESSAGES.appointmentEmpty }}</p>
      <label>
        交接时间
        <input v-model="form.start_at" type="datetime-local" :min="minStartAt" />
      </label>
      <label>
        交接地点
        <input v-model="form.location" type="text" placeholder="例如：地铁站 A 口" />
      </label>
      <label>
        备注
        <input v-model="form.note" type="text" placeholder="可选，核对物品 / 联系方式" />
      </label>
      <p v-if="hasConflict" class="appointment-conflict">
        {{ PAGE_MESSAGES.appointmentSlotConflict }}
      </p>
      <ul v-else-if="conflicts.length" class="appointment-conflict-list">
        <li v-for="entry in conflicts" :key="entry.id">{{ formatAppointmentRange(entry.start_at, entry.end_at) }} · {{ entry.location }}</li>
      </ul>
      <button class="primary-button" type="submit" :disabled="!canSubmit">提出预约时间地点</button>
    </form>

    <!-- 进行中预约 -->
    <div v-else-if="appointment && !isTerminal" class="appointment-detail">
      <dl class="appointment-detail__grid">
        <div>
          <dt>时间</dt>
          <dd>{{ formatAppointmentRange(appointment.start_at, appointment.end_at) }}</dd>
        </div>
        <div>
          <dt>地点</dt>
          <dd>{{ appointment.location }}</dd>
        </div>
        <div v-if="appointment.note">
          <dt>备注</dt>
          <dd>{{ appointment.note }}</dd>
        </div>
        <div>
          <dt>方案</dt>
          <dd>第 {{ appointment.proposal_version }} 版 · {{ proposerName }} 提出</dd>
        </div>
      </dl>

      <ul class="appointment-confirm-row">
        <li :class="{ done: appointment.from_confirmed }">
          {{ fromUser?.nickname ?? '发起方' }}：{{ appointment.from_confirmed ? '已确认' : '待确认' }}
        </li>
        <li :class="{ done: appointment.to_confirmed }">
          {{ toUser?.nickname ?? '接收方' }}：{{ appointment.to_confirmed ? '已确认' : '待确认' }}
        </li>
      </ul>
      <p class="appointment-hint">{{ formatConfirmParties(appointment.from_confirmed, appointment.to_confirmed) }}</p>
      <p v-if="appointment.cancel_reason" class="appointment-reason">
        {{ formatAppointmentStatus(appointment.status) }}：{{ appointment.cancel_reason }}
      </p>

      <!-- 终结态：取消/过期后可重新发起 -->
      <div v-if="isTerminal && !restart" class="appointment-actions">
        <button class="primary-button" type="button" @click="beginRestart">重新预约交接</button>
      </div>

      <!-- 改约表单 -->
      <form v-if="editing" class="appointment-form" @submit.prevent="submitPropose">
        <label>
          新交接时间
          <input v-model="form.start_at" type="datetime-local" :min="minStartAt" />
        </label>
        <label>
          新交接地点
          <input v-model="form.location" type="text" />
        </label>
        <label>
          备注
          <input v-model="form.note" type="text" />
        </label>
        <p v-if="hasConflict" class="appointment-conflict">
          {{ PAGE_MESSAGES.appointmentSlotConflict }}
        </p>
        <div class="appointment-actions">
          <button class="primary-button" type="submit" :disabled="!canSubmit">提交新方案（需双方重认）</button>
          <button class="secondary-button" type="button" @click="editing = false">收起</button>
        </div>
      </form>

      <!-- 操作区 -->
      <div v-else class="appointment-actions">
        <button
          v-if="canConfirm"
          class="primary-button"
          type="button"
          :disabled="submitting"
          @click="submitConfirm"
        >
          确认该时间地点
        </button>
        <p v-else-if="iAmParticipant && appointment.status === AppointmentStatus.CONFIRMED" class="appointment-hint">
          你已确认，按时段赴约即可
        </p>
        <button
          v-if="iAmParticipant && !isTerminal"
          class="secondary-button"
          type="button"
          :disabled="submitting"
          @click="toggleEdit"
        >
          改约
        </button>
        <button
          v-if="iAmParticipant && !isTerminal"
          class="secondary-button"
          type="button"
          :disabled="submitting"
          @click="submitCancel"
        >
          取消预约
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import { AppointmentStatus } from '@/constants/appointment';
import { PAGE_MESSAGES } from '@/constants/messages';
import type { Exchange } from '@/models/exchange';
import type { Appointment, AppointmentProposalInput } from '@/models/appointment';
import type { User } from '@/models/user';
import { useAppointmentConflict } from '@/hooks/useAppointmentConflict';
import { useAppointmentStore } from '@/stores/appointmentStore';
import { useAuthStore } from '@/stores/authStore';
import {
  computeEndAt,
  defaultStartAtInputValue,
  inputToIso,
} from '@/utils/appointmentTime';
import { validateAppointmentProposal } from '@/utils/appointmentValidators';
import {
  formatAppointmentRange,
  formatAppointmentStatus,
  formatConfirmParties,
  statusToneClass,
} from '@/utils/formatters';
import { message } from '@/utils/message';

const props = defineProps<{
  exchange: Exchange;
  appointment?: Appointment;
  users: User[];
}>();

const authStore = useAuthStore();
const appointmentStore = useAppointmentStore();

const editing = ref(false);
const restart = ref(false);
const submitting = ref(false);
const minStartAt = defaultStartAtInputValue(0.5);

const buildForm = (source?: Appointment) => ({
  start_at: source ? toInputValue(source.start_at) : defaultStartAtInputValue(24),
  location: source?.location ?? '',
  note: source?.note ?? '',
});

const form = reactive(buildForm(props.appointment));

watch(
  () => props.appointment?.id,
  () => {
    editing.value = false;
    restart.value = false;
    Object.assign(form, buildForm(props.appointment));
  },
);

watch(
  () => props.appointment?.status,
  (status) => {
    // 新预约创建成功后（出现进行中状态）收起重新预约表单
    if (status === AppointmentStatus.PROPOSED || status === AppointmentStatus.CONFIRMED) {
      restart.value = false;
    }
  },
);

const fromUser = computed(() => props.users.find((user) => user.id === props.appointment?.from_user_id));
const toUser = computed(() => props.users.find((user) => user.id === props.appointment?.to_user_id));
const proposerName = computed(() => {
  if (!props.appointment) return '';
  const proposer = props.users.find((user) => user.id === props.appointment?.proposed_by);
  return proposer?.nickname ?? '某一方';
});

const currentUserId = computed(() => authStore.currentUser?.id);
const iAmParticipant = computed(
  () =>
    Boolean(currentUserId.value) &&
    (props.exchange.from_user_id === currentUserId.value ||
      props.exchange.to_user_id === currentUserId.value),
);
const iHaveConfirmed = computed(() => {
  if (!props.appointment || !currentUserId.value) return false;
  if (currentUserId.value === props.appointment.from_user_id) return props.appointment.from_confirmed;
  if (currentUserId.value === props.appointment.to_user_id) return props.appointment.to_confirmed;
  return false;
});
const isTerminal = computed(
  () =>
    props.appointment?.status === AppointmentStatus.CANCELLED ||
    props.appointment?.status === AppointmentStatus.EXPIRED,
);
// 无预约（首次），或上一条已终结且点击了"重新预约"时展示创建表单
const showCreateForm = computed(
  () => !props.appointment || (isTerminal.value && restart.value),
);

const draftRange = computed(() => {
  if (!form.start_at) return null;
  const startAt = inputToIso(form.start_at);
  return { start_at: startAt, end_at: computeEndAt(startAt) };
});
const { conflicts, hasConflict } = useAppointmentConflict(
  () => currentUserId.value ?? '',
  () => (editing.value || showCreateForm.value ? draftRange.value : null),
);

const canConfirm = computed(
  () =>
    Boolean(props.appointment) &&
    iAmParticipant.value &&
    !iHaveConfirmed.value &&
    !isTerminal.value &&
    props.appointment?.status === AppointmentStatus.PROPOSED,
);
const canSubmit = computed(() => Boolean(form.start_at && form.location.trim()));

function toInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const buildPayload = (): (AppointmentProposalInput & { proposed_by: string }) | null => {
  if (!currentUserId.value || !canSubmit.value) return null;
  const startAt = inputToIso(form.start_at);
  const endAt = computeEndAt(startAt);
  const error = validateAppointmentProposal({ ...form, start_at: startAt }, endAt);
  if (error) {
    message(error, 'error');
    return null;
  }
  return {
    start_at: startAt,
    end_at: endAt,
    location: form.location,
    note: form.note,
    proposed_by: currentUserId.value,
  };
};

const submitCreate = async () => {
  const payload = buildPayload();
  if (!payload) return;
  if (hasConflict.value) {
    message(PAGE_MESSAGES.appointmentSlotConflict, 'error');
    return;
  }
  submitting.value = true;
  try {
    await appointmentStore.create({
      exchange_id: props.exchange.id,
      from_user_id: props.exchange.from_user_id,
      to_user_id: props.exchange.to_user_id,
      ...payload,
    });
  } finally {
    submitting.value = false;
  }
};

const submitPropose = async () => {
  const payload = buildPayload();
  if (!payload || !props.appointment) return;
  if (hasConflict.value) {
    message(PAGE_MESSAGES.appointmentSlotConflict, 'error');
    return;
  }
  submitting.value = true;
  try {
    const ok = await appointmentStore.propose(props.appointment.id, payload.proposed_by, {
      exchange_id: props.exchange.id,
      from_user_id: props.exchange.from_user_id,
      to_user_id: props.exchange.to_user_id,
      ...payload,
    });
    if (ok) editing.value = false;
  } finally {
    submitting.value = false;
  }
};

const submitConfirm = async () => {
  if (!props.appointment || !currentUserId.value) return;
  submitting.value = true;
  try {
    await appointmentStore.confirm(props.appointment.id, currentUserId.value);
  } finally {
    submitting.value = false;
  }
};

const submitCancel = async () => {
  if (!props.appointment || !currentUserId.value) return;
  submitting.value = true;
  try {
    await appointmentStore.cancel(props.appointment.id, currentUserId.value);
  } finally {
    submitting.value = false;
  }
};

const toggleEdit = () => {
  Object.assign(form, buildForm(props.appointment));
  editing.value = true;
};

const beginRestart = () => {
  Object.assign(form, buildForm(undefined));
  restart.value = true;
};
</script>
