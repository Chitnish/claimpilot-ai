"""
Coding Agent — validates ICD-10 / CPT linkage and flags issues.
"""
from __future__ import annotations
import time
from pydantic import BaseModel, Field
from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.services.llm import structured_call, MODEL_REASONING
from app.services.supabase_client import log_agent_event


class CodingReview(BaseModel):
    validated: bool
    issues: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    summary: str


SYSTEM = """You are a certified medical coder (CPC).
Review the claim lines provided. For each line check:
1. ICD-10-CM code format validity (letter + 2 digits + optional decimal)
2. CPT code format (5 digits)
3. Medical necessity linkage — does the diagnosis justify the procedure?
4. Modifier appropriateness
5. Unbundling issues (e.g. billing component codes when a comprehensive code exists)
Return structured JSON only."""


async def run(state: ClaimState) -> ClaimState:
    if not state.claim_lines:
        state.errors.append("coding: no claim lines to validate")
        return state

    state.agent_events.append(AgentEvent(
        agent="coding", event="started",
        summary=f"Validating {len(state.claim_lines)} claim line(s) for ICD-10/CPT compliance.",
    ))

    lines_text = "\n".join(
        f"Line {ln.line_no}: CPT {ln.cpt_code} {ln.modifiers} | "
        f"ICD-10: {', '.join(ln.icd10_codes)} | Units: {ln.units} | ${ln.charge:.2f}"
        for ln in state.claim_lines
    )
    user = f"Patient: {state.patient_name}\nDate: {state.date_of_service}\n\nClaim lines:\n{lines_text}"

    review: CodingReview
    review, latency_ms = await structured_call(
        model=MODEL_REASONING,
        system=SYSTEM,
        user_content=user,
        response_schema=CodingReview,
    )

    state.coding_issues = review.issues
    state.coding_validated = review.validated

    if review.issues:
        summary = f"Coding review found {len(review.issues)} issue(s): {'; '.join(review.issues)}."
    else:
        summary = f"Coding validated — all {len(state.claim_lines)} lines pass ICD-10/CPT checks."

    state.agent_events.append(AgentEvent(
        agent="coding", event="completed",
        summary=summary,
        payload={"issues": review.issues, "suggestions": review.suggestions},
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "coding", "completed",
        summary, {"issues": review.issues}, latency_ms,
    )

    if not state.needs_human_review:
        state.status = ClaimStatus.CODED
    return state
