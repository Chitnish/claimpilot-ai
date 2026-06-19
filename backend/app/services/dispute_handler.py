from __future__ import annotations

import re

from app.schemas.claim_state import ClaimState
from app.services.llm import MODEL_REASONING, strip_markdown, text_call

DISPUTE_AI_SYSTEM = """You are a senior medical billing specialist handling \
a payer's response to an appeal letter on behalf of the provider's billing \
office. You will be shown the full claim context, the original appeal \
letter, and the full reply thread so far. The latest message is from the \
payer (or whoever replied to the appeal email).

Read their message and respond professionally:
- If they're asking a clarifying question, answer it using only the real \
  claim data provided — never invent clinical or billing facts.
- If they're requesting additional documentation, explain what's available \
  based on the claim data and what would need separate documentation.
- If they're upholding the denial, acknowledge it professionally and note \
  next steps (next appeal level, deadlines) if applicable.
- If they're approving/reversing, acknowledge and confirm next steps.

CRITICAL: At the end of every reply, ask a clear yes/no question: \
"Would you like to escalate this dispute to a human reviewer on our team \
for further handling? Reply yes to flag this for review."

Output plain text only — no Markdown, no asterisks, no headers, no bullet \
points. Write as a real business email reply, 1-2 paragraphs plus the \
escalation question on its own line at the end."""

ESCALATION_QUESTION = (
    "Would you like to escalate this dispute to a human reviewer on our team "
    "for further handling? Reply yes to flag this for review."
)


def _format_thread(thread: list[dict]) -> str:
    lines: list[str] = []
    for msg in thread:
        sender = msg.get("sender", "unknown")
        text = msg.get("message_text", "")
        created = msg.get("created_at", "")
        label = {
            "payer_reply": "Payer reply",
            "ai_reply": "Our reply",
            "reviewer_initial": "Initial appeal",
        }.get(sender, sender)
        lines.append(f"[{label} {created}]\n{text}")
    return "\n\n---\n\n".join(lines)


def _format_claim_context(state: ClaimState) -> str:
    lines_text = "\n".join(
        f"  Line {ln.line_no}: CPT {ln.cpt_code} "
        f"({', '.join(ln.modifiers) or 'no modifiers'}) "
        f"ICD-10 {', '.join(ln.icd10_codes)} ${ln.charge:.2f}"
        for ln in state.claim_lines
    ) or "  See claim on file"
    return f"""
Claim ID: {state.claim_id}
Patient: {state.patient_name}, DOB {state.patient_dob}
Member ID: {state.patient_member_id}
Provider: {state.provider_name} (NPI {state.provider_npi})
Date of Service: {state.date_of_service}
Payer: {state.payer_name}
Total Charge: ${state.total_charge:.2f}
CARC: {state.carc_code or 'n/a'}  RARC: {state.rarc_code or 'n/a'}
Denial reason: {state.denial_reason or 'n/a'}

Service lines:
{lines_text}
"""


async def generate_dispute_reply(
    claim_state: ClaimState,
    thread_history: list[dict],
    latest_message: str,
) -> str:
    context = _format_claim_context(claim_state)
    appeal = claim_state.appeal_letter or "(no appeal letter on file)"
    thread_text = _format_thread(thread_history) if thread_history else "(no prior replies)"

    user_prompt = f"""
CLAIM CONTEXT:
{context}

ORIGINAL APPEAL LETTER:
{appeal}

THREAD SO FAR:
{thread_text}

LATEST MESSAGE FROM PAYER (reply to the appeal email):
{latest_message}

Draft your professional email reply to the latest message.
"""
    reply, _ = await text_call(
        model=MODEL_REASONING,
        system=DISPUTE_AI_SYSTEM,
        user=user_prompt,
    )
    return strip_markdown(reply or "")


def generate_escalation_acknowledgment(claim_state: ClaimState) -> str:
    return (
        f"Thank you. This dispute regarding claim "
        f"{claim_state.claim_id[:8].upper()} has been flagged for human "
        f"reviewer handling by our team. They will follow up with next "
        f"steps."
    )


def detect_escalation_request(reply_text: str) -> bool:
    """Conservative keyword check for affirmative escalation intent."""
    text = reply_text.lower()
    affirmatives = ("yes", "yeah", "yep", "please", "escalate", "human", "reviewer")
    if not any(word in text for word in affirmatives):
        return False
    # Require a clear affirmative near escalation language
    if re.search(r"\byes\b", text):
        return True
    if "escalat" in text and any(w in text for w in ("please", "human", "review")):
        return True
    if "human reviewer" in text or "human review" in text:
        return True
    return False


def last_ai_message_asked_to_escalate(thread: list[dict]) -> bool:
    """True if the most recent ai_reply in the thread asked the escalation question."""
    for msg in reversed(thread):
        if msg.get("sender") == "ai_reply":
            return ESCALATION_QUESTION.lower() in (
                msg.get("message_text", "").lower()
            )
    return False
