"""Build fictional demo documents from the landing page's shared fixtures.

Run through generate.mjs, which supplies reviewed literal fixture data on stdin.
Only ReportLab is needed at authoring time; the application serves static files.
"""

import json
import re
import sys
from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer


OUTPUT = Path(__file__).resolve().parents[2] / "public" / "demo"
INK = colors.HexColor("#152029")
MUTED = colors.HexColor("#55616c")
GREEN = colors.HexColor("#007f64")
LINE = colors.HexColor("#dbe2e5")
WIDTH, HEIGHT = A4
MARGIN = 52


def ascii_dashes(value):
    return re.sub(r"[\u2010-\u2015\u2212]", "-", value)


def text(value):
    return escape(ascii_dashes(value))


STYLES = {
    "name": ParagraphStyle("name", fontName="Times-Bold", fontSize=29, leading=32, textColor=INK),
    "title": ParagraphStyle("title", fontName="Helvetica", fontSize=10.5, leading=16, textColor=MUTED),
    "role": ParagraphStyle("role", fontName="Times-Bold", fontSize=14, leading=19, textColor=INK),
    "section": ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=9, leading=13, textColor=GREEN, spaceBefore=24, spaceAfter=10),
    "body": ParagraphStyle("body", fontName="Times-Roman", fontSize=11.5, leading=17, textColor=INK, alignment=TA_LEFT, spaceAfter=13),
    "experience": ParagraphStyle("experience", fontName="Times-Roman", fontSize=11.5, leading=17, textColor=INK, leftIndent=12, firstLineIndent=-12, spaceAfter=13),
    "note": ParagraphStyle("note", fontName="Helvetica", fontSize=8.5, leading=13, textColor=MUTED),
}


def paragraph(value, kind="body"):
    return Paragraph(text(value), STYLES[kind])


def frame(canvas, document):
    canvas.saveState()
    canvas.setFillColor(GREEN)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(MARGIN, HEIGHT - 36, "JOBLIT  /  FICTIONAL SAMPLE")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawRightString(WIDTH - MARGIN, HEIGHT - 36, "Prepared demonstration")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, 48, WIDTH - MARGIN, 48)
    canvas.drawString(MARGIN, 32, "Static sample. Candidate, roles and employers are fictional.")
    canvas.drawRightString(WIDTH - MARGIN, 32, str(document.page))
    canvas.restoreState()


def header(profile, job, document_type):
    return [
        paragraph(profile["name"], "name"),
        Spacer(1, 4),
        paragraph(f'{profile["title"]}  |  {document_type}', "title"),
        Spacer(1, 17),
        HRFlowable(width="100%", thickness=0.7, color=LINE, spaceAfter=18),
        paragraph(job["title"], "role"),
        Spacer(1, 4),
        paragraph(f'{job["company"]}  |  {job["location"]}', "title"),
    ]


def build_pdf(path, profile, job, kind, content):
    document = SimpleDocTemplate(
        str(path), pagesize=A4, rightMargin=MARGIN, leftMargin=MARGIN,
        topMargin=65, bottomMargin=69, pageCompression=1, invariant=1,
        title=ascii_dashes(f'{profile["name"]} - {job["company"]} - {kind} (fictional sample)'),
        author="Joblit fictional demonstration", subject="Prepared static sample, not a live generation",
    )
    document.build(content, onFirstPage=frame, onLaterPages=frame)


def resume(profile, skills, job):
    content = header(profile, job, "Resume")
    content += [paragraph("PROFILE", "section"), paragraph(job["summary"])]
    content += [paragraph("SELECTED SKILLS", "section"), paragraph("  /  ".join(skills[index] for index in job["skills"]))]
    content += [paragraph("SELECTED EXPERIENCE", "section")]
    for experience in profile["experience"]:
        content.append(paragraph(f"-  {experience}", "experience"))
    content += [
        Spacer(1, 15),
        HRFlowable(width="100%", thickness=0.6, color=LINE, spaceAfter=12),
        paragraph("This prepared sample emphasizes the role in the summary and selects existing skills. The source experience remains unchanged.", "note"),
    ]
    build_pdf(OUTPUT / f'{job["id"]}-resume.pdf', profile, job, "Resume", content)


def cover(profile, job):
    content = header(profile, job, "Cover letter")
    content += [Spacer(1, 30), paragraph("Dear Hiring Team,")]
    content += [paragraph(value) for value in job["cover"]]
    content += [Spacer(1, 11), paragraph("Kind regards,"), paragraph(profile["name"])]
    build_pdf(OUTPUT / f'{job["id"]}-cover.pdf', profile, job, "Cover letter", content)


def job_page(job):
    technology = "".join(f"<span>{escape(value)}</span>" for value in job["technology"])
    responsibilities = "".join(f"<li>{escape(value)}</li>" for value in job["responsibilities"])
    qualifier = f'<p class="qualifier">{escape(job["qualifier"])}</p>' if job["qualifier"] else ""
    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="description" content="Fictional sample job posting for the Joblit product demonstration.">
  <title>{escape(job["title"])} - Fictional Joblit sample</title>
  <style>
    :root{{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#10202b;background:#f5f8fa}}
    *{{box-sizing:border-box}}body{{margin:0;padding:32px 20px 64px}}
    main{{max-width:820px;margin:0 auto;background:#fff;border:1px solid #e1e7ea;border-radius:20px;overflow:hidden}}
    header{{padding:36px 40px 30px;border-bottom:1px solid #e1e7ea}}
    .eyebrow{{margin:0 0 24px;color:#007f64;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}}
    h1{{font-size:clamp(28px,5vw,38px);line-height:1.15;letter-spacing:-.035em;margin:0 0 12px}}
    .company{{font-weight:700;margin:0 0 6px}}.meta,.qualifier{{color:#596672;font-size:14px;line-height:1.65;margin:0}}
    .qualifier{{margin:0 0 20px}}article{{padding:8px 40px 36px}}
    section{{padding-top:24px}}h2{{font-size:16px;line-height:1.4;margin:0 0 12px}}
    p,li{{font-size:16px;line-height:1.75}}p{{margin:0 0 16px}}ul{{padding-left:22px;margin:0}}li+li{{margin-top:8px}}
    .skills{{display:flex;flex-wrap:wrap;gap:8px}}.skills span{{font-size:13px;line-height:1.4;padding:6px 10px;background:#e9faf3;color:#006850;border:1px solid #cdeadd;border-radius:7px}}
    footer{{padding:20px 40px;background:#f7fafb;border-top:1px solid #e1e7ea;color:#596672;font-size:12px;line-height:1.7}}
    footer p{{font-size:12px;margin:0}}@media(max-width:540px){{body{{padding:16px 12px 32px}}header{{padding:28px 24px 24px}}article{{padding:4px 24px 28px}}footer{{padding:18px 24px}}}}
    @media print{{body{{padding:0;background:#fff}}main{{border:0;border-radius:0}}}}
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">Joblit / Fictional sample posting</p>
      <h1>{escape(job["title"])}</h1>
      {qualifier}
      <p class="company">{escape(job["company"])}</p>
      <p class="meta">{escape(job["location"])}</p>
      <p class="meta">Full time &middot; {escape(job["level"])}</p>
    </header>
    <article>
      <section aria-labelledby="overview"><h2 id="overview">About the role</h2><p>{escape(job["intro"])}</p></section>
      <section aria-labelledby="requirements"><h2 id="requirements">Experience and skills</h2><p>{escape(job["source"])}</p><div class="skills">{technology}</div></section>
      <section aria-labelledby="responsibilities"><h2 id="responsibilities">What you will do</h2><ul>{responsibilities}</ul></section>
      <section aria-label="Team"><p>{escape(job["closing"])}</p></section>
    </article>
    <footer><p>This is a prepared fictional posting for the Joblit demo. The employer and vacancy are illustrative; this page does not accept applications.</p></footer>
  </main>
</body>
</html>
"""
    page = "\n".join(line.rstrip() for line in page.splitlines()) + "\n"
    (OUTPUT / f'{job["id"]}-job.html').write_text(page, encoding="utf-8")


def main():
    fixtures = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    profile, skills, jobs = fixtures["DEMO_PROFILE"], fixtures["DEMO_SKILLS"], fixtures["DEMO_JOBS"]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for job in jobs:
        if not re.fullmatch(r"[a-z0-9-]+", job["id"]):
            raise ValueError("Unsafe demo fixture ID")
        resume(profile, skills, job)
        cover(profile, job)
        job_page(job)
    print(f"Created {len(jobs) * 2} fictional PDFs and {len(jobs)} sample postings in {OUTPUT}")


if __name__ == "__main__":
    main()
