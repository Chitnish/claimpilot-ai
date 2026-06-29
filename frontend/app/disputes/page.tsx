"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquare,
  MessageSquareWarning,
  ShieldCheck,
  User,
} from "lucide-react";

import { getPendingDisputes, resolveDispute } from "@/lib/api";
import { truncateId } from "@/lib/claim-ui";
import type { DisputeItem } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { CountUp, Stagger, StaggerItem } from "@/components/ui/motion";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;

function previewMessages(item: DisputeItem): DisputeItem["disputeThread"] {
  const thread = item.disputeThread;
  if (thread.length <= 2) {
    return thread;
  }
  return thread.slice(-2);
}

function formatTimestamp(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function senderLabel(sender: string): string {
  if (sender === "payer_reply") {
    return "Payer";
  }
  if (sender === "ai_reply") {
    return "ClaimPilot AI";
  }
  return sender;
}

export default function DisputesPage(): React.ReactElement {
  const router = useRouter();
  const [items, setItems] = useState<DisputeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const loadDisputes = useCallback(async (): Promise<void> => {
    try {
      const data = await getPendingDisputes();
      setItems(data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load pending disputes";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDisputes();
    const interval = setInterval(() => {
      void loadDisputes();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadDisputes]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleResolve = async (item: DisputeItem): Promise<void> => {
    setActingOn(item.id);
    const note = notes[item.id]?.trim() ?? "";
    try {
      await resolveDispute(item.claimId, note);
      setItems((prev) => prev.filter((row) => row.id !== item.id));
      setNotes((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setToast("Dispute marked resolved.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to resolve dispute.";
      setToast(message);
    } finally {
      setActingOn(null);
    }
  };

  const distinctCarcs = new Set(
    items.map((item) => item.carcCode).filter(Boolean),
  ).size;
  const totalMessages = items.reduce(
    (sum, item) => sum + item.disputeThread.length,
    0,
  );

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Appeals
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Pending Disputes
          </h1>
          <Badge
            variant="outline"
            className={cn(
              "border-amber-200 bg-amber-100 text-amber-800",
              items.length > 0 && "animate-status-pulse",
            )}
          >
            {items.length} pending
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Appeal email threads flagged for human review
        </p>
      </div>

      {items.length > 0 && (
        <Stagger className="mb-6 grid gap-4 sm:grid-cols-3">
          <StaggerItem>
            <StatCard
              label="Awaiting Resolution"
              value={<CountUp value={items.length} />}
              subtitle="Threads flagged for a human decision"
              icon={MessageSquareWarning}
              accent="amber"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Denial Codes"
              value={<CountUp value={distinctCarcs} />}
              subtitle="Distinct CARC codes in dispute"
              icon={ShieldCheck}
              accent="purple"
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label="Thread Messages"
              value={<CountUp value={totalMessages} />}
              subtitle="Total payer / AI correspondence"
              icon={MessageSquare}
              accent="blue"
            />
          </StaggerItem>
        </Stagger>
      )}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-brand" />
        </div>
      ) : error && items.length === 0 ? (
        <p className="text-center text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No pending disputes"
          description="Appeal threads that need a human decision will show up here."
        />
      ) : (
        <Stagger className="grid gap-4 lg:grid-cols-2">
          {items.map((item) => {
            const previews = previewMessages(item);
            const isActing = actingOn === item.id;

            return (
              <StaggerItem key={item.id}>
              <Card
                className="card-lift relative h-full cursor-pointer overflow-hidden"
                onClick={() => router.push(`/claims/${item.claimId}`)}
              >
                {/* Dispute triage bar */}
                <span
                  className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 to-orange-500"
                  aria-hidden
                />
                <CardHeader className="pb-3 pt-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base text-slate-900">
                        {item.patientName.trim() || "Unknown Patient"}
                      </CardTitle>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {truncateId(item.claimId, 8)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-amber-200 bg-amber-100 text-amber-800"
                    >
                      <MessageSquareWarning className="mr-1 size-3" />
                      CARC {item.carcCode || "—"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {previews.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        <MessageSquare className="size-3.5" />
                        Recent thread
                      </p>
                      <div className="space-y-2.5">
                        {previews.map((msg, index) => {
                          const isAi = msg.sender === "ai_reply";
                          return (
                            <div
                              key={`${msg.sender}-${index}`}
                              className={cn(
                                "flex items-start gap-2",
                                isAi ? "flex-row-reverse" : "flex-row",
                              )}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ring-1",
                                  isAi
                                    ? "bg-gradient-to-br from-brand to-brand-dark text-white ring-white/30"
                                    : "bg-white text-slate-500 ring-slate-200",
                                )}
                              >
                                {isAi ? (
                                  <Bot className="size-3" />
                                ) : (
                                  <User className="size-3" />
                                )}
                              </span>
                              <div
                                className={cn(
                                  "min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-sm",
                                  isAi
                                    ? "bg-brand/10 text-right"
                                    : "bg-white ring-1 ring-slate-200",
                                )}
                              >
                                <p
                                  className={cn(
                                    "text-[11px] font-semibold",
                                    isAi ? "text-brand-dark" : "text-slate-600",
                                  )}
                                >
                                  {senderLabel(msg.sender)}
                                  {msg.createdAt && (
                                    <span className="ml-1.5 font-normal text-slate-400">
                                      {formatTimestamp(msg.createdAt)}
                                    </span>
                                  )}
                                </p>
                                <p className="line-clamp-1 text-slate-700">
                                  {msg.messageText}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div onClick={(event) => event.stopPropagation()}>
                    <label
                      htmlFor={`dispute-note-${item.id}`}
                      className="mb-1.5 block text-xs font-medium text-slate-600"
                    >
                      Resolution note (optional)
                    </label>
                    <Textarea
                      id={`dispute-note-${item.id}`}
                      placeholder="Add context for the audit log…"
                      rows={2}
                      value={notes[item.id] ?? ""}
                      className="resize-none text-sm"
                      onChange={(event) => {
                        const value = event.target.value;
                        setNotes((prev) => ({
                          ...prev,
                          [item.id]: value,
                        }));
                      }}
                    />
                  </div>

                  <Button
                    className="press w-full bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-sm shadow-emerald-600/25 hover:from-emerald-500 hover:to-emerald-700"
                    disabled={isActing}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleResolve(item);
                    }}
                  >
                    {isActing ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 className="mr-1.5 size-4" />
                        Mark Resolved
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border border-border bg-white px-4 py-3 text-sm shadow-card-hover"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
