"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Check,
  ChevronsLeft,
  ChevronsUpDown,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageSquareWarning,
  PanelLeftOpen,
  Upload,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { getPendingDisputes, getReviewQueue } from "@/lib/api";
import { DEMO_USERS, getActor, setActor, type DemoUser, type Role } from "@/lib/actor";
import { cn } from "@/lib/utils";

const REVIEW_POLL_INTERVAL_MS = 30_000;

type BadgeKey = "review" | "dispute";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: BadgeKey;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Claims",
    items: [
      { href: "/claims", label: "Claims", icon: FileText },
      { href: "/upload", label: "Upload", icon: Upload },
      { href: "/review", label: "Review", icon: ClipboardList, badge: "review" },
      {
        href: "/disputes",
        label: "Disputes",
        icon: MessageSquareWarning,
        badge: "dispute",
      },
    ],
  },
  {
    label: "Patients & A/R",
    items: [
      { href: "/patients", label: "Patients", icon: Users },
      { href: "/ar", label: "Accounts Receivable", icon: Wallet },
    ],
  },
];

function roleBadgeClass(role: Role): string {
  switch (role) {
    case "manager":
      return "bg-sky-500/20 text-sky-300";
    case "supervisor":
      return "bg-purple-500/20 text-purple-300";
    default:
      return "bg-slate-500/25 text-slate-300";
  }
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export interface AppSidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onNavigate: () => void;
}

export function AppSidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onNavigate,
}: AppSidebarProps): React.ReactElement {
  const pathname = usePathname();
  const [reviewCount, setReviewCount] = useState(0);
  const [disputeCount, setDisputeCount] = useState(0);
  const [actor, setActorState] = useState<DemoUser>(DEMO_USERS[2]!);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActorState(getActor());
  }, []);

  // On mobile the drawer (and any open user menu) should not linger.
  useEffect(() => {
    if (!mobileOpen) setMenuOpen(false);
  }, [mobileOpen]);

  // Collapsed rail has no room for the expanded user menu.
  useEffect(() => {
    if (collapsed) setMenuOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const handleActorChange = (id: string): void => {
    const next = DEMO_USERS.find((user) => user.id === id);
    if (next) {
      setActor(next);
      setActorState(next);
    }
  };

  const loadReviewCount = useCallback(async (): Promise<void> => {
    try {
      const items = await getReviewQueue();
      setReviewCount(items.length);
    } catch {
      // Keep last known count on poll failure
    }
  }, []);

  const loadDisputeCount = useCallback(async (): Promise<void> => {
    try {
      const items = await getPendingDisputes();
      setDisputeCount(items.length);
    } catch {
      // Keep last known count on poll failure
    }
  }, []);

  useEffect(() => {
    void loadReviewCount();
    void loadDisputeCount();
    const interval = setInterval(() => {
      void loadReviewCount();
      void loadDisputeCount();
    }, REVIEW_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadReviewCount, loadDisputeCount]);

  const badgeFor = (key: BadgeKey | undefined): number => {
    if (key === "review") return reviewCount;
    if (key === "dispute") return disputeCount;
    return 0;
  };

  return (
    <aside
      className={cn(
        "sidebar-surface fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-white/5 text-white",
        "transition-[width,transform] duration-200 ease-out",
        collapsed ? "md:w-16" : "md:w-60",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-white/5 px-3",
          collapsed ? "justify-center" : "gap-2.5",
        )}
      >
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className={cn("flex items-center gap-2.5", collapsed && "justify-center")}
          aria-label="ClaimPilot AI — Dashboard"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-dark shadow-md shadow-brand/20">
            <Activity className="size-[18px] text-white" />
          </span>
          {!collapsed && (
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight text-white">
                ClaimPilot AI
              </span>
              <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-400">
                RCM Platform
              </span>
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            className="ml-auto hidden rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white md:inline-flex"
          >
            <ChevronsLeft className="size-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="Expand sidebar"
          className="hidden items-center justify-center border-b border-white/5 py-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-white md:flex"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}

      {/* Navigation */}
      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2.5 py-3">
        {NAV_SECTIONS.map((section, sectionIndex) => (
          <div key={section.label} className={cn(sectionIndex > 0 && "mt-5")}>
            {collapsed ? (
              sectionIndex > 0 && <div className="mx-2 mb-2 border-t border-white/5" />
            ) : (
              <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {section.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map(({ href, label, icon: Icon, badge }) => {
                const active =
                  pathname === href || pathname.startsWith(`${href}/`);
                const count = badgeFor(badge);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    title={collapsed ? label : undefined}
                    aria-label={label}
                    className={cn(
                      "group relative flex items-center rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                      collapsed ? "justify-center" : "gap-2.5",
                      active
                        ? "bg-white/10 text-white before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-brand"
                        : "text-slate-400 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                    {!collapsed && count > 0 && (
                      <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                        {count}
                      </span>
                    )}
                    {collapsed && count > 0 && (
                      <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-brand ring-2 ring-clinical-sidebar" />
                    )}
                    {collapsed && (
                      <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-white/10 bg-clinical-shell px-2 py-1 text-xs font-medium text-white shadow-xl group-hover:block">
                        {label}
                        {count > 0 ? ` (${count})` : ""}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User menu */}
      <div className="shrink-0 border-t border-white/5 p-2.5" ref={menuRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={collapsed ? `${actor.name} — ${actor.role}` : undefined}
            className={cn(
              "flex w-full items-center rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5",
              collapsed ? "justify-center" : "gap-2.5",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-dark text-xs font-semibold text-white">
              {initialsOf(actor.name)}
            </span>
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {actor.name}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      roleBadgeClass(actor.role),
                    )}
                  >
                    {actor.role}
                  </span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
              </>
            )}
          </button>

          {menuOpen && (
            <div
              role="menu"
              className={cn(
                "absolute bottom-full z-50 mb-2 overflow-hidden rounded-lg border border-white/10 bg-clinical-shell shadow-2xl",
                collapsed ? "left-0 w-56" : "inset-x-0",
              )}
            >
              <p className="border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Switch role · demo identity
              </p>
              {DEMO_USERS.map((user) => {
                const selected = user.id === actor.id;
                return (
                  <button
                    key={user.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      handleActorChange(user.id);
                      setMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-white/5",
                      selected ? "text-white" : "text-slate-300",
                    )}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold">
                      {initialsOf(user.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{user.name}</span>
                      <span className="block text-[10px] uppercase tracking-wide text-slate-500">
                        {user.role}
                      </span>
                    </span>
                    {selected && <Check className="size-4 shrink-0 text-brand" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {!collapsed && (
          <p className="mt-2 px-2 text-[10px] leading-snug text-slate-500">
            Role controls approval authority.
          </p>
        )}
      </div>
    </aside>
  );
}
