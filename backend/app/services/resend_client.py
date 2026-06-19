from __future__ import annotations

import asyncio
import html
import os

import resend

resend.api_key = os.getenv("RESEND_API_KEY", "")


def _appeal_subject(claim_id: str, patient_name: str) -> str:
    return f"Appeal — Claim {claim_id[:8]} — {patient_name}"


def _build_html(
    claim_id: str,
    patient_name: str,
    payer_name: str,
    carc_code: str,
    appeal_letter: str,
) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#f5f5f5;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;">
    <div style="background:#1e3a5f;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:600;">
      ClaimPilot AI — Appeal Letter
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;background:#f9f9f9;font-weight:600;width:140px;">Claim ID</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;">{html.escape(claim_id)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;background:#f9f9f9;font-weight:600;">Patient</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;">{html.escape(patient_name)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;background:#f9f9f9;font-weight:600;">Payer</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;">{html.escape(payer_name)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;background:#f9f9f9;font-weight:600;">Denial Code</td>
          <td style="padding:8px 12px;border:1px solid #e0e0e0;">{html.escape(carc_code)}</td>
        </tr>
      </table>
      <pre style="font-family:Georgia,serif;white-space:pre-wrap;padding:16px;background:#fafafa;border:1px solid #e0e0e0;border-radius:4px;line-height:1.6;margin:0;">{html.escape(appeal_letter)}</pre>
    </div>
    <div style="padding:12px 24px;font-size:12px;color:#888888;border-top:1px solid #e0e0e0;">
      Synthetic demo — not a real claim.
    </div>
  </div>
</body>
</html>"""


def _reply_html(body_text: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#f5f5f5;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;">
    <div style="background:#1e3a5f;color:#ffffff;padding:16px 24px;font-size:16px;font-weight:600;">
      ClaimPilot AI — Appeal Response
    </div>
    <div style="padding:24px;">
      <pre style="font-family:Georgia,serif;white-space:pre-wrap;line-height:1.6;margin:0;">{html.escape(body_text)}</pre>
    </div>
    <div style="padding:12px 24px;font-size:12px;color:#888888;border-top:1px solid #e0e0e0;">
      Synthetic demo — not a real claim.
    </div>
  </div>
</body>
</html>"""


async def send_appeal_email(
    claim_id: str,
    patient_name: str,
    payer_name: str,
    carc_code: str,
    appeal_letter: str,
) -> bool:
    from_email = os.getenv("ALERT_FROM_EMAIL", "onboarding@resend.dev")
    to_email = os.getenv("ALERT_TO_EMAIL", "")
    reply_to = os.getenv("RESEND_INBOUND_ADDRESS", "")

    if not to_email:
        print("Warning: ALERT_TO_EMAIL is not set; skipping appeal email.")
        return False

    subject = _appeal_subject(claim_id, patient_name)
    html_body = _build_html(claim_id, patient_name, payer_name, carc_code, appeal_letter)

    payload: dict = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_body,
    }
    if reply_to:
        payload["reply_to"] = [reply_to]

    def _send() -> None:
        resend.Emails.send(payload)

    try:
        await asyncio.to_thread(_send)
    except Exception as exc:
        print(f"Failed to send appeal email: {exc}")
        return False

    return True


async def send_dispute_reply_email(
    claim_id: str,
    state,
    reply_text: str,
    in_reply_to: str | None = None,
) -> bool:
    """Send an AI dispute reply, threading via In-Reply-To / References when provided."""
    from_email = os.getenv("ALERT_FROM_EMAIL", "onboarding@resend.dev")
    to_email = os.getenv("ALERT_TO_EMAIL", "")

    if not to_email:
        print("Warning: ALERT_TO_EMAIL is not set; skipping dispute reply email.")
        return False

    patient_name = getattr(state, "patient_name", "") or "Patient"
    subject = f"Re: {_appeal_subject(claim_id, patient_name)}"
    html_body = _reply_html(reply_text)

    payload: dict = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_body,
    }
    if in_reply_to:
        payload["headers"] = {
            "In-Reply-To": in_reply_to,
            "References": in_reply_to,
        }

    def _send() -> None:
        resend.Emails.send(payload)

    try:
        await asyncio.to_thread(_send)
    except Exception as exc:
        print(f"Failed to send dispute reply email: {exc}")
        return False

    return True
