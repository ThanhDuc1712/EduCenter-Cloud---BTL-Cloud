import type { AttendanceCounts } from './types'

/** Attendance uses the reserved status colours, always shown with a text label in the legend. */
export const ATTENDANCE_COLORS = { present: 'var(--success)', late: 'var(--warning)', absent: 'var(--destructive)', excused: 'var(--series-1)' }

export function attendanceParts(c: AttendanceCounts) {
  return [
    { label: 'Có mặt', value: c.present, color: ATTENDANCE_COLORS.present },
    { label: 'Đi muộn', value: c.late, color: ATTENDANCE_COLORS.late },
    { label: 'Vắng', value: c.absent, color: ATTENDANCE_COLORS.absent },
    { label: 'Có phép', value: c.excused, color: ATTENDANCE_COLORS.excused },
  ]
}
