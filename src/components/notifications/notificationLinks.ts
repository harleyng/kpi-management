import type { KpiNotification } from '@/data/types';

/**
 * Where clicking a notification leads (WBS 4.8.2). Every target is under "Của tôi", which every
 * signed-in user may open; the record travels as a query parameter the owning screen can pick up
 * (`?form=` for T5's "Việc cần xử lý", `?plan=` for T3's "KPI của tôi"). A record that no longer
 * exists is that screen's to explain — the link never checks.
 */
export function notificationTarget(n: Pick<KpiNotification, 'refType' | 'refId'>): string {
  const ref = encodeURIComponent(n.refId);
  switch (n.refType) {
    case 'Form':
      return `/my/tasks?form=${ref}`;
    case 'Launch':
      return '/my/tasks';
    case 'GoalPlan':
      return `/my/kpi?plan=${ref}`;
    case 'Goal':
      return `/my/kpi?goal=${ref}`;
    case 'Result':
      return '/my/results';
  }
}
