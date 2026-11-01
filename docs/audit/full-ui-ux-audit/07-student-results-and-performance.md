# 07 — Student results, certificate and performance

Account: student.a002 (8/8, Pass, certificate SZABMU/2026/1000), student.a004 (Absent). Evidence: `s16-results-published.jpg`, `s17-certificate.jpg`, `s18-performance.jpg`, `s19-dashboard-after-results.jpg`.

| Item | Observation |
|---|---|
| Marks, maximum, percentage, pass/fail | Present: TOTAL 8, OBTAINED 8, % 100.0, STATUS Pass (green chip) |
| Grade | **absent** (no grade scale in UI) |
| Result release date | **absent** — "DATE" is the exam date |
| Subject identity | code `AU-197179896`, subject "Pathology", course "MBBS", semester 4 — the exam title ("Audit — Completed Paper") is shown on the certificate but **not in the Results table**; two exams of the same subject would be hard to tell apart (recommendation) |
| Certificate | row link "Certificate ›" only for passes → certificate page with "Print certificate" (browser print dialog; **no PDF/download**). The certificate itself is well formed (`s17`): logo, name, registration number, campus, programme, **exam title**, marks (8 / 8, 100.0 %), issue date, **serial and verify code** with the line "Anyone can verify this certificate at /verify using the serial and verify code" — a strong, trustworthy pattern |
| Result status vocabulary | Pass / Fail / Absent; "Published results only…" explanatory line (good) |
| Appeals / rechecking | none in UI |
| Failed result | no certificate link; no message explaining why (observed on a 50 %-pass-mark fixture only for the pass case; fail view not captured) |
| Wrong certificate id | "We could not find that — Certificate not found" under an active "Print certificate" button (UI-048) |

**Performance** (`/performance`): tiles Average 100.0 %, Best score 100 %, Pathology Passed 1/1, Pass rate 100 %, "Score by subject" bar chart with axes 0/50/100 and one bar. Axes and labels are readable; with one data point the chart conveys nothing (a table would do). CGPA/rank are **not** shown — correct, since no such data exists; the reference deck's CGPA, class rank and semester history are not implemented (not a defect, a scope gap). For an absent candidate Performance says "No published results yet." while Results lists an "Absent" row (UI-042). The difference between Results (what happened per exam) and Performance (aggregate) is clear from the headings.
