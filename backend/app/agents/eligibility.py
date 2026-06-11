"""
Eligibility Verification Agent — simulates 270/271 payer eligibility check.
"""
from __future__ import annotations
import time
from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.services.mock_payer import check_eligibility
from app.services.supabase_client import log_agent_event

_STATUS_RANK = {s: i for i, s in enumerate(ClaimStatus)}


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="eligibility", event="started",
        summary="Verifying eligibility with payer...",
    ))

    result = check_eligibility(state.payer_name, state.patient_member_id)

    state.eligibility_active = result["active"]
    state.copay = result["copay"]
    state.deductible_remaining = result["deductible_remaining"]

    latency_ms = int((time.monotonic() - t0) * 1000)

    if not state.eligibility_active:
        state.needs_human_review = True
        state.review_reason = "Member not eligible"
        state.status = ClaimStatus.NEEDS_REVIEW
        summary = f"Member not eligible for {state.payer_name}."
    else:
        if _STATUS_RANK[state.status] < _STATUS_RANK[ClaimStatus.EXTRACTED]:
            state.status = ClaimStatus.EXTRACTED
        summary = (
            f"Eligibility confirmed for {state.payer_name}. "
            f"Plan: {result['plan_name']}. "
            f"Copay ${state.copay:.2f}, deductible remaining ${state.deductible_remaining:.2f}."
        )

    payload = {
        "active": state.eligibility_active,
        "copay": state.copay,
        "deductible_remaining": state.deductible_remaining,
        "plan_name": result.get("plan_name", ""),
    }
    state.agent_events.append(AgentEvent(
        agent="eligibility", event="completed",
        summary=summary,
        payload=payload,
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "eligibility", "completed",
        summary, payload, latency_ms,
    )
    return state
