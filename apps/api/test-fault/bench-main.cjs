// BENCHMARK-ONLY entry point (never used by the product). Identical to dist/main.js, except that with BENCH_SKIP_ADMIT=1 the
// admission lookup (DeliveryService.admit: student + enrolment + exam-institution queries) is replaced by a constant, so an A/B
// run isolates exactly that cost. There is deliberately no equivalent switch in the application itself.
const { createApp } = require('../dist/bootstrap');
const { loadConfig } = require('../dist/config');
const { DeliveryService } = require('../dist/modules/delivery/delivery.service');
if (process.env.BENCH_SKIP_ADMIT === '1') {
  DeliveryService.prototype.admit = async function (_u, cand, _exam, now) {
    return { decision: 'ADMITTED', source: cand.decisionSource, rosterVersion: cand.rosterVersion, enrollmentId: null, enrolmentEligibility: null, at: now.toISOString() };
  };
}
(async () => { const cfg = loadConfig(); const app = await createApp(); await app.listen(cfg.API_PORT, cfg.API_HOST); })().catch((e) => { console.error(e); process.exit(1); });
