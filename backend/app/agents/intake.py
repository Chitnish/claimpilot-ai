from __future__ import annotations
import os, base64, time
from pathlib import Path
from app.schemas.claim_state import ClaimState, ClaimLine, AgentEvent, ClaimStatus
from app.schemas.superbill import SuperbillExtraction
from app.services.llm import structured_call, MODEL_VISION
from app.services.supabase_client import log_agent_event

CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.85"))

SYSTEM = """You are a medical billing specialist AI.
Extract every field from the provided superbill / medical encounter document.
Return ONLY the structured JSON — no prose.
For each header field (patient_name, patient_dob, patient_member_id, payer_name,
provider_name, provider_npi, date_of_service) include a confidence score 0.0-1.0
in the confidence dict, keyed by field name.
If a field is missing or illegible, use an empty string and confidence 0.0.
For each CPT line, capture any modifiers (e.g. 25, 59) from the MOD column —
an empty list if none — and validate that at least one ICD-10 code is present."""


def _to_base64_image(doc_path: str) -> tuple[str, str]:
    """
    Returns (base64_string, media_type).
    PDFs are converted to PNG via pdf2image (requires poppler).
    Images are returned as-is.
    """
    suffix = Path(doc_path).suffix.lower()

    if suffix == ".pdf":
        from pdf2image import convert_from_path
        kwargs = {}
        poppler_path = os.getenv("POPPLER_PATH", "")
        if not poppler_path:
            default = Path(r"C:\poppler\poppler-24.08.0\Library\bin")
            if default.exists():
                poppler_path = str(default)
        if poppler_path:
            kwargs["poppler_path"] = poppler_path
        pages = convert_from_path(doc_path, first_page=1, last_page=1, dpi=200, **kwargs)
        if not pages:
            raise ValueError("pdf2image returned no pages")
        import io
        buf = io.BytesIO()
        pages[0].save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode(), "image/png"

    with open(doc_path, "rb") as f:
        raw = f.read()
    media_type = (
        "image/png"  if suffix == ".png"  else
        "image/jpeg" if suffix in (".jpg", ".jpeg") else
        "image/png"
    )
    return base64.b64encode(raw).decode(), media_type


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    doc_path = state.document_storage_path
    if not doc_path or not Path(doc_path).exists():
        state.errors.append("intake: document path missing or file not found")
        state.agent_events.append(AgentEvent(
            agent="intake", event="error",
            summary="Document not found — cannot extract superbill.",
        ))
        return state

    state.agent_events.append(AgentEvent(
        agent="intake", event="started",
        summary=f"Reading document ({Path(doc_path).name}) for extraction.",
    ))

    try:
        b64, media_type = _to_base64_image(doc_path)
    except Exception as exc:
        state.errors.append(f"intake: image conversion failed: {exc}")
        state.agent_events.append(AgentEvent(
            agent="intake", event="error",
            summary=f"Could not convert document to image: {exc}",
        ))
        return state

    user_content = [
        {"type": "text",      "text": "Extract all billing fields from this document."},
        {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}},
    ]
    extraction: SuperbillExtraction
    extraction, latency_ms = await structured_call(
        model=MODEL_VISION,
        system=SYSTEM,
        user_content=user_content,
        response_schema=SuperbillExtraction,
    )

    state.patient_name      = extraction.patient_name
    state.patient_dob       = extraction.patient_dob
    state.patient_member_id = extraction.patient_member_id
    state.payer_name        = extraction.payer_name
    state.provider_name     = extraction.provider_name
    state.provider_npi      = extraction.provider_npi
    state.date_of_service   = extraction.date_of_service
    state.extraction_confidence = extraction.confidence.model_dump()
    state.claim_lines = [
        ClaimLine(
            line_no=i + 1,
            cpt_code=ln.cpt_code,
            modifiers=ln.modifiers,
            icd10_codes=ln.icd10_codes,
            units=ln.units,
            charge=ln.charge,
        )
        for i, ln in enumerate(extraction.lines)
    ]
    state.total_charge = sum(ln.charge for ln in state.claim_lines)

    low = [f for f, c in extraction.confidence.model_dump().items() if c < CONFIDENCE_THRESHOLD]
    state.low_confidence_fields = low

    if low:
        state.needs_human_review = True
        state.review_reason = f"Low confidence on: {', '.join(low)}"
        state.status = ClaimStatus.NEEDS_REVIEW
        summary = f"Extraction complete — {len(low)} low-confidence field(s) flagged: {', '.join(low)}."
    else:
        state.status = ClaimStatus.EXTRACTED
        summary = (f"Extracted superbill for {extraction.patient_name}: "
                   f"{len(state.claim_lines)} line(s), total ${state.total_charge:.2f}. "
                   f"All fields high-confidence.")

    state.agent_events.append(AgentEvent(
        agent="intake", event="completed",
        summary=summary,
        payload={"confidence": extraction.confidence.model_dump(), "lines": len(state.claim_lines)},
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "intake", "completed",
        summary, {"confidence": extraction.confidence.model_dump()}, latency_ms,
    )
    return state
