"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Upload,
} from "lucide-react";

import { getReviewQueue } from "@/lib/api";
import { cn } from "@/lib/utils";

const REVIEW_POLL_INTERVAL_MS = 30_000;

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/claims", label: "Claims", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/review", label: "Review", icon: ClipboardList, showBadge: true },
  { href: "/upload", label: "Upload", icon: Upload },
] as const;

export function AppSidebar(): React.ReactElement {
  const pathname = usePathname();
  const [reviewCount, setReviewCount] = useState(0);

  const loadReviewCount = useCallback(async (): Promise<void> => {
    try {
      const items = await getReviewQueue();
      setReviewCount(items.length);
    } catch {
      // Keep last known count on poll failure
    }
  }, []);

  useEffect(() => {
    void loadReviewCount();
    const interval = setInterval(() => {
      void loadReviewCount();
    }, REVIEW_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadReviewCount]);

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
          const active =
            pathname === href || pathname.startsWith(`${href}/`);
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
              {showBadge && reviewCount > 0 && (
                <span className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {reviewCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
