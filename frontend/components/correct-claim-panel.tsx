"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2, RefreshCw } from "lucide-react";

import { correctClaim, type CorrectionLineInput } from "@/lib/api";
import type { Claim } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface EditableLine {
  lineNo: number;
  cptCode: string;
  modifiers: string;
  icd10Codes: string;
  units: number;
  charge: number;
}

interface CorrectClaimPanelProps {
  claim: Claim;
}

function toEditable(claim: Claim): EditableLine[] {
  return claim.claimLines.map((line) => ({
    lineNo: line.lineNo,
    cptCode: line.cptCode,
    modifiers: line.modifiers.join(", "),
    icd10Codes: line.icd10Codes.join(", "),
    units: line.units,
    charge: line.charge,
  }));
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function CorrectClaimPanel({
  claim,
}: CorrectClaimPanelProps): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EditableLine[]>(() => toEditable(claim));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateLine = (
    index: number,
    field: "modifiers" | "icd10Codes",
    value: string,
  ): void => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
    );
  };

  const handleSubmit = async (): Promise<void> => {
    if (!reason.trim()) {
      setError("Please describe what you corrected and why.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload: CorrectionLineInput[] = lines.map((line) => ({
        line_no: line.lineNo,
        cpt_code: line.cptCode,
        modifiers: parseCsv(line.modifiers),
        icd10_codes: parseCsv(line.icd10Codes),
        units: line.units,
        charge: line.charge,
      }));
      const result = await correctClaim(claim.claimId, reason.trim(), payload);
      router.push(`/claims/${result.claimId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to file corrected claim.",
      );
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setLines(toEditable(claim));
          setOpen(true);
        }}
      >
        <RefreshCw className="size-4" />
        Correct &amp; Resubmit
      </Button>
    );
  }

  return (
    <Card className="border-[#1e3a5f]/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FilePlus2 className="size-4" />
          File corrected claim
        </CardTitle>
        <CardDescription>
          Submits an 837P frequency 7 (replacement) referencing payer ref{" "}
          <span className="font-mono">
            {claim.clearinghouseRef || "n/a"}
          </span>
          . Edit the lines you fixed, then resubmit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {lines.map((line, index) => (
            <div
              key={line.lineNo}
              className="rounded-md border bg-muted/20 p-3 text-sm"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="font-mono font-medium">{line.cptCode}</span>
                <span className="text-xs text-muted-foreground">
                  Line {line.lineNo} · {line.units} unit(s)
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    Modifiers (comma-separated)
                  </span>
                  <input
                    value={line.modifiers}
                    onChange={(e) =>
                      updateLine(index, "modifiers", e.target.value)
                    }
                    placeholder="e.g. 25, 59"
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    ICD-10 codes (comma-separated)
                  </span>
                  <input
                    value={line.icd10Codes}
                    onChange={(e) =>
                      updateLine(index, "icd10Codes", e.target.value)
                    }
                    placeholder="e.g. E11.9, I10"
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Correction reason (required)
          </span>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Added modifier 25 to the E/M line to support same-day immunization administration."
            rows={3}
          />
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Resubmitting…
              </>
            ) : (
              <>
                <RefreshCw className="size-4" />
                Resubmit corrected claim
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
