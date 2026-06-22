import {
  agentEventSchema,
  analyticsSchema,
  arAgingSchema,
  bulkResumeResponseSchema,
  claimSchema,
  claimSearchResponseSchema,
  claimsListSchema,
  copilotResponseSchema,
  correctionResponseSchema,
  resumeResponseSchema,
  reviewQueueSchema,
  uploadResponseSchema,
  batchUploadResponseSchema,
  disputeQueueSchema,
  resolveDisputeResponseSchema,
  patientListResponseSchema,
  patientDetailSchema,
  patientRecordSchema,
  type AgentEvent,
  type BatchUploadResponse,
  type Analytics,
  type ArAging,
  type BulkResumeResponse,
  type Claim,
  type ClaimSearchResponse,
  type CopilotChatMessage,
  type CopilotResponse,
  type CorrectionResponse,
  type ResumeResponse,
  type ReviewItem,
  type DisputeItem,
  type UploadResponse,
  type PatientListResponse,
  type PatientDetail,
  type PatientRecord,
} from "@/lib/schemas";

import { actorHeaders, getActor } from "@/lib/actor";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function parseJson<T>(
  response: Response,
  schema: { parse: (data: unknown) => T },
): Promise<T> {
  const data: unknown = await response.json();
  return schema.parse(data);
}

/** Best-effort extraction of a FastAPI `{ detail }` error message. */
async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === "object" &&
      "detail" in body &&
      typeof (body as { detail: unknown }).detail === "string"
    ) {
      return (body as { detail: string }).detail;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

export async function uploadClaim(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${API_BASE}/claims/upload`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status})`);
  }

  return parseJson(response, uploadResponseSchema);
}

export async function uploadClaimBatch(
  files: File[],
): Promise<BatchUploadResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));

  const response = await fetch(`${API_BASE}/claims/upload-batch`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Batch upload failed (${response.status})`);
  }

  return parseJson(response, batchUploadResponseSchema);
}

export async function getClaim(claimId: string): Promise<Claim> {
  const response = await fetch(`${API_BASE}/claims/${claimId}`);

  if (!response.ok) {
    throw new Error(`Claim not found (${response.status})`);
  }

  return parseJson(response, claimSchema);
}

export async function listClaims(): Promise<Claim[]> {
  const response = await fetch(`${API_BASE}/claims`);

  if (!response.ok) {
    throw new Error(`Failed to load claims (${response.status})`);
  }

  return parseJson(response, claimsListSchema);
}

export interface ClaimSearchParams {
  q?: string;
  status?: string;
  payer?: string;
  limit?: number;
  offset?: number;
}

export async function searchClaims(
  params: ClaimSearchParams,
): Promise<ClaimSearchResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  if (params.payer) query.set("payer", params.payer);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));

  const response = await fetch(`${API_BASE}/claims/search?${query.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to search claims (${response.status})`);
  }

  return parseJson(response, claimSearchResponseSchema);
}

export function exportClaimsUrl(params: ClaimSearchParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  if (params.payer) query.set("payer", params.payer);
  return `${API_BASE}/claims/export.csv?${query.toString()}`;
}

export async function bulkResume(
  claimIds: string[],
  approved: boolean,
  reviewerNotes: string,
): Promise<BulkResumeResponse> {
  const response = await fetch(`${API_BASE}/review/bulk-resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify({
      claim_ids: claimIds,
      approved,
      reviewer_comment: reviewerNotes,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Bulk action failed (${response.status})`),
    );
  }

  return parseJson(response, bulkResumeResponseSchema);
}

export async function getAnalytics(): Promise<Analytics> {
  const response = await fetch(`${API_BASE}/analytics`);

  if (!response.ok) {
    throw new Error(`Failed to load analytics (${response.status})`);
  }

  return parseJson(response, analyticsSchema);
}

function actorQuery(): string {
  const actor = getActor();
  return new URLSearchParams({
    actor_id: actor.id,
    actor_name: actor.name,
    actor_role: actor.role,
  }).toString();
}

export function cms1500Url(claimId: string): string {
  return `${API_BASE}/claims/${claimId}/cms1500?${actorQuery()}`;
}

export function statementUrl(claimId: string): string {
  return `${API_BASE}/claims/${claimId}/statement?${actorQuery()}`;
}

export async function getArAging(): Promise<ArAging> {
  const response = await fetch(`${API_BASE}/ar/aging`);

  if (!response.ok) {
    throw new Error(`Failed to load A/R aging (${response.status})`);
  }

  return parseJson(response, arAgingSchema);
}

export async function getReviewQueue(): Promise<ReviewItem[]> {
  const response = await fetch(`${API_BASE}/review`);

  if (!response.ok) {
    throw new Error(`Failed to load review queue (${response.status})`);
  }

  return parseJson(response, reviewQueueSchema);
}

export async function getPendingDisputes(): Promise<DisputeItem[]> {
  const response = await fetch(`${API_BASE}/disputes/pending`);

  if (!response.ok) {
    throw new Error(`Failed to load pending disputes (${response.status})`);
  }

  return parseJson(response, disputeQueueSchema);
}

export async function resolveDispute(
  claimId: string,
  note: string,
): Promise<{ resolved: boolean }> {
  const response = await fetch(`${API_BASE}/disputes/${claimId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify({ resolution_note: note }),
  });

  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Failed to resolve dispute (${response.status})`),
    );
  }

  return parseJson(response, resolveDisputeResponseSchema);
}

export async function resumeClaim(
  claimId: string,
  approved: boolean,
  reviewerNotes: string,
): Promise<ResumeResponse> {
  const response = await fetch(`${API_BASE}/claims/${claimId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify({ approved, reviewer_comment: reviewerNotes }),
  });

  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Failed to resume claim (${response.status})`),
    );
  }

  return parseJson(response, resumeResponseSchema);
}

export async function sendAppealEmail(
  claimId: string,
  appealLetter: string,
): Promise<{ sent: boolean }> {
  const response = await fetch(`${API_BASE}/claims/${claimId}/send-appeal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify({ appeal_letter: appealLetter }),
  });
  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Failed to send appeal (${response.status})`),
    );
  }
  return response.json();
}

export interface CorrectionLineInput {
  line_no: number;
  cpt_code: string;
  modifiers: string[];
  icd10_codes: string[];
  units: number;
  charge: number;
}

export async function correctClaim(
  claimId: string,
  reason: string,
  claimLines: CorrectionLineInput[] | null,
): Promise<CorrectionResponse> {
  const response = await fetch(`${API_BASE}/claims/${claimId}/correct`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify({
      reason,
      frequency_code: "7",
      claim_lines: claimLines,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Failed to correct claim (${response.status})`),
    );
  }

  return parseJson(response, correctionResponseSchema);
}

export async function chatWithClaim(
  claimId: string,
  messages: CopilotChatMessage[],
): Promise<CopilotResponse> {
  const response = await fetch(`${API_BASE}/claims/${claimId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(
      await errorMessage(response, `Copilot request failed (${response.status})`),
    );
  }

  return parseJson(response, copilotResponseSchema);
}

export function subscribeToClaimEvents(
  claimId: string,
  onEvent: (event: AgentEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  const source = new EventSource(`${API_BASE}/claims/${claimId}/events`);

  source.onmessage = (message: MessageEvent<string>) => {
    try {
      const parsed: unknown = JSON.parse(message.data);
      onEvent(agentEventSchema.parse(parsed));
    } catch {
      // Ignore malformed SSE payloads
    }
  };

  source.onerror = (error: Event) => {
    onError?.(error);
  };

  return () => {
    source.close();
  };
}

export interface PatientSearchParams {
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listPatients(
  params: PatientSearchParams = {},
): Promise<PatientListResponse> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));

  const response = await fetch(`${API_BASE}/patients?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to load patients (${response.status})`);
  }
  return parseJson(response, patientListResponseSchema);
}

export async function getPatient(patientId: string): Promise<PatientDetail> {
  const response = await fetch(`${API_BASE}/patients/${patientId}`);
  if (!response.ok) {
    throw new Error(`Patient not found (${response.status})`);
  }
  return parseJson(response, patientDetailSchema);
}

export async function updatePatient(
  patientId: string,
  fields: Partial<Record<keyof PatientRecord, string | number>>,
): Promise<PatientRecord> {
  const snakeBody: Record<string, string | number> = {};
  const mapping: Record<string, string> = {
    firstName: "first_name",
    lastName: "last_name",
    middleName: "middle_name",
    preferredName: "preferred_name",
    gender: "gender",
    dob: "dob",
    ssnLast4: "ssn_last4",
    memberId: "member_id",
    payerName: "payer_name",
    addressLine1: "address_line1",
    addressLine2: "address_line2",
    city: "city",
    state: "state",
    zipCode: "zip_code",
    phonePrimary: "phone_primary",
    phoneSecondary: "phone_secondary",
    email: "email",
    emergencyContactName: "emergency_contact_name",
    emergencyContactRelationship: "emergency_contact_relationship",
    emergencyContactPhone: "emergency_contact_phone",
    responsiblePartyName: "responsible_party_name",
    responsiblePartyRelationship: "responsible_party_relationship",
    responsiblePartyDob: "responsible_party_dob",
    responsiblePartyPhone: "responsible_party_phone",
    insurancePlanName: "insurance_plan_name",
    insuranceGroupNumber: "insurance_group_number",
    insurancePlanType: "insurance_plan_type",
    insuranceEffectiveDate: "insurance_effective_date",
    insuranceCopay: "insurance_copay",
    insuranceDeductible: "insurance_deductible",
    secondaryPayerName: "secondary_payer_name",
    secondaryMemberId: "secondary_member_id",
    notes: "notes",
  };
  for (const [key, val] of Object.entries(fields)) {
    const snake = mapping[key];
    if (snake && val !== undefined) snakeBody[snake] = val;
  }

  const response = await fetch(`${API_BASE}/patients/${patientId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify(snakeBody),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Failed to update patient (${response.status})`));
  }
  const data = await response.json() as { patient: unknown };
  return patientRecordSchema.parse(data.patient);
}

export async function createPatientAppointment(
  patientId: string,
  body: {
    appointment_date: string;
    appointment_time?: string;
    provider_name?: string;
    appointment_type?: string;
    notes?: string;
  },
): Promise<void> {
  const response = await fetch(`${API_BASE}/patients/${patientId}/appointments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...actorHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Failed to create appointment (${response.status})`));
  }
}

export async function uploadPatientDocument(
  patientId: string,
  file: File,
  documentType: string,
  notes: string = "",
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("document_type", documentType);
  formData.append("notes", notes);

  const response = await fetch(`${API_BASE}/patients/${patientId}/documents/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Failed to upload document (${response.status})`));
  }
}
