import type { ReactNode } from 'react';
import { MissingValue } from '@/components/shared/DataTable';
import {
  CYCLE_STATUS_LABEL,
  EMPLOYMENT_STATUS_LABEL,
  FORM_STATUS_LABEL,
  GOAL_PLAN_STATUS_LABEL,
  GOAL_STATUS_LABEL,
  IMPORT_BATCH_STATUS_LABEL,
  LAUNCH_STATUS_LABEL,
  LIBRARY_STATUS_LABEL,
  NOTIFICATION_STATUS_LABEL,
  PERIOD_RESULT_STATUS_LABEL,
  RECORD_STATUS_LABEL,
  SYNC_RUN_STATUS_LABEL,
  TENANT_STATUS_LABEL,
  type EntityName,
  type JsonValue,
} from '@/data/types';
import { formatViDate } from '@/lib/notificationRules';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { ShortId } from './AuditActor';

/**
 * How the audit log (WBS 4.8.4) shows a row's columns: a Vietnamese name for the columns people care
 * about (the rest keep their technical name, in monospace), status codes through their state set's
 * label map, dates as dates, ids as a short code with the full id on hover.
 */

export const AUDIT_FIELD_LABEL: Readonly<Record<string, string>> = {
  status: 'Trạng thái',
  name: 'Tên',
  fullName: 'Họ và tên',
  displayName: 'Tên hiển thị',
  code: 'Mã',
  label: 'Nhãn',
  description: 'Mô tả',
  weight: 'Trọng số (%)',
  targetValue: 'Mục tiêu',
  targetText: 'Mục tiêu (chữ)',
  actualValue: 'Giá trị thực tế',
  actualText: 'Thực tế (chữ)',
  lockedAt: 'Thời điểm khóa',
  isLocked: 'Đã khóa',
  revokedAt: 'Thời điểm thu hồi',
  dueDate: 'Hạn',
  startDate: 'Ngày bắt đầu',
  endDate: 'Ngày kết thúc',
  currentStepId: 'Bước hiện tại',
  currentStepEnteredAt: 'Vào bước lúc',
  overdueHandledAt: 'Xử lý quá hạn lúc',
  launchedAt: 'Khởi chạy lúc',
  scheduledAt: 'Hẹn khởi chạy lúc',
  finalizedAt: 'Chốt lúc',
  totalScore: 'Tổng điểm',
  adjustmentPct: 'Điều chỉnh (điểm %)',
  payoutPct: 'Tỷ lệ lương KPI (%)',
  ratingLevelId: 'Mức xếp loại',
  selfAchievementPct: 'Hệ thống tính (%)',
  selfComment: 'Giải trình',
  actualEnteredBy: 'Người nhập số thực tế',
  submittedActualValue: 'Số thực tế nhân viên gửi',
  submittedActualText: 'Kết quả thực tế nhân viên gửi',
  managerAchievementPct: 'Quản lý đánh giá (%)',
  managerComment: 'Nhận xét của quản lý',
  finalAchievementPct: 'HR ghi nhận (%)',
  finalComment: 'Lý do HR điều chỉnh',
  comment: 'Nhận xét',
  subject: 'Tiêu đề',
  body: 'Nội dung',
  visibility: 'Hiển thị',
  validFrom: 'Hiệu lực từ',
  validTo: 'Hiệu lực đến',
  employmentStatus: 'Tình trạng làm việc',
  leftOn: 'Ngày nghỉ việc',
};

/** The status set of each entity that has one, so a status change reads in words. */
const STATUS_LABELS: Partial<Record<EntityName, Readonly<Record<string, string>>>> = {
  Tenant: TENANT_STATUS_LABEL,
  OrgUnit: RECORD_STATUS_LABEL,
  JobPosition: RECORD_STATUS_LABEL,
  UserAccount: RECORD_STATUS_LABEL,
  RatingScale: RECORD_STATUS_LABEL,
  IntegrationConnection: RECORD_STATUS_LABEL,
  KpiDefinition: LIBRARY_STATUS_LABEL,
  KpiTemplate: LIBRARY_STATUS_LABEL,
  PerformanceCycle: CYCLE_STATUS_LABEL,
  GoalPlan: GOAL_PLAN_STATUS_LABEL,
  Goal: GOAL_STATUS_LABEL,
  SyncRun: SYNC_RUN_STATUS_LABEL,
  ImportBatch: IMPORT_BATCH_STATUS_LABEL,
  FormInstance: FORM_STATUS_LABEL,
  FormLaunch: LAUNCH_STATUS_LABEL,
  PeriodResult: PERIOD_RESULT_STATUS_LABEL,
  Notification: NOTIFICATION_STATUS_LABEL,
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LONG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fieldLabel(field: string): ReactNode {
  const label = AUDIT_FIELD_LABEL[field];
  return label ?? <span className="font-mono text-xs">{field}</span>;
}

export function formatAuditValue(entity: EntityName, field: string, value: JsonValue | undefined): ReactNode {
  if (value === undefined || value === null || value === '') return <MissingValue />;
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  if (typeof value === 'number') return <span className="tabular">{formatNumber(value)}</span>;
  if (typeof value === 'string') {
    if (field === 'status' || field === 'employmentStatus') {
      const labels: Readonly<Record<string, string>> | undefined = field === 'employmentStatus' ? EMPLOYMENT_STATUS_LABEL : STATUS_LABELS[entity];
      return labels?.[value] ?? value;
    }
    if (ISO_INSTANT.test(value)) return <span className="tabular">{formatDateTime(value)}</span>;
    if (ISO_DATE.test(value)) return <span className="tabular">{formatViDate(value)}</span>;
    if (LONG_ID.test(value)) return <ShortId id={value} />;
    return <span className="whitespace-pre-line break-words">{value}</span>;
  }
  return <span className="break-all font-mono text-xs">{JSON.stringify(value)}</span>;
}
