/**
 * Wire types for API responses, as the browser receives them (JSON: dates are ISO strings).
 * Type-only: nothing here exists at runtime. Keep in step with the API services that produce these shapes
 * (`delivery.service.ts#myExams`, `exams.service.ts#list`, `notifications.service.ts`, `reports.service.ts#dashboard`).
 */
export type ISODate = string;

export interface Paged<T> { items: T[]; total: number }

export interface NotificationDto { id: string; title: string; body: string; link: string | null; readAt: ISODate | null; createdAt: ISODate }
export interface NotificationsDto { unread: number; items: NotificationDto[] }

export interface CourseRef { code: string; title: string }

/** One row of GET /exams */
export interface ExamListItem {
  id: string; code: string; title: string; status: string; opensAt: ISODate; closesAt: ISODate; durationMin: number;
  course: CourseRef;
  _count: { questions: number; candidates: number; attempts: number };
}

export interface ProgramDto { id: string; code?: string; name?: string; courses: { id: string; code: string; title: string }[] }
export interface InstitutionRef { id: string; code: string; name: string }
