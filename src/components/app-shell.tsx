"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Calendar,
  Columns3,
  Inbox,
  Menu,
  Plus,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";

import { AccountDot } from "@/components/account-dot";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccounts } from "@/hooks/use-accounts";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Whether a nav href is the active route (matches the route or any subpath). */
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

function Brand() {
  return (
    <Link
      href="/inbox"
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-base font-semibold tracking-tight outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Columns3 className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="truncate">OnePane</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Primary navigation
// ---------------------------------------------------------------------------

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function PrimaryNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={isActive(pathname, item.href)}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Accounts section
// ---------------------------------------------------------------------------

function AccountsSection({ onNavigate }: { onNavigate?: () => void }) {
  const { accounts, isLoading } = useAccounts();

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2">
      <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Accounts
      </p>

      <ScrollArea className="min-h-0 flex-1 scrollbar-thin">
        <div className="flex flex-col gap-0.5 pb-2 pr-1">
          {isLoading ? (
            <div className="flex flex-col gap-1.5 px-3 py-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : accounts.length === 0 ? (
            <Link
              href="/settings"
              onClick={onNavigate}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-primary outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Connect an account</span>
            </Link>
          ) : (
            accounts.map((account) => (
              <Link
                key={account.id}
                href="/settings"
                onClick={onNavigate}
                title={account.email}
                className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              >
                <AccountDot color={account.color} size="md" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {account.email}
                </span>
              </Link>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sidebar body (used by both the fixed desktop rail and mobile drawer)
// ---------------------------------------------------------------------------

function SidebarBody({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 py-3">
      <div className="px-2">
        <Brand />
      </div>
      <div className="pt-1">
        <PrimaryNav pathname={pathname} onNavigate={onNavigate} />
      </div>
      <div className="mx-2 mt-1 border-t border-border" />
      <AccountsSection onNavigate={onNavigate} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile drawer (slide-out from the left, built on the Dialog primitive)
// ---------------------------------------------------------------------------

function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = React.useState(false);

  // Close the drawer whenever the route changes.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label="Open navigation"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[80%] max-w-[280px] flex-col border-r border-border bg-background shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left data-[state=closed]:duration-200 data-[state=open]:duration-300"
        >
          <DialogPrimitive.Title className="sr-only">
            Navigation
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Move between your inbox, calendar, settings, and connected accounts.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            aria-label="Close navigation"
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
          <SidebarBody
            pathname={pathname}
            onNavigate={() => setOpen(false)}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Fixed sidebar on md+ */}
      <aside className="hidden w-[248px] shrink-0 border-r border-border bg-card md:block">
        <SidebarBody pathname={pathname} />
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 md:hidden">
          <MobileNav pathname={pathname} />
          <Link
            href="/inbox"
            className="flex items-center gap-2 text-base font-semibold tracking-tight"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Columns3 className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="truncate">OnePane</span>
          </Link>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
