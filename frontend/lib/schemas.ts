import { z } from "zod";

export const claimStatusSchema = z.enum([
  "draft",
  "extracted",
  "coded",
  "scrubbed",
  "needs_review",
  "submitted",
  "denied",
  "appealed",
  "paid",
  "reconciled",
]);

export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const uploadResponseSchema = z.object({
  claim_id: z.string(),
  status: z.string(),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const agentEventSchema = z.object({
  agent: z.string(),
  event: z.string(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
  latency_ms: z.number().optional(),
});

export type AgentEvent = z.infer<typeof agentEventSchema>;

export const claimSchema = z
  .object({
    id: z.string().nullable().optional(),
    claim_id: z.string().nullable().optional(),
    org_id: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    patient_name: z.string().nullable().optional(),
    patient_dob: z.string().nullable().optional(),
    patient_member_id: z.string().nullable().optional(),
    payer_name: z.string().nullable().optional(),
    provider_name: z.string().nullable().optional(),
    total_charge: z.number().nullable().optional(),
    denial_risk: z.number().nullable().optional(),
    appeal_letter: z.string().nullable().optional(),
    cms1500_path: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .transform((data) => ({
    claimId: data.claim_id ?? data.id ?? "",
    orgId: data.org_id ?? "",
    status: data.status ?? "",
    patientName: data.patient_name ?? "",
    patientDob: data.patient_dob ?? "",
    patientMemberId: data.patient_member_id ?? "",
    payerName: data.payer_name ?? "",
    providerName: data.provider_name ?? "",
    totalCharge: data.total_charge ?? 0,
    denialRisk: data.denial_risk ?? 0,
    appealLetter: data.appeal_letter ?? "",
    cms1500Path: data.cms1500_path ?? "",
    createdAt: data.created_at ?? "",
  }));

export type Claim = z.infer<typeof claimSchema>;

export const claimsListSchema = z.array(claimSchema);

export type ClaimsList = z.infer<typeof claimsListSchema>;

export interface TimelineEvent extends AgentEvent {
  receivedAt: Date;
}
