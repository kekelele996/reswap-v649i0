import { AppointmentStatus } from '@/constants/appointment';
import type { AppointmentProposalInput } from '@/models/appointment';
import { validateTimeRange } from '@/utils/appointmentTime';

export const validateAppointmentProposal = (
  proposal: Partial<AppointmentProposalInput>,
  endAt: string,
): string => {
  if (!proposal.location?.trim()) return '请填写交接地点';
  const timeError = validateTimeRange(proposal.start_at ?? '', endAt);
  if (timeError) return timeError;
  return '';
};

// 只有交换双方能对预约做任何操作
export const isAppointmentParticipant = (
  appointment: { from_user_id: string; to_user_id: string },
  userId: string | undefined,
): boolean =>
  Boolean(userId) &&
  (appointment.from_user_id === userId || appointment.to_user_id === userId);

export const assertActiveAppointment = (status: AppointmentStatus): string => {
  if (status === AppointmentStatus.CANCELLED) return '预约已取消，需要重新发起';
  if (status === AppointmentStatus.EXPIRED) return '预约已过期，需要重新发起';
  return '';
};
