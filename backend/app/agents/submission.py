"""
Submission Agent — submits to the mock clearinghouse, handles adjudication.

Denials are handled the way a real billing office works them:
  - Clinically appealable denials (medical necessity, bundling, frequency,
    prior auth) get a GPT-drafted appeal letter citing the CARC/RARC and the
    clinical facts on the claim.
  - Administrative denials (unprocessable claim, duplicate, coverage
    terminated, timely filing) are NOT appealed — they route to the review
    queue with a corrective action, because the fix is correct-and-resubmit.
"""
from __future__ import annotations
import time
from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.services.llm import text_call, MODEL_REASONING
from app.services.mock_payer import adjudicate_claim, CARC_DESCRIPTIONS, RARC_DESCRIPTIONS
from app.services.supabase_client import log_agent_event

APPEAL_SYSTEM = """You are a senior medical billing specialist drafting an insurance appeal letter.
Write a professional, persuasive appeal that:
1. Opens with the claim reference and denial reason (CARC code and its meaning, plus the RARC remark if present)
2. Argues the clinical case using the SPECIFIC diagnosis and procedure codes on the claim — explain why the diagnosis supports the procedure
3. References relevant clinical guidelines (e.g. ADA Standards of Care for diabetes monitoring, ACC/AHA for cardiac testing, USPSTF for screening) where applicable to the codes involved
4. Requests reconsideration with a specific deadline (30 days) and notes the right to escalate to external review
5. Closes professionally
Keep the tone firm but respectful. Use real medical billing language. 3-4 paragraphs."""

# CARC codes worth appealing vs. correcting & resubmitting.
APPEALABLE_CARCS = {"50", "97", "151", "197", "11", "4", "96"}

CORRECTIVE_ACTIONS = {
    "16": "Claim is unprocessable — fix the missing/invalid data identified by the remark code and resubmit a corrected claim.",
    "18": "Duplicate claim — verify whether the original claim paid; do not resubmit unless voiding/replacing the original.",
    "27": "Coverage terminated — verify current insurance with the patient and bill the correct payer.",
    "29": "Timely filing expired — review filing-limit calendar; payment is generally unrecoverable unless proof of timely submission exists.",
    "22": "Coordination of benefits — identify the primary payer and resubmit there first.",
    "109": "Wrong payer — confirm the member's current plan and route the claim to the correct payer/contractor.",
}


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="submission", event="started",
        summary=f"Submitting claim (${state.total_charge:.2f}, {len(state.claim_lines)} line(s)) to clearinghouse as 837P.",
    ))

    result = adjudicate_claim(state)
    state.clearinghouse_ref = result["clearinghouse_ref"]
    state.adjudication = result
    state.amount_expected = result["expected_paid"]

    if result["claim_denied"]:
        state.carc_code = result["carc_code"]
        state.rarc_code = result["rarc_code"]
        state.denial_reason = result["denial_reason"]
        state.rarc_reason = RARC_DESCRIPTIONS.get(state.rarc_code, "")
        state.status = ClaimStatus.DENIED
        state.submission_status = "denied"

        denied_summary = (
            f"Claim DENIED by {state.payer_name or 'payer'}. "
            f"CARC {state.carc_code}: {state.denial_reason[:90]} "
            + (f"(RARC {state.rarc_code}: {state.rarc_reason[:60]})" if state.rarc_code else "")
        )
        state.agent_events.append(AgentEvent(
            agent="submission", event="decision",
            summary=denied_summary,
            payload={"carc": state.carc_code, "rarc": state.rarc_code},
        ))
        await log_agent_event(
            state.claim_id, state.org_id, "submission", "decision",
            denied_summary, {"carc": state.carc_code, "rarc": state.rarc_code}, 0,
        )

        if state.carc_code in APPEALABLE_CARCS:
            await _draft_appeal(state, t0)
        else:
            # Administrative denial: correct-and-resubmit workflow, not appeal.
            action = CORRECTIVE_ACTIONS.get(
                state.carc_code, "Review the denial reason and resubmit a corrected claim."
            )
            state.needs_human_review = True
            state.review_reason = f"Denied CARC {state.carc_code} — corrective action required"
            state.recon_notes = action
            latency_ms = int((time.monotonic() - t0) * 1000)
            summary = (
                f"CARC {state.carc_code} is an administrative denial — appeal is not the correct "
                f"workflow. Routed to review queue with corrective action: {action}"
            )
            state.agent_events.append(AgentEvent(
                agent="submission", event="escalated",
                summary=summary,
                payload={"carc": state.carc_code, "corrective_action": action},
                latency_ms=latency_ms,
            ))
            await log_agent_event(
                state.claim_id, state.org_id, "submission", "escalated",
                summary, {"carc": state.carc_code, "corrective_action": action}, latency_ms,
            )
            try:
                from app.services.supabase_client import get_supabase
                get_supabase().table("review_queue").insert({
                    "org_id": state.org_id,
                    "claim_id": state.claim_id,
                    "reason": state.review_reason,
                    "details": {"carc_code": state.carc_code, "corrective_action": action},
                    "status": "open",
                }).execute()
            except Exception as e:
                print(f"[submission] review_queue insert error: {e}")

    else:
        state.submission_status = "accepted"
        state.status = ClaimStatus.SUBMITTED
        latency_ms = int((time.monotonic() - t0) * 1000)

        denied_lines = [d for d in result["line_decisions"] if d["denied"]]
        if denied_lines:
            line_notes = "; ".join(
                f"line {d['line_no']} (CPT {d['cpt_code']}) denied CARC {d['carc_code']}"
                for d in denied_lines
            )
            summary = (
                f"Claim accepted by clearinghouse (ref {state.clearinghouse_ref}) with "
                f"{len(denied_lines)} line-level denial(s): {line_notes}. "
                f"Expected payment ${state.amount_expected:.2f}. Awaiting ERA."
            )
        else:
            summary = (
                f"Claim accepted by clearinghouse. Ref: {state.clearinghouse_ref}. "
                f"All {len(result['line_decisions'])} line(s) payable — expected payment "
                f"${state.amount_expected:.2f} after contractual adjustment and patient responsibility. Awaiting ERA."
            )
        state.agent_events.append(AgentEvent(
            agent="submission", event="completed",
            summary=summary,
            payload={"ref": state.clearinghouse_ref, "denied": False,
                     "expected_paid": state.amount_expected,
                     "line_denials": len(denied_lines)},
            latency_ms=latency_ms,
        ))
        await log_agent_event(
            state.claim_id, state.org_id, "submission", "completed",
            summary, {"ref": state.clearinghouse_ref, "denied": False}, latency_ms,
        )

    return state


async def _draft_appeal(state: ClaimState, t0: float) -> None:
    carc_meaning = CARC_DESCRIPTIONS.get(state.carc_code, "See payer remittance.")
    rarc_meaning = RARC_DESCRIPTIONS.get(state.rarc_code, "")
    lines_text = "\n".join(
        f"  - CPT {ln.cpt_code}{(' (mod ' + ', '.join(ln.modifiers) + ')') if ln.modifiers else ''}: "
        f"ICD-10 {', '.join(ln.icd10_codes)}, {ln.units} unit(s), ${ln.charge:.2f}"
        for ln in state.claim_lines
    )
    appeal_prompt = f"""
Claim Reference: {state.clearinghouse_ref}
Patient: {state.patient_name}, DOB {state.patient_dob}
Provider: {state.provider_name} (NPI {state.provider_npi})
Date of Service: {state.date_of_service}
Payer: {state.payer_name} (plan: {state.plan_name})

Denial:
  CARC {state.carc_code}: {carc_meaning}
  RARC {state.rarc_code}: {rarc_meaning}

Claim Lines:
{lines_text}

Draft a complete appeal letter."""

    appeal_text, _ = await text_call(
        model=MODEL_REASONING,
        system=APPEAL_SYSTEM,
        user=appeal_prompt,
    )
    state.appeal_letter = appeal_text

    from app.services.resend_client import send_appeal_email
    email_sent = await send_appeal_email(
        claim_id=state.claim_id,
        patient_name=state.patient_name,
        payer_name=state.payer_name,
        carc_code=state.carc_code,
        appeal_letter=appeal_text,
    )

    state.status = ClaimStatus.APPEALED
    latency_ms = int((time.monotonic() - t0) * 1000)

    appeal_summary = (
        f"Appeal letter drafted for CARC {state.carc_code} denial — "
        f"{len(appeal_text.split())} words, citing medical necessity for "
        f"{', '.join(sorted(set(c for ln in state.claim_lines for c in ln.icd10_codes)))}."
        + (" Appeal email sent." if email_sent else " (Email not configured.)")
    )
    state.agent_events.append(AgentEvent(
        agent="submission", event="completed",
        summary=appeal_summary,
        payload={"appeal_length": len(appeal_text)},
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "submission", "completed",
        appeal_summary, {"carc": state.carc_code, "denied": True}, latency_ms,
    )
