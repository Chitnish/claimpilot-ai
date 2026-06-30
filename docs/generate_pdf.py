"""
Convert docs/ClaimPilot-AI-Technical-Documentation.md to a styled PDF.

Uses ReportLab (already in backend requirements). Run from repo root:

  cd backend
  .\\.venv\\Scripts\\Activate.ps1
  python ..\\docs\\generate_pdf.py
"""
from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent
MD_PATH = ROOT / "ClaimPilot-AI-Technical-Documentation.md"
OUT_PATH = ROOT / "ClaimPilot-AI-Technical-Documentation.pdf"

# Typography — Helvetica family (built-in, clean sans-serif)
FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
FONT_OBI = "Helvetica-Oblique"
FONT_MONO = "Courier"
ACCENT = colors.HexColor("#1e3a5f")
CODE_BG = colors.HexColor("#f4f6f8")
TABLE_HEADER = colors.HexColor("#e8eef6")


class NumberedCanvas:
    """Mixin-style page callbacks via doc.build(onFirstPage=..., onLaterPages=...)"""

    def __init__(self, doc_title: str):
        self.doc_title = doc_title

    def on_page(self, canvas, doc):
        canvas.saveState()
        canvas.setFont(FONT, 8)
        canvas.setFillColor(colors.HexColor("#888888"))
        if doc.page == 1:
            pass  # title page — no footer
        else:
            canvas.drawString(
                0.75 * inch,
                0.45 * inch,
                self.doc_title,
            )
            canvas.drawRightString(
                letter[0] - 0.75 * inch,
                0.45 * inch,
                f"Page {doc.page}",
            )
            canvas.setStrokeColor(colors.HexColor("#dddddd"))
            canvas.line(0.75 * inch, 0.62 * inch, letter[0] - 0.75 * inch, 0.62 * inch)
        canvas.restoreState()


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _inline_md(text: str) -> str:
    """Minimal inline markdown → ReportLab Paragraph markup."""
    text = _escape_xml(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", rf'<font face="{FONT_MONO}">\1</font>', text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # strip links, keep label
    return text


def _styles():
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "DocTitle",
            parent=base["Title"],
            fontName=FONT_BOLD,
            fontSize=28,
            leading=34,
            textColor=ACCENT,
            spaceAfter=12,
            alignment=TA_LEFT,
        ),
        "subtitle": ParagraphStyle(
            "DocSubtitle",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=12,
            leading=16,
            textColor=colors.HexColor("#444444"),
            spaceAfter=6,
        ),
        "h1": ParagraphStyle(
            "H1",
            parent=base["Heading1"],
            fontName=FONT_BOLD,
            fontSize=18,
            leading=22,
            textColor=ACCENT,
            spaceBefore=18,
            spaceAfter=8,
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName=FONT_BOLD,
            fontSize=14,
            leading=18,
            textColor=ACCENT,
            spaceBefore=14,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName=FONT_BOLD,
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#333333"),
            spaceBefore=10,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=10,
            leading=14,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontName=FONT,
            fontSize=10,
            leading=14,
            leftIndent=18,
            bulletIndent=8,
            spaceAfter=3,
        ),
        "code": ParagraphStyle(
            "CodeBlock",
            parent=base["Code"],
            fontName=FONT_MONO,
            fontSize=8,
            leading=10,
            backColor=CODE_BG,
            borderPadding=6,
            spaceAfter=8,
        ),
        "toc_h1": ParagraphStyle(
            "TOC1",
            fontName=FONT_BOLD,
            fontSize=11,
            leftIndent=0,
            spaceBefore=4,
        ),
        "toc_h2": ParagraphStyle(
            "TOC2",
            fontName=FONT,
            fontSize=10,
            leftIndent=16,
            spaceBefore=2,
        ),
    }
    return styles


def _parse_table(lines: list[str]) -> Table | None:
    if len(lines) < 2:
        return None
    rows = []
    for line in lines:
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if all(re.match(r"^[-:\s]+$", c) for c in cells):
            continue  # separator row
        rows.append([Paragraph(_inline_md(c), ParagraphStyle("tc", fontName=FONT, fontSize=9)) for c in cells])
    if not rows:
        return None
    col_count = max(len(r) for r in rows)
    width = (letter[0] - 1.5 * inch) / col_count
    t = Table(rows, colWidths=[width] * col_count, repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER),
                ("TEXTCOLOR", (0, 0), (-1, 0), ACCENT),
                ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#cccccc")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return t


def parse_markdown(text: str, styles: dict) -> list:
    story: list = []
    lines = text.splitlines()
    i = 0
    in_code = False
    code_buf: list[str] = []
    table_buf: list[str] = []

    def flush_table():
        nonlocal table_buf
        if table_buf:
            tbl = _parse_table(table_buf)
            if tbl:
                story.append(tbl)
                story.append(Spacer(1, 8))
            table_buf = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_table()
            if in_code:
                story.append(Preformatted("\n".join(code_buf), styles["code"]))
                code_buf = []
                in_code = False
            else:
                in_code = True
            i += 1
            continue

        if in_code:
            code_buf.append(line)
            i += 1
            continue

        if stripped.startswith("|"):
            table_buf.append(line)
            i += 1
            continue
        flush_table()

        if stripped == "---":
            story.append(Spacer(1, 12))
            i += 1
            continue

        if stripped.startswith("# "):
            story.append(Paragraph(_inline_md(stripped[2:]), styles["h1"]))
            i += 1
            continue
        if stripped.startswith("## "):
            story.append(Paragraph(_inline_md(stripped[3:]), styles["h2"]))
            i += 1
            continue
        if stripped.startswith("### "):
            story.append(Paragraph(_inline_md(stripped[4:]), styles["h3"]))
            i += 1
            continue

        if stripped.startswith("- ") or stripped.startswith("* "):
            story.append(
                Paragraph(f"• {_inline_md(stripped[2:])}", styles["bullet"])
            )
            i += 1
            continue

        num_match = re.match(r"^(\d+)\.\s+(.*)", stripped)
        if num_match:
            story.append(
                Paragraph(
                    f"{num_match.group(1)}. {_inline_md(num_match.group(2))}",
                    styles["bullet"],
                )
            )
            i += 1
            continue

        if not stripped:
            story.append(Spacer(1, 4))
            i += 1
            continue

        story.append(Paragraph(_inline_md(stripped), styles["body"]))
        i += 1

    flush_table()
    return story


class TocDocTemplate(SimpleDocTemplate):
    """Register heading paragraphs for TableOfContents page numbers."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._toc = None

    def set_toc(self, toc: TableOfContents) -> None:
        self._toc = toc

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        text = flowable.getPlainText()
        style_name = flowable.style.name
        if style_name == "H1":
            self.notify("TOCEntry", (0, text, self.page))
        elif style_name == "H2":
            self.notify("TOCEntry", (1, text, self.page))
        elif style_name == "H3":
            self.notify("TOCEntry", (2, text, self.page))


def build_pdf():
    if not MD_PATH.exists():
        raise SystemExit(f"Markdown not found: {MD_PATH}")

    md_text = MD_PATH.read_text(encoding="utf-8")
    styles = _styles()
    footer = NumberedCanvas("ClaimPilot AI — Technical Documentation")

    doc = TocDocTemplate(
        str(OUT_PATH),
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.85 * inch,
        title="ClaimPilot AI Technical Documentation",
        author="Anish Chitnis",
    )

    toc = TableOfContents()
    toc.levelStyles = [
        styles["toc_h1"],
        styles["toc_h2"],
        ParagraphStyle(
            "TOC3",
            fontName=FONT,
            fontSize=9,
            leftIndent=32,
            spaceBefore=1,
        ),
    ]
    doc.set_toc(toc)

    story: list = []

    # Title page
    story.append(Spacer(1, 2.2 * inch))
    story.append(Paragraph("ClaimPilot AI", styles["title"]))
    story.append(Paragraph("Complete Technical Documentation", styles["title"]))
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph("Author: Anish Chitnis", styles["subtitle"]))
    story.append(Paragraph("Date: June 30, 2026", styles["subtitle"]))
    story.append(Paragraph("Version: 0.2.0 (API) / 0.1.0 (frontend package)", styles["subtitle"]))
    story.append(Spacer(1, 0.6 * inch))
    story.append(
        Paragraph(
            "Synthetic demo system — not for production PHI. All claims traceable to codebase as of June 2026.",
            styles["body"],
        )
    )
    story.append(PageBreak())

    story.append(Paragraph("Table of Contents", styles["h1"]))
    story.append(Spacer(1, 12))
    story.append(toc)
    story.append(PageBreak())

    # Main content — skip first # title block in markdown (we rendered title page)
    body_start = 0
    for idx, line in enumerate(md_text.splitlines()):
        if line.strip().startswith("# ClaimPilot AI"):
            body_start = idx
            break
    body_md = "\n".join(md_text.splitlines()[body_start:])
    story.extend(parse_markdown(body_md, styles))

    def on_page(canvas, doc_obj):
        footer.on_page(canvas, doc_obj)

    doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
    return OUT_PATH


if __name__ == "__main__":
    out = build_pdf()
    print(f"Wrote {out}")
