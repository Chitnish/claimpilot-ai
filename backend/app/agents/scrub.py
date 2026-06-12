"""
Claim Scrub Agent — runs the full pre-submission scrubber (identifiers, code
validity, NCCI/MUE/modifier edits, filing limits, prior auth, LCD necessity),
scores ML denial risk, and generates the CMS-1500 PDF.

Two human-review gates:
  - Hard scrub errors block submission (the claim WILL deny as-is)
  - High ML denial risk above threshold flags for review
"""
from __future__ import annotations
import os, time
from pathlib import Path
from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.rules.scrubber import scrub_claim
from app.services.supabase_client import log_agent_event
from app.pdf.cms1500 import generate_cms1500


DENIAL_RISK_THRESHOLD = float(os.getenv("DENIAL_RISK_THRESHOLD", "0.60"))


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="scrub", event="started",
        summary="Running pre-submission scrubber: identifiers, NCCI/MUE edits, modifiers, filing limits, coverage policy.",
    ))

    findings = scrub_claim(state)
    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity == "warning"]

    state.scrub_findings = findings
    state.scrub_issues = [f"[{f.rule}] {f.message}" for f in errors]
    state.scrub_passed = not errors

    # ML denial risk prediction
    try:
        from app.ml.predictor import predict_denial_risk
        risk_score, shap_factors = await predict_denial_risk(state.model_dump())
        state.denial_risk = risk_score
        state.denial_risk_factors = shap_factors
    except Exception as e:
        print(f"[scrub] ML prediction error: {e}")
        state.denial_risk = 0.5
        state.denial_risk_factors = ["Prediction unavailable"]

    # Generate CMS-1500 PDF
    pdf_dir = Path("data/synthetic")
    pdf_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = pdf_dir / f"cms1500_{state.claim_id[:8]}.pdf"
    generate_cms1500(state, str(pdf_path))
    state.cms1500_path = str(pdf_path)

    latency_ms = int((time.monotonic() - t0) * 1000)

    already_reviewed = bool(state.review_reason) and (
        "denial risk" in state.review_reason.lower()
        or "scrub" in state.review_reason.lower()
    )

    if errors:
        first = errors[0]
        summary = (
            f"Scrubber BLOCKED submission — {len(errors)} hard error(s), {len(warnings)} warning(s). "
            f"First: [{first.rule}] {first.message[:110]}"
        )
    elif warnings:
        summary = (
            f"Scrub passed with {len(warnings)} warning(s) — claim is submittable. "
            f"CMS-1500 generated. ML denial risk: {state.denial_risk:.0%}."
        )
    else:
        summary = (
            f"Clean scrub — all {len(state.claim_lines)} line(s) pass NCCI, MUE, modifier, "
            f"identifier, and coverage edits. CMS-1500 generated. ML denial risk: {state.denial_risk:.0%}."
        )

    review_reason = ""
    if errors and not state.needs_human_review and not already_reviewed:
        review_reason = f"Scrubber blocked submission: {len(errors)} hard error(s) — [{errors[0].rule}] {errors[0].message[:90]}"
    elif (
        state.denial_risk >= DENIAL_RISK_THRESHOLD
        and not state.needs_human_review
        and not already_reviewed
    ):
        review_reason = f"Denial risk {state.denial_risk:.0%} exceeds threshold"
        summary += f" ⚠ High denial risk ({state.denial_risk:.0%}) — flagged for review."

    if review_reason:
        state.needs_human_review = True
        state.review_reason = review_reason
        state.status = ClaimStatus.NEEDS_REVIEW
        from app.services.supabase_client import get_supabase
        try:
            get_supabase().table("review_queue").insert({
                "org_id": state.org_id,
                "claim_id": state.claim_id,
                "reason": state.review_reason,
                "details": {
                    "denial_risk": state.denial_risk,
                    "scrub_errors": [f"[{f.rule}] {f.message}" for f in errors],
                    "scrub_warnings": [f"[{f.rule}] {f.message}" for f in warnings],
                    "low_confidence_fields": state.low_confidence_fields,
                },
                "status": "open",
            }).execute()
        except Exception as e:
            print(f"[scrub] review_queue insert error: {e}")

    payload = {
        "errors": [f"[{f.rule}] {f.message}" for f in errors],
        "warnings": [f"[{f.rule}] {f.message}" for f in warnings],
        "denial_risk": state.denial_risk,
        "pdf": str(pdf_path),
    }
    state.agent_events.append(AgentEvent(
        agent="scrub", event="completed",
        summary=summary,
        payload=payload,
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "scrub", "completed",
        summary, payload, latency_ms,
    )

    if not state.needs_human_review or already_reviewed:
        state.status = ClaimStatus.SCRUBBED
    return state
