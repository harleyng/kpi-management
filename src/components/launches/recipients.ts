import { RECIPIENT_MODE_LABEL, type RecipientFilter, type RecipientMode } from '@/data/types';

/** A FILTER with every list empty means "any" — HR narrows it from here (D5). */
export const EMPTY_RECIPIENT_FILTER: RecipientFilter = {
  orgUnitIds: [],
  includeChildUnits: true,
  positionIds: [],
  jobLevels: [],
  employmentStatuses: [],
  employeeIds: [],
};

/** "Theo bộ lọc: 2 đơn vị, 3 người" — what a launch or rule row says about its recipients. */
export function recipientSummary(mode: RecipientMode, filter: RecipientFilter | null): string {
  if (mode === 'ALL' || filter === null) return RECIPIENT_MODE_LABEL.ALL;
  const parts = [
    filter.orgUnitIds.length && `${filter.orgUnitIds.length} đơn vị${filter.includeChildUnits ? ' (gồm đơn vị con)' : ''}`,
    filter.positionIds.length && `${filter.positionIds.length} chức danh`,
    filter.jobLevels.length && `${filter.jobLevels.length} cấp bậc`,
    filter.employmentStatuses.length && `${filter.employmentStatuses.length} tình trạng`,
    filter.employeeIds.length && `${filter.employeeIds.length} người`,
  ].filter(Boolean);
  return parts.length ? `${RECIPIENT_MODE_LABEL.FILTER}: ${parts.join(', ')}` : RECIPIENT_MODE_LABEL.FILTER;
}

