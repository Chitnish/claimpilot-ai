"""
Reconciliation Agent — parses the simulated 835/ERA and posts payments.

Compares the payer's actual line-level payments against the expected amounts
from adjudication (contracted allowed minus patient responsibility). Variances
above tolerance — payer underpayments, unexpected line denials — route to the
human review queue with an explanation a billing specialist can act on.
"""
from __future__ import annotations
import os, time
from datetime import date
from pathlib import Path

from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.services.mock_payer import generate_era, CARC_DESCRIPTIONS
from app.services.supabase_client import log_agent_event

RECON_VARIANCE_TOLERANCE = float(os.getenv("RECON_VARIANCE_TOLERANCE", "0.05"))


def finalize_patient_ar(state: ClaimState) -> str:
    """
    Open (or close) the patient A/R for a reconciled claim and generate the
    patient statement PDF when the patient owes a balance. Returns a short
    plain-English note for the activity feed. Safe to call on already-final
    claims (idempotent on the statement path).
    """
    balance = round(state.patient_responsibility, 2)
    state.patient_balance = balance

    if balance <= 0:
        state.ar_status = "paid"
        return ""

    state.ar_status = "open"
    if not state.statement_date:
        state.statement_date = date.today().isoformat()

    try:
        from app.pdf.statement import generate_statement
        pdf_dir = Path("data/synthetic")
        pdf_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = pdf_dir / f"statement_{state.claim_id[:8]}.pdf"
        generate_statement(state, str(pdf_path))
        state.patient_statement_path = str(pdf_path)
    except Exception as e:
        print(f"[reconciliation] statement generation error: {e}")

    return (
        f" Patient statement generated — balance due ${balance:.2f} "
        f"(copay/deductible/coinsurance) posted to patient A/R."
    )


async def maybe_send_patient_statement_email(state: ClaimState) -> None:
    """Email the statement PDF once when the patient owes a balance."""
    if (
        not state.cms1500_path
        or state.patient_responsibility <= 0
        or state.statement_email_sent
        or not state.patient_statement_path
    ):
        return

    from app.services.resend_client import send_patient_statement_email

    email_sent = await send_patient_statement_email(
        claim_id=state.claim_id,
        patient_name=state.patient_name,
        total_charge=state.total_charge,
        patient_balance=state.patient_responsibility,
        statement_pdf_path=state.patient_statement_path,
    )
    if not email_sent:
        return

    state.statement_email_sent = True
    summary = (
        f"Patient statement emailed to billing contact. "
        f"Balance due: ${state.patient_responsibility:.2f}"
    )
    state.agent_events.append(AgentEvent(
        agent="reconciliation",
        event="completed",
        summary=summary,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "reconciliation", "completed",
        summary, {"patient_balance": state.patient_responsibility}, 0,
    )


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="reconciliation", event="started",
        summary="Parsing 835/ERA remittance and posting payments line by line.",
    ))

    era = generate_era(state, state.adjudication or None)
    state.era = era

    state.amount_paid = era["total_paid"]
    state.patient_responsibility = era["total_patient_responsibility"]
    if not state.amount_expected:
        state.amount_expected = state.adjudication.get("expected_paid", 0.0) if state.adjudication else 0.0
    state.recon_variance = round(abs(state.amount_paid - state.amount_expected), 2)

    variance_pct = (state.recon_variance / state.amount_expected) if state.amount_expected else 0.0
    denied_lines = [d for d in era["lines"] if d.get("denied")]
    underpaid_lines = [d for d in era["lines"] if d.get("underpaid")]

    latency_ms = int((time.monotonic() - t0) * 1000)

    if state.carc_code:
        # Claim-level denial — $0 remit; appeal or corrective action already in motion.
        summary = (
            f"ERA posted — claim denied (CARC {state.carc_code}: "
            f"{CARC_DESCRIPTIONS.get(state.carc_code, '')}). "
            f"$0.00 paid of ${era['total_billed']:.2f} billed. "
            + ("Appeal is on file." if state.appeal_letter else "Corrective action pending in review queue.")
        )
    elif variance_pct > RECON_VARIANCE_TOLERANCE and not state.needs_human_review:
        state.recon_discrepancy = True
        state.needs_human_review = True
        state.status = ClaimStatus.NEEDS_REVIEW
        if underpaid_lines:
            detail = (
                f"Payer underpaid line {underpaid_lines[0]['line_no']} "
                f"(CPT {underpaid_lines[0]['cpt_code']}) vs contracted allowed amount."
            )
        elif denied_lines:
            detail = "; ".join(
                f"Line {d['line_no']} (CPT {d['cpt_code']}) denied CARC {d['carc_code']}: "
                f"{CARC_DESCRIPTIONS.get(d['carc_code'], '')}"
                for d in denied_lines
            )
        else:
            detail = "Payment does not match contracted rate."
        state.review_reason = (
            f"Payment variance ${state.recon_variance:.2f} ({variance_pct:.0%}) exceeds tolerance"
        )
        state.recon_notes = (
            f"Expected ${state.amount_expected:.2f}, received ${state.amount_paid:.2f}. {detail}"
        )
        summary = (
            f"⚠ Payment variance: expected ${state.amount_expected:.2f}, received "
            f"${state.amount_paid:.2f} (check {era['check_number']}). {detail} Flagged for review."
        )
        try:
            from app.services.supabase_client import get_supabase
            get_supabase().table("review_queue").insert({
                "org_id": state.org_id,
                "claim_id": state.claim_id,
                "reason": state.review_reason,
                "details": {"expected": state.amount_expected, "paid": state.amount_paid,
                            "notes": state.recon_notes},
                "status": "open",
            }).execute()
        except Exception as e:
            print(f"[reconciliation] review_queue insert error: {e}")
    else:
        state.status = ClaimStatus.RECONCILED
        pr_note = finalize_patient_ar(state)
        await maybe_send_patient_statement_email(state)
        if state.amount_paid == 0 and state.patient_responsibility > 0:
            summary = (
                f"Reconciliation complete. Payer paid $0.00 (check {era['check_number']}) — "
                f"full allowed amount applied to patient cost sharing.{pr_note}"
            )
        else:
            summary = (
                f"Reconciliation complete. ${state.amount_paid:.2f} posted from check "
                f"{era['check_number']} — matches contracted rate "
                f"(${era['total_billed']:.2f} billed, CO-45 contractual adjustment applied).{pr_note}"
            )

    payload = {
        "paid": state.amount_paid,
        "expected": state.amount_expected,
        "patient_responsibility": state.patient_responsibility,
        "variance": state.recon_variance,
        "check_number": era["check_number"],
        "line_denials": len(denied_lines),
    }
    state.agent_events.append(AgentEvent(
        agent="reconciliation", event="completed",
        summary=summary,
        payload=payload,
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "reconciliation", "completed",
        summary, payload, latency_ms,
    )
    return state
