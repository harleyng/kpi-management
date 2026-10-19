import { useMemo, useState } from 'react';
import { Building2, Check, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSession } from '@/contexts/useSession';
import { ROLE_LABEL } from '@/data/types';
import { matchesSearch } from '@/lib/search';
import { groupPeopleByRole, type SessionPerson } from '@/lib/sessionRules';
import { cn } from '@/lib/utils';

/**
 * The simulated session's controls, in the top bar (plan §3.3): which company, and who you are.
 * Switching person is how a demo walks NV → QL → HR → BOD without signing in again; a person's
 * access is the union of their roles, so there is no role picker.
 *
 * Roles are shown as plain muted text — they are attributes of a person, not statuses, so they
 * never borrow a status badge's tone. The account block at the foot of the sidebar stays the
 * identity display; this is the control.
 */
export function SessionSwitcher() {
  const { tenant, tenants, switchTenant } = useSession();
  const [announcement, setAnnouncement] = useState('');

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Chọn công ty, đang chọn ${tenant.name}`}
            className="flex min-w-0 max-w-32 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-w-56"
          >
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{tenant.name}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>Công ty</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {tenants.map((t) => {
            const current = t.id === tenant.id;
            return (
              <DropdownMenuItem
                key={t.id}
                aria-current={current ? 'true' : undefined}
                onSelect={() => {
                  if (!current) switchTenant(t.id);
                }}
                className="gap-2"
              >
                <Check className={cn('h-4 w-4 shrink-0 text-primary', current ? 'opacity-100' : 'opacity-0')} aria-hidden />
                <span className="truncate">{t.name}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <span aria-hidden className="text-muted-foreground/60">
        /
      </span>

      <PersonPicker onSwitched={(name) => setAnnouncement(`Đang xem với tư cách ${name}`)} />

      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function roleSummary(person: Pick<SessionPerson, 'roles' | 'primaryRole'>): string {
  if (!person.primaryRole) return '';
  const others = person.roles.filter((r) => r !== person.primaryRole && r !== 'EMPLOYEE').length;
  return others > 0 ? `${ROLE_LABEL[person.primaryRole]} +${others}` : ROLE_LABEL[person.primaryRole];
}

/**
 * A row's roles. Everyone with an employee record holds EMPLOYEE (BR-KPI-62), so it is noise beside
 * another role — shown only when it is the person's sole role.
 */
function rowRoles(person: Pick<SessionPerson, 'roles'>): string {
  const beyondBaseline = person.roles.filter((r) => r !== 'EMPLOYEE');
  return (beyondBaseline.length > 0 ? beyondBaseline : person.roles).map((r) => ROLE_LABEL[r]).join(', ');
}

function PersonPicker({ onSwitched }: { onSwitched: (name: string) => void }) {
  const { user, roles, people, switchUser } = useSession();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const me = people.find((p) => p.userId === user.id);
  const roleNames = roles.map((r) => ROLE_LABEL[r]).join(', ');

  const groups = useMemo(() => {
    const matching = people.filter((p) =>
      matchesSearch(search, [p.name, p.orgUnitName, ...p.roles.map((r) => ROLE_LABEL[r])]),
    );
    return groupPeopleByRole(matching);
  }, [people, search]);

  const select = (person: SessionPerson) => {
    setOpen(false);
    setSearch('');
    if (person.userId !== user.id) {
      switchUser(person.userId);
      onSwitched(person.name);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={`Chọn người dùng, đang xem với tư cách ${user.name}, vai trò ${roleNames}`}
          className="flex min-w-0 max-w-56 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-w-80"
        >
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[11px] font-semibold text-primary"
          >
            {user.name.slice(0, 1)}
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            {me && <span className="block truncate text-[11px] text-muted-foreground">{roleSummary(me)}</span>}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Tìm người dùng"
            placeholder="Tìm theo tên, đơn vị hoặc vai trò"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-96">
            {groups.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Không tìm thấy người dùng nào khớp với “{search.trim()}”.
              </p>
            ) : (
              groups.map((group) => (
                <CommandGroup
                  key={group.role ?? 'none'}
                  heading={`${group.role ? ROLE_LABEL[group.role] : 'Chưa có vai trò'} (${group.people.length})`}
                >
                  {group.people.map((person) => {
                    const current = person.userId === user.id;
                    return (
                      <CommandItem
                        key={person.userId}
                        value={person.userId}
                        onSelect={() => select(person)}
                        aria-current={current ? 'true' : undefined}
                        className="items-start gap-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{person.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {person.orgUnitName ?? 'Không thuộc đơn vị'}
                            {' · '}
                            {rowRoles(person)}
                          </span>
                        </span>
                        <Check
                          className={cn('mt-0.5 h-4 w-4 shrink-0 text-primary', current ? 'opacity-100' : 'opacity-0')}
                          aria-hidden
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
