import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { OrgUnitTreeView } from '@/components/shared/OrgUnitTree';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useOrgDirectory } from '@/hooks/queries/org';
import { useSearchParamState } from '@/hooks/useSearchParamState';
import { UnitSheet } from './UnitSheet';

export const ORG_STRUCTURE_URL = '/system/org/structure';

/**
 * "Cơ cấu" — the org tree (WBS 4.1.2). Selecting a unit opens its page
 * (`/system/org/structure/:unitId`, `OrgUnitDetailPage`); the tree never holds a unit's detail
 * beside it. "Hiện đơn vị ngừng dùng" is `?inactive=1`.
 */
export function OrgStructureTab() {
  const navigate = useNavigate();
  const { data, query } = useOrgDirectory();
  const [inactiveParam, setInactiveParam] = useSearchParamState('inactive');
  const showInactive = inactiveParam === '1';
  const [adding, setAdding] = useState(false);
  const switchId = useId();

  const root = data?.units.find((u) => u.parentId === null) ?? null;
  const treeUnits = useMemo(() => data?.units.filter((u) => showInactive || u.status === 'Active'), [data, showInactive]);
  const open = (unitId: string) => navigate(`${ORG_STRUCTURE_URL}/${unitId}`);

  return (
    <>
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch id={switchId} checked={showInactive} onCheckedChange={(on) => setInactiveParam(on ? '1' : null)} />
              <Label htmlFor={switchId} className="text-sm font-normal text-muted-foreground">
                Hiện đơn vị ngừng dùng
              </Label>
            </div>
            <Button size="sm" onClick={() => setAdding(true)} disabled={!data}>
              <Plus aria-hidden />
              Thêm đơn vị
            </Button>
          </div>
          <OrgUnitTreeView label="Cây tổ chức" units={treeUnits} query={query} selected={[]} onSelectedChange={(ids) => ids[0] && open(ids[0])} />
        </CardContent>
      </Card>

      {adding && data && (
        <UnitSheet
          key={`new-${root?.id ?? 'root'}`}
          open
          onOpenChange={(isOpen) => !isOpen && setAdding(false)}
          unit={null}
          parentId={root?.id ?? null}
          directory={data}
          onSaved={(saved) => {
            setAdding(false);
            open(saved.id);
          }}
        />
      )}
    </>
  );
}
