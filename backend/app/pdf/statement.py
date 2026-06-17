"""
Generates a patient billing statement PDF using reportlab.

A real practice mails (or e-delivers) a patient statement after the payer
adjudicates: it shows the billed charges, what insurance paid, contractual
write-offs, and the remaining patient responsibility (copay + deductible +
coinsurance) as the balance due. This is the front end of the patient A/R cycle.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as rl_canvas

from app.rules.code_reference import CPT_REFERENCE

NAVY = colors.HexColor("#1e3a5f")
STATEMENT_TERMS_DAYS = 30


def _fmt(amount: float) -> str:
    return f"${amount:,.2f}"


def _parse_date(value: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime((value or "").strip()[:10], fmt).date()
        except ValueError:
            continue
    return None


def generate_statement(state, output_path: str) -> None:
    """Render a patient statement PDF for an adjudicated claim to `output_path`."""
    c = rl_canvas.Canvas(output_path, pagesize=letter)
    W, H = letter

    era_lines = (state.era or {}).get("lines", []) if isinstance(state.era, dict) else []
    by_line = {ln.get("line_no"): ln for ln in era_lines}

    total_billed = round(sum(ln.charge for ln in state.claim_lines), 2)
    total_insurance_paid = round(state.amount_paid, 2)
    patient_resp = round(
        state.patient_balance if state.patient_balance else state.patient_responsibility, 2
    )
    total_adjustments = round(
        sum(
            adj.get("amount", 0.0)
            for ln in era_lines
            for adj in ln.get("adjustments", [])
            if adj.get("group") in ("CO", "OA")
        ),
        2,
    )

    statement_date = _parse_date(state.statement_date) or date.today()
    due_date = statement_date + timedelta(days=STATEMENT_TERMS_DAYS)

    # ── Header bar ────────────────────────────────────────────────────
    c.setFillColor(NAVY)
    c.rect(0, H - 0.7 * inch, W, 0.7 * inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(0.5 * inch, H - 0.45 * inch, "PATIENT STATEMENT")
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 0.5 * inch, H - 0.35 * inch, "ClaimPilot AI — Synthetic Demo")
    c.drawRightString(W - 0.5 * inch, H - 0.50 * inch,
                      f"Statement date: {statement_date.isoformat()}")

    margin = 0.5 * inch
    y = H - 1.05 * inch

    # ── Provider / remit-to block ─────────────────────────────────────
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(margin, y, "FROM (Billing Provider)")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawString(margin, y - 0.16 * inch, state.provider_name or "Provider")
    if state.provider_npi:
        c.drawString(margin, y - 0.31 * inch, f"NPI: {state.provider_npi}")

    # ── Patient / account block ───────────────────────────────────────
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(W / 2, y, "STATEMENT FOR")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawString(W / 2, y - 0.16 * inch, state.patient_name or "Patient")
    c.drawString(W / 2, y - 0.31 * inch, f"Account: {state.claim_id[:12].upper()}")
    c.drawString(W / 2, y - 0.46 * inch,
                 f"Insurance: {state.payer_name or '—'}  |  Member {state.patient_member_id or '—'}")
    c.drawString(W / 2, y - 0.61 * inch, f"Date of service: {state.date_of_service or '—'}")

    # ── Service line table ────────────────────────────────────────────
    table_top = y - 0.95 * inch
    headers = ["DATE", "SERVICE (CPT)", "DESCRIPTION", "CHARGE", "INS. PAID", "YOU OWE"]
    col_x = [margin, margin + 0.8 * inch, margin + 1.8 * inch,
             margin + 4.4 * inch, margin + 5.3 * inch, margin + 6.3 * inch]

    c.setFillColor(colors.HexColor("#e8eef6"))
    c.rect(margin, table_top - 0.04 * inch, W - 2 * margin, 0.26 * inch, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 7.5)
    for hdr, x in zip(headers, col_x):
        if hdr in ("CHARGE", "INS. PAID", "YOU OWE"):
            c.drawRightString(x + 0.75 * inch, table_top + 0.04 * inch, hdr)
        else:
            c.drawString(x, table_top + 0.04 * inch, hdr)

    row_y = table_top - 0.04 * inch
    c.setFont("Helvetica", 8)
    for ln in state.claim_lines[:12]:
        row_y -= 0.26 * inch
        era_ln = by_line.get(ln.line_no, {})
        line_paid = float(era_ln.get("paid", 0.0))
        line_patient = float(era_ln.get("patient_responsibility", 0.0))
        desc = CPT_REFERENCE.get(ln.cpt_code, "Medical service")
        c.setFillColor(colors.black)
        c.drawString(col_x[0], row_y + 0.07 * inch, (state.date_of_service or "")[:10])
        c.drawString(col_x[1], row_y + 0.07 * inch, ln.cpt_code)
        c.drawString(col_x[2], row_y + 0.07 * inch, desc[:34])
        c.drawRightString(col_x[3] + 0.75 * inch, row_y + 0.07 * inch, _fmt(ln.charge))
        c.drawRightString(col_x[4] + 0.75 * inch, row_y + 0.07 * inch, _fmt(line_paid))
        c.drawRightString(col_x[5] + 0.75 * inch, row_y + 0.07 * inch, _fmt(line_patient))
        c.setStrokeColor(colors.HexColor("#e2e8f0"))
        c.line(margin, row_y, W - margin, row_y)

    # ── Summary box ───────────────────────────────────────────────────
    sum_y = row_y - 0.45 * inch
    box_x = W - margin - 3.0 * inch
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.rect(box_x, sum_y - 0.95 * inch, 3.0 * inch, 1.35 * inch, fill=0, stroke=1)

    def summary_row(label: str, value: str, dy: float, bold: bool = False) -> None:
        c.setFont("Helvetica-Bold" if bold else "Helvetica", 9 if not bold else 10)
        c.setFillColor(NAVY if bold else colors.black)
        c.drawString(box_x + 0.12 * inch, sum_y + dy, label)
        c.drawRightString(box_x + 2.88 * inch, sum_y + dy, value)

    summary_row("Total charges", _fmt(total_billed), 0.22 * inch)
    summary_row("Insurance payments", f"-{_fmt(total_insurance_paid)}", 0.04 * inch)
    summary_row("Insurance adjustments", f"-{_fmt(total_adjustments)}", -0.14 * inch)
    c.setStrokeColor(colors.HexColor("#cccccc"))
    c.line(box_x + 0.1 * inch, sum_y - 0.26 * inch, box_x + 2.9 * inch, sum_y - 0.26 * inch)
    summary_row("BALANCE DUE", _fmt(patient_resp), -0.46 * inch, bold=True)
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#b91c1c"))
    c.drawRightString(box_x + 2.88 * inch, sum_y - 0.66 * inch,
                      f"Payable by {due_date.isoformat()}")

    # ── Remittance stub ───────────────────────────────────────────────
    stub_y = 1.1 * inch
    c.setStrokeColor(colors.HexColor("#999999"))
    c.setDash(3, 3)
    c.line(margin, stub_y + 0.5 * inch, W - margin, stub_y + 0.5 * inch)
    c.setDash()
    c.setFillColor(colors.HexColor("#666666"))
    c.setFont("Helvetica-Oblique", 7)
    c.drawString(margin, stub_y + 0.55 * inch, "Detach and return with payment")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    c.drawString(margin, stub_y + 0.25 * inch, f"Account: {state.claim_id[:12].upper()}")
    c.drawString(margin, stub_y + 0.08 * inch, f"Patient: {state.patient_name or '—'}")
    c.drawRightString(W - margin, stub_y + 0.25 * inch, f"Amount due: {_fmt(patient_resp)}")
    c.drawRightString(W - margin, stub_y + 0.08 * inch, f"Due by: {due_date.isoformat()}")

    # ── Footer ────────────────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#f0f4f8"))
    c.rect(0, 0, W, 0.35 * inch, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#888888"))
    c.setFont("Helvetica-Oblique", 7)
    c.drawCentredString(W / 2, 12,
                        "SYNTHETIC DEMO — NOT A REAL STATEMENT  |  ClaimPilot AI")

    c.save()
