"""
Seed synthetic claims in various pipeline states for the demo dashboard.

Run from backend/: python data/synthetic/seed.py
"""
from __future__ import annotations

import random
import sys
import uuid
from datetime import datetime, timedelta, time
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

PLAN_COPAYS = {
    "PPO Gold": 30.00,
    "PPO Silver": 45.00,
    "HMO Value": 60.00,
}

PLAN_DEDUCTIBLES = {
    "PPO Gold": 500.00,
    "PPO Silver": 1500.00,
    "HMO Value": 3000.00,
}

APPOINTMENT_TYPES = ["office_visit", "lab", "imaging", "follow_up", "specialist"]
APPOINTMENT_STATUSES_UPCOMING = ["scheduled"]
APPOINTMENT_STATUSES_PAST = ["completed", "completed", "cancelled", "no_show"]

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


def _plan_type(payer: str) -> str:
    lower = payer.lower()
    if any(k in lower for k in ("aetna", "cigna", "united")):
        return "PPO"
    return "HMO"


def _plan_tier() -> str:
    return random.choice(["PPO Gold", "PPO Silver", "HMO Value"])


def _build_patient_profile(
    fake: Faker,
    org_id: str,
    first_name: str,
    last_name: str,
    dob: str,
    member_id: str,
    payer: str,
) -> dict:
    tier = _plan_tier()
    full_name = f"{first_name} {last_name}"
    eff_date = (datetime.now() - timedelta(days=random.randint(30, 900))).date().isoformat()
    ec_first = fake.first_name()
    return {
        "org_id": org_id,
        "first_name": first_name,
        "last_name": last_name,
        "dob": dob,
        "member_id": member_id,
        "payer_name": payer,
        "middle_name": fake.first_name()[0] + ".",
        "preferred_name": first_name,
        "gender": random.choice(["Female", "Male", "Non-binary"]),
        "ssn_last4": f"{random.randint(1000, 9999)}",
        "address_line1": fake.street_address(),
        "address_line2": fake.secondary_address() if random.random() > 0.6 else None,
        "city": fake.city(),
        "state": fake.state_abbr(),
        "zip_code": fake.zipcode(),
        "phone_primary": fake.phone_number(),
        "phone_secondary": fake.phone_number() if random.random() > 0.5 else None,
        "email": fake.email(),
        "emergency_contact_name": f"{ec_first} {fake.last_name()}",
        "emergency_contact_relationship": random.choice(["spouse", "parent", "sibling", "friend"]),
        "emergency_contact_phone": fake.phone_number(),
        "responsible_party_name": full_name,
        "responsible_party_relationship": "self",
        "responsible_party_dob": dob,
        "responsible_party_phone": fake.phone_number(),
        "insurance_plan_name": f"{payer} {tier}",
        "insurance_group_number": f"GRP{random.randint(100000, 999999)}",
        "insurance_plan_type": _plan_type(payer),
        "insurance_effective_date": eff_date,
        "insurance_copay": PLAN_COPAYS[tier],
        "insurance_deductible": PLAN_DEDUCTIBLES[tier],
        "secondary_payer_name": None,
        "secondary_member_id": None,
        "notes": None,
    }


def _insert_patient(sb, profile: dict) -> str:
    basic = {
        "org_id": profile["org_id"],
        "first_name": profile["first_name"],
        "last_name": profile["last_name"],
        "dob": profile["dob"],
        "member_id": profile["member_id"],
        "payer_name": profile["payer_name"],
    }
    try:
        row = sb.table("patients").insert(profile).execute()
        return row.data[0]["id"]
    except Exception as exc:
        print(f"[seed] extended patient insert skipped ({exc}); using base columns")
        row = sb.table("patients").insert(basic).execute()
        return row.data[0]["id"]


def _seed_appointments(sb, patient_id: str, org_id: str) -> None:
    today = datetime.now().date()
    rows: list[dict] = []

    for i in range(random.randint(2, 3)):
        appt_date = today + timedelta(days=random.randint(3, 45))
        rows.append({
            "patient_id": patient_id,
            "org_id": org_id,
            "appointment_date": appt_date.isoformat(),
            "appointment_time": time(hour=random.randint(8, 16), minute=random.choice([0, 15, 30, 45])).isoformat(),
            "provider_name": PROVIDER_NAME,
            "appointment_type": random.choice(APPOINTMENT_TYPES),
            "status": "scheduled",
            "notes": "Routine follow-up" if random.random() > 0.5 else None,
        })

    for _ in range(random.randint(1, 2)):
        appt_date = today - timedelta(days=random.randint(7, 180))
        rows.append({
            "patient_id": patient_id,
            "org_id": org_id,
            "appointment_date": appt_date.isoformat(),
            "appointment_time": time(hour=random.randint(8, 16), minute=0).isoformat(),
            "provider_name": PROVIDER_NAME,
            "appointment_type": random.choice(APPOINTMENT_TYPES),
            "status": random.choice(APPOINTMENT_STATUSES_PAST),
            "notes": None,
        })

    try:
        sb.table("patient_appointments").insert(rows).execute()
    except Exception as exc:
        print(f"[seed] appointments skipped (migration 0007 not applied?): {exc}")


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

        profile = _build_patient_profile(fake, org_id, first_name, last_name, dob, member_id, payer)
        patient_id = _insert_patient(sb, profile)
        _seed_appointments(sb, patient_id, org_id)

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
