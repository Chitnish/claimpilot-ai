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
DX      = ["E11.9", "I10", "J06.9", "M54.5", "Z00.00", "F41.1", "E78.5"]
CPT_MAP = {
    "99213": ("Office visit, est. patient, moderate complexity", 185.00),
    "99214": ("Office visit, est. patient, high complexity",     250.00),
    "93000": ("Electrocardiogram, routine",                       89.00),
    "85025": ("Complete CBC with differential",                   45.00),
    "80053": ("Comprehensive metabolic panel",                    52.00),
    "99000": ("Specimen handling fee",                            15.00),
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
    mid   = f"{random.choice(PAYERS[:3]).replace(' ','')[:4].upper()}{random.randint(100000,999999)}"
    payer = random.choice(PAYERS)
    dos   = "2026-06-10"
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
    for x, hdr in [(0.5, "CPT"), (1.1, "DESCRIPTION"), (4.2, "ICD-10"), (5.3, "UNITS"), (6.0, "CHARGE")]:
        c.drawString(x*inch, y + 8, hdr)
    y -= 0.28*inch

    cpts = random.sample(list(CPT_MAP.keys()), k=random.randint(2, 3))
    total = 0.0
    c.setFillColor(colors.black)
    for i, cpt in enumerate(cpts):
        desc, charge = CPT_MAP[cpt]
        dx = random.sample(DX, k=random.randint(1, 2))
        total += charge
        fill = colors.HexColor("#f7f9fc") if i % 2 == 0 else colors.white
        c.setFillColor(fill)
        c.rect(0.4*inch, y, W - 0.8*inch, 0.27*inch, fill=1, stroke=1)
        c.setFillColor(colors.black)
        c.setFont("Helvetica", 8)
        c.drawString(0.5*inch,  y+7, cpt)
        c.drawString(1.1*inch,  y+7, desc[:38])
        c.drawString(4.2*inch,  y+7, ", ".join(dx))
        c.drawString(5.3*inch,  y+7, "1")
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
