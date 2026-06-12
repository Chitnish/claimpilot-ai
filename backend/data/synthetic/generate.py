"""
Generates a synthetic superbill as a PNG image using reportlab + Pillow.
Run: python data/synthetic/generate.py
Outputs: data/synthetic/superbill_<id>.png
"""
import sys, uuid, random
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.lib import colors

# Sample synthetic data pools
PAYERS  = ["BlueCross BlueShield", "Aetna PPO", "United HealthCare", "Cigna", "Humana"]
CPT_MAP = {
    "99213": ("Office visit, est. patient, moderate complexity", 185.00),
    "99214": ("Office visit, est. patient, high complexity",     250.00),
    "93000": ("Electrocardiogram, routine",                       89.00),
    "85025": ("Complete CBC with differential",                   45.00),
    "80053": ("Comprehensive metabolic panel",                    52.00),
    "99000": ("Specimen handling fee",                            15.00),
}

E_AND_M = ["99213", "99214"]
ANCILLARY = ["93000", "85025", "80053", "99000"]

# Clinically plausible diagnoses per CPT (matches payer coverage policy) and
# implausible ones (will trip LCD edits) — mixed deliberately so generated
# claims include both clean and deniable examples.
DX_SUPPORTED = {
    "99213": ["E11.9", "I10", "J06.9", "M54.5", "F41.1", "E78.5", "Z00.00"],
    "99214": ["E11.9", "I10", "J06.9", "M54.5", "F41.1", "E78.5"],
    "93000": ["I10", "R00.0", "R07.9", "E11.9"],
    "85025": ["D64.9", "R50.9", "J06.9", "E11.9"],
    "80053": ["E11.9", "E78.5", "I10"],
    "99000": ["E11.9", "I10", "E78.5"],
}
DX_UNSUPPORTED = {
    "93000": ["M54.5", "Z00.00", "F41.1"],
    "85025": ["M54.5", "F41.1"],
    "80053": ["M54.5", "J06.9", "F41.1"],
}

def make_superbill(out_dir: str = "data/synthetic") -> str:
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    sid = uuid.uuid4().hex[:8].upper()
    pdf_path = str(Path(out_dir) / f"superbill_{sid}.pdf")

    c = rl_canvas.Canvas(pdf_path, pagesize=letter)
    W, H = letter

    # Header
    c.setFillColor(colors.HexColor("#1e3a5f"))
    c.rect(0, H - 0.8*inch, W, 0.8*inch, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(W/2, H - 0.45*inch, "AMPCUS FAMILY MEDICINE")
    c.setFont("Helvetica", 9)
    c.drawCentredString(W/2, H - 0.65*inch, "123 Clinic Drive, Chantilly VA 20151  |  NPI: 1234567893")

    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.5*inch, H - 1.1*inch, "PATIENT SUPERBILL")

    # Patient info box
    first = random.choice(["James","Maria","David","Sarah","Kevin","Linda","Robert","Patricia"])
    last  = random.choice(["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis"])
    dob   = f"{random.randint(1950,2000)}-{random.randint(1,12):02d}-{random.randint(1,28):02d}"
    payer = random.choice(PAYERS)
    mid   = f"{payer.replace(' ','')[:4].upper()}{random.randint(100000,999999)}"
    from datetime import date, timedelta
    dos   = (date.today() - timedelta(days=random.randint(1, 10))).isoformat()
    npi   = "1234567893"  # checksum-valid synthetic NPI (passes Luhn w/ 80840 prefix)
    provider = "Dr. Emily Carter MD"

    fields = [
        ("Patient Name:",    f"{last}, {first}"),
        ("Date of Birth:",    dob),
        ("Member ID:",        mid),
        ("Insurance Payer:",  payer),
        ("Date of Service:",  dos),
        ("Provider:",         provider),
        ("Provider NPI:",     npi),
    ]

    y = H - 1.35*inch
    c.setFont("Helvetica", 9)
    for label, val in fields:
        c.setFont("Helvetica-Bold", 9); c.drawString(0.5*inch, y, label)
        c.setFont("Helvetica", 9);      c.drawString(2.2*inch, y, val)
        y -= 0.22*inch

    # Service lines
    y -= 0.1*inch
    c.setFillColor(colors.HexColor("#e8eef6"))
    c.rect(0.4*inch, y, W - 0.8*inch, 0.28*inch, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#1e3a5f"))
    c.setFont("Helvetica-Bold", 8)
    for x, hdr in [(0.5, "CPT"), (1.05, "MOD"), (1.5, "DESCRIPTION"), (4.2, "ICD-10"), (5.4, "UNITS"), (6.0, "CHARGE")]:
        c.drawString(x*inch, y + 8, hdr)
    y -= 0.28*inch

    # One E/M visit + 1-2 ancillary services, like a real primary-care superbill.
    # 99000 weighted low — most practices rarely bill it (it trips NCCI edits).
    n_anc = random.randint(1, 2)
    anc: list[str] = []
    while len(anc) < n_anc:
        pick = random.choices(ANCILLARY, weights=[0.34, 0.30, 0.30, 0.06])[0]
        if pick not in anc:
            anc.append(pick)
    cpts = [random.choice(E_AND_M)] + anc
    has_ecg = "93000" in cpts
    # Most E/M lines billed with an ECG carry the required modifier 25 —
    # the rest will (correctly) trip the scrubber/payer bundling edit.
    em_mods = ["25"] if has_ecg and random.random() < 0.75 else []

    total = 0.0
    c.setFillColor(colors.black)
    for i, cpt in enumerate(cpts):
        desc, charge = CPT_MAP[cpt]
        # 80% clinically supported dx; 20% draw an unsupported dx (LCD denial bait)
        unsupported = DX_UNSUPPORTED.get(cpt)
        if unsupported and random.random() < 0.20:
            dx = [random.choice(unsupported)]
        else:
            dx = random.sample(DX_SUPPORTED[cpt], k=min(random.randint(1, 2), len(DX_SUPPORTED[cpt])))
        mods = em_mods if cpt in E_AND_M else []
        total += charge
        fill = colors.HexColor("#f7f9fc") if i % 2 == 0 else colors.white
        c.setFillColor(fill)
        c.rect(0.4*inch, y, W - 0.8*inch, 0.27*inch, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        c.drawString(0.5*inch,  y+7, cpt)
        c.drawString(1.05*inch, y+7, ",".join(mods))
        c.drawString(1.5*inch,  y+7, desc[:33])
        c.drawString(4.2*inch,  y+7, ", ".join(dx))
        c.drawString(5.4*inch,  y+7, "1")
        c.drawString(6.0*inch,  y+7, f"${charge:.2f}")
        y -= 0.27*inch

    # Total
    y -= 0.1*inch
    c.setFont("Helvetica-Bold", 10)
    c.drawString(4.5*inch, y, f"TOTAL:  ${total:.2f}")

    # Footer
    c.setFillColor(colors.HexColor("#eeeeee"))
    c.rect(0, 0, W, 0.3*inch, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#999999"))
    c.setFont("Helvetica-Oblique", 7)
    c.drawCentredString(W/2, 8, "SYNTHETIC DATA — FOR DEMO PURPOSES ONLY — NOT REAL PHI")

    c.save()
    print(f"Generated: {pdf_path}")
    return pdf_path


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    for _ in range(n):
        make_superbill()
