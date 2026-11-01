'use client';
import { ApiError, api, get, post } from './api';

export type SyncState = 'saved' | 'saving' | 'pending' | 'error';
export interface ServerAnswer { examQuestionId: string; selectedLabel: string | null; state: 'ANSWERED' | 'SKIPPED' | 'CLEARED'; markedForReview: boolean; visited: boolean; revision: number }
export interface QState { selectedLabel: string | null; state: 'ANSWERED' | 'SKIPPED' | 'CLEARED' | null; marked: boolean; visited: boolean; rev: number; savedRev: number; sync: SyncState; /** when this question first became unconfirmed */ since?: number; /** a save timed out: it may or may not have been committed */ ambiguous?: boolean }
export type PaletteKind = 'answered' | 'skipped' | 'unanswered' | 'notvisited';
export type Phase = 'running' | 'superseded' | 'closed';

/**
 * What the candidate is told about saving (UI-003/004). Always derived from authoritative facts: a question is "saved" only after the server acknowledged
 * a revision at least as new as the local one, or after reconciliation read exactly that revision back from the server.
 *  saved                  – every change is server-confirmed
 *  saving                 – a request is in flight, nothing has failed yet
 *  retrying               – an attempt failed or timed out a moment ago; automatic retry is scheduled (brief, not alarming)
 *  offline_pending        – the browser/network is down; answers are held on this device
 *  not_confirmed          – changes have been unconfirmed for longer than NOT_CONFIRMED_AFTER_MS; a persistent warning is shown
 *  reconciliation_required– an outcome is ambiguous (timed-out saves the server could not be asked about) or the server's copy differed and was adopted
 */
export type SaveState = 'saved' | 'saving' | 'retrying' | 'offline_pending' | 'not_confirmed' | 'reconciliation_required';
export interface SaveStatus { state: SaveState; pendingIds: string[]; unresolvedMs: number; refreshedIds: string[] }
/** A timed-out request is NOT proof the server failed: the answer may have been committed and only the acknowledgment lost. Retries reuse the same revision, which the server treats as idempotent (duplicate:true). */
export const SAVE_TIMEOUT_MS = 12_000;
const HEARTBEAT_TIMEOUT_MS = 8_000;
const SHEET_TIMEOUT_MS = 8_000;
export const NOT_CONFIRMED_AFTER_MS = 15_000;
const isAbort = (e: unknown) => (e as Error | undefined)?.name === 'AbortError';
function timeoutSignal(ms: number) { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms); return { signal: ctl.signal, done: () => clearTimeout(t) }; }

const blank = (): QState => ({ selectedLabel: null, state: null, marked: false, visited: false, rev: 0, savedRev: 0, sync: 'saved' });

export function paletteKind(q: QState): PaletteKind {
  if (q.state === 'ANSWERED' && q.selectedLabel) return 'answered';
  if (!q.visited) return 'notvisited';        // a skipped question (state SKIPPED, from earlier sittings) is simply "not answered" (UI-016)
  return 'unanswered';
}

/**
 * Client half of the answer-saving protocol.
 *  - Every change bumps a per-question revision; the server accepts only strictly newer revisions.
 *  - A question shows "Saved" only when the server has acknowledged a durable write at (or after) its latest revision.
 *  - Unacknowledged changes are retried with exponential backoff and mirrored to localStorage purely as a
 *    crash/reload buffer — the database remains the single source of truth.
 */
export class ExamEngine {
  qs = new Map<string, QState>();
  online = true; phase: Phase = 'running';
  private lastError: 'network' | 'timeout' | 'http' | null = null; private timeouts = 0; private reconciling = false; private reconcileFailed = false; private refreshed = new Set<string>();
  /** Backend-declared state (from heartbeat): the server decides; the UI only reflects it. */
  suspended = false; examStatus = ''; frozenRemainingMs: number | null = null; controlNote = '';
  deadlineMs: number; offsetMs = 0; lastSavedAt: number | null = null;
  private listeners = new Set<() => void>(); private inflight = new Set<string>(); private failures = 0; private timer: ReturnType<typeof setTimeout> | null = null;
  private hb: ReturnType<typeof setInterval>; private version = 0; private disposed = false;
  private onWin = () => { this.setOnline(true); void this.reconcileAmbiguous().then(() => this.pump(true)); }; private offWin = () => this.setOnline(false);
  private onVis = () => { if (document.hidden) void this.event('TAB_HIDDEN'); };

  constructor(public readonly attemptId: string, public readonly clientId: string, order: string[], serverAnswers: ServerAnswer[], deadlineIso: string, serverNowIso: string) {
    for (const id of order) this.qs.set(id, blank());
    for (const a of serverAnswers) this.qs.set(a.examQuestionId, { selectedLabel: a.selectedLabel, state: a.state, marked: a.markedForReview, visited: a.visited, rev: a.revision, savedRev: a.revision, sync: 'saved' });
    this.deadlineMs = new Date(deadlineIso).getTime(); this.offsetMs = new Date(serverNowIso).getTime() - Date.now();
    this.restoreBuffer();
    window.addEventListener('online', this.onWin); window.addEventListener('offline', this.offWin); document.addEventListener('visibilitychange', this.onVis);
    this.hb = setInterval(() => void this.heartbeat(), 15000);
    this.pump();
  }

  // ── store plumbing (useSyncExternalStore) ──
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getVersion = () => this.version;
  private emit() { this.version++; this.listeners.forEach((l) => l()); }
  dispose() { this.disposed = true; clearInterval(this.hb); if (this.timer) clearTimeout(this.timer); window.removeEventListener('online', this.onWin); window.removeEventListener('offline', this.offWin); document.removeEventListener('visibilitychange', this.onVis); this.listeners.clear(); }

  nowServer() { return Date.now() + this.offsetMs; }
  remainingMs() { return this.frozenRemainingMs !== null ? this.frozenRemainingMs : Math.max(0, this.deadlineMs - this.nowServer()); }
  private syncClock(serverNowIso?: string, deadlineIso?: string) {
    if (serverNowIso) this.offsetMs = new Date(serverNowIso).getTime() - Date.now();
    if (deadlineIso) this.deadlineMs = new Date(deadlineIso).getTime();
  }
  private setOnline(v: boolean) { if (this.online !== v) { this.online = v; this.emit(); void this.event(v ? 'ONLINE' : 'OFFLINE'); } }

  get(qid: string): QState { return this.qs.get(qid) ?? blank(); }
  pendingCount() { let n = 0; for (const q of this.qs.values()) if (q.rev > q.savedRev) n++; return n; }
  counts() {
    const c = { answered: 0, skipped: 0, unanswered: 0, notvisited: 0, marked: 0 };
    for (const q of this.qs.values()) { c[paletteKind(q)]++; if (q.marked) c.marked++; }
    return c;
  }

  // ── user intents ──
  private mutate(qid: string, patch: Partial<QState>) {
    if (this.phase !== 'running' || this.suspended) return;           // a suspended examination accepts no changes; confirmed answers stay as they are
    const q = this.get(qid);
    const next: QState = { ...q, ...patch, visited: true, rev: q.rev + 1, sync: 'pending', since: q.rev > q.savedRev ? q.since ?? Date.now() : Date.now() };
    this.qs.set(qid, next); this.persistBuffer(); this.emit(); this.pump();
  }
  select(qid: string, label: string) { const q = this.get(qid); if (q.selectedLabel === label && q.state === 'ANSWERED') return; this.mutate(qid, { selectedLabel: label, state: 'ANSWERED' }); }
  clear(qid: string) { const q = this.get(qid); if (!q.selectedLabel && q.state === 'CLEARED') return; this.mutate(qid, { selectedLabel: null, state: 'CLEARED' }); }
  skip(qid: string) { const q = this.get(qid); if (q.state === 'ANSWERED') return; if (q.state === 'SKIPPED') return; this.mutate(qid, { selectedLabel: null, state: 'SKIPPED' }); }
  toggleMark(qid: string) { const q = this.get(qid); this.mutate(qid, { marked: !q.marked, state: q.state ?? 'CLEARED' }); }
  /** Persist "visited" once, so the palette survives a reload. Does not clobber an existing answer. */
  visit(qid: string) { const q = this.get(qid); if (!q.visited) this.mutate(qid, { state: q.state ?? 'CLEARED' }); }

  // ── sender ──
  private pump(immediate = false) {
    if (this.disposed || this.phase !== 'running' || this.suspended) return;       // nothing is sent while suspended; unconfirmed edits wait and flush after resume
    if (this.timer && !immediate) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    let sent = 0;
    for (const [qid, q] of this.qs) {
      if (q.rev > q.savedRev && !this.inflight.has(qid) && sent < 4) { sent++; void this.send(qid); }
    }
  }
  private schedule() {
    if (this.timer || this.disposed) return;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.failures, 4)) + Math.random() * 500;
    this.timer = setTimeout(() => { this.timer = null; this.pump(true); }, delay);
  }
  private async send(qid: string) {
    this.inflight.add(qid);
    const q = this.get(qid); const sent = { ...q };
    this.qs.set(qid, { ...q, sync: 'saving' }); this.emit();
    const t = timeoutSignal(SAVE_TIMEOUT_MS);
    try {
      const r = await api('PUT', `/attempts/${this.attemptId}/answers/${qid}`, { clientId: this.clientId, revision: sent.rev, selectedLabel: sent.selectedLabel, state: sent.state ?? 'CLEARED', markedForReview: sent.marked, visited: true }, t.signal);
      this.failures = 0; this.timeouts = 0; this.lastError = null; this.setOnline(true); this.lastSavedAt = Date.now();
      this.syncClock(r.serverNow);
      const cur = this.get(qid); const stillNewer = cur.rev > r.revision;
      this.qs.set(qid, { ...cur, savedRev: Math.max(cur.savedRev, r.revision), sync: stillNewer ? 'pending' : 'saved', ambiguous: stillNewer ? cur.ambiguous : false, since: stillNewer ? cur.since : undefined });
    } catch (e) {
      const cur = this.get(qid);
      if (isAbort(e)) {
        // Outcome unknown: keep the change, keep its revision (the retry is idempotent), and ask the server what it actually holds.
        this.failures++; this.timeouts++; this.lastError = 'timeout'; this.qs.set(qid, { ...cur, sync: 'pending', ambiguous: true }); this.schedule();
        if (this.timeouts >= 2) void this.reconcileAmbiguous();
      } else if (e instanceof ApiError) {
        if (e.code === 'STALE_REVISION' && e.body?.server) { const s = e.body.server as ServerAnswer; this.refreshed.add(qid); this.qs.set(qid, { selectedLabel: s.selectedLabel, state: s.state, marked: s.markedForReview, visited: s.visited, rev: s.revision, savedRev: s.revision, sync: 'saved' }); }
        else if (e.code === 'EXAM_SUSPENDED') { this.applyControl({ suspended: true }); this.qs.set(qid, { ...cur, sync: 'pending' }); void this.heartbeat(); }
        else if (e.code === 'SESSION_SUPERSEDED') { this.phase = 'superseded'; this.qs.set(qid, { ...cur, sync: 'pending' }); }
        else if (e.code === 'TIME_EXPIRED' || e.code === 'ATTEMPT_CLOSED') { this.phase = 'closed'; this.qs.set(qid, { ...cur, sync: 'error' }); }
        else if (e.status === 400) { this.qs.set(qid, { ...cur, sync: 'error', savedRev: cur.rev }); }
        else { this.failures++; this.lastError = e.status === 0 ? 'network' : 'http'; this.qs.set(qid, { ...cur, sync: 'pending' }); this.schedule(); }
      } else { this.failures++; this.lastError = 'network'; this.setOnline(false); this.qs.set(qid, { ...cur, sync: 'pending' }); this.schedule(); }
    } finally {
      t.done(); this.inflight.delete(qid); this.persistBuffer(); this.emit();
      if (this.phase === 'running') this.pump();
    }
  }
  /** Resolves true once every local change has been acknowledged by the server. */
  async flushAll(timeoutMs = 20000, cancelled?: () => boolean): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    this.pump(true);
    while (Date.now() < end && !cancelled?.()) {
      if (this.phase !== 'running') return this.pendingCount() === 0;
      if (this.pendingCount() === 0 && this.inflight.size === 0) return true;
      await new Promise((r) => setTimeout(r, 150));
      if (this.pendingCount() > 0 && this.inflight.size === 0) this.pump(true);
    }
    return this.pendingCount() === 0;
  }

  // ── save status (UI-003/004) ──
  /** Aggregate, honest view of saving for the banner, the per-question text and the review screen. */
  saveStatus(): SaveStatus {
    const pending = [...this.qs].filter(([, q]) => q.rev > q.savedRev);
    const pendingIds = pending.map(([id]) => id); const refreshedIds = [...this.refreshed];
    const oldest = pending.reduce((m, [, q]) => Math.min(m, q.since ?? Date.now()), Date.now());
    const unresolvedMs = pending.length ? Math.max(0, Date.now() - oldest) : 0;
    const ambiguous = pending.some(([, q]) => q.ambiguous);
    let state: SaveState;
    if (!pending.length) state = refreshedIds.length ? 'reconciliation_required' : 'saved';
    else if (!this.online || this.lastError === 'network') state = 'offline_pending';
    else if (ambiguous && this.reconcileFailed && unresolvedMs >= NOT_CONFIRMED_AFTER_MS) state = 'reconciliation_required';
    else if (unresolvedMs >= NOT_CONFIRMED_AFTER_MS) state = 'not_confirmed';
    else if (this.failures > 0 || ambiguous) state = 'retrying';
    else state = 'saving';
    return { state, pendingIds, unresolvedMs, refreshedIds };
  }
  dismissRefreshed() { this.refreshed.clear(); this.emit(); }
  /** "Retry now": ask the server what it holds for timed-out saves, then resend what is genuinely missing (same revisions → idempotent). */
  async retryNow() {
    this.failures = 0; if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.reconcileAmbiguous(); this.pump(true); this.emit();
  }
  /**
   * For answers whose save timed out: read the server's committed sheet. If it already holds exactly our revision the answer is confirmed
   * (the acknowledgment was merely lost); if it holds something newer we adopt it and tell the candidate; if the sheet cannot be read the
   * answer stays unconfirmed and keeps retrying. Never invents a confirmation and never overwrites a newer local edit.
   */
  async reconcileAmbiguous(): Promise<void> {
    if (this.reconciling || this.disposed) return;
    const amb = [...this.qs].filter(([, q]) => q.ambiguous && q.rev > q.savedRev); if (!amb.length) return;
    this.reconciling = true; const t = timeoutSignal(SHEET_TIMEOUT_MS);
    try {
      const sheet = (await api('GET', `/attempts/${this.attemptId}/sheet`, undefined, t.signal)).answers as ServerAnswer[]; this.reconcileFailed = false;
      for (const [qid] of amb) {
        const cur = this.get(qid); const a = sheet.find((x) => x.examQuestionId === qid); if (!a || cur.rev <= cur.savedRev) continue;
        const same = a.revision === cur.rev && (a.selectedLabel ?? null) === (cur.selectedLabel ?? null) && a.state === (cur.state ?? 'CLEARED') && a.markedForReview === cur.marked;
        if (same) this.qs.set(qid, { ...cur, savedRev: a.revision, sync: 'saved', ambiguous: false, since: undefined });
        else if (a.revision > cur.rev) { this.refreshed.add(qid); this.qs.set(qid, { selectedLabel: a.selectedLabel, state: a.state, marked: a.markedForReview, visited: a.visited, rev: a.revision, savedRev: a.revision, sync: 'saved' }); }
        // else: the server holds an older revision → the save did not commit; the idempotent retry will send it.
      }
    } catch { this.reconcileFailed = true; }
    finally { t.done(); this.reconciling = false; this.persistBuffer(); this.emit(); }
  }

  // ── server coordination ──
  /** Applies the server's declared control state: suspension (with the clock policy), exam status; resumes sending when it clears. */
  applyControl(r: { suspended?: boolean; suspensionPolicy?: string | null; examStatus?: string }) {
    const was = this.suspended;
    if (r.examStatus !== undefined) this.examStatus = r.examStatus;
    this.suspended = !!r.suspended;
    if (this.suspended && !was) this.frozenRemainingMs = r.suspensionPolicy === 'CLOCK_CONTINUES' ? null : Math.max(0, this.deadlineMs - this.nowServer());     // FREEZE_CLOCK: show the time standing still
    if (!this.suspended) { this.frozenRemainingMs = null; if (was) this.pump(true); }
    if (this.suspended && r.suspensionPolicy === 'CLOCK_CONTINUES') this.frozenRemainingMs = null;
  }

  async heartbeat(): Promise<{ status: string; deadlineAt?: string; extendedMs?: number } | null> {
    if (this.disposed) return null;
    const hb = timeoutSignal(HEARTBEAT_TIMEOUT_MS);
    try {
      const before = this.deadlineMs;
      const r = await api('POST', `/attempts/${this.attemptId}/heartbeat`, { clientId: this.clientId, online: this.online }, hb.signal);
      this.syncClock(r.serverNow, r.deadlineAt); this.setOnline(true);
      this.applyControl({ suspended: r.suspended, suspensionPolicy: r.suspensionPolicy, examStatus: r.examStatus });
      if (r.superseded) this.phase = 'superseded'; else if (r.status !== 'IN_PROGRESS') this.phase = 'closed';
      this.emit(); return { ...r, extendedMs: this.deadlineMs - before };
    } catch (e) { if (!(e instanceof ApiError) && !isAbort(e)) this.setOnline(false); return null; }
    finally { hb.done(); }
  }
  private lastEvent = new Map<string, number>();
  async event(kind: string) {
    const now = Date.now(); if ((this.lastEvent.get(kind) ?? 0) > now - 5000 || this.phase !== 'running') return; this.lastEvent.set(kind, now);
    try { await post(`/attempts/${this.attemptId}/events`, { clientId: this.clientId, kind }); } catch { /* best effort */ }
  }
  /** Server's committed view — used by the review screen so the candidate confirms what is really stored. */
  async serverSheet(): Promise<ServerAnswer[]> { return (await get(`/attempts/${this.attemptId}/sheet`)).answers; }
  /** Compares server truth with the local view; adopts server values on mismatch. Returns mismatching ids. */
  async reconcile(): Promise<string[]> {
    const rows = await this.serverSheet(); const bad: string[] = []; const seen = new Set<string>();
    for (const a of rows) {
      seen.add(a.examQuestionId); const q = this.get(a.examQuestionId);
      if (q.savedRev !== a.revision || (q.selectedLabel ?? null) !== (a.selectedLabel ?? null)) { bad.push(a.examQuestionId); this.qs.set(a.examQuestionId, { selectedLabel: a.selectedLabel, state: a.state, marked: a.markedForReview, visited: a.visited, rev: a.revision, savedRev: a.revision, sync: 'saved' }); }
    }
    for (const [id, q] of this.qs) if (!seen.has(id) && q.savedRev > 0) bad.push(id);
    this.emit(); return bad;
  }
  expected() { return [...this.qs].map(([examQuestionId, q]) => ({ examQuestionId, revision: q.savedRev, selectedLabel: q.savedRev > 0 ? q.selectedLabel : null })).filter((e) => e.revision > 0); }

  // ── crash buffer (never authoritative) ──
  private bufKey() { return `oes:buffer:${this.attemptId}`; }
  private persistBuffer() {
    try {
      const pending = Object.fromEntries([...this.qs].filter(([, q]) => q.rev > q.savedRev).map(([id, q]) => [id, q]));
      if (Object.keys(pending).length) localStorage.setItem(this.bufKey(), JSON.stringify(pending)); else localStorage.removeItem(this.bufKey());
    } catch { /* storage unavailable */ }
  }
  private restoreBuffer() {
    try {
      const raw = localStorage.getItem(this.bufKey()); if (!raw) return;
      const buf = JSON.parse(raw) as Record<string, QState>;
      for (const [id, b] of Object.entries(buf)) { const cur = this.get(id); if (b.rev > cur.savedRev && this.qs.has(id)) this.qs.set(id, { ...b, savedRev: cur.savedRev, sync: 'pending', since: Date.now(), ambiguous: true }); /* may have been committed before the reload: re-sent idempotently */ }
    } catch { /* ignore corrupt buffer */ }
  }
  clearBuffer() { try { localStorage.removeItem(this.bufKey()); } catch { /* */ } }
}
