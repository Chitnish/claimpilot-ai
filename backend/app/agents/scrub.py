"""
Claim Scrub Agent — runs rules-based scrubber and generates CMS-1500 PDF.
"""
from __future__ import annotations
import os, time
from pathlib import Path
from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.services.supabase_client import log_agent_event
from app.pdf.cms1500 import generate_cms1500


DENIAL_RISK_THRESHOLD = float(os.getenv("DENIAL_RISK_THRESHOLD", "0.60"))


def _scrub_rules(state: ClaimState) -> list[str]:
    issues = []
    if not state.provider_npi or len(state.provider_npi) != 10:
        issues.append("Provider NPI missing or not 10 digits")
    if not state.patient_member_id:
        issues.append("Patient member ID missing")
    if not state.date_of_service:
        issues.append("Date of service missing")
    if not state.claim_lines:
        issues.append("No claim lines present")
    for ln in state.claim_lines:
        if not ln.icd10_codes:
            issues.append(f"Line {ln.line_no}: no diagnosis codes")
        if ln.charge <= 0:
            issues.append(f"Line {ln.line_no}: invalid charge ${ln.charge}")
    return issues


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="scrub", event="started",
        summary="Running claim scrubber against payer rules.",
    ))

    issues = _scrub_rules(state)
    state.scrub_issues = issues
    state.scrub_passed = len(issues) == 0

    # Real ML denial risk prediction (Phase 4)
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

    if issues:
        summary = f"Scrubber flagged {len(issues)} issue(s): {issues[0]}. CMS-1500 generated with warnings."
    else:
        summary = f"Claim passed all scrub rules. CMS-1500 generated at {pdf_path.name}. Denial risk: {state.denial_risk:.0%}."

    # High denial risk gate — only flag if not already reviewed
    already_reviewed = "denial risk" in state.review_reason.lower() if state.review_reason else False
    if state.denial_risk >= DENIAL_RISK_THRESHOLD and not state.needs_human_review and not already_reviewed:
        state.needs_human_review = True
        state.review_reason = f"Denial risk {state.denial_risk:.0%} exceeds threshold"
        state.status = ClaimStatus.NEEDS_REVIEW
        summary += f" ⚠ High denial risk ({state.denial_risk:.0%}) — flagged for review."
        from app.services.supabase_client import get_supabase
        try:
            get_supabase().table("review_queue").insert({
                "org_id": state.org_id,
                "claim_id": state.claim_id,
                "reason": state.review_reason,
                "details": {"denial_risk": state.denial_risk, "low_confidence_fields": []},
                "status": "open",
            }).execute()
        except Exception as e:
            print(f"[scrub] review_queue insert error: {e}")

    state.agent_events.append(AgentEvent(
        agent="scrub", event="completed",
        summary=summary,
        payload={"issues": issues, "denial_risk": state.denial_risk, "pdf": str(pdf_path)},
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "scrub", "completed",
        summary, {"issues": issues, "denial_risk": state.denial_risk}, latency_ms,
    )

    if not state.needs_human_review:
        state.status = ClaimStatus.SCRUBBED
    elif already_reviewed:
        state.status = ClaimStatus.SCRUBBED
    return state
