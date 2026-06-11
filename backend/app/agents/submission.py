"""
Submission Agent — submits to mock clearinghouse, handles denial, drafts appeal.
"""
from __future__ import annotations
import time
from app.schemas.claim_state import ClaimState, AgentEvent, ClaimStatus
from app.services.llm import text_call, MODEL_REASONING
from app.services.mock_payer import submit_claim, CARC_DESCRIPTIONS, RARC_DESCRIPTIONS
from app.services.supabase_client import log_agent_event

APPEAL_SYSTEM = """You are a senior medical billing specialist drafting an insurance appeal letter.
Write a professional, persuasive appeal that:
1. Opens with the claim reference and denial reason (CARC code and its meaning)
2. Argues medical necessity citing the specific diagnosis and procedure
3. References relevant clinical guidelines where applicable
4. Requests reconsideration with a specific deadline (30 days)
5. Closes professionally
Keep the tone firm but respectful. Use real medical billing language. 2-3 paragraphs."""


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="submission", event="started",
        summary=f"Submitting claim ${state.total_charge:.2f} to clearinghouse.",
    ))

    result = submit_claim(state.claim_id, state.total_charge, force_deny=state.demo_mode)
    state.clearinghouse_ref = result["clearinghouse_ref"]

    if result["denied"]:
        state.carc_code    = result["carc_code"]
        state.rarc_code    = result["rarc_code"]
        state.denial_reason = result["denial_reason"]
        state.status        = ClaimStatus.DENIED
        state.submission_status = "denied"

        denied_summary = (
            f"Claim denied by payer. CARC {state.carc_code}: {state.denial_reason[:80]}. "
            f"Drafting appeal letter."
        )
        state.agent_events.append(AgentEvent(
            agent="submission", event="decision",
            summary=denied_summary,
            payload={"carc": state.carc_code, "rarc": state.rarc_code},
        ))

        # Draft appeal letter
        carc_meaning  = CARC_DESCRIPTIONS.get(state.carc_code, "See payer remittance.")
        rarc_meaning  = RARC_DESCRIPTIONS.get(state.rarc_code, "")
        lines_text = "\n".join(
            f"  - CPT {ln.cpt_code}: ICD-10 {', '.join(ln.icd10_codes)}, ${ln.charge:.2f}"
            for ln in state.claim_lines
        )
        appeal_prompt = f"""
Claim Reference: {state.clearinghouse_ref}
Patient: {state.patient_name}, DOB {state.patient_dob}
Provider: {state.provider_name} (NPI {state.provider_npi})
Date of Service: {state.date_of_service}
Payer: {state.payer_name}

Denial:
  CARC {state.carc_code}: {carc_meaning}
  RARC {state.rarc_code}: {rarc_meaning}

Claim Lines:
{lines_text}

Draft a complete appeal letter."""

        appeal_text, appeal_latency = await text_call(
            model=MODEL_REASONING,
            system=APPEAL_SYSTEM,
            user=appeal_prompt,
        )
        state.appeal_letter = appeal_text

        # Send appeal email via Resend
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
            f"{', '.join(set(c for ln in state.claim_lines for c in ln.icd10_codes))}."
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

    else:
        state.submission_status = "accepted"
        state.status = ClaimStatus.SUBMITTED
        latency_ms = int((time.monotonic() - t0) * 1000)
        summary = f"Claim accepted by clearinghouse. Ref: {state.clearinghouse_ref}. Awaiting ERA."
        state.agent_events.append(AgentEvent(
            agent="submission", event="completed",
            summary=summary,
            latency_ms=latency_ms,
        ))
        await log_agent_event(
            state.claim_id, state.org_id, "submission", "completed",
            summary, {"ref": state.clearinghouse_ref, "denied": False}, latency_ms,
        )

    return state
