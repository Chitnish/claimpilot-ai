"""
Simulates:
  - Eligibility 270/271 check
  - Clearinghouse claim submission
  - Payer adjudication (80% pay, 20% denial with CARC 97)
  - 835/ERA remittance generation
"""
import random, uuid
from datetime import date


CARC_DESCRIPTIONS = {
    "97":  "The benefit for this service is included in the payment/allowance for another service/procedure that has already been adjudicated.",
    "50":  "These are non-covered services because this is not deemed a medical necessity by the payer.",
    "16":  "Claim/service lacks information or has submission/billing error(s).",
    "4":   "The service/equipment/drug is not covered under the patient's current benefit plan.",
    "CO45": "Charges exceed your contracted/legislated fee arrangement.",
}

RARC_DESCRIPTIONS = {
    "N130": "Consult plan benefit documents/guidelines for information about restrictions for this service.",
    "N95":  "This product/service is not payable per your contracted/legislated fee arrangement.",
    "MA130": "Your claim contains incomplete and/or invalid information.",
}


def check_eligibility(payer_name: str, member_id: str) -> dict:
    """Simulate a 270/271 eligibility response."""
    return {
        "active": True,
        "plan_name": f"{payer_name} PPO Gold",
        "copay": 30.0,
        "deductible_remaining": 250.0,
        "prior_auth_required": False,
    }


def submit_claim(claim_id: str, total_charge: float, force_deny: bool = False) -> dict:
    """Simulate clearinghouse submission. 20% chance of denial."""
    denied = force_deny or random.random() < 0.20
    return {
        "clearinghouse_ref": f"CLH-{uuid.uuid4().hex[:8].upper()}",
        "accepted": not denied,
        "denied": denied,
        "carc_code": "97" if denied else "",
        "rarc_code": "N130" if denied else "",
        "denial_reason": CARC_DESCRIPTIONS.get("97", "") if denied else "",
    }


def generate_era(
    claim_id: str,
    total_charge: float,
    carc_code: str,
) -> dict:
    """Generate a simulated 835/ERA remittance."""
    if carc_code:
        # Denied — zero payment
        paid = 0.0
        adjustment = total_charge
    else:
        # Pay 78% of billed (contractual adjustment)
        paid = round(total_charge * 0.78, 2)
        adjustment = round(total_charge - paid, 2)

    return {
        "check_number": f"CHK{random.randint(100000,999999)}",
        "payer_name": "Simulated Payer Inc.",
        "service_date": date.today().isoformat(),
        "total_billed": total_charge,
        "total_paid": paid,
        "contractual_adjustment": adjustment,
        "carc_code": carc_code,
        "rarc_code": "N95" if not carc_code else "N130",
        "lines": [
            {
                "claim_id": claim_id,
                "billed": total_charge,
                "allowed": round(total_charge * 0.85, 2) if not carc_code else 0.0,
                "paid": paid,
                "adjustment": adjustment,
                "carc_code": carc_code,
                "match_status": "matched",
            }
        ],
    }
