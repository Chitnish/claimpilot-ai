from __future__ import annotations

import asyncio
import html
import os
import re

import resend

resend.api_key = os.getenv("RESEND_API_KEY", "")


def _strip_html_to_text(raw: str) -> str:
    """Basic HTML → plain text for inbound emails that only have an html body."""
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    text = re.sub(r"</p>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def trim_quoted_reply(text: str) -> str:
    """Keep only the new reply text; drop Gmail/Outlook quoted thread below."""
    if not text:
        return ""
    cut = text
    for pattern in (
        r"\nOn .+ wrote:\s*\n",
        r"\n-{3,}\s*Original Message",
        r"\n_{3,}",
        r"\nFrom:.+\nSent:",
    ):
        m = re.search(pattern, cut, flags=re.I)
        if m:
            cut = cut[:m.start()]
    lines = cut.splitlines()
    trimmed: list[str] = []
    for line in lines:
        if line.strip().startswith(">") and trimmed:
            break
        trimmed.append(line)
    return "\n".join(trimmed).strip()


def extract_inbound_body(email: dict) -> str:
    """Plain-text body from a Receiving API response, with quote trimming."""
    text = (email.get("text") or "").strip()
    html_raw = (email.get("html") or "").strip()
    if text:
        body = text
    elif html_raw:
        body = _strip_html_to_text(html_raw)
    else:
        body = ""
    return trim_quoted_reply(body)


async def fetch_inbound_email_body(email_id: str) -> tuple[str, str | None]:
    """Resend webhooks omit the body — must call Emails.Receiving.get(email_id)."""
    def _fetch() -> tuple[str, str | None]:
        received = resend.Emails.Receiving.get(email_id)
        data = received if isinstance(received, dict) else dict(received)
        body = extract_inbound_body(data)
        message_id = data.get("message_id") or None
        return body, message_id

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as exc:
        print(f"[dispute] Receiving API error for {email_id}: {exc}")
        return "", None


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


def _patient_statement_html(patient_name: str, claim_id: str, patient_balance: float) -> str:
    short_id = claim_id[:8].upper()
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">
    <div style="background:#1e3a5f;color:#ffffff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <h1 style="margin:0;font-size:20px;font-weight:600;">ClaimPilot AI</h1>
      <p style="color:#a0b4c8;margin:4px 0 0 0;font-size:14px;">Patient Billing Statement</p>
    </div>
    <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-radius:0 0 8px 8px;">
      <p style="color:#374151;font-size:15px;">Dear {html.escape(patient_name)},</p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Please find attached your patient billing statement for Claim
        <strong>{html.escape(short_id)}</strong>.
      </p>
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 8px 0;font-size:13px;color:#6b7280;">Amount Due</p>
        <p style="margin:0;font-size:28px;font-weight:bold;color:#1e3a5f;">
          ${patient_balance:,.2f}
        </p>
      </div>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        This statement reflects the portion of your healthcare services
        not covered by your insurance. Please review the attached PDF
        for a complete itemized breakdown of services.
      </p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
        This is an automated statement from ClaimPilot AI.
        For questions, please contact your provider's billing office.
      </p>
    </div>
    <div style="padding:12px 24px;font-size:12px;color:#888888;border-top:1px solid #e0e0e0;">
      Synthetic demo — not a real claim.
    </div>
  </div>
</body>
</html>"""


async def send_patient_statement_email(
    claim_id: str,
    patient_name: str,
    total_charge: float,
    patient_balance: float,
    statement_pdf_path: str,
) -> bool:
    """Send the patient statement PDF as an email attachment."""
    import base64
    from pathlib import Path

    from_email = os.getenv("ALERT_FROM_EMAIL", "onboarding@resend.dev")
    to_email = os.getenv("ALERT_TO_EMAIL", "")

    if not to_email:
        print("Warning: ALERT_TO_EMAIL is not set; skipping patient statement email.")
        return False

    pdf_path = Path(statement_pdf_path)
    if not pdf_path.exists():
        print(f"[resend] patient statement PDF not found: {statement_pdf_path}")
        return False

    pdf_b64 = base64.b64encode(pdf_path.read_bytes()).decode("utf-8")
    short_id = claim_id[:8].upper()
    subject = f"Patient Statement — {patient_name} — Claim {short_id}"
    html_body = _patient_statement_html(patient_name, claim_id, patient_balance)

    payload: dict = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_body,
        "attachments": [
            {
                "filename": f"patient_statement_{claim_id[:8]}.pdf",
                "content": pdf_b64,
            }
        ],
    }

    def _send() -> None:
        resend.Emails.send(payload)

    try:
        await asyncio.to_thread(_send)
    except Exception as exc:
        print(f"[resend] patient statement email error: {exc}")
        return False

    print(f"[resend] patient statement email sent for claim {claim_id[:8]}")
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
    reply_to = os.getenv("RESEND_INBOUND_ADDRESS", "")

    payload: dict = {
        "from": from_email,
        "to": [to_email],
        "subject": subject,
        "html": html_body,
    }
    if reply_to:
        payload["reply_to"] = [reply_to]
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
