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

export const claimLineSchema = z
  .object({
    line_no: z.number(),
    cpt_code: z.string(),
    modifiers: z.array(z.string()).default([]),
    icd10_codes: z.array(z.string()).default([]),
    units: z.number().default(1),
    charge: z.number().default(0),
  })
  .transform((data) => ({
    lineNo: data.line_no,
    cptCode: data.cpt_code,
    modifiers: data.modifiers,
    icd10Codes: data.icd10_codes,
    units: data.units,
    charge: data.charge,
  }));

export type ClaimLine = z.infer<typeof claimLineSchema>;

export const scrubFindingSchema = z
  .object({
    severity: z.string(),
    rule: z.string(),
    message: z.string(),
    line_no: z.number().nullable().optional(),
  })
  .transform((data) => ({
    severity: data.severity,
    rule: data.rule,
    message: data.message,
    lineNo: data.line_no ?? null,
  }));

export type ScrubFinding = z.infer<typeof scrubFindingSchema>;

export const eraAdjustmentSchema = z.object({
  group: z.string().default(""),
  carc: z.string().default(""),
  amount: z.number().default(0),
  description: z.string().default(""),
});

export type EraAdjustment = z.infer<typeof eraAdjustmentSchema>;

export const eraLineSchema = z
  .object({
    line_no: z.number(),
    cpt_code: z.string().default(""),
    billed: z.number().default(0),
    allowed: z.number().default(0),
    paid: z.number().default(0),
    denied: z.boolean().default(false),
    carc_code: z.string().default(""),
    rarc_code: z.string().default(""),
    group_code: z.string().default(""),
    patient_responsibility: z.number().optional(),
    adjustments: z.array(eraAdjustmentSchema).default([]),
    underpaid: z.boolean().optional(),
  })
  .transform((data) => ({
    lineNo: data.line_no,
    cptCode: data.cpt_code,
    billed: data.billed,
    allowed: data.allowed,
    paid: data.paid,
    denied: data.denied,
    carcCode: data.carc_code,
    rarcCode: data.rarc_code,
    groupCode: data.group_code,
    patientResponsibility: data.patient_responsibility ?? 0,
    adjustments: data.adjustments,
    underpaid: data.underpaid ?? false,
  }));

export type EraLine = z.infer<typeof eraLineSchema>;

export const eraSchema = z
  .object({
    check_number: z.string().default(""),
    payer_name: z.string().default(""),
    service_date: z.string().default(""),
    total_billed: z.number().default(0),
    total_paid: z.number().default(0),
    total_patient_responsibility: z.number().default(0),
    carc_code: z.string().default(""),
    rarc_code: z.string().default(""),
    underpayment_detected: z.boolean().default(false),
    lines: z.array(eraLineSchema).default([]),
  })
  .transform((data) => ({
    checkNumber: data.check_number,
    payerName: data.payer_name,
    serviceDate: data.service_date,
    totalBilled: data.total_billed,
    totalPaid: data.total_paid,
    totalPatientResponsibility: data.total_patient_responsibility,
    carcCode: data.carc_code,
    rarcCode: data.rarc_code,
    underpaymentDetected: data.underpayment_detected,
    lines: data.lines,
  }));

export type Era = z.infer<typeof eraSchema>;

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
    provider_npi: z.string().nullable().optional(),
    date_of_service: z.string().nullable().optional(),
    claim_lines: z.array(claimLineSchema).nullable().optional(),
    total_charge: z.number().nullable().optional(),
    denial_risk: z.number().nullable().optional(),
    denial_risk_factors: z.array(z.string()).nullable().optional(),
    anomaly_score: z.number().nullable().optional(),
    appeal_letter: z.string().nullable().optional(),
    cms1500_path: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    low_confidence_fields: z.array(z.string()).nullable().optional(),
    scrub_findings: z.array(scrubFindingSchema).nullable().optional(),
    eligibility_checked: z.boolean().nullable().optional(),
    eligibility_active: z.boolean().nullable().optional(),
    plan_name: z.string().nullable().optional(),
    copay: z.number().nullable().optional(),
    coinsurance: z.number().nullable().optional(),
    deductible_total: z.number().nullable().optional(),
    deductible_remaining: z.number().nullable().optional(),
    prior_auth_cpts: z.array(z.string()).nullable().optional(),
    prior_auth_on_file: z.boolean().nullable().optional(),
    clearinghouse_ref: z.string().nullable().optional(),
    carc_code: z.string().nullable().optional(),
    rarc_code: z.string().nullable().optional(),
    denial_reason: z.string().nullable().optional(),
    rarc_reason: z.string().nullable().optional(),
    era: eraSchema.nullable().optional(),
    amount_paid: z.number().nullable().optional(),
    amount_expected: z.number().nullable().optional(),
    patient_responsibility: z.number().nullable().optional(),
    recon_variance: z.number().nullable().optional(),
    recon_discrepancy: z.boolean().nullable().optional(),
    recon_notes: z.string().nullable().optional(),
    needs_human_review: z.boolean().nullable().optional(),
    review_reason: z.string().nullable().optional(),
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
    providerNpi: data.provider_npi ?? "",
    dateOfService: data.date_of_service ?? "",
    claimLines: data.claim_lines ?? [],
    totalCharge: data.total_charge ?? 0,
    denialRisk: data.denial_risk ?? 0,
    denialRiskFactors: data.denial_risk_factors ?? [],
    anomalyScore: data.anomaly_score ?? 0,
    appealLetter: data.appeal_letter ?? "",
    cms1500Path: data.cms1500_path ?? "",
    createdAt: data.created_at ?? "",
    lowConfidenceFields: data.low_confidence_fields ?? [],
    scrubFindings: data.scrub_findings ?? [],
    eligibilityChecked: data.eligibility_checked ?? false,
    eligibilityActive: data.eligibility_active ?? false,
    planName: data.plan_name ?? "",
    copay: data.copay ?? 0,
    coinsurance: data.coinsurance ?? 0,
    deductibleTotal: data.deductible_total ?? 0,
    deductibleRemaining: data.deductible_remaining ?? 0,
    priorAuthCpts: data.prior_auth_cpts ?? [],
    priorAuthOnFile: data.prior_auth_on_file ?? false,
    clearinghouseRef: data.clearinghouse_ref ?? "",
    carcCode: data.carc_code ?? "",
    rarcCode: data.rarc_code ?? "",
    denialReason: data.denial_reason ?? "",
    rarcReason: data.rarc_reason ?? "",
    era: data.era && data.era.lines.length > 0 ? data.era : null,
    amountPaid: data.amount_paid ?? 0,
    amountExpected: data.amount_expected ?? 0,
    patientResponsibility: data.patient_responsibility ?? 0,
    reconVariance: data.recon_variance ?? 0,
    reconDiscrepancy: data.recon_discrepancy ?? false,
    reconNotes: data.recon_notes ?? "",
    needsHumanReview: data.needs_human_review ?? false,
    reviewReason: data.review_reason ?? "",
  }));

export type Claim = z.infer<typeof claimSchema>;

export const claimsListSchema = z.array(claimSchema);

export type ClaimsList = z.infer<typeof claimsListSchema>;

export interface TimelineEvent extends AgentEvent {
  receivedAt: Date;
}

export const reviewDetailsSchema = z.object({
  denial_risk: z.number().optional(),
  low_confidence_fields: z.array(z.string()).optional(),
});

export type ReviewDetails = z.infer<typeof reviewDetailsSchema>;

export const reviewItemSchema = z
  .object({
    id: z.string(),
    claim_id: z.string(),
    reason: z.string().default(""),
    details: reviewDetailsSchema.default({}),
    created_at: z.string().default(""),
    claim_status: z.string().default(""),
    total_charge: z.number().default(0),
    patient_name: z.string().default(""),
    denial_risk: z.number().default(0),
  })
  .transform((data) => ({
    id: data.id,
    claimId: data.claim_id,
    reason: data.reason,
    details: data.details,
    createdAt: data.created_at,
    claimStatus: data.claim_status,
    totalCharge: data.total_charge,
    patientName: data.patient_name,
    denialRisk: data.denial_risk,
  }));

export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const reviewQueueSchema = z.array(reviewItemSchema);

export type ReviewQueue = z.infer<typeof reviewQueueSchema>;

export const resumeResponseSchema = z.object({
  resumed: z.boolean(),
  approved: z.boolean(),
});

export type ResumeResponse = z.infer<typeof resumeResponseSchema>;

export const claimSearchResponseSchema = z
  .object({
    items: z.array(claimSchema),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    facets: z.object({ payers: z.array(z.string()).default([]) }).default({ payers: [] }),
  })
  .transform((data) => ({
    items: data.items,
    total: data.total,
    limit: data.limit,
    offset: data.offset,
    payers: data.facets.payers,
  }));

export type ClaimSearchResponse = z.infer<typeof claimSearchResponseSchema>;

export const analyticsSchema = z
  .object({
    total_claims: z.number(),
    total_billed: z.number(),
    denial_rate: z.number(),
    avg_denial_risk: z.number(),
    high_risk_open: z.number(),
    status_counts: z.record(z.string(), z.number()),
    top_denial_reasons: z.array(
      z.object({
        carc_code: z.string(),
        description: z.string(),
        count: z.number(),
      }),
    ),
    payers: z.array(
      z.object({
        payer: z.string(),
        claims: z.number(),
        billed: z.number(),
        denied: z.number(),
        denial_rate: z.number(),
      }),
    ),
    daily_volume: z.array(
      z.object({
        date: z.string(),
        claims: z.number(),
        billed: z.number(),
      }),
    ),
  })
  .transform((data) => ({
    totalClaims: data.total_claims,
    totalBilled: data.total_billed,
    denialRate: data.denial_rate,
    avgDenialRisk: data.avg_denial_risk,
    highRiskOpen: data.high_risk_open,
    statusCounts: data.status_counts,
    topDenialReasons: data.top_denial_reasons.map((r) => ({
      carcCode: r.carc_code,
      description: r.description,
      count: r.count,
    })),
    payers: data.payers.map((p) => ({
      payer: p.payer,
      claims: p.claims,
      billed: p.billed,
      denied: p.denied,
      denialRate: p.denial_rate,
    })),
    dailyVolume: data.daily_volume,
  }));

export type Analytics = z.infer<typeof analyticsSchema>;
