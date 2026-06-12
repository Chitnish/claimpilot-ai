"""
Eligibility Verification Agent — simulates the 270/271 payer eligibility check
and records plan benefits (copay, coinsurance, deductible, prior-auth rules)
that downstream agents use for scrubbing and payment reconciliation.
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
        summary=f"Sending 270 eligibility inquiry to {state.payer_name or 'payer'}...",
    ))

    result = check_eligibility(state.payer_name, state.patient_member_id)

    already_reviewed = state.eligibility_checked  # re-run after human approval
    state.eligibility_checked = True
    state.eligibility_active = result["active"]
    state.plan_name = result["plan_name"]
    state.copay = result["copay"]
    state.coinsurance = result["coinsurance"]
    state.deductible_total = result["deductible_total"]
    state.deductible_remaining = result["deductible_remaining"]
    state.prior_auth_cpts = result["prior_auth_cpts"]
    state.prior_auth_on_file = result["prior_auth_on_file"]

    latency_ms = int((time.monotonic() - t0) * 1000)

    if not state.eligibility_active and not already_reviewed:
        state.needs_human_review = True
        state.review_reason = "Coverage terminated — member not eligible on date of service"
        state.status = ClaimStatus.NEEDS_REVIEW
        summary = (
            f"271 response: coverage TERMINATED for member {state.patient_member_id or '(unknown)'} "
            f"at {state.payer_name}. Claim routed to review — verify current insurance before billing."
        )
    elif not state.eligibility_active and already_reviewed:
        # Reviewer chose to proceed despite terminated coverage — bill anyway;
        # the payer will adjudicate (expect CARC 27).
        if _STATUS_RANK[state.status] < _STATUS_RANK[ClaimStatus.EXTRACTED]:
            state.status = ClaimStatus.EXTRACTED
        summary = (
            f"Proceeding per reviewer instruction despite terminated coverage — "
            f"payer is expected to deny (CARC 27)."
        )
    else:
        if _STATUS_RANK[state.status] < _STATUS_RANK[ClaimStatus.EXTRACTED]:
            state.status = ClaimStatus.EXTRACTED

        auth_cpts_on_claim = [
            ln.cpt_code for ln in state.claim_lines if ln.cpt_code in state.prior_auth_cpts
        ]
        auth_note = ""
        if auth_cpts_on_claim:
            if state.prior_auth_on_file:
                auth_note = f" Prior auth required for CPT {', '.join(auth_cpts_on_claim)} — auth on file."
            else:
                auth_note = (
                    f" ⚠ Prior auth required for CPT {', '.join(auth_cpts_on_claim)} "
                    f"but NO auth on file — denial risk."
                )

        summary = (
            f"271 response: active coverage, plan {state.plan_name}. "
            f"Copay ${state.copay:.2f}, coinsurance {state.coinsurance:.0%}, "
            f"deductible remaining ${state.deductible_remaining:.2f} "
            f"of ${state.deductible_total:.2f}.{auth_note}"
        )

    payload = {
        "active": state.eligibility_active,
        "plan_name": state.plan_name,
        "copay": state.copay,
        "coinsurance": state.coinsurance,
        "deductible_remaining": state.deductible_remaining,
        "prior_auth_cpts": state.prior_auth_cpts,
        "prior_auth_on_file": state.prior_auth_on_file,
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
