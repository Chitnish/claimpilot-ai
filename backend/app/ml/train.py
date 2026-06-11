"""Generate synthetic claims and train denial / anomaly models."""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest
from sklearn.metrics import accuracy_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

PAYERS = ["BlueCross", "Aetna", "United", "Cigna", "Humana"]
CPT_CODES = ["99213", "99214", "93000", "85025", "80053", "99000", "99215"]
E_AND_M_CPTS = {"99213", "99214", "99215"}
N_CLAIMS = 5000
ML_DIR = Path(__file__).resolve().parent


def generate_synthetic_claims(n: int = N_CLAIMS, random_state: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(random_state)

    payer_name = rng.choice(PAYERS, size=n)
    cpt_code = rng.choice(CPT_CODES, size=n)
    has_modifier = rng.binomial(1, 0.3, size=n)
    coding_issues = rng.poisson(0.8, size=n).clip(0, 4)
    npi_valid = rng.binomial(1, 0.9, size=n)
    charge_amount = np.clip(rng.normal(200, 80, size=n), 20, 800)
    prior_auth_required = rng.binomial(1, 0.15, size=n)
    num_dx_codes = rng.integers(1, 5, size=n)
    date_of_service_month = rng.integers(1, 13, size=n)

    coding_gt_0 = (coding_issues > 0).astype(float)
    coding_gt_2 = (coding_issues > 2).astype(float)
    missing_modifier_e_m = np.array(
        [
            has_modifier[i] == 0 and cpt_code[i] in E_AND_M_CPTS
            for i in range(n)
        ],
        dtype=float,
    )
    num_dx_gt_2 = (num_dx_codes > 2).astype(float)
    noise = rng.normal(0, 0.05, size=n)

    denial_probability = (
        0.15
        + 0.25 * coding_gt_0
        + 0.20 * coding_gt_2
        + 0.15 * prior_auth_required
        + 0.10 * (1 - npi_valid)
        + 0.08 * missing_modifier_e_m
        - 0.05 * num_dx_gt_2
        + noise
    )
    denial_probability = np.clip(denial_probability, 0.02, 0.98)
    denied = (denial_probability > 0.35).astype(int)

    return pd.DataFrame(
        {
            "payer_name": payer_name,
            "cpt_code": cpt_code,
            "has_modifier": has_modifier,
            "coding_issues": coding_issues,
            "npi_valid": npi_valid,
            "charge_amount": charge_amount,
            "prior_auth_required": prior_auth_required,
            "num_dx_codes": num_dx_codes,
            "date_of_service_month": date_of_service_month,
            "denied": denied,
        }
    )


def engineer_features(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    numeric_cols = [
        "has_modifier",
        "coding_issues",
        "npi_valid",
        "charge_amount",
        "prior_auth_required",
        "num_dx_codes",
        "date_of_service_month",
    ]
    payer_dummies = pd.get_dummies(df["payer_name"], prefix="payer")
    cpt_dummies = pd.get_dummies(df["cpt_code"], prefix="cpt")
    X = pd.concat([df[numeric_cols], payer_dummies, cpt_dummies], axis=1)
    feature_columns = list(X.columns)
    return X, feature_columns


def train_denial_model(
    X: pd.DataFrame, y: pd.Series
) -> tuple[GradientBoostingClassifier, dict]:
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        random_state=42,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    accuracy = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)
    auc = roc_auc_score(y_test, y_proba)

    print(f"Accuracy:  {accuracy:.4f}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"AUC-ROC:   {auc:.4f}")

    assert auc > 0.75, f"AUC {auc:.4f} is below 0.75 — check synthetic data generation"

    metrics = {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "auc": auc,
    }
    return model, metrics


def train_anomaly_model(df: pd.DataFrame) -> IsolationForest:
    anomaly_features = df[
        ["charge_amount", "coding_issues", "num_dx_codes", "has_modifier"]
    ]
    model = IsolationForest(
        n_estimators=100,
        contamination=0.08,
        random_state=42,
    )
    model.fit(anomaly_features)
    return model


def save_artifacts(
    denial_model: GradientBoostingClassifier,
    feature_columns: list[str],
    label_encoder_payer: LabelEncoder,
    label_encoder_cpt: LabelEncoder,
    anomaly_model: IsolationForest,
) -> None:
    ML_DIR.mkdir(parents=True, exist_ok=True)

    denial_artifact = {
        "model": denial_model,
        "feature_columns": feature_columns,
        "label_encoder_payer": label_encoder_payer,
        "label_encoder_cpt": label_encoder_cpt,
    }
    joblib.dump(denial_artifact, ML_DIR / "denial_model.pkl")
    joblib.dump(anomaly_model, ML_DIR / "anomaly_model.pkl")
    print("Models saved successfully")


def main() -> None:
    print(f"Generating {N_CLAIMS} synthetic claims...")
    df = generate_synthetic_claims()
    print(f"Denial rate: {df['denied'].mean():.2%}")

    X, feature_columns = engineer_features(df)
    y = df["denied"]

    label_encoder_payer = LabelEncoder()
    label_encoder_payer.fit(PAYERS)

    label_encoder_cpt = LabelEncoder()
    label_encoder_cpt.fit(CPT_CODES)

    print("Training denial prediction model...")
    denial_model, _ = train_denial_model(X, y)

    print("Training anomaly detection model...")
    anomaly_model = train_anomaly_model(df)

    save_artifacts(
        denial_model,
        feature_columns,
        label_encoder_payer,
        label_encoder_cpt,
        anomaly_model,
    )


if __name__ == "__main__":
    main()
