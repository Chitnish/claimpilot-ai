"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Info,
  Link2,
  Loader2,
  PauseCircle,
  Receipt,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  User,
  XCircle,
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
import { ReviewCopilot } from "@/components/review-copilot";
import { CorrectClaimPanel } from "@/components/correct-claim-panel";

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

  const eraLinesByNo = new Map(
    (claim.era?.lines ?? []).map((line) => [line.lineNo, line]),
  );
  const hasPayment = claim.era !== null;
  const adjustedLines = (claim.era?.lines ?? []).filter(
    (line) => line.adjustments.length > 0,
  );
  const scrubErrors = claim.scrubFindings.filter(
    (f) => f.severity === "error",
  );
  const scrubWarnings = claim.scrubFindings.filter(
    (f) => f.severity !== "error",
  );
  const isDenied = claim.status === "denied" || claim.status === "appealed";

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

      {isDenied && claim.carcCode && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-600" />
          <div className="text-sm">
            <p className="font-semibold text-red-800">
              Denied — CARC {claim.carcCode}
              {claim.rarcCode ? ` / RARC ${claim.rarcCode}` : ""}
            </p>
            <p className="mt-0.5 text-red-700">{claim.denialReason}</p>
            {claim.rarcReason && (
              <p className="mt-0.5 text-red-700/80">{claim.rarcReason}</p>
            )}
          </div>
        </div>
      )}

      {claim.frequencyCode === "7" && claim.originalClaimId && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-[#1e3a5f]/20 bg-[#eef3fa] p-4">
          <RefreshCw className="mt-0.5 size-5 shrink-0 text-[#1e3a5f]" />
          <div className="text-sm">
            <p className="font-semibold text-[#1e3a5f]">
              Corrected claim (837P frequency 7 — replacement)
            </p>
            <p className="mt-0.5 text-[#1e3a5f]/80">
              Replaces original claim{" "}
              <Link
                href={`/claims/${claim.originalClaimId}`}
                className="font-medium underline underline-offset-2"
              >
                {truncateId(claim.originalClaimId, 12)}
              </Link>
              {claim.originalPayerControlNumber
                ? ` · original payer ref ${claim.originalPayerControlNumber}`
                : ""}
              {claim.correctionCount > 0
                ? ` · correction #${claim.correctionCount}`
                : ""}
              .
            </p>
            {claim.correctionReason && (
              <p className="mt-0.5 text-[#1e3a5f]/70">
                Reason: {claim.correctionReason}
              </p>
            )}
          </div>
        </div>
      )}

      {claim.correctedByClaimId && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <Link2 className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800">
              Superseded by a corrected claim
            </p>
            <p className="mt-0.5 text-amber-700">
              A corrected replacement was filed for this claim —{" "}
              <Link
                href={`/claims/${claim.correctedByClaimId}`}
                className="font-medium underline underline-offset-2"
              >
                view corrected claim {truncateId(claim.correctedByClaimId, 12)}
              </Link>
              .
            </p>
          </div>
        </div>
      )}

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
              {claim.providerName && (
                <div>
                  <span className="text-muted-foreground">Provider: </span>
                  {claim.providerName}
                  {claim.providerNpi ? ` (NPI ${claim.providerNpi})` : ""}
                </div>
              )}
              {claim.dateOfService && (
                <div>
                  <span className="text-muted-foreground">
                    Date of service:{" "}
                  </span>
                  {claim.dateOfService}
                </div>
              )}
            </CardContent>
          </Card>

          {claim.eligibilityChecked && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {claim.eligibilityActive ? (
                    <ShieldCheck className="size-4 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="size-4 text-red-600" />
                  )}
                  Coverage &amp; benefits
                </CardTitle>
                <CardDescription>
                  271 eligibility response{claim.planName ? ` — ${claim.planName}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Coverage</span>
                  <Badge
                    variant={claim.eligibilityActive ? "success" : "danger"}
                  >
                    {claim.eligibilityActive ? "Active" : "Terminated"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Copay</span>
                  <span>{formatCurrency(claim.copay)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Coinsurance</span>
                  <span>{Math.round(claim.coinsurance * 100)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Deductible remaining
                  </span>
                  <span>
                    {formatCurrency(claim.deductibleRemaining)}
                    <span className="text-muted-foreground">
                      {" "}
                      / {formatCurrency(claim.deductibleTotal)}
                    </span>
                  </span>
                </div>
                {claim.priorAuthCpts.length > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Prior auth (CPT {claim.priorAuthCpts.join(", ")})
                    </span>
                    <Badge
                      variant={claim.priorAuthOnFile ? "success" : "warning"}
                    >
                      {claim.priorAuthOnFile ? "On file" : "Not on file"}
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

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
              {hasPayment && (
                <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Payer paid</span>
                    <span className="font-medium text-emerald-700">
                      {formatCurrency(claim.amountPaid)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Patient responsibility
                    </span>
                    <span className="font-medium">
                      {formatCurrency(claim.patientResponsibility)}
                    </span>
                  </div>
                  {claim.reconDiscrepancy && (
                    <div className="flex items-center justify-between text-amber-700">
                      <span className="flex items-center gap-1">
                        <AlertTriangle className="size-3.5" />
                        Variance vs expected
                      </span>
                      <span className="font-medium">
                        {formatCurrency(claim.reconVariance)}
                      </span>
                    </div>
                  )}
                  {claim.era?.checkNumber && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">ERA check</span>
                      <span className="font-mono text-xs">
                        {claim.era.checkNumber}
                      </span>
                    </div>
                  )}
                </div>
              )}
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

          {claim.reviewerDecision && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reviewer Decision</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Badge
                  variant={
                    claim.reviewerDecision === "approved" ? "success" : "danger"
                  }
                  className="gap-1"
                >
                  {claim.reviewerDecision === "approved" ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <XCircle className="size-3.5" />
                  )}
                  {claim.reviewerDecision === "approved"
                    ? "Approved"
                    : "Rejected"}
                </Badge>
                {claim.reviewerName && (
                  <p className="text-xs text-muted-foreground">
                    by {claim.reviewerName}
                    {claim.reviewerRole ? ` · ${claim.reviewerRole}` : ""}
                  </p>
                )}
                {claim.reviewerComment && (
                  <blockquote className="border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
                    {claim.reviewerComment}
                  </blockquote>
                )}
              </CardContent>
            </Card>
          )}

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

          {isDenied && !claim.correctedByClaimId && (
            <CorrectClaimPanel claim={claim} />
          )}

          <ReviewCopilot
            claimId={claim.claimId}
            needsHumanReview={claim.needsHumanReview}
          />
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

      {claim.claimLines.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="size-4" />
              Service lines
            </CardTitle>
            <CardDescription>
              {hasPayment
                ? "Billed services with line-level payer adjudication from the 835/ERA"
                : "Billed services extracted from the superbill"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">CPT</th>
                    <th className="px-2 py-2">Mod</th>
                    <th className="px-2 py-2">ICD-10</th>
                    <th className="px-2 py-2 text-right">Units</th>
                    <th className="px-2 py-2 text-right">Billed</th>
                    {hasPayment && (
                      <>
                        <th className="px-2 py-2 text-right">Allowed</th>
                        <th className="px-2 py-2 text-right">Paid</th>
                        <th className="px-2 py-2 text-right">Patient</th>
                        <th className="px-2 py-2">Outcome</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {claim.claimLines.map((line) => {
                    const era = eraLinesByNo.get(line.lineNo);
                    return (
                      <tr
                        key={line.lineNo}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-2 py-2.5 text-muted-foreground">
                          {line.lineNo}
                        </td>
                        <td className="px-2 py-2.5 font-mono font-medium">
                          {line.cptCode}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-muted-foreground">
                          {line.modifiers.join(", ") || "—"}
                        </td>
                        <td className="px-2 py-2.5 font-mono text-muted-foreground">
                          {line.icd10Codes.join(", ") || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-right">{line.units}</td>
                        <td className="px-2 py-2.5 text-right">
                          {formatCurrency(line.charge)}
                        </td>
                        {hasPayment && (
                          <>
                            <td className="px-2 py-2.5 text-right text-muted-foreground">
                              {era ? formatCurrency(era.allowed) : "—"}
                            </td>
                            <td className="px-2 py-2.5 text-right font-medium">
                              {era ? formatCurrency(era.paid) : "—"}
                            </td>
                            <td className="px-2 py-2.5 text-right text-muted-foreground">
                              {era
                                ? formatCurrency(era.patientResponsibility)
                                : "—"}
                            </td>
                            <td className="px-2 py-2.5">
                              {era?.denied ? (
                                <Badge variant="danger">
                                  Denied {era.groupCode}-{era.carcCode}
                                </Badge>
                              ) : era?.underpaid ? (
                                <Badge variant="warning">Underpaid</Badge>
                              ) : era ? (
                                <Badge variant="success">Paid</Badge>
                              ) : (
                                "—"
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {hasPayment && claim.era && (
                  <tfoot>
                    <tr className="border-t font-medium">
                      <td className="px-2 py-2.5" colSpan={5}>
                        Totals
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {formatCurrency(claim.era.totalBilled)}
                      </td>
                      <td className="px-2 py-2.5" />
                      <td className="px-2 py-2.5 text-right text-emerald-700">
                        {formatCurrency(claim.era.totalPaid)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        {formatCurrency(claim.era.totalPatientResponsibility)}
                      </td>
                      <td className="px-2 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {adjustedLines.length > 0 && (
              <div className="mt-4 space-y-2 border-t pt-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Receipt className="size-3.5" />
                  Claim adjustment reason codes (835 CAS segments)
                </p>
                {adjustedLines.map((line) =>
                  line.adjustments.map((adj, i) => (
                    <div
                      key={`${line.lineNo}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-2 text-sm"
                    >
                      <span className="font-mono text-xs font-medium text-muted-foreground">
                        Line {line.lineNo}
                      </span>
                      <span
                        className={cn(
                          "inline-flex rounded px-1.5 py-0.5 font-mono text-xs font-medium",
                          adj.group === "PR"
                            ? "bg-blue-100 text-blue-800"
                            : adj.group === "CO"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800",
                        )}
                      >
                        {adj.group}-{adj.carc}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(adj.amount)}
                      </span>
                      <span className="text-muted-foreground">
                        {adj.description}
                      </span>
                    </div>
                  )),
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {claim.scrubFindings.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" />
              Scrub findings
            </CardTitle>
            <CardDescription>
              {scrubErrors.length} error{scrubErrors.length === 1 ? "" : "s"}
              {scrubWarnings.length > 0
                ? `, ${scrubWarnings.length} warning${scrubWarnings.length === 1 ? "" : "s"}`
                : ""}{" "}
              from pre-submission claim edits
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {[...scrubErrors, ...scrubWarnings].map((finding, index) => (
              <div
                key={`${finding.rule}-${index}`}
                className={cn(
                  "flex items-start gap-3 rounded-md border p-3 text-sm",
                  finding.severity === "error"
                    ? "border-red-200 bg-red-50/60"
                    : "border-amber-200 bg-amber-50/60",
                )}
              >
                <AlertTriangle
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    finding.severity === "error"
                      ? "text-red-600"
                      : "text-amber-600",
                  )}
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">
                      {finding.rule}
                    </span>
                    {finding.lineNo !== null && (
                      <span className="text-xs text-muted-foreground">
                        Line {finding.lineNo}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5">{finding.message}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
