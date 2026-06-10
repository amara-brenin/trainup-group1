#!/usr/bin/env python3
"""Render the Group Training client guide markdown into a clean PDF.

Handles: # / ## / ### headings, ``` fenced code (ASCII flowcharts kept in
monospace), | tables |, - bullet lists, > blockquotes, **bold**, `inline code`.
"""
import re
import sys
import html

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Preformatted, Table, TableStyle,
    HRFlowable,
)

SRC = sys.argv[1] if len(sys.argv) > 1 else "GROUP_TRAINING_CLIENT_GUIDE.md"
OUT = sys.argv[2] if len(sys.argv) > 2 else "GROUP_TRAINING_CLIENT_GUIDE.pdf"

ORANGE = colors.HexColor("#ff6200")
DARK = colors.HexColor("#1f2937")
GREY = colors.HexColor("#6b7280")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle("Body2", parent=styles["BodyText"], fontSize=10, leading=14, spaceAfter=6))
styles.add(ParagraphStyle("H1c", parent=styles["Heading1"], fontSize=20, textColor=ORANGE, spaceBefore=6, spaceAfter=10))
styles.add(ParagraphStyle("H2c", parent=styles["Heading2"], fontSize=14, textColor=DARK, spaceBefore=14, spaceAfter=6))
styles.add(ParagraphStyle("H3c", parent=styles["Heading3"], fontSize=11.5, textColor=DARK, spaceBefore=10, spaceAfter=4))
styles.add(ParagraphStyle("Bullet2", parent=styles["Body2"], leftIndent=16, bulletIndent=4, spaceAfter=3))
styles.add(ParagraphStyle("Quote2", parent=styles["Body2"], leftIndent=14, textColor=GREY, borderColor=ORANGE,
                          borderWidth=0, fontName="Helvetica-Oblique"))
styles.add(ParagraphStyle("Code2", parent=styles["Code"], fontSize=7.2, leading=8.4, textColor=colors.HexColor("#111827")))
styles.add(ParagraphStyle("Cell", parent=styles["Body2"], fontSize=9, leading=12, spaceAfter=0))
styles.add(ParagraphStyle("CellH", parent=styles["Cell"], textColor=colors.white, fontName="Helvetica-Bold"))


def inline(text):
    """Escape XML then apply **bold** and `code`."""
    t = html.escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"`([^`]+)`", r'<font face="Courier">\1</font>', t)
    return t


def make_table(rows):
    # rows: list of list[str] (raw cell text). First row = header.
    data = []
    for r_i, row in enumerate(rows):
        style = styles["CellH"] if r_i == 0 else styles["Cell"]
        data.append([Paragraph(inline(c.strip()), style) for c in row])
    ncols = max(len(r) for r in data)
    # pad
    for r in data:
        while len(r) < ncols:
            r.append(Paragraph("", styles["Cell"]))
    avail = letter[0] - 1.4 * inch
    tbl = Table(data, colWidths=[avail / ncols] * ncols, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), ORANGE),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f7f9")]),
    ]))
    return tbl


def parse(md):
    lines = md.split("\n")
    flow = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]

        # fenced code block
        if line.strip().startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1  # skip closing fence
            code = "\n".join(buf)
            flow.append(Preformatted(code, styles["Code2"]))
            flow.append(Spacer(1, 8))
            continue

        # table block
        if line.strip().startswith("|") and i + 1 < n and re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            rows = []
            header = [c for c in line.strip().strip("|").split("|")]
            rows.append(header)
            i += 2  # skip header + separator
            while i < n and lines[i].strip().startswith("|"):
                rows.append([c for c in lines[i].strip().strip("|").split("|")])
                i += 1
            flow.append(make_table(rows))
            flow.append(Spacer(1, 8))
            continue

        stripped = line.strip()
        if not stripped:
            flow.append(Spacer(1, 5))
            i += 1
            continue

        if stripped == "---":
            flow.append(Spacer(1, 2))
            flow.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#e5e7eb")))
            flow.append(Spacer(1, 4))
            i += 1
            continue

        if stripped.startswith("### "):
            flow.append(Paragraph(inline(stripped[4:]), styles["H3c"]))
        elif stripped.startswith("## "):
            flow.append(Paragraph(inline(stripped[3:]), styles["H2c"]))
        elif stripped.startswith("# "):
            flow.append(Paragraph(inline(stripped[2:]), styles["H1c"]))
        elif stripped.startswith("> "):
            flow.append(Paragraph(inline(stripped[2:]), styles["Quote2"]))
        elif re.match(r"^[-*] ", stripped):
            flow.append(Paragraph(inline(stripped[2:]), styles["Bullet2"], bulletText="•"))
        else:
            flow.append(Paragraph(inline(stripped), styles["Body2"]))
        i += 1
    return flow


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GREY)
    canvas.drawString(0.7 * inch, 0.5 * inch, "AI Group Training Hall — Client User Guide")
    canvas.drawRightString(letter[0] - 0.7 * inch, 0.5 * inch, f"Page {doc.page}")
    canvas.restoreState()


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        md = f.read()
    doc = SimpleDocTemplate(
        OUT, pagesize=letter,
        leftMargin=0.7 * inch, rightMargin=0.7 * inch,
        topMargin=0.7 * inch, bottomMargin=0.8 * inch,
        title="AI Group Training Hall — Client User Guide",
    )
    doc.build(parse(md), onFirstPage=footer, onLaterPages=footer)
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
