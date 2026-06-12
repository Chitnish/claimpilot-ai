"""
Seed synthetic claims in various pipeline states for the demo dashboard.

Run from backend/: python data/synthetic/seed.py
"""
from __future__ import annotations

import random
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

backend_dir = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
from faker import Faker

load_dotenv(backend_dir / ".env")

from app.services.supabase_client import get_supabase

PAYERS = [
    "BlueCross BlueShield",
    "Aetna PPO",
    "United HealthCare",
    "Cigna",
    "Humana",
]
PROVIDER_NAME = "Dr. Emily Carter MD"
DENIAL_RISK_FACTORS = ["Coding Issues: +2.1", "Num Dx Codes: -0.3"]

STATUS_DISTRIBUTION = (
    ["reconciled"] * 3
    + ["needs_review"] * 2
    + ["appealed"] * 2
    + ["submitted"] * 2
    + ["denied"] * 1
)

DENIAL_RISK_RANGES: dict[str, tuple[float, float]] = {
    "reconciled": (0.1, 0.3),
    "needs_review": (0.6, 0.9),
    "appealed": (0.7, 0.95),
    "submitted": (0.2, 0.5),
    "denied": (0.7, 0.9),
}

APPEAL_LETTER_TEMPLATE = """\
Dear Appeals Department,

We are writing to formally appeal the denial of claim {claim_id} for services rendered on {dos}. \
The claim was denied under CARC 97, indicating the benefit is included in payment for another service. \
However, CPT 99214 and the supporting laboratory work (CPT 80053) represent distinct, medically necessary \
services documented in the patient's chart for management of Type 2 diabetes mellitus (ICD-10 E11.9) \
and essential hypertension (ICD-10 I10).

Clinical guidelines from the ADA support periodic metabolic monitoring alongside evaluation and management \
visits. We respectfully request reconsideration and payment within 30 days.

Sincerely,
{provider}
Billing Department"""


def _denial_risk_for_status(status: str) -> float:
    lo, hi = DENIAL_RISK_RANGES[status]
    return round(random.uniform(lo, hi), 2)


def _member_id(payer: str) -> str:
    prefix = "".join(word[0] for word in payer.split()[:2]).upper()
    return f"{prefix}{random.randint(100000, 999999)}"


def seed_claims() -> int:
    fake = Faker()
    sb = get_supabase()

    org_rows = sb.table("orgs").select("id").limit(1).execute()
    if not org_rows.data:
        raise SystemExit("No org found in database — create an org before seeding.")
    org_id = org_rows.data[0]["id"]

    statuses = STATUS_DISTRIBUTION.copy()
    random.shuffle(statuses)
    seeded = 0

    for status in statuses:
        claim_id = str(uuid.uuid4())
        payer = random.choice(PAYERS)
        first_name = fake.first_name()
        last_name = fake.last_name()
        dob = fake.date_of_birth(minimum_age=18, maximum_age=85).isoformat()
        member_id = _member_id(payer)
        total_charge = round(random.uniform(150, 800), 2)
        denial_risk = _denial_risk_for_status(status)
        created_at = (
            datetime.now() - timedelta(days=random.randint(0, 7))
        ).isoformat()
        dos = (datetime.now() - timedelta(days=random.randint(1, 14))).date().isoformat()

        patient_row = sb.table("patients").insert({
            "org_id": org_id,
            "first_name": first_name,
            "last_name": last_name,
            "dob": dob,
            "member_id": member_id,
            "payer_name": payer,
        }).execute()
        patient_id = patient_row.data[0]["id"]

        encounter_row = sb.table("encounters").insert({
            "org_id": org_id,
            "patient_id": patient_id,
            "provider_name": PROVIDER_NAME,
            "provider_npi": "1234567893",
            "date_of_service": dos,
        }).execute()
        encounter_id = encounter_row.data[0]["id"]

        carc_code = "97" if status in ("denied", "appealed") else None
        appeal_letter = None
        if status == "appealed":
            appeal_letter = APPEAL_LETTER_TEMPLATE.format(
                claim_id=claim_id[:8].upper(),
                dos=dos,
                provider=PROVIDER_NAME,
            )

        sb.table("claims").insert({
            "id": claim_id,
            "org_id": org_id,
            "encounter_id": encounter_id,
            "status": status,
            "payer_name": payer,
            "total_charge": total_charge,
            "denial_risk": denial_risk,
            "denial_risk_factors": DENIAL_RISK_FACTORS,
            "carc_code": carc_code,
            "appeal_letter": appeal_letter,
            "created_at": created_at,
        }).execute()

        if status == "needs_review":
            sb.table("review_queue").insert({
                "org_id": org_id,
                "claim_id": claim_id,
                "reason": f"Denial risk {denial_risk:.0%} exceeds threshold",
                "details": {
                    "denial_risk": denial_risk,
                    "low_confidence_fields": [],
                },
                "status": "open",
            }).execute()

        seeded += 1

    return seeded


if __name__ == "__main__":
    count = seed_claims()
    print(f"Seeded {count} claims successfully")
