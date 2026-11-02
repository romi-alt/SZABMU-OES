import { CourseAccessService } from '../modules/org/course-access.service';
import 'reflect-metadata';
import argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../infra/prisma.service';
import { QuestionsService } from '../modules/exams/questions.service';
import { ExamsService } from '../modules/exams/exams.service';
import { OrgService } from '../modules/org/org.service';
import { loadConfig } from '../config';
import type { AuthUser } from '../common/auth';
import { QUESTIONS } from './content';
import type { INestApplicationContext } from '@nestjs/common';

export const DEMO_PASSWORD = 'Demo-Passw0rd-2026!';
export const TERM = '2026-SPRING';
export const DOMAIN = 'demo.szabmu.invalid'; // RFC 2606 reserved TLD: can never be a real mailbox

const FIRST = ['Anila', 'Subhan', 'Adil', 'Bilal', 'Hira', 'Maryam', 'Imran', 'Saqib', 'Zainab', 'Hamza', 'Fatima', 'Usman', 'Ayesha', 'Omar', 'Noor', 'Daniyal', 'Sana', 'Talha', 'Mahnoor', 'Rayyan', 'Iqra', 'Haris', 'Laiba', 'Zubair'];
const LAST = ['Qureshi', 'Ali', 'Khan', 'Akhtar', 'Bukhari', 'Raza', 'Malik', 'Ahmed', 'Siddiqui', 'Farooq', 'Hussain', 'Chaudhry'];

export async function asUser(prisma: PrismaService, email: string): Promise<AuthUser> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { institutions: true, student: { select: { id: true } } } });
  const campus = ['STUDENT', 'LECTURER', 'CAMPUS_ADMIN', 'INVIGILATOR'].includes(u.role);
  return { id: u.id, email: u.email, fullName: u.fullName, role: u.role, institutionIds: campus ? u.institutions.map((i) => i.institutionId) : null, studentId: u.student?.id, sessionHash: 'seed', mustChangePw: false, mfa: 'ok' };
}

export async function resetDatabase(prisma: PrismaService) {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

/** Creates the synthetic demo universe. Idempotent only after resetDatabase(). */
export async function seed(app: INestApplicationContext, opts: { studentsPerCampus?: number } = {}) {
  const cfg = loadConfig();
  if (cfg.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const prisma = app.get(PrismaService);
  const org = app.get(OrgService);
  const qsvc = app.get(QuestionsService);
  const esvc = app.get(ExamsService);
  const perCampus = opts.studentsPerCampus ?? 24;
  const hash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const mk = (email: string, fullName: string, role: AuthUser['role'], institutionIds: string[]) =>
    prisma.user.create({ data: { email: `${email}@${DOMAIN}`, fullName, role, passwordHash: hash, institutions: { create: institutionIds.map((institutionId) => ({ institutionId })) } } });

  // Institutions (all names are fictional and prefixed "Demo")
  const [a, b, c] = await Promise.all([
    prisma.institution.create({ data: { code: 'DMC-A', name: 'Demo Medical College A (synthetic)', type: 'MEDICAL_COLLEGE', affiliation: 'CONSTITUENT', city: 'Islamabad' } }),
    prisma.institution.create({ data: { code: 'DMC-B', name: 'Demo Medical College B (synthetic)', type: 'MEDICAL_COLLEGE', affiliation: 'AFFILIATED', city: 'Rawalpindi' } }),
    prisma.institution.create({ data: { code: 'DNC-C', name: 'Demo College of Nursing C (synthetic)', type: 'NURSING_COLLEGE', affiliation: 'AFFILIATED', city: 'Lahore' } }),
  ]);
  await prisma.department.createMany({ data: [{ institutionId: a.id, code: 'PATH', name: 'Pathology' }, { institutionId: a.id, code: 'PHARM', name: 'Pharmacology' }, { institutionId: b.id, code: 'PATH', name: 'Pathology' }] });

  // Programs and courses
  const mbbs = await prisma.program.create({ data: { code: 'MBBS', name: 'Bachelor of Medicine, Bachelor of Surgery', durationYrs: 5 } });
  const bsn = await prisma.program.create({ data: { code: 'BSN', name: 'Bachelor of Science in Nursing', durationYrs: 4 } });
  const path = await prisma.course.create({ data: { programId: mbbs.id, code: 'MBBS-PATH-4', title: 'Pathology', semester: 4, credits: 4 } });
  const pharm = await prisma.course.create({ data: { programId: mbbs.id, code: 'MBBS-PHARM-4', title: 'Pharmacology', semester: 4, credits: 4 } });
  await prisma.course.create({ data: { programId: mbbs.id, code: 'MBBS-ANAT-1', title: 'Anatomy', semester: 1, credits: 5 } });
  await prisma.course.create({ data: { programId: bsn.id, code: 'BSN-FUND-1', title: 'Fundamentals of Nursing', semester: 1, credits: 3 } });

  // Staff
  const superU = await mk('super.admin', 'Demo Super Administrator', 'SUPER_ADMIN', []);
  const cce = await mk('cce', 'Demo Controller of Examinations', 'CCE', []);
  const examiner = await mk('examiner', 'Dr. Afra Naz (demo)', 'EXAMINER', []);
  await mk('examiner2', 'Dr. Kamran Shah (demo)', 'EXAMINER', []);
  await mk('admin.a', 'Abbas Mehdi (demo)', 'CAMPUS_ADMIN', [a.id]);
  await mk('admin.b', 'Sidra Anwar (demo)', 'CAMPUS_ADMIN', [b.id]);
  await mk('lecturer.a', 'Dr. Imran Yousuf (demo)', 'LECTURER', [a.id]);
  await mk('lecturer.a2', 'Dr. Maryam Tariq (demo)', 'LECTURER', [a.id]);
  await mk('lecturer.b', 'Dr. Saqib Javed (demo)', 'LECTURER', [b.id]);
  await mk('invigilator.a', 'Naveed Iqbal (demo)', 'INVIGILATOR', [a.id]);
  await mk('invigilator.b', 'Rabia Sultan (demo)', 'INVIGILATOR', [b.id]);

  // Students
  const studs: { id: string; institutionId: string }[] = [];
  for (const [inst, tag] of [[a, 'a'], [b, 'b']] as const) {
    for (let i = 1; i <= perCampus; i++) {
      const name = `${FIRST[(i - 1) % FIRST.length]} ${LAST[(i * 7 + (tag === 'a' ? 0 : 3)) % LAST.length]}`;
      const u = await mk(`student.${tag}${String(i).padStart(3, '0')}`, `${name} (demo)`, 'STUDENT', [inst.id]);
      const s = await prisma.student.create({ data: { userId: u.id, institutionId: inst.id, programId: mbbs.id, regNo: `${inst.code}-2024-${String(i).padStart(4, '0')}`, semester: 4, batchYear: 2024 } });
      studs.push({ id: s.id, institutionId: inst.id });
    }
  }
  // Official register entries nobody has claimed yet, so self-registration can be tried out of the box.
  // Reg no DEMO-A-2025-000N / DEMO-B-2025-000N, date of birth 2005-01-0N (N = 1..5). Documented in docs/deployment/hostinger-demo/README.md.
  await prisma.rosterEntry.createMany({ data: ([[a, 'A'], [b, 'B']] as const).flatMap(([inst, t]) => [1, 2, 3, 4, 5].map((n) => ({
    institutionId: inst.id, programId: mbbs.id, regNo: `DEMO-${t}-2025-000${n}`, fullName: `${FIRST[(n + 3) % FIRST.length]} ${LAST[(n * 5 + (t === 'A' ? 1 : 4)) % LAST.length]} (demo)`,
    dateOfBirth: new Date(`2005-01-0${n}`), semester: 1, batchYear: 2025,
  }))) });
  void c;
  const sa = await asUser(prisma, `super.admin@${DOMAIN}`);
  void superU; void cce;
  // Enrol everyone in both courses; one student per campus has insufficient attendance
  for (const inst of [a, b]) {
    const admin = await asUser(prisma, `admin.${inst.code === 'DMC-A' ? 'a' : 'b'}@${DOMAIN}`);
    for (const course of [path, pharm]) await org.enrol(admin, { courseId: course.id, term: TERM, institutionId: inst.id });
  }
  const low = await prisma.enrollment.findMany({ where: { courseId: path.id, student: { regNo: { in: ['DMC-A-2024-0001', 'DMC-B-2024-0001'] } } } });
  for (const e of low) await prisma.enrollment.update({ where: { id: e.id }, data: { attendancePct: 62, eligibility: 'INELIGIBLE' } });
  await prisma.enrollment.updateMany({ where: { eligibility: 'ELIGIBLE' }, data: { attendancePct: 88 } });

  // Question bank via the real workflow: lecturer authors → submits → examiner approves
  // Lecturers act only on explicitly assigned courses (P0-A). Demo assignments: A1 → PATH+PHARM, A2 → PHARM, B → PATH.
  const access = app.get(CourseAccessService);
  const uid = async (local: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${local}@${DOMAIN}` } })).id;
  for (const [local, inst, courses] of [['lecturer.a', a, [path, pharm]], ['lecturer.a2', a, [pharm]], ['lecturer.b', b, [path]]] as const) {
    for (const c of courses) await access.assign(sa, { userId: await uid(local), courseId: c.id, institutionId: inst.id });
  }
  const lect = await asUser(prisma, `lecturer.a@${DOMAIN}`);
  const rev = await asUser(prisma, `examiner@${DOMAIN}`);
  const ids: Record<'PATH' | 'PHARM', string[]> = { PATH: [], PHARM: [] };
  for (const q of QUESTIONS) {
    const course = q.course === 'PATH' ? path : pharm;
    const created = await qsvc.create(lect, { courseId: course.id, institutionId: a.id, type: q.type, vignette: q.vignette, stem: q.stem, explanation: q.explanation, difficulty: q.difficulty, tags: ['synthetic'],
      options: q.options.map((text, i) => ({ label: 'ABCDE'[i]!, text, isCorrect: i === q.correct })) });
    await qsvc.submit(lect, created.id);
    await qsvc.review(rev, created.id, 'APPROVE', 'Approved (demo seed)');
    ids[q.course].push(created.id);
  }
  // one pending + one draft for UI states
  const pend = await qsvc.create(lect, { courseId: path.id, institutionId: a.id, type: 'MCQ', stem: 'Synthetic pending-review question: which organelle is the site of oxidative phosphorylation?', difficulty: 'EASY', options: ['Nucleus', 'Mitochondrion', 'Golgi apparatus', 'Ribosome'].map((text, i) => ({ label: 'ABCD'[i]!, text, isCorrect: i === 1 })) });
  await qsvc.submit(lect, pend.id);
  await qsvc.create(lect, { courseId: path.id, institutionId: a.id, type: 'MCQ', stem: 'Synthetic draft question: the normal adult range for serum sodium is approximately?', difficulty: 'EASY', options: ['135–145 mmol/L', '100–110 mmol/L', '170–180 mmol/L', '60–70 mmol/L'].map((text, i) => ({ label: 'ABCD'[i]!, text, isCorrect: i === 0 })) });

  // A live exam: built by the examiner, approved by the CCE (four-eyes), scheduled, open now
  const cceU = await asUser(prisma, `cce@${DOMAIN}`);
  const now = Date.now();
  const exam = await esvc.create(rev, { code: 'MBBS-PATH-MT', title: 'Pathology Mid-term (DEMO)', courseId: path.id, term: TERM, opensAt: new Date(now - 5 * 60_000), closesAt: new Date(now + 7 * 24 * 3600_000), durationMin: 45, passPercent: 50, negativeMarking: 0, shuffleQuestions: true, instructions: 'Synthetic demonstration paper. Choose the single best answer.', institutionIds: [a.id, b.id] });
  await esvc.setPaper(sa, exam.id, ids.PATH.map((questionId) => ({ questionId, marks: 2 })));
  await esvc.submitPaper(rev, exam.id);
  await esvc.reviewPaper(cceU, exam.id, 'APPROVE', 'Approved (demo seed)');
  await esvc.schedule(rev, exam.id);
  await prisma.exam.update({ where: { id: exam.id }, data: { status: 'LIVE' } });
  const invA = await prisma.user.findUniqueOrThrow({ where: { email: `invigilator.a@${DOMAIN}` } });
  const invB = await prisma.user.findUniqueOrThrow({ where: { email: `invigilator.b@${DOMAIN}` } });
  await esvc.assignInvigilator(sa, exam.id, { userId: invA.id, institutionId: a.id });
  await esvc.assignInvigilator(sa, exam.id, { userId: invB.id, institutionId: b.id });
  void examiner;
  return { institutions: { a, b, c }, programs: { mbbs, bsn }, courses: { path, pharm }, questionIds: ids, examId: exam.id, students: studs };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  if (process.argv.includes('--reset')) await resetDatabase(prisma);
  const r = await seed(app, { studentsPerCampus: Number(process.env.SEED_STUDENTS_PER_CAMPUS ?? 6) });
  console.log(`Seeded synthetic demo data. Demo password for every account: ${DEMO_PASSWORD}`);
  console.log(`Live demo exam id: ${r.examId}`);
  await app.close();
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
