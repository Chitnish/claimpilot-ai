"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Info,
  Loader2,
  PauseCircle,
  User,
} from "lucide-react";

import { API_BASE, cms1500Url, getClaim } from "@/lib/api";
import {
  agentBadgeClass,
  denialRiskColor,
  formatCurrency,
  formatStatus,
  statusBadgeVariant,
  truncateId,
} from "@/lib/claim-ui";
import { agentEventSchema, type Claim, type TimelineEvent } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PipelineDiagram } from "@/components/pipeline-diagram";

export default function ClaimDetailPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const claimId = params.id;

  const [claim, setClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [appealOpen, setAppealOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const feedEndRef = useRef<HTMLDivElement>(null);
  const isDoneRef = useRef(false);

  const loadClaim = useCallback(async (): Promise<void> => {
    try {
      const data = await getClaim(claimId);
      setClaim(data);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load claim";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [claimId]);

  const loadClaimRef = useRef(loadClaim);
  loadClaimRef.current = loadClaim;

  useEffect(() => {
    void loadClaim();
    const interval = setInterval(() => {
      void loadClaim();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadClaim]);

  useEffect(() => {
    isDoneRef.current = false;
    setIsDone(false);
    setIsPaused(false);
    setEvents([]);
  }, [claimId]);

  useEffect(() => {
    if (isDoneRef.current) {
      return;
    }

    const eventSource = new EventSource(
      `${API_BASE}/claims/${claimId}/events`,
    );

    const markDone = (): void => {
      if (isDoneRef.current) {
        return;
      }
      isDoneRef.current = true;
      setIsDone(true);
      eventSource.close();
      void loadClaimRef.current();
    };

    const handlePayload = (data: string): void => {
      try {
        const parsed: unknown = JSON.parse(data);
        const event = agentEventSchema.parse(parsed);
        setEvents((prev) => [...prev, { ...event, receivedAt: new Date() }]);
        if (event.event === "done") {
          markDone();
        } else if (event.event === "paused") {
          setIsPaused(true);
          markDone();
        }
      } catch {
        // Ignore malformed SSE payloads
      }
    };

    eventSource.onmessage = (message: MessageEvent<string>) => {
      handlePayload(message.data);
    };

    eventSource.addEventListener("done", (message: Event) => {
      if (message instanceof MessageEvent && typeof message.data === "string") {
        handlePayload(message.data);
      } else {
        markDone();
      }
    });

    eventSource.onerror = () => {
      if (isDoneRef.current) {
        eventSource.close();
      }
    };

    return () => {
      eventSource.close();
    };
  }, [claimId]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  if (loading && !claim) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <Loader2 className="size-8 animate-spin text-[#1e3a5f]" />
      </div>
    );
  }

  if (error && !claim) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  if (!claim) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <p className="text-muted-foreground">Claim not found.</p>
      </div>
    );
  }

  const riskPercent = Math.round(claim.denialRisk * 100);

  // Derive pipeline state from agent events for the diagram
  const completedAgents = events
    .filter((e) => e.event === "completed")
    .map((e) => e.agent)
    .filter((a) => a !== "system");

  const lastEvent = events[events.length - 1];
  const activeAgent =
    !isDone && lastEvent && lastEvent.event === "started"
      ? lastEvent.agent
      : null;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">
            Claim {truncateId(claim.claimId, 12)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live pipeline activity and claim details
          </p>
        </div>
        <Badge variant={statusBadgeVariant(claim.status)}>
          {formatStatus(claim.status)}
        </Badge>
      </div>

      <div className="mb-6">
        <PipelineDiagram
          activeAgent={activeAgent}
          completedAgents={completedAgents}
          status={claim.status}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="size-4" />
                Patient
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Name: </span>
                {claim.patientName || "—"}
              </div>
              <div>
                <span className="text-muted-foreground">DOB: </span>
                {claim.patientDob || "—"}
              </div>
              <div>
                <span className="text-muted-foreground">Member ID: </span>
                {claim.patientMemberId || "—"}
              </div>
              {claim.payerName && (
                <div>
                  <span className="text-muted-foreground">Payer: </span>
                  {claim.payerName}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Financials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Total charge</p>
                <p className="text-2xl font-semibold">
                  {formatCurrency(claim.totalCharge)}
                </p>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Denial risk</span>
                  <span className="font-medium">{riskPercent}%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-200">
                  <div
                    className={cn(
                      "h-2 rounded-full transition-all",
                      denialRiskColor(riskPercent),
                    )}
                    style={{ width: `${riskPercent}%` }}
                  />
                </div>
                {claim.denialRiskFactors.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-sm text-muted-foreground">
                      Risk factors
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {claim.denialRiskFactors.map((factor) => (
                        <span
                          key={factor}
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            factor.includes("+")
                              ? "bg-amber-100 text-amber-800"
                              : factor.includes("-")
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-gray-100 text-gray-700",
                          )}
                        >
                          {factor}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {claim.anomalyScore > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Info className="size-3.5 shrink-0" />
                    <span>
                      Anomaly score: {Math.round(claim.anomalyScore * 100)}%
                    </span>
                  </div>
                )}
              </div>
              {claim.cms1500Path && (
                <Button asChild variant="outline" className="w-full">
                  <a
                    href={cms1500Url(claimId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="size-4" />
                    Download CMS-1500
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>

          {claim.appealLetter && (
            <Card>
              <CardHeader
                className="cursor-pointer"
                onClick={() => setAppealOpen((open) => !open)}
              >
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Appeal letter</CardTitle>
                  {appealOpen ? (
                    <ChevronUp className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  )}
                </div>
                <CardDescription>Generated appeal documentation</CardDescription>
              </CardHeader>
              {appealOpen && (
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                    {claim.appealLetter}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => {
                      void navigator.clipboard.writeText(claim.appealLetter);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? (
                      <>
                        <Check className="size-3.5 mr-1.5" /> Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5 mr-1.5" /> Copy Appeal Letter
                      </>
                    )}
                  </Button>
                </CardContent>
              )}
            </Card>
          )}
        </div>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Agent activity</CardTitle>
                <CardDescription>
                  Real-time updates from the ClaimPilot pipeline
                </CardDescription>
              </div>
              {isPaused ? (
                <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
                  <PauseCircle className="size-4 shrink-0" />
                  Paused for review
                </div>
              ) : isDone ? (
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                  <CheckCircle2 className="size-4 shrink-0" />
                  Pipeline complete
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                  Live
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[32rem] space-y-0 overflow-y-auto pr-1">
              {events.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Waiting for agent events…
                </p>
              ) : (
                events.map((event, index) => (
                  <div
                    key={`${event.agent}-${event.event}-${index}`}
                    className="relative flex gap-4 border-l-2 border-muted pb-6 pl-6 last:pb-0"
                  >
                    <div className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-[#1e3a5f]" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
                            agentBadgeClass(event.agent),
                          )}
                        >
                          {event.agent}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {event.receivedAt.toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm">{event.summary}</p>
                    </div>
                  </div>
                ))
              )}
              <div ref={feedEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
