import { Fragment, useEffect, type ReactNode } from 'react';
import { Link, useInRouterContext, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { NAV_GROUPS } from '@/components/layout/navConfig';
import { findNavLocation } from '@/lib/navRules';

/** One step of the trail above a heading. `to` absent = plain text (the area of a sub-page). */
export interface Crumb {
  label: string;
  to?: string;
}

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /**
   * The trail above the title. A DETAIL page passes its own, with explicit targets — never "back
   * in history", which breaks on a shared link or a reload:
   * `[{ label: 'Chu kỳ', to: '/admin/cycles' }, { label: cycle.name, to: … }]`.
   * Omitted: a sub-page shows its area ("Thư viện KPI") from the menu; a top-level page shows none.
   */
  breadcrumb?: Crumb[];
  /** A badge beside the title — a detail page's status. */
  status?: ReactNode;
}

const PRODUCT = 'Syntra KPI';

/**
 * Shared page heading — every route-level screen goes through it so titles stay consistent. The
 * title is the menu item's title on a list page and the record's name on a detail page; it also
 * becomes the browser tab's title.
 */
export function PageHeader(props: PageHeaderProps) {
  // Rendered outside a router only by isolated component tests.
  return useInRouterContext() ? <RoutedHeader {...props} /> : <HeaderBody {...props} trail={props.breadcrumb ?? []} />;
}

function RoutedHeader(props: PageHeaderProps) {
  const { pathname } = useLocation();
  const here = props.breadcrumb ? null : findNavLocation(pathname, NAV_GROUPS);
  const trail = props.breadcrumb ?? (here?.parent && here.leaf.title === props.title ? [{ label: here.parent.title }] : []);
  return <HeaderBody {...props} trail={trail} linked />;
}

function HeaderBody({ title, description, actions, status, trail, linked = false }: PageHeaderProps & { trail: Crumb[]; linked?: boolean }) {
  useEffect(() => {
    document.title = `${title} · ${PRODUCT}`;
  }, [title]);

  return (
    <div className="mb-6 space-y-1.5">
      {trail.length > 0 && (
        <nav aria-label="Đường dẫn">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {trail.map((crumb, i) => (
              <Fragment key={`${i}-${crumb.label}`}>
                {i > 0 && (
                  <li aria-hidden>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </li>
                )}
                <li className="min-w-0 truncate">
                  {crumb.to && linked ? (
                    <Link to={crumb.to} className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {crumb.label}
                    </Link>
                  ) : (
                    crumb.label
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {/* tabIndex -1: the shell moves focus here on navigation (AppShell). */}
            <h1 tabIndex={-1} data-page-title className="text-xl font-semibold tracking-tight focus:outline-none">
              {title}
            </h1>
            {status}
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
