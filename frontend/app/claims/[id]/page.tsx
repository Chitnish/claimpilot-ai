"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  DollarSign,
  Download,
  Info,
  Link2,
  Loader2,
  MessageSquareWarning,
  PauseCircle,
  Receipt,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  User,
  XCircle,
} from "lucide-react";

import { API_BASE, cms1500Url, getClaim, sendAppealEmail, statementUrl } from "@/lib/api";
import {
  agentBadgeClass,
  denialRiskColor,
  formatCurrency,
  formatStatus,
  statusBadgeClass,
  truncateId,
} from "@/lib/claim-ui";
import { agentEventSchema, type Claim, type DisputeMessage, type TimelineEvent } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { Reveal } from "@/components/ui/motion";

function formatDisputeTimestamp(value: string): string {
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
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function disputeSenderLabel(sender: string): string {
  if (sender === "payer_reply") {
    return "Payer";
  }
  if (sender === "ai_reply") {
    return "ClaimPilot AI";
  }
  return sender;
}

// Left-edge accent per agent type for the operations console feed.
const AGENT_BORDER: Record<string, string> = {
  intake: "border-l-blue-500",
  eligibility: "border-l-teal-500",
  coding: "border-l-purple-500",
  scrub: "border-l-orange-500",
  submission: "border-l-red-500",
  reconciliation: "border-l-emerald-500",
  fraud: "border-l-slate-400",
  human_review: "border-l-amber-500",
  system: "border-l-slate-300",
};

function agentBorderClass(agent: string): string {
  return AGENT_BORDER[agent.toLowerCase()] ?? AGENT_BORDER.system;
}

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
  const [editedLetter, setEditedLetter] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [appealEmailSent, setAppealEmailSent] = useState(false);

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
    if (claim?.appealLetter) {
      setEditedLetter(claim.appealLetter);
    }
  }, [claim?.appealLetter]);

  useEffect(() => {
    if (claim) {
      setAppealEmailSent(claim.appealEmailSent);
    }
  }, [claim?.appealEmailSent]);

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
        <Loader2 className="size-8 animate-spin text-brand" />
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
      <div className="mb-6">
        <Link
          href="/claims"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-3.5" />
          Claims
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Claim Detail
            </p>
            <h1 className="mt-1.5 flex flex-wrap items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-white">
              Claim
              <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-base font-medium text-slate-200">
                {truncateId(claim.claimId, 12)}
              </span>
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {claim.patientName || "—"}
              {claim.payerName ? ` · ${claim.payerName}` : ""}
              {claim.dateOfService ? ` · DOS ${claim.dateOfService}` : ""}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "px-3 py-1 text-sm",
              statusBadgeClass(claim.status),
              claim.status === "needs_review" && "animate-status-pulse",
            )}
          >
            {formatStatus(claim.status)}
          </Badge>
        </div>
      </div>

      {isDenied && claim.carcCode && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-4">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-red-400" />
          <div className="text-sm">
            <p className="font-semibold text-red-300">
              Denied — CARC {claim.carcCode}
              {claim.rarcCode ? ` / RARC ${claim.rarcCode}` : ""}
            </p>
            <p className="mt-0.5 text-red-300">{claim.denialReason}</p>
            {claim.rarcReason && (
              <p className="mt-0.5 text-red-300/80">{claim.rarcReason}</p>
            )}
          </div>
        </div>
      )}

      {claim.frequencyCode === "7" && claim.originalClaimId && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-sky-500/25 bg-sky-500/10 p-4">
          <RefreshCw className="mt-0.5 size-5 shrink-0 text-brand" />
          <div className="text-sm">
            <p className="font-semibold text-sky-200">
              Corrected claim (837P frequency 7 — replacement)
            </p>
            <p className="mt-0.5 text-sky-300/90">
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
              <p className="mt-0.5 text-sky-300/70">
                Reason: {claim.correctionReason}
              </p>
            )}
          </div>
        </div>
      )}

      {claim.correctedByClaimId && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-4">
          <Link2 className="mt-0.5 size-5 shrink-0 text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold text-amber-300">
              Superseded by a corrected claim
            </p>
            <p className="mt-0.5 text-amber-300">
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

      <Reveal className="mb-6">
        <PipelineDiagram
          activeAgent={activeAgent}
          completedAgents={completedAgents}
          status={claim.status}
        />
      </Reveal>

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
                    <ShieldCheck className="size-4 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="size-4 text-red-400" />
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
              <CardTitle className="flex items-center gap-2 text-base">
                <DollarSign className="size-4 text-emerald-400" />
                Financials
              </CardTitle>
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
                    <span className="font-medium text-emerald-300">
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
                    <div className="flex items-center justify-between text-amber-300">
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
                <div className="h-2 w-full rounded-full bg-white/10">
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
                              ? "bg-amber-500/15 text-amber-300"
                              : factor.includes("-")
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-white/[0.06] text-slate-200",
                          )}
                        >
                          {factor}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {claim.anomalyScore > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      {claim.anomalyReasons.length > 0 ? (
                        <ShieldAlert className="size-3.5 shrink-0 text-red-400" />
                      ) : (
                        <Info className="size-3.5 shrink-0" />
                      )}
                      <span>
                        Fraud/anomaly score: {Math.round(claim.anomalyScore * 100)}%
                      </span>
                    </div>
                    {claim.anomalyReasons.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {claim.anomalyReasons.map((reason, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 rounded-md border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-300"
                          >
                            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                            <span>{reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              {claim.patientBalance > 0 && (
                <div className="space-y-1.5 rounded-md border border-sky-500/25 bg-sky-500/10 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-sky-200">
                      <Receipt className="size-3.5" />
                      Patient balance due
                    </span>
                    <span className="font-semibold text-sky-200">
                      {formatCurrency(claim.patientBalance)}
                    </span>
                  </div>
                  {claim.arStatus && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">A/R status</span>
                      <Badge
                        variant={
                          claim.arStatus === "paid" ? "success" : "warning"
                        }
                      >
                        {claim.arStatus === "paid" ? "Paid" : "Open"}
                      </Badge>
                    </div>
                  )}
                </div>
              )}
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
              {claim.patientStatementPath && (
                <Button asChild variant="outline" className="w-full">
                  <a
                    href={statementUrl(claimId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Receipt className="size-4" />
                    Download Patient Statement
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
                <CardContent className="space-y-3">
                  <Textarea
                    value={editedLetter}
                    onChange={(e) => setEditedLetter(e.target.value)}
                    rows={12}
                    className="w-full text-sm leading-relaxed text-muted-foreground"
                  />
                  <div className="flex items-center gap-2">
                    {appealEmailSent ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="size-3.5" />
                        Sent to payer
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="gap-1">
                        Draft — not yet sent
                      </Badge>
                    )}
                  </div>
                  {sendSuccess && (
                    <p className="text-sm text-emerald-400">
                      Appeal email sent successfully.
                    </p>
                  )}
                  {sendError && (
                    <p className="text-sm text-destructive">{sendError}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(editedLetter);
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
                    <Button
                      size="sm"
                      className="bg-brand text-white hover:bg-brand-dark"
                      disabled={sending}
                      onClick={() => {
                        void (async () => {
                          setSending(true);
                          setSendError(null);
                          setSendSuccess(false);
                          try {
                            await sendAppealEmail(claimId, editedLetter);
                            setAppealEmailSent(true);
                            setSendSuccess(true);
                            void loadClaim();
                          } catch (err) {
                            const message =
                              err instanceof Error
                                ? err.message
                                : "Failed to send appeal email";
                            setSendError(message);
                          } finally {
                            setSending(false);
                          }
                        })();
                      }}
                    >
                      {sending ? (
                        <>
                          <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                          Sending…
                        </>
                      ) : (
                        <>
                          <Send className="size-3.5 mr-1.5" />
                          Send Appeal Email
                        </>
                      )}
                    </Button>
                  </div>
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

        <Card className="overflow-hidden border-white/10 bg-clinical-shell shadow-float lg:col-span-2">
          <div className="sidebar-surface flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                <Bot className="size-4 text-brand" />
              </span>
              <div>
                <h2 className="font-display text-sm font-semibold tracking-tight text-white">
                  Agent Activity
                </h2>
                <p className="text-xs text-slate-400">
                  Real-time updates from the ClaimPilot pipeline
                </p>
              </div>
            </div>
            {isPaused ? (
              <div className="flex items-center gap-2 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
                <PauseCircle className="size-3.5 shrink-0" />
                Paused for review
              </div>
            ) : isDone ? (
              <div className="flex items-center gap-2 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                <CheckCircle2 className="size-3.5 shrink-0" />
                Pipeline complete
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-medium text-sky-300">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                Live
              </div>
            )}
          </div>
          <CardContent className="pt-4 sm:pt-6">
            <div className="scrollbar-thin max-h-[32rem] overflow-y-auto pr-1">
              {events.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <Loader2 className="size-5 animate-spin text-slate-400" />
                  <p className="text-sm text-slate-400">
                    Waiting for agent events…
                  </p>
                </div>
              ) : (
                events.map((event, index) => (
                  <motion.div
                    key={`${event.agent}-${event.event}-${index}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    className={cn(
                      "mb-2 rounded-lg border border-white/[0.07] border-l-[3px] bg-white/[0.03] px-3 py-2.5 transition-colors last:mb-0 hover:bg-white/[0.06]",
                      agentBorderClass(event.agent),
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
                          agentBadgeClass(event.agent),
                        )}
                      >
                        {event.agent.replace(/_/g, " ")}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {event.receivedAt.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-200">
                      {event.summary}
                    </p>
                  </motion.div>
                ))
              )}
              <div ref={feedEndRef} />
            </div>
          </CardContent>
        </Card>
      </div>

      {claim.claimLines.length > 0 && (
        <Reveal>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="size-4 text-brand" />
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
                      <td className="px-2 py-2.5 text-right text-emerald-300">
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
                            ? "bg-blue-500/15 text-blue-300"
                            : adj.group === "CO"
                              ? "bg-red-500/15 text-red-300"
                              : "bg-amber-500/15 text-amber-300",
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
        </Reveal>
      )}

      {claim.scrubFindings.length > 0 && (
        <Reveal>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-amber-500" />
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
                    ? "border-red-500/25 bg-red-500/10"
                    : "border-amber-500/25 bg-amber-500/10",
                )}
              >
                <AlertTriangle
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    finding.severity === "error"
                      ? "text-red-400"
                      : "text-amber-400",
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
        </Reveal>
      )}

      {claim.disputeThread.length > 0 && (
        <Reveal>
          <section className="mt-8">
            <div className="mb-4">
              <h2 className="font-display text-xl font-bold tracking-tight text-white">
                Dispute Log
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Email exchange following the appeal letter
              </p>
            </div>
            <Card className="overflow-hidden">
              {/* Chat header */}
              <div className="sidebar-surface flex items-center justify-between border-b border-white/10 px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/10">
                    <MessageSquareWarning className="size-4 text-amber-300" />
                  </span>
                  <div>
                    <p className="font-display text-sm font-semibold text-white">
                      Appeal Correspondence
                    </p>
                    <p className="text-xs text-slate-400">
                      {claim.disputeThread.length} message
                      {claim.disputeThread.length === 1 ? "" : "s"}
                      {claim.carcCode ? ` · CARC ${claim.carcCode}` : ""}
                    </p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-4 bg-white/[0.03] pt-6">
                {claim.hasPendingDispute && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                    <MessageSquareWarning className="mt-0.5 size-4 shrink-0" />
                    <p>
                      This dispute has been flagged for human review.{" "}
                      <Link
                        href="/disputes"
                        className="font-medium underline underline-offset-2"
                      >
                        View pending disputes
                      </Link>
                    </p>
                  </div>
                )}
                <div className="space-y-5">
                  {claim.disputeThread.map(
                    (msg: DisputeMessage, index: number) => {
                      const isAi = msg.sender === "ai_reply";
                      return (
                        <div
                          key={`${msg.sender}-${index}`}
                          className={cn(
                            "flex items-end gap-2.5",
                            isAi ? "flex-row-reverse" : "flex-row",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-8 shrink-0 items-center justify-center rounded-full shadow-sm ring-1",
                              isAi
                                ? "bg-gradient-to-br from-brand to-brand-dark text-white ring-white/30"
                                : "bg-white/[0.03] text-slate-400 ring-white/10",
                            )}
                          >
                            {isAi ? (
                              <Bot className="size-4" />
                            ) : (
                              <User className="size-4" />
                            )}
                          </span>
                          <div
                            className={cn(
                              "max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm",
                              isAi
                                ? "rounded-br-sm bg-gradient-to-br from-brand to-brand-dark text-white"
                                : "rounded-bl-sm border border-white/10 bg-white/[0.03] text-slate-200",
                            )}
                          >
                            <p
                              className={cn(
                                "mb-1.5 text-xs font-semibold",
                                isAi ? "text-sky-100" : "text-slate-300",
                              )}
                            >
                              {disputeSenderLabel(msg.sender)}
                              {msg.createdAt && (
                                <span
                                  className={cn(
                                    "ml-2 font-normal",
                                    isAi ? "text-sky-200/80" : "text-slate-400",
                                  )}
                                >
                                  {formatDisputeTimestamp(msg.createdAt)}
                                </span>
                              )}
                            </p>
                            <p className="whitespace-pre-wrap leading-relaxed">
                              {msg.messageText}
                            </p>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </CardContent>
            </Card>
          </section>
        </Reveal>
      )}
    </div>
  );
}
