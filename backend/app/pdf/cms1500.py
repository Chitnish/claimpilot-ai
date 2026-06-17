"""
Generates a filled CMS-1500 PDF using reportlab.
This is a simplified but faithful rendering of the standard form boxes.
"""
from __future__ import annotations
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib import colors


def generate_cms1500(state, output_path: str) -> None:
    c = rl_canvas.Canvas(output_path, pagesize=letter)
    W, H = letter

    # ── Header bar ───────────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#1e3a5f"))
    c.rect(0, H - 0.6 * inch, W, 0.6 * inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 13)
    c.drawCentredString(W / 2, H - 0.38 * inch, "HEALTH INSURANCE CLAIM FORM")
    c.setFont("Helvetica", 8)
    c.drawCentredString(W / 2, H - 0.52 * inch, "CMS-1500 (02-12)  |  ClaimPilot AI — Synthetic Demo")

    # ── Helper functions ─────────────────────────────────────────────
    def box(x, y, w, h, label="", value="", label_size=6, value_size=9):
        c.setStrokeColor(colors.HexColor("#cccccc"))
        c.setFillColor(colors.white)
        c.rect(x, y, w, h, fill=1, stroke=1)
        c.setFillColor(colors.HexColor("#666666"))
        c.setFont("Helvetica", label_size)
        c.drawString(x + 2, y + h - label_size - 1, label)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", value_size)
        c.drawString(x + 4, y + 3, str(value)[:30])

    margin = 0.4 * inch
    top = H - 0.75 * inch
    col_w = (W - 2 * margin) / 2

    # ── Box 1a — Insured ID ──────────────────────────────────────────
    box(margin, top - 0.5*inch, col_w, 0.45*inch,
        "1a. INSURED'S I.D. NUMBER", state.patient_member_id)

    # ── Box 2 — Patient name ─────────────────────────────────────────
    box(margin + col_w, top - 0.5*inch, col_w, 0.45*inch,
        "2. PATIENT'S NAME (Last, First)", state.patient_name)

    # ── Box 3 — DOB ──────────────────────────────────────────────────
    box(margin, top - 1.0*inch, col_w/2, 0.45*inch,
        "3. PATIENT'S DATE OF BIRTH", state.patient_dob)

    # ── Box 5 — Payer ────────────────────────────────────────────────
    box(margin + col_w/2, top - 1.0*inch, col_w*1.5, 0.45*inch,
        "4. INSURED'S NAME / PAYER", state.payer_name)

    # ── Box 21 — Diagnosis codes ─────────────────────────────────────
    all_dx = list({c for ln in state.claim_lines for c in ln.icd10_codes})
    dx_str = "  ".join(f"{i+1}. {d}" for i, d in enumerate(all_dx[:4]))
    box(margin, top - 1.55*inch, W - 2*margin, 0.45*inch,
        "21. DIAGNOSIS OR NATURE OF ILLNESS (ICD-10-CM)", dx_str)

    # ── Box 22 — Resubmission code / original ref (corrected claims only) ──
    freq = getattr(state, "frequency_code", "1") or "1"
    if freq in ("7", "8"):
        orig_ref = getattr(state, "original_payer_control_number", "") or ""
        code_label = "7 - REPLACEMENT" if freq == "7" else "8 - VOID"
        c.setStrokeColor(colors.HexColor("#1e3a5f"))
        c.setFillColor(colors.HexColor("#eef3fa"))
        c.rect(margin, top - 1.95*inch, W - 2*margin, 0.32*inch, fill=1, stroke=1)
        c.setFillColor(colors.HexColor("#1e3a5f"))
        c.setFont("Helvetica-Bold", 7)
        c.drawString(margin + 3, top - 1.74*inch,
                     "22. RESUBMISSION CODE / ORIGINAL REF. NO.")
        c.setFont("Helvetica", 8)
        c.setFillColor(colors.black)
        c.drawString(margin + 3, top - 1.90*inch,
                     f"{code_label}    Original Ref. No.: {orig_ref or '—'}")
        row_y = top - 2.45 * inch
    else:
        row_y = top - 2.05 * inch

    # ── Box 24 — Service lines header ────────────────────────────────
    c.setFillColor(colors.HexColor("#e8eef6"))
    c.rect(margin, row_y, W - 2*margin, 0.28*inch, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#1e3a5f"))
    c.setFont("Helvetica-Bold", 7)
    headers = ["24. DOS", "CPT/HCPCS", "MOD", "DX PTR", "CHARGES", "UNITS"]
    col_widths = [0.9, 1.1, 0.6, 0.6, 1.0, 0.5]
    col_widths = [w * inch for w in col_widths]
    x_cur = margin + 2
    for hdr, cw in zip(headers, col_widths):
        c.drawString(x_cur, row_y + 8, hdr)
        x_cur += cw

    # ── Service lines ────────────────────────────────────────────────
    for i, ln in enumerate(state.claim_lines[:6]):
        row_y -= 0.3 * inch
        fill = colors.HexColor("#f7f9fc") if i % 2 == 0 else colors.white
        c.setFillColor(fill)
        c.rect(margin, row_y, W - 2*margin, 0.28*inch, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        x_cur = margin + 4
        row_vals = [
            state.date_of_service,
            ln.cpt_code,
            " ".join(ln.modifiers[:2]),
            ",".join(str(j+1) for j in range(len(ln.icd10_codes))),
            f"${ln.charge:.2f}",
            str(ln.units),
        ]
        for val, cw in zip(row_vals, col_widths):
            c.drawString(x_cur, row_y + 8, str(val))
            x_cur += cw

    # ── Box 28 — Total charges ───────────────────────────────────────
    total_y = row_y - 0.5 * inch
    box(margin, total_y, col_w, 0.4*inch,
        "28. TOTAL CHARGE", f"${state.total_charge:.2f}")

    # ── Box 31 — Provider ────────────────────────────────────────────
    box(margin + col_w, total_y, col_w, 0.4*inch,
        "33. BILLING PROVIDER & NPI",
        f"{state.provider_name}  NPI: {state.provider_npi}")

    # ── Footer ───────────────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#f0f4f8"))
    c.rect(0, 0, W, 0.35*inch, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#888888"))
    c.setFont("Helvetica-Oblique", 7)
    c.drawCentredString(W/2, 10,
        f"SYNTHETIC DEMO — NOT A REAL CLAIM  |  ClaimPilot AI  |  Claim ID: {state.claim_id[:16]}")

    c.save()
