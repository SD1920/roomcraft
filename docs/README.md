# roomcraft: report and presentation

| File | What |
|---|---|
| `RoomCraft_Project_Report.pdf` | Project report, 19 A4 pages: abstract, architecture, every module, data model, security, testing, limitations, references |
| `report_source.html` | The report's source. Edit this, then print it again (below) |
| `RoomCraft_Presentation.pptx` | 17-slide deck (16:9), speaker notes on every slide, about 25–30 minutes |
| `images/` | Screenshots used by both (editor, AI panel, scanner, phone views, floor plans) |

## Before submitting or presenting

Fill in the placeholders, which are in square brackets:

- **Report cover** (`report_source.html`, the table near the top): team members and roll
  numbers, guide, department, institution, academic year.
- **Slides 1 and 17**: team member names, guide, college.

## Re-making the report PDF

1. Open `report_source.html` in Chrome (double-click it, or drag it into a Chrome window).
2. Print (Ctrl+P), destination **Save as PDF**, paper **A4**, margins **Default**.
3. Under *More settings*: **Headers and footers** off, **Background graphics** on.
4. Save over `RoomCraft_Project_Report.pdf`.

Page numbers come from the file itself. Keep `images/` next to the HTML file, or the
pictures will be missing.

## Presenting

Slides follow the report: problem and flow (2–3), architecture and stack (4–5), the
editor (6–8), the AR scanner (9–10), AI (11–12), accounts, security and phones (13–14),
results and limitations (15–16). Slide 17 offers a live demo: open a scan (or a scan file),
open it in the editor, ask the AI to furnish it, and export the PDF.

## Numbers used (checked on 8–9 Nov 2026)

| Figure | Source |
|---|---|
| 306 scanner tests passing | `npm test` in RoomScanAR |
| 2.72 m ceiling vs 2.74 m tape; 1–2 cm on floor lines | RoomScanAR README, "How it measures" and "Accuracy" |
| 14 room types, 86 furniture types | `src/data/roomPresets.js` |
| 19 API routes, 7 rate limits, 4 tables | `backend/routes/`, `backend/middleware/rateLimiter.js`, `backend/schema.sql` |
| ~19,000 lines of code | frontend ~11,700, backend ~1,900, scanner ~5,300 (tests and libraries excluded) |

If the code changes, update these numbers in both the report and the slides.
