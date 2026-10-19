import type { KpiNotification } from '@/data/types';

/**
 * Where clicking a notification leads (WBS 4.8.2). A form opens on its own page (`/forms/:formId`,
 * which checks the record), a Goal Plan sent back on its owner's plan page under "KPI của tôi";
 * the rest under "Của tôi", which every signed-in user may open. A record that no longer exists is
 * the target page's to explain — the link never checks.
 */
export function notificationTarget(n: Pick<KpiNotification, 'refType' | 'refId'>): string {
  const ref = encodeURIComponent(n.refId);
  switch (n.refType) {
    case 'Form':
      return `/forms/${ref}`;
    case 'Launch':
      return '/my/tasks/inbox';
    case 'GoalPlan':
      return `/my/kpi/plans/${ref}`;
    case 'Goal':
      // A goal alone does not name its plan; the person's current plan holds it.
      return '/my/kpi';
    case 'Result':
      return '/my/results';
  }
}
