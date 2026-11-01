import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { MetricsService } from '../infra/metrics.service';
import type { FastifyReply } from 'fastify';

export class AppError extends HttpException {
  constructor(status: number, public readonly code: string, message: string, public readonly extra?: Record<string, unknown>) {
    super({ code, message, ...extra }, status);
  }
}
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', msg);
export const conflict = (code: string, msg: string, extra?: Record<string, unknown>) => new AppError(409, code, msg, extra);
export const badRequest = (msg: string, extra?: Record<string, unknown>) => new AppError(400, 'BAD_REQUEST', msg, extra);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');
  constructor(private readonly metrics: MetricsService) {}
  catch(ex: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    reply.type('application/json; charset=utf-8'); // handlers such as CSV export may have preset another content type
    if (ex instanceof HttpException) {
      const r = ex.getResponse();
      const body = typeof r === 'string' ? { code: 'ERROR', message: r } : (r as Record<string, unknown>);
      if (ex.getStatus() === 401 || ex.getStatus() === 403) this.metrics.unauthorized.inc({ status: String(ex.getStatus()), code: String(body.code ?? 'ERROR') });
      return reply.status(ex.getStatus()).send({ code: body.code ?? 'ERROR', ...body, message: body.message ?? ex.message });
    }
    const e = ex as { code?: string; message?: string };
    // Unique violation → 409; FK/check violations → 400; never leak SQL.
    if (e?.code === 'P2002') return reply.status(409).send({ code: 'DUPLICATE', message: 'A record with these values already exists' });
    if (e?.code === 'P2025') return reply.status(404).send({ code: 'NOT_FOUND', message: 'Record not found' });
    this.metrics.recordUnhandled(ex);
    this.log.error(e?.message ?? String(ex), (ex as Error)?.stack);
    return reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ code: 'INTERNAL', message: 'Internal server error' });
  }
}
