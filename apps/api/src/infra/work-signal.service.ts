import { Injectable } from '@nestjs/common';

/**
 * Tiny in-process hand-off from request paths to background work, so DeliveryService can ask for an attempt to be graded
 * without depending on ResultsService (which would be circular). JobsService registers the handler at start-up.
 * Best effort by design: the lifecycle tick grades every sealed attempt that has no result yet.
 */
@Injectable()
export class WorkSignal {
  private grader: ((attemptId: string) => Promise<unknown>) | null = null;
  private onError: (attemptId: string, err: Error) => void = () => undefined;

  setGrader(fn: (attemptId: string) => Promise<unknown>, onError: (attemptId: string, err: Error) => void) { this.grader = fn; this.onError = onError; }

  /** Fire and forget: never delays or fails the caller. */
  requestGrade(attemptId: string) {
    const g = this.grader; if (!g) return;
    setImmediate(() => { void g(attemptId).catch((e: Error) => this.onError(attemptId, e)); });
  }
}
