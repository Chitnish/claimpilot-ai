"use client";

import { useEffect, useState } from "react";
import { Activity, Menu } from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { cn } from "@/lib/utils";

/**
 * Owns responsive layout state for the app frame and renders the sidebar +
 * content region. Mobile: sidebar is an off-canvas drawer toggled from a top
 * bar. Tablet: sidebar auto-collapses to an icon rail. Desktop: full sidebar,
 * with a manual collapse toggle.
 */
export function AppShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auto-collapse to the icon rail on tablet widths; expand on desktop.
  useEffect(() => {
    const tablet = window.matchMedia(
      "(min-width: 768px) and (max-width: 1023px)",
    );
    const apply = (): void => setCollapsed(tablet.matches);
    apply();
    tablet.addEventListener("change", apply);
    return () => tablet.removeEventListener("change", apply);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile top bar */}
      <header className="sidebar-surface fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-white/10 px-4 text-white backdrop-blur-sm md:hidden">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-brand to-brand-dark shadow-md shadow-brand/30 ring-1 ring-white/20">
            <Activity className="size-4 text-white" />
          </span>
          <span className="font-display text-sm font-semibold tracking-tight">
            ClaimPilot AI
          </span>
        </div>
      </header>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          aria-hidden
          onClick={() => setMobileOpen(false)}
        />
      )}

      <AppSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onNavigate={() => setMobileOpen(false)}
      />

      <main
        className={cn(
          "min-h-screen pt-14 transition-[margin] duration-200 ease-out md:pt-0",
          collapsed ? "md:ml-16" : "md:ml-60",
        )}
      >
        {children}
      </main>
    </div>
  );
}
