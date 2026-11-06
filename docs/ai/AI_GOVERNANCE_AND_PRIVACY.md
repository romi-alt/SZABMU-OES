# AI governance and privacy

Reference frameworks: NIST AI Risk Management Framework 1.0 (govern, map, measure, manage) and the OWASP Top 10 for LLM Applications.
These are used as checklists; nothing here claims conformance.

## 1. Non-negotiable rules
1. No AI output changes marks, results, eligibility, admission, publication or any examination state. Those remain human, audited actions.
2. AI-drafted or AI-reviewed questions are **drafts**: they enter the existing author → submit → four-eyes review workflow like any other question.
3. No automatic accusation, sanction or misconduct label from behavioural signals. Browser events are weak context only (already the case).
4. No AI assistance is shown to students during a restricted examination.
5. AI failure (timeout, outage, refusal) must never block an examination, a save, a submission or a result.

## 2. Data classification and what may leave
| Data | Class | May be sent to an external model? |
|---|---|---|
| Live or unused question papers, answer keys, explanations | Confidential (exam security) | **No**, unless the owner approves a provider with a data-processing agreement that forbids retention and training, and only for questions not yet scheduled |
| Syllabus / curriculum documents | Internal | Yes, with approval |
| Student identities, answers, results, behavioural events | Personal / sensitive | **No** |
| Aggregate, de-identified statistics | Internal | Yes, with approval |

Approval means: written decision by the Controller of Examinations (or delegate) naming the provider, model, purpose and data classes.

## 3. Technical controls (to be implemented with the first LLM feature)
- **Feature flag** per feature (`AI_<FEATURE>_ENABLED=false` by default) and a dedicated permission; off in production until approved.
- **Credentials** held only in the hosting environment, never in git or the browser; calls made server-side.
- **Prompt-injection defence:** question text and syllabus excerpts are passed as quoted data with fixed system instructions; outputs are parsed against
  a strict schema and rejected otherwise; no tool use, browsing or code execution by the model; no model output is rendered as HTML.
- **Data minimisation:** send only the fields the feature needs; strip names, IDs and metadata.
- **Records:** for each suggestion store feature, provider, model, version, timestamp, requesting user, input hash (not the input when confidential), and the
  human decision (accepted / edited / rejected). Records are part of the audit trail.
- **Limits and monitoring:** per-user rate limits; cost, latency and error-rate metrics; a kill switch.
- **Evaluation:** before enabling, a sample of outputs is reviewed by subject experts; acceptance rate and factual-error rate are reported.

## 4. Roles
Owner of each AI feature: the Controller of Examinations. Reviewers of AI-drafted content: the same examiners who review human-written questions.
Technical owner: the platform maintainers. Data-protection review: the university's designated officer before any external transfer.
