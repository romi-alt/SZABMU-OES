import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { can, type Permission } from '@oes/shared';
import { AppModule } from '../src/app.module';
import { as, boot, save, startExam, type Ctx } from './helpers';

/**
 * Answer-key confidentiality. A candidate (and lecturers of other courses) must never receive correct-answer fields
 * from ANY endpoint their role can reach — swept programmatically over every GET route so a newly added endpoint is
 * covered automatically — before AND after submission. Keys are only for staff with explicit paper/question permissions.
 */
let ctx: Ctx;
beforeAll(async () => { ctx = await boot({ studentsPerCampus: 3 }); });
afterAll(async () => { await ctx.app.close(); });

const KEY_FIELDS = /"(correctLabel|isCorrect|correct|answerKey|key)"\s*:/;

/** Long-lived SSE streams never end, so `inject` would wait forever; their content is asserted over a real connection in exam-control-stream.test.ts. */
const STREAMS = new Set(['ExamControlController.studentStream', 'ExamControlController.staffStream']);

function getRoutes(role: Parameters<typeof can>[0]) {
  const reflector = new Reflector(); const out: { path: string; handler: string }[] = [];
  const controllers: (new (...a: never[]) => object)[] = Reflect.getMetadata('controllers', AppModule) ?? [];
  for (const cls of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
    for (const name of Object.getOwnPropertyNames(cls.prototype)) {
      const fn = (cls.prototype as Record<string, unknown>)[name] as () => unknown; if (typeof fn !== 'function') continue;
      const m = Reflect.getMetadata(METHOD_METADATA, fn); if (m !== RequestMethod.GET) continue;
      const perm = reflector.getAllAndOverride<Permission>('perm', [fn, cls]); if (!perm || !can(role, perm)) continue;
      if (STREAMS.has(`${cls.name}.${name}`)) continue;
      out.push({ path: ('/' + [base, String(Reflect.getMetadata(PATH_METADATA, fn) ?? '')].filter(Boolean).join('/')).replace(/\/+/g, '/'), handler: `${cls.name}.${name}` });
    }
  }
  return out;
}

describe('answer keys never reach candidates', () => {
  it('no GET endpoint reachable by a student exposes key fields — during the sitting and after submission', async () => {
    const s = await as(ctx, 'student.a002');
    const t = await startExam(ctx, s);
    expect((await save(s, t.attemptId, t.questions[0]!.id, t.clientId, 1, 'B')).status).toBe(200);
    expect(KEY_FIELDS.test(t.res.raw)).toBe(false); // start payload
    const examQ = t.questions[0]!.id;
    const candidates = (route: string): string[] => {
      const params = route.match(/:(\w+)/g) ?? [];
      let paths = [route];
      for (const p of params) {
        const vals = p === ':id' || p === ':examId' ? [t.attemptId, ctx.seeded.examId] : p === ':qid' ? [examQ] : [t.attemptId];
        paths = paths.flatMap((x) => vals.map((v) => x.replace(p, v)));
      }
      return paths;
    };
    const routes = getRoutes('STUDENT'); expect(routes.length).toBeGreaterThanOrEqual(5);
    const sweep = async (phase: string) => {
      let ok = 0;
      for (const r of routes) for (const p of candidates(r.path)) {
        const res = await s.get(p.replace(/^\/api/, ''));
        expect(KEY_FIELDS.test(res.raw), `${phase}: ${r.handler} (${p}) leaked a key field`).toBe(false);
        if (res.status === 200) ok++;
      }
      return ok;
    };
    expect(await sweep('during sitting')).toBeGreaterThanOrEqual(3);
    const sub = await s.post(`/attempts/${t.attemptId}/submit`, { clientId: t.clientId, submitKey: 'key-sweep-submit' });
    expect(sub.status).toBe(200); expect(KEY_FIELDS.test(sub.raw)).toBe(false);
    expect(await sweep('after submission')).toBeGreaterThanOrEqual(3);
  });

  it('staff without a course relationship cannot read a paper\'s keys (unassigned lecturer, invigilator, campus admin)', async () => {
    for (const who of ['lecturer.a2', 'invigilator.a', 'admin.a']) {
      const c = await as(ctx, who);
      const r = await c.get(`/exams/${ctx.seeded.examId}/paper`);
      const hasKey = KEY_FIELDS.test(r.raw);
      expect(r.status === 200 ? !hasKey : true, `${who} must not receive keys for a paper of a course they have no role in`).toBe(true);
    }
  });
});
