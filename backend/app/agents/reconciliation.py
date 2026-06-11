"""
Reconciliation Agent — parses simulated 835/ERA and matches payments line by line.
"""
from __future__ import annotations
import os, time
from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.services.mock_payer import generate_era
from app.services.supabase_client import log_agent_event

RECON_VARIANCE_TOLERANCE = float(os.getenv("RECON_VARIANCE_TOLERANCE", "0.05"))


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="reconciliation", event="started",
        summary="Parsing ERA/835 remittance and matching payments to claim lines.",
    ))

    era = generate_era(state.claim_id, state.total_charge, state.carc_code)

    state.amount_paid     = era["total_paid"]
    state.amount_expected = round(state.total_charge * 0.78, 2)  # contracted rate
    state.recon_variance  = abs(state.amount_paid - state.amount_expected)

    variance_pct = (state.recon_variance / state.total_charge) if state.total_charge else 0

    if variance_pct > RECON_VARIANCE_TOLERANCE and not state.carc_code:
        state.recon_discrepancy = True
        state.needs_human_review = True
        state.review_reason = (
            f"Payment variance ${state.recon_variance:.2f} "
            f"({variance_pct:.1%}) exceeds tolerance"
        )
        state.recon_notes = (
            f"Expected ${state.amount_expected:.2f}, received ${state.amount_paid:.2f}. "
            f"Possible underpayment — review EOB."
        )

    latency_ms = int((time.monotonic() - t0) * 1000)

    if state.carc_code:
        summary = (
            f"ERA parsed — claim denied (CARC {state.carc_code}). "
            f"$0 paid of ${state.total_charge:.2f} billed. Appeal is on file."
        )
    elif state.recon_discrepancy:
        summary = (
            f"Payment variance detected: expected ${state.amount_expected:.2f}, "
            f"received ${state.amount_paid:.2f}. Flagged for review."
        )
    else:
        summary = (
            f"Reconciliation complete. ${state.amount_paid:.2f} received "
            f"of ${state.total_charge:.2f} billed — within contracted rate."
        )

    if not state.carc_code:
        state.status = ClaimStatus.RECONCILED if not state.recon_discrepancy else ClaimStatus.NEEDS_REVIEW

    state.agent_events.append(AgentEvent(
        agent="reconciliation", event="completed",
        summary=summary,
        payload={"paid": state.amount_paid, "expected": state.amount_expected,
                 "variance": state.recon_variance, "era": era},
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "reconciliation", "completed",
        summary, {"paid": state.amount_paid, "variance": state.recon_variance}, latency_ms,
    )
    return state
