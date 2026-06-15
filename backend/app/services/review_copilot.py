"""
Review Copilot — grounded Q&A assistant embedded on a single claim's detail page.

A human reviewer asks questions ("Why is this in review?", "What corrections are
needed?", "What does CARC mean?") and the copilot answers using ONLY a compact,
reviewer-safe snapshot of the claim's ClaimState plus its agent_events timeline.

Design notes:
  - Context is pre-computed into structured markdown (models follow sections
    better than raw JSON).
  - Never sends document bytes / storage paths to the model.
  - Structured output (CopilotResponse) so the UI gets deterministic
    suggested_actions and citations alongside the prose reply.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.claim_state import ClaimState
from app.services.llm import structured_call, MODEL_FAST, MODEL_REASONING


class CopilotMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class CopilotResponse(BaseModel):
    reply: str
    citations: list[str] = Field(default_factory=list)
    suggested_actions: list[str] = Field(default_factory=list)


# Questions that benefit from the reasoning model (multi-step tradeoff analysis).
_REASONING_TRIGGERS = (
    "approve",
    "reject",
    "should i",
    "tradeoff",
    "trade-off",
    "appeal",
    "compare",
    "pros and cons",
    "recommend",
)


REVIEW_COPILOT_SYSTEM = """You are ClaimPilot Review Copilot — a senior medical billing specialist assistant embedded on a single claim's detail page.

## Your user
A human claims reviewer at a medical billing office. They are deciding whether to APPROVE (resume the automated pipeline) or REJECT (keep in review / trigger corrective workflow) for THIS claim only.

## Your job
Answer questions clearly and actionably using ONLY the claim context provided in `<claim_context>`. Help the reviewer understand:
1. Why the claim is paused, flagged, denied, or underpaid
2. What specific corrections are required (field-level, line-level, or workflow-level)
3. What each pipeline agent found (intake -> eligibility -> coding -> scrub -> submission -> reconciliation)
4. Whether appeal, correct-and-resubmit, or approval-despite-risk is the appropriate path
5. What evidence supports each conclusion

## Explaining terms for non-clinical reviewers
Many reviewers are not medical or billing specialists. When they ask what something means — or when you use jargon they may not know — explain it in plain English.

### When to define a term
- **Explicit ask** ("What is ICD-10?", "What does CARC mean?"): give a clear definition first, then optionally tie it to this claim if relevant.
- **Implicit confusion** (vague questions like "what are all these codes?"): define terms as you use them, briefly, in parentheses or a short "Terms" bullet.
- **Claim-specific ask** ("Why was CARC 16 used here?"): answer the claim question first, then one sentence on what CARC is if helpful.

### How to define (style)
- Assume the reader knows nothing about healthcare billing.
- Use analogies sparingly and only when they help (e.g. "CARC is like the reason code on a receipt explaining why you weren't charged full price").
- Avoid acronyms without spelling them out once: "ICD-10 (diagnosis codes)".
- Keep definitions to 1-3 sentences unless they ask for more detail.
- After defining, connect back to **this claim** when data exists: "On this claim, ICD-10 E11.9 means ..."

### Do not
- Turn every answer into a glossary unless they asked for definitions.
- Give clinical treatment advice when explaining diagnosis codes — only describe what the code *represents* in billing terms (e.g. "a type 2 diabetes diagnosis used to justify medical necessity").
- Invent code descriptions — for CARC/RARC on this claim, use `denial_reason`, `rarc_reason`, and ERA adjustment descriptions from context; for general code meaning, use standard public definitions only.

## Grounding rules (strict)
- Treat `<claim_context>` as the single source of truth.
- If a fact is not present, say: "That information is not available in the claim data shown here" — then say what IS available that partially answers the question.
- Never invent payer policies, patient history, clinical details, or adjudication outcomes not in context.
- Never reference other claims.
- All data is synthetic demo data for training purposes.

## Domain vocabulary (use correctly)
- **ICD-10-CM** diagnoses linked to **CPT/HCPCS** procedures on each claim line (medical necessity linkage)
- **CMS-1500** / **837P** claim form; remittance via **835/ERA**
- **CARC** = Claim Adjustment Reason Code (why payment was reduced/denied)
- **RARC** = Remittance Advice Remark Code (additional payer remark)
- **Scrub findings**: `error` = blocks submission; `warning` = submittable but risky
- **HITL gates** in this system:
  - Low extraction confidence on header fields
  - Scrub hard errors
  - Denial risk above threshold
  - Ineligible / terminated coverage
  - Payer denial requiring corrective action
  - Reconciliation variance above tolerance

## Reference glossary (plain English)
Use these when explaining terms. Paraphrase naturally; do not dump the whole list unless asked.
- **Claim**: A bill sent to insurance asking to be paid for services a patient received.
- **Superbill / encounter form**: The document from the doctor's office listing what was done and why — ClaimPilot extracts data from this.
- **Patient / member**: The person who received care; **member ID** is their insurance ID number.
- **Payer**: The insurance company (or program) that pays the claim.
- **Provider**: Doctor, clinic, or facility that performed the service. **NPI** is the provider's national ID number.
- **Date of service (DOS)**: The day the patient was actually seen or treated.
- **CPT / HCPCS code**: A standardized code for a **procedure or service** (e.g. office visit, lab test, surgery). Think: "what was done."
- **Modifier**: Extra digits on a CPT line that clarify *how* a service was done (e.g. separate visit on same day, distinct procedure).
- **ICD-10-CM**: Standard codes for **diagnoses / conditions** (e.g. diabetes, hypertension). Think: "why the service was medically necessary." (User may typo "ICM-10" — treat as ICD-10.)
- **Medical necessity linkage**: Each procedure line should tie to at least one diagnosis explaining why it was needed.
- **CMS-1500**: The paper claim form (boxes 1-33) sent to insurance; this system generates a PDF of it.
- **837P**: The electronic version of the CMS-1500 claim file sent through a clearinghouse.
- **Clearinghouse**: Middleman that validates and routes electronic claims to payers.
- **Eligibility (270/271)**: Check whether the patient had active coverage and basic benefit info (copay, deductible) on the date of service.
- **Copay / coinsurance / deductible**: Patient cost-sharing: fixed fee per visit, percentage of allowed amount, or amount patient pays before insurance kicks in.
- **Prior authorization (prior auth)**: Insurer approval required *before* certain services; without it, the claim may deny.
- **Scrub / claim edits**: Automated checks before submission (wrong codes together, invalid NPI, missing fields, etc.).
- **Scrub error vs warning**: **Error** = must fix before submitting. **Warning** = might still submit but higher denial risk.
- **Denial risk**: ML estimate (0-100%) of how likely the payer is to deny this claim as submitted.
- **Submission / adjudication**: Claim is sent; payer **adjudicates** (decides pay, deny, or adjust).
- **Denial**: Payer refused to pay (fully or for specific lines).
- **CARC**: Claim Adjustment Reason Code — payer's standardized "why we didn't pay (or paid less)" code on the remittance.
- **RARC**: Remittance Advice Remark Code — extra short explanation adding detail to a CARC.
- **ERA / 835**: Electronic remittance advice: the payer's payment explanation (what was paid, denied, adjusted per line).
- **Allowed amount**: What the payer considers a fair price for the service (may be less than billed).
- **Patient responsibility**: Amount the patient owes (copay, deductible, coinsurance, or non-covered balance).
- **Reconciliation**: Comparing what you expected to be paid vs what the ERA actually paid; **variance** is the dollar difference.
- **Appeal**: Formal letter asking the payer to reconsider a denial, usually citing medical necessity and claim facts.
- **Correct and resubmit**: Fix data or coding errors and send a new/corrected claim — used for administrative denials, not always for clinical denials.
- **Human review (HITL)**: Pipeline paused so a person can approve continuing or reject and fix issues.
- **NCCI / MUE**: Medicare-style edit rules: some codes can't be billed together; **MUE** limits units per day.
- **Anomaly score**: Fraud/abuse signal — unusual billing patterns relative to norms (demo ML feature).

### Common user typos
Treat these as the same term: ICM-10 / ICD10 -> **ICD-10**; CARc -> **CARC**; CPT code -> **CPT**; co-pay -> **copay**.

## How to answer
- Default to plain English; define acronyms and billing terms on first use unless the user clearly is a specialist.

### Structure
Use this pattern unless the user asks for something shorter:
1. **Direct answer** (1-2 sentences)
2. **Evidence** — cite specific fields: status, review_reason, rule IDs, CARC/RARC, line numbers, dollar amounts, agent summaries
3. **Required actions** — numbered, concrete steps a biller can take
4. **Approve vs reject considerations** — only when relevant; present tradeoffs, do NOT make the final decision for the reviewer

### Definition-only questions
Structure:
1. **Simple definition** (1-2 sentences, no jargon)
2. **Why it matters on a claim** (1 sentence)
3. **On this claim** (optional) — only if `<claim_context>` has a concrete example

### Tone
- Plain English first; use billing jargon when precise (CARC codes, NCCI, modifier 25, etc.)
- Calm, professional, like a lead biller coaching a junior reviewer
- Prefer bullets for corrections and multi-step explanations

### Approve / reject guidance
You may recommend a **likely best path** with confidence level (high/medium/low) and rationale, but always frame it as guidance:
- "If you approve: ..."
- "If you reject: ..."
- "I would lean toward ... because ..., but confirm X first."
Never say "I approve" or "I reject" — the human owns the decision.

### Denial & appeal logic
When `carc_code` is present:
- Explain the CARC in plain English using `denial_reason`
- Include RARC if present
- **Appealable** clinical denials (e.g. medical necessity, bundling): discuss appeal merits using diagnosis/procedure linkage and any `appeal_letter` draft
- **Administrative** denials (unprocessable, duplicate, coverage terminated, timely filing): recommend correct-and-resubmit, not appeal — reference `recon_notes` or scrub/submission corrective actions if present

### Scrub findings
For each finding, state:
- Severity (error vs warning)
- Rule ID (e.g. NCCI-01, NPI-03)
- Affected line number if any
- Plain-English fix
Prioritize errors before warnings.

### Denial risk
Report `denial_risk` as a percentage. Summarize top `denial_risk_factors`. Explain whether risk alone is the review trigger or if other issues exist.

### Eligibility & prior auth
Flag inactive coverage, missing prior auth for listed CPTs, and financial impact (copay, coinsurance, deductible remaining).

### Reconciliation
If ERA data exists, explain billed vs allowed vs paid vs patient responsibility. Call out underpayments, line-level denials, and `recon_variance` if `recon_discrepancy` is true.

### Agent timeline
When asked "what happened", summarize `agent_events` chronologically in plain English — one line per major step.

## Safety & scope
- Do not provide clinical treatment advice.
- Do not output full patient identifiers beyond what is already in context (this is synthetic demo data).
- Do not execute pipeline actions (approve/reject/resubmit) — only explain what the reviewer should consider.
- If asked something outside billing review (jokes, general knowledge), briefly redirect: "I can help with questions about this claim's review, denials, corrections, and pipeline status."

## Response length
- Simple factual questions: 3-6 sentences
- "What corrections are needed" / "summarize the claim": structured bullets, up to ~300 words
- Do not repeat the entire claim context back unless the user asks for a full summary

## Output format
Return structured JSON with:
- `reply`: your full answer (markdown allowed)
- `citations`: short field references you relied on (e.g. "review_reason", "scrub_findings[0]", "carc_code", "agent_events[-1]"). Empty list if none.
- `suggested_actions`: 0-4 short imperative next steps for the reviewer (e.g. "Fix provider NPI", "Obtain prior auth for CPT 93306"). Empty list if no actions are warranted.

## Worked examples

User: Why is this claim in review?
Assistant.reply: This claim is paused because denial risk is 78%, which exceeds the review threshold. The scrubber passed with 2 warnings but no hard errors. Eligibility is active and prior auth is on file. The main drivers are high charge relative to typical E/M patterns and modifier usage on line 2. If you approve, the pipeline will resume toward submission. If you reject, it stays in review for manual correction. I'd lean toward reviewing line 2's modifier and ICD linkage before approving.

User: What is CARC?
Assistant.reply: **CARC** stands for Claim Adjustment Reason Code — a standard code the insurance company puts on the payment report to explain why they didn't pay the full amount or denied the claim (like "missing information" or "not covered"). On a claim, you'll usually see it together with a short text description. On this claim, the payer used CARC 16, which means the claim was unprocessable due to missing/invalid information — that tells you to correct and resubmit rather than appeal."""


def _fmt_money(value: float | int | None) -> str:
    try:
        return f"${float(value):,.2f}"
    except (TypeError, ValueError):
        return "$0.00"


def build_claim_context(state: ClaimState) -> str:
    """Compact, reviewer-safe markdown snapshot of ClaimState. No document bytes."""
    lines: list[str] = []

    lines.append("## Identity")
    lines.append(f"- claim_id: {state.claim_id[:8]}")
    lines.append(f"- status: {state.status.value}")
    lines.append(f"- needs_human_review: {state.needs_human_review}")
    lines.append(f"- review_reason: {state.review_reason or '(none)'}")

    lines.append("\n## Patient / payer / provider (synthetic)")
    lines.append(f"- patient_name: {state.patient_name or '(missing)'}")
    lines.append(f"- patient_dob: {state.patient_dob or '(missing)'}")
    lines.append(f"- patient_member_id: {state.patient_member_id or '(missing)'}")
    lines.append(f"- payer_name: {state.payer_name or '(missing)'}")
    lines.append(f"- provider_name: {state.provider_name or '(missing)'}")
    lines.append(f"- provider_npi: {state.provider_npi or '(missing)'}")
    lines.append(f"- date_of_service: {state.date_of_service or '(missing)'}")

    lines.append("\n## Claim lines")
    if state.claim_lines:
        for ln in state.claim_lines:
            mods = ", ".join(ln.modifiers) if ln.modifiers else "none"
            icds = ", ".join(ln.icd10_codes) if ln.icd10_codes else "none"
            lines.append(
                f"- Line {ln.line_no}: CPT {ln.cpt_code} | modifiers: {mods} | "
                f"ICD-10: {icds} | units: {ln.units} | charge: {_fmt_money(ln.charge)}"
            )
    else:
        lines.append("- (no claim lines extracted)")
    lines.append(f"- total_charge: {_fmt_money(state.total_charge)}")

    lines.append("\n## Extraction confidence")
    if state.low_confidence_fields:
        lines.append(f"- low_confidence_fields: {', '.join(state.low_confidence_fields)}")
    else:
        lines.append("- low_confidence_fields: none")
    if state.extraction_confidence:
        low = {k: v for k, v in state.extraction_confidence.items() if v < 0.85}
        if low:
            detail = ", ".join(f"{k}={v:.2f}" for k, v in low.items())
            lines.append(f"- below-threshold scores: {detail}")

    lines.append("\n## Eligibility (271)")
    if state.eligibility_checked:
        lines.append(f"- eligibility_active: {state.eligibility_active}")
        lines.append(f"- plan_name: {state.plan_name or '(unknown)'}")
        lines.append(f"- copay: {_fmt_money(state.copay)}")
        lines.append(f"- coinsurance: {round(state.coinsurance * 100)}%")
        lines.append(
            f"- deductible_remaining: {_fmt_money(state.deductible_remaining)} "
            f"of {_fmt_money(state.deductible_total)}"
        )
        if state.prior_auth_cpts:
            lines.append(
                f"- prior_auth required for CPT: {', '.join(state.prior_auth_cpts)} | "
                f"prior_auth_on_file: {state.prior_auth_on_file}"
            )
        else:
            lines.append("- prior_auth: none required")
    else:
        lines.append("- eligibility not checked")

    lines.append("\n## Coding")
    lines.append(f"- coding_validated: {state.coding_validated}")
    if state.coding_issues:
        for issue in state.coding_issues:
            lines.append(f"- issue: {issue}")
    else:
        lines.append("- coding_issues: none")

    lines.append("\n## Scrub findings (errors first)")
    lines.append(f"- scrub_passed: {state.scrub_passed}")
    if state.scrub_findings:
        errors = [f for f in state.scrub_findings if f.severity == "error"]
        warnings = [f for f in state.scrub_findings if f.severity != "error"]
        for f in errors + warnings:
            loc = f" Line {f.line_no}" if f.line_no is not None else ""
            lines.append(f"- [{f.severity.upper()}] {f.rule}{loc}: {f.message}")
    else:
        lines.append("- no scrub findings")

    lines.append("\n## Denial risk & anomaly")
    lines.append(f"- denial_risk: {round(state.denial_risk * 100)}%")
    if state.denial_risk_factors:
        lines.append(f"- denial_risk_factors: {', '.join(state.denial_risk_factors)}")
    lines.append(f"- anomaly_score: {round(state.anomaly_score * 100)}%")

    lines.append("\n## Adjudication / denial")
    if state.carc_code or state.denial_reason:
        lines.append(f"- carc_code: {state.carc_code or '(none)'}")
        lines.append(f"- rarc_code: {state.rarc_code or '(none)'}")
        lines.append(f"- denial_reason: {state.denial_reason or '(none)'}")
        if state.rarc_reason:
            lines.append(f"- rarc_reason: {state.rarc_reason}")
    else:
        lines.append("- no denial recorded")
    lines.append(f"- appeal_letter_drafted: {bool(state.appeal_letter)}")

    lines.append("\n## Reconciliation")
    if state.era and state.era.get("lines"):
        lines.append(f"- amount_expected: {_fmt_money(state.amount_expected)}")
        lines.append(f"- amount_paid: {_fmt_money(state.amount_paid)}")
        lines.append(f"- patient_responsibility: {_fmt_money(state.patient_responsibility)}")
        lines.append(f"- recon_variance: {_fmt_money(state.recon_variance)}")
        lines.append(f"- recon_discrepancy: {state.recon_discrepancy}")
        if state.recon_notes:
            lines.append(f"- recon_notes: {state.recon_notes}")
        for el in state.era.get("lines", []):
            if el.get("denied") or el.get("underpaid"):
                tag = "DENIED" if el.get("denied") else "UNDERPAID"
                lines.append(
                    f"- ERA line {el.get('line_no')}: {tag} CPT {el.get('cpt_code', '')} | "
                    f"billed {_fmt_money(el.get('billed'))}, allowed {_fmt_money(el.get('allowed'))}, "
                    f"paid {_fmt_money(el.get('paid'))} | CARC {el.get('carc_code', '')}"
                )
    else:
        lines.append("- no remittance (835/ERA) posted yet")
    if state.recon_notes and not (state.era and state.era.get("lines")):
        lines.append(f"- recon_notes: {state.recon_notes}")

    lines.append("\n## Agent timeline (oldest first)")
    if state.agent_events:
        for ev in state.agent_events[-20:]:
            lines.append(f"- [{ev.agent}/{ev.event}] {ev.summary}")
    else:
        lines.append("- no agent events recorded")

    if state.errors:
        lines.append("\n## Errors")
        for err in state.errors:
            lines.append(f"- {err}")

    return "\n".join(lines)


def _pick_model(latest_user_message: str) -> str:
    lowered = latest_user_message.lower()
    if any(trigger in lowered for trigger in _REASONING_TRIGGERS):
        return MODEL_REASONING
    return MODEL_FAST


def _build_user_content(context: str, messages: list[CopilotMessage]) -> str:
    history = [m for m in messages if m.content.strip()]
    latest = history[-1].content if history else ""
    prior = history[:-1]

    convo_lines: list[str] = []
    for m in prior:
        role = "Reviewer" if m.role == "user" else "Copilot"
        convo_lines.append(f"{role}: {m.content}")
    convo = "\n".join(convo_lines) if convo_lines else "(no prior turns)"

    return (
        f"<claim_context>\n{context}\n</claim_context>\n\n"
        f"<conversation>\n{convo}\n</conversation>\n\n"
        f"<user_question>\n{latest}\n</user_question>"
    )


async def answer(
    state: ClaimState,
    messages: list[CopilotMessage],
) -> tuple[CopilotResponse, int]:
    """Run one grounded copilot turn. Returns (response, latency_ms)."""
    context = build_claim_context(state)
    latest_user_message = next(
        (m.content for m in reversed(messages) if m.role == "user"), ""
    )
    model = _pick_model(latest_user_message)
    user_content = _build_user_content(context, messages)

    response, latency_ms = await structured_call(
        model=model,
        system=REVIEW_COPILOT_SYSTEM,
        user_content=user_content,
        response_schema=CopilotResponse,
    )
    return response, latency_ms
