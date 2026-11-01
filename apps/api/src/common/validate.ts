import { z, type ZodType } from 'zod';
import { AppError } from './errors';

export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError(400, 'VALIDATION', 'Request validation failed', {
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}
export const uuid = z.string().uuid();
export const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) });
export const paginate = (p: { page: number; pageSize: number }) => ({ skip: (p.page - 1) * p.pageSize, take: p.pageSize });
