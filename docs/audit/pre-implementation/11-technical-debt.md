# 11 — Technical Debt and Disposition

| Item | Disposition | Reason |
|---|---|---|
| `delivery.service.ts` save/submit/start; `exam-engine.ts` | KEEP | tested invariants; do not restructure |
| Prisma schema + 3 migrations | KEEP (extend via new migrations only) | never edit applied migrations |
| `@Perm`/scope model, shared permission matrix | KEEP | add route-inventory test |
| Audit hash chain | KEEP; REFACTOR later for external anchoring | |
| Uncommitted work (docs, infra, CI, load test) | **FIX now** | single point of loss |
| Sweeper + workers inside API process | REFACTOR | separate worker entrypoint, leader-safe |
| Dashboard page (one component, role-switched) | REFACTOR | per-role dashboards (lecturer/examiner/campus tiles are thin) |
| Free-text `venue` | REPLACE | with `ExamCentre`/`Venue` model with capacity |
| `Question.version` counter | REPLACE | with revision table |
| Result correction history | ADD | `ResultRevision` |
| Polling monitor | REPLACE | SSE |
| Hand-rolled `api.ts` types (no shared DTO contract) | DEFER | consider shared zod schemas; risk of drift is real but contained |
| Department model without UI | DEFER or REMOVE | decide with product owner |
| Hash-chain advisory lock | KEEP, document throughput limit | staff actions only |
| No mocks/TODO markers found | – | grep clean |
| Duplicates/circular deps | NOT_VERIFIED | no `madge`/dup scan was run |

**Rewrite justification:** none. No evidence of structural defects requiring replacement of any verified module.
