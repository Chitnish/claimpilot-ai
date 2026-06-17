"""
Cross-claim / cross-provider fraud & abuse signals.

A single-claim Isolation Forest on a handful of features cannot tell a credible
fraud story — real program-integrity detection looks for patterns ACROSS a
provider's claim stream and relative to peers. This module maintains a rolling,
in-process view of the claim stream and derives explainable statistical signals
that mirror the abuse patterns the OIG and CMS program-integrity contractors
actually pursue:

  - Charge outlier vs peers (provider billing far above the peer average)
  - Duplicate / cloned claims (same provider + member + service set repeated)
  - E/M upcoding skew (disproportionate share of level 4/5 office visits)
  - Improbable service volume (too many claims for one provider on one day)

Signals are combined into a 0-1 cross-claim score with human-readable reasons,
which the fraud agent fuses with the model anomaly score. State is in-process
(rebuilds from the live claim stream); persisting provider baselines across
restarts is a Tier-2 step (a provider_npi column + warehouse aggregation).
"""
from __future__ import annotations

import statistics
from collections import defaultdict

# Level 4/5 office/outpatient E/M — the codes upcoding schemes gravitate to.
HIGH_LEVEL_EM = {"99204", "99205", "99214", "99215"}
EM_CODES = {
    "99202", "99203", "99204", "99205",
    "99211", "99212", "99213", "99214", "99215",
}

# Tuning thresholds (documented heuristics, not invented payer policy).
CHARGE_Z_THRESHOLD = 2.5          # std-devs above peer mean to flag
MIN_PEER_SAMPLE = 8               # need a peer baseline before charge z-scores mean anything
UPCODE_MIN_EM_CLAIMS = 4          # provider needs a track record before skew is meaningful
UPCODE_SHARE_THRESHOLD = 0.80     # share of E/M that is level 4/5
VOLUME_DOS_THRESHOLD = 15         # claims by one provider on a single DOS

# Rolling, bounded in-process history.
_MAX_HISTORY = 5000
_PROVIDER_HISTORY: dict[str, list[dict]] = defaultdict(list)
_ALL_CHARGES: list[float] = []
_SEEN_CLAIM_IDS: set[str] = set()


def reset() -> None:
    """Clear all rolling state (used by tests)."""
    _PROVIDER_HISTORY.clear()
    _ALL_CHARGES.clear()
    _SEEN_CLAIM_IDS.clear()


def _record(state) -> dict:
    cpts = [ln.cpt_code for ln in state.claim_lines]
    rec = {
        "claim_id": state.claim_id,
        "npi": state.provider_npi or "",
        "member_id": state.patient_member_id or "",
        "dos": state.date_of_service or "",
        "cpt_set": tuple(sorted(cpts)),
        "total_charge": float(state.total_charge or 0.0),
        "em_codes": [c for c in cpts if c in EM_CODES],
    }
    if state.claim_id not in _SEEN_CLAIM_IDS:
        _SEEN_CLAIM_IDS.add(state.claim_id)
        _ALL_CHARGES.append(rec["total_charge"])
        if len(_ALL_CHARGES) > _MAX_HISTORY:
            del _ALL_CHARGES[0]
    return rec


def evaluate(state) -> dict:
    """
    Register `state` into the rolling stream and return cross-claim fraud signals:
      { "score": float 0-1, "reasons": list[str], "signals": {flag: bool} }

    The current claim is compared against history captured BEFORE it (so the
    provider's prior claims and the peer population), then added to history.
    """
    rec = _record(state)
    npi = rec["npi"]
    prior = list(_PROVIDER_HISTORY[npi])  # this provider's earlier claims

    reasons: list[str] = []
    signals: dict[str, bool] = {
        "charge_outlier": False,
        "duplicate_clone": False,
        "upcoding_skew": False,
        "volume_spike": False,
    }
    score = 0.0

    # 1) Charge outlier vs peer population (needs a baseline excluding this claim).
    peer = _ALL_CHARGES[:-1] if _ALL_CHARGES else []
    if len(peer) >= MIN_PEER_SAMPLE:
        mean = statistics.fmean(peer)
        stdev = statistics.pstdev(peer)
        if stdev > 0:
            z = (rec["total_charge"] - mean) / stdev
            if z >= CHARGE_Z_THRESHOLD:
                signals["charge_outlier"] = True
                score += 0.40
                reasons.append(
                    f"Charge ${rec['total_charge']:,.0f} is {z:.1f} SD above the peer "
                    f"average (${mean:,.0f}) — statistical billing outlier."
                )

    # 2) Duplicate / cloned claim: same provider + member + identical service set.
    if npi and rec["member_id"]:
        for p in prior:
            if p["member_id"] == rec["member_id"] and p["cpt_set"] == rec["cpt_set"]:
                signals["duplicate_clone"] = True
                score += 0.50
                reasons.append(
                    f"Possible duplicate/cloned claim — identical service set already "
                    f"billed for member {rec['member_id']} by this provider "
                    f"(claim {p['claim_id'][:8]})."
                )
                break

    # 3) E/M upcoding skew across the provider's track record (incl. this claim).
    em_history = prior + [rec]
    em_claims = [p for p in em_history if p["em_codes"]]
    if len(em_claims) >= UPCODE_MIN_EM_CLAIMS:
        high = sum(1 for p in em_claims if any(c in HIGH_LEVEL_EM for c in p["em_codes"]))
        share = high / len(em_claims)
        if share >= UPCODE_SHARE_THRESHOLD:
            signals["upcoding_skew"] = True
            score += 0.40
            reasons.append(
                f"E/M upcoding pattern — {share:.0%} of this provider's {len(em_claims)} "
                f"office visits are level 4/5 (99214/99215), well above typical distribution."
            )

    # 4) Improbable single-day service volume for one provider.
    if npi and rec["dos"]:
        same_day = sum(1 for p in em_history if p["dos"] == rec["dos"])
        if same_day >= VOLUME_DOS_THRESHOLD:
            signals["volume_spike"] = True
            score += 0.30
            reasons.append(
                f"Improbable service volume — {same_day} claims by this provider on "
                f"{rec['dos']}."
            )

    # Commit this claim to the provider's history after scoring.
    hist = _PROVIDER_HISTORY[npi]
    hist.append(rec)
    if len(hist) > _MAX_HISTORY:
        del hist[0]

    return {"score": min(score, 1.0), "reasons": reasons, "signals": signals}
