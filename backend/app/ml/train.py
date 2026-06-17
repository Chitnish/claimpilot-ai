"""
Train the denial-risk and anomaly models against the payer adjudication engine.

Unlike the previous version (which generated labels from a hand-written
formula and then "learned" it back), this trains on outcomes produced by the
actual adjudication rules in app.services.mock_payer — the same engine that
adjudicates demo claims. Hidden payer-side state (auth on file, coverage
termination, underpayments) is invisible to the features, so the model faces
genuine irreducible uncertainty, exactly like a production denial model.

Run from backend/:  .\\.venv\\Scripts\\python.exe -m app.ml.train
"""
from __future__ import annotations

import random
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split

from app.ml.features import claim_features, feature_frame, NUMERIC_FEATURES
from app.schemas.claim_state import ClaimLine, ClaimState
from app.services.mock_payer import adjudicate_claim, check_eligibility

N_CLAIMS = 8000
ML_DIR = Path(__file__).resolve().parent

PAYERS = ["BlueCross BlueShield", "Aetna PPO", "United HealthCare", "Cigna", "Humana"]
VALID_NPI = "1234567893"
INVALID_NPI = "1234567890"

E_AND_M = ["99213", "99214", "99215"]
ANCILLARY = ["93000", "85025", "80053", "99000", "90471"]
ANCILLARY_WEIGHTS = [0.30, 0.26, 0.26, 0.06, 0.12]

CHARGES = {
    "99213": 185.0, "99214": 250.0, "99215": 320.0,
    "93000": 89.0, "85025": 45.0, "80053": 52.0, "99000": 15.0, "90471": 35.0,
}

DX_SUPPORTED = {
    "99213": ["E11.9", "I10", "J06.9", "M54.5", "F41.1", "E78.5", "Z00.00"],
    "99214": ["E11.9", "I10", "J06.9", "M54.5", "F41.1", "E78.5"],
    "99215": ["E11.9", "I10", "R07.9", "F32.9"],
    "93000": ["I10", "R00.0", "R07.9", "E11.9"],
    "85025": ["D64.9", "R50.9", "J06.9", "E11.9"],
    "80053": ["E11.9", "E78.5", "I10"],
    "99000": ["E11.9", "I10", "E78.5"],
    "90471": ["Z23"],
}
DX_UNSUPPORTED = {
    "93000": ["M54.5", "Z00.00", "F41.1"],
    "85025": ["M54.5", "F41.1"],
    "80053": ["M54.5", "J06.9", "F41.1"],
}


def _sample_claim(i: int, rng: random.Random) -> ClaimState:
    payer = rng.choice(PAYERS)
    member_id = f"{payer.replace(' ', '')[:4].upper()}{rng.randint(100000, 999999)}"

    # One E/M + 1-2 ancillaries. 99000 is rare (practices seldom bill it). With
    # the error-seeded mix below and the authentic edit set (status-B bundling,
    # NCCI panel unbundling, MUE, LCD necessity, auth, timely filing) the
    # observed claim-or-line denial rate lands ~35-40% — higher than a clean
    # production book (~15-25%) by design, so the model has ample signal to learn.
    n_anc = rng.randint(1, 2)
    anc = []
    while len(anc) < n_anc:
        pick = rng.choices(ANCILLARY, weights=ANCILLARY_WEIGHTS)[0]
        if pick not in anc:
            anc.append(pick)
    cpts = [rng.choice(E_AND_M)] + anc

    # Modifier 25 belongs on the E/M when billed same-day as a procedure with a
    # global period (immunization admin 90471); ~85% carry it correctly.
    needs_mod25 = "90471" in cpts
    em_mods = ["25"] if needs_mod25 and rng.random() < 0.85 else []
    bypass_99000 = ["59"] if "99000" in cpts and rng.random() < 0.60 else []

    lines: list[ClaimLine] = []
    for n, cpt in enumerate(cpts, start=1):
        unsupported = DX_UNSUPPORTED.get(cpt)
        if unsupported and rng.random() < 0.07:
            dxs = [rng.choice(unsupported)]
        else:
            pool = DX_SUPPORTED[cpt]
            dxs = rng.sample(pool, k=min(rng.randint(1, 2), len(pool)))
        mods = list(em_mods) if cpt in E_AND_M else (list(bypass_99000) if cpt == "99000" else [])
        units = 2 if rng.random() < 0.03 else 1   # occasional MUE violation
        lines.append(ClaimLine(
            line_no=n, cpt_code=cpt, modifiers=mods, icd10_codes=dxs,
            units=units, charge=CHARGES[cpt] * units,
        ))

    dos_age = rng.choices([rng.randint(1, 30), rng.randint(60, 100), rng.randint(120, 400)],
                          weights=[0.90, 0.07, 0.03])[0]
    from datetime import date, timedelta
    dos = (date.today() - timedelta(days=dos_age)).isoformat()

    npi = INVALID_NPI if rng.random() < 0.03 else VALID_NPI
    member = "" if rng.random() < 0.015 else member_id

    elig = check_eligibility(payer, member)
    state = ClaimState(
        claim_id=f"train-{i}",
        patient_name="Synthetic, Patient",
        patient_dob="1970-01-01",
        patient_member_id=member,
        payer_name=payer,
        provider_npi=npi,
        date_of_service=dos,
        claim_lines=lines,
        eligibility_active=elig["active"],
        copay=elig["copay"],
        coinsurance=elig["coinsurance"],
        deductible_remaining=elig["deductible_remaining"],
        prior_auth_cpts=elig["prior_auth_cpts"],
        prior_auth_on_file=elig["prior_auth_on_file"],
    )
    state.total_charge = sum(ln.charge for ln in lines)
    return state


def generate_training_data(n: int = N_CLAIMS, seed: int = 42) -> tuple[pd.DataFrame, pd.Series]:
    rng = random.Random(seed)
    rows: list[dict] = []
    labels: list[int] = []

    for i in range(n):
        state = _sample_claim(i, rng)
        result = adjudicate_claim(state)
        denied = result["claim_denied"] or any(d["denied"] for d in result["line_decisions"])
        rows.append(claim_features(state.model_dump()))
        labels.append(int(denied))

    return feature_frame(rows), pd.Series(labels, name="denied")


def train_denial_model(X: pd.DataFrame, y: pd.Series) -> tuple[GradientBoostingClassifier, dict]:
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    model = GradientBoostingClassifier(
        n_estimators=300, max_depth=4, learning_rate=0.05,
        subsample=0.9, random_state=42,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]
    metrics = {
        "accuracy": accuracy_score(y_test, y_pred),
        "precision": precision_score(y_test, y_pred, zero_division=0),
        "recall": recall_score(y_test, y_pred, zero_division=0),
        "auc": roc_auc_score(y_test, y_proba),
        "base_denial_rate": float(y.mean()),
    }
    for k, v in metrics.items():
        print(f"{k:>18}: {v:.4f}")
    assert metrics["auc"] > 0.75, f"AUC {metrics['auc']:.4f} below 0.75 — check generation"
    return model, metrics


def train_anomaly_model(X: pd.DataFrame) -> IsolationForest:
    anomaly_features = X[["charge_amount", "num_lines", "num_dx_codes", "units_over_mue"]]
    model = IsolationForest(n_estimators=100, contamination=0.08, random_state=42)
    model.fit(anomaly_features)
    return model


def main() -> None:
    print(f"Generating {N_CLAIMS} synthetic claims through the adjudication engine...")
    X, y = generate_training_data()
    print(f"Observed denial rate (claim- or line-level): {y.mean():.2%}")

    print("\nTraining denial prediction model...")
    model, metrics = train_denial_model(X, y)

    print("\nTraining anomaly detection model...")
    anomaly_model = train_anomaly_model(X)

    joblib.dump(
        {"model": model, "feature_columns": list(X.columns), "metrics": metrics},
        ML_DIR / "denial_model.pkl",
    )
    joblib.dump(anomaly_model, ML_DIR / "anomaly_model.pkl")
    print("\nModels saved successfully")


if __name__ == "__main__":
    main()
