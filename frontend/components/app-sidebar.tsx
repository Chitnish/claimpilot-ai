"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageSquareWarning,
  Upload,
  UserCircle2,
  Users,
  Wallet,
} from "lucide-react";

import { getPendingDisputes, getReviewQueue } from "@/lib/api";
import { DEMO_USERS, getActor, setActor, type DemoUser } from "@/lib/actor";
import { cn } from "@/lib/utils";

const REVIEW_POLL_INTERVAL_MS = 30_000;

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/claims", label: "Claims", icon: FileText },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/ar", label: "Accounts Receivable", icon: Wallet },
  { href: "/review", label: "Review", icon: ClipboardList, showBadge: true },
  { href: "/disputes", label: "Disputes", icon: MessageSquareWarning, showDisputeBadge: true },
  { href: "/upload", label: "Upload", icon: Upload },
] as const;

export function AppSidebar(): React.ReactElement {
  const pathname = usePathname();
  const [reviewCount, setReviewCount] = useState(0);
  const [disputeCount, setDisputeCount] = useState(0);
  const [actor, setActorState] = useState<DemoUser>(DEMO_USERS[2]!);

  useEffect(() => {
    setActorState(getActor());
  }, []);

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

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-[#1e3a5f] text-white">
      <div className="border-b border-white/10 px-5 py-6">
        <Link href="/dashboard" className="block">
          <span className="text-lg font-bold tracking-tight">ClaimPilot AI</span>
          <span className="mt-0.5 block text-xs text-white/60">
            Claims automation
          </span>
        </Link>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon, ...rest }) => {
          const showBadge = "showBadge" in rest && rest.showBadge === true;
          const showDisputeBadge =
            "showDisputeBadge" in rest && rest.showDisputeBadge === true;
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
          const badgeCount = showBadge ? reviewCount : showDisputeBadge ? disputeCount : 0;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-white/15 text-white"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="size-4" />
              {label}
              {(showBadge || showDisputeBadge) && badgeCount > 0 && (
                <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/10 p-3">
        <label
          htmlFor="actor-switcher"
          className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/60"
        >
          <UserCircle2 className="size-3.5" />
          Signed in as
        </label>
        <select
          id="actor-switcher"
          value={actor.id}
          onChange={(event) => handleActorChange(event.target.value)}
          className="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/40"
        >
          {DEMO_USERS.map((user) => (
            <option key={user.id} value={user.id} className="text-[#1e3a5f]">
              {user.name} — {user.role}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] leading-snug text-white/40">
          Role controls approval authority (demo identity).
        </p>
      </div>
    </aside>
  );
}
