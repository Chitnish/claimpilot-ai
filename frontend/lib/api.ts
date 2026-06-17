import {
  agentEventSchema,
  analyticsSchema,
  claimSchema,
  claimSearchResponseSchema,
  claimsListSchema,
  copilotResponseSchema,
  resumeResponseSchema,
  reviewQueueSchema,
  uploadResponseSchema,
  batchUploadResponseSchema,
  type AgentEvent,
  type BatchUploadResponse,
  type Analytics,
  type Claim,
  type ClaimSearchResponse,
  type CopilotChatMessage,
  type CopilotResponse,
  type ResumeResponse,
  type ReviewItem,
  type UploadResponse,
} from "@/lib/schemas";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function parseJson<T>(
  response: Response,
  schema: { parse: (data: unknown) => T },
): Promise<T> {
  const data: unknown = await response.json();
  return schema.parse(data);
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

export async function getAnalytics(): Promise<Analytics> {
  const response = await fetch(`${API_BASE}/analytics`);

  if (!response.ok) {
    throw new Error(`Failed to load analytics (${response.status})`);
  }

  return parseJson(response, analyticsSchema);
}

export function cms1500Url(claimId: string): string {
  return `${API_BASE}/claims/${claimId}/cms1500`;
}

export async function getReviewQueue(): Promise<ReviewItem[]> {
  const response = await fetch(`${API_BASE}/review`);

  if (!response.ok) {
    throw new Error(`Failed to load review queue (${response.status})`);
  }

  return parseJson(response, reviewQueueSchema);
}

export async function resumeClaim(
  claimId: string,
  approved: boolean,
  reviewerNotes: string,
): Promise<ResumeResponse> {
  const response = await fetch(`${API_BASE}/claims/${claimId}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approved, reviewer_comment: reviewerNotes }),
  });

  if (!response.ok) {
    throw new Error(`Failed to resume claim (${response.status})`);
  }

  return parseJson(response, resumeResponseSchema);
}

export async function chatWithClaim(
  claimId: string,
  messages: CopilotChatMessage[],
): Promise<CopilotResponse> {
  const response = await fetch(`${API_BASE}/claims/${claimId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Copilot request failed (${response.status})`);
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
