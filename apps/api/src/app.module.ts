import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CONFIG, loadConfig } from './config';
import { PrismaService } from './infra/prisma.service';
import { KvService } from './infra/kv.service';
import { QueuesService } from './infra/queues.service';
import { MailService } from './infra/mail.service';
import { MetricsService } from './infra/metrics.service';
import { MetricsController } from './modules/metrics.controller';
import { AuthGuard } from './common/auth';
import { AllExceptionsFilter } from './common/errors';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
import { RegistrationService } from './modules/auth/registration.service';
import { RegistrationController } from './modules/auth/registration.controller';
import { OnboardingService } from './modules/auth/onboarding.service';
import { OnboardingController } from './modules/auth/onboarding.controller';
import { TeacherRegistrationService } from './modules/teachers/teacher-registration.service';
import { TeacherService } from './modules/teachers/teacher.service';
import { BankReviewService } from './modules/teachers/bank-review.service';
import { DirectoryController } from './modules/directory/directory.controller';
import { DirectoryService } from './modules/directory/directory.service';
import { TeacherAdminService } from './modules/teachers/teacher-admin.service';
import { TeacherRegistrationController, TeacherController, TeacherAdminController, QuestionBanksController } from './modules/teachers/teachers.controller';
import { AuthController } from './modules/auth/auth.controller';
import { MfaService } from './modules/auth/mfa.service';
import { OrgService } from './modules/org/org.service';
import { OrgController } from './modules/org/org.controller';
import { CourseAccessService } from './modules/org/course-access.service';
import { CourseAssignmentsController } from './modules/org/course-assignments.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { QuestionsService } from './modules/exams/questions.service';
import { ExamsService } from './modules/exams/exams.service';
import { ExamsController } from './modules/exams/exams.controller';
import { DeliveryService } from './modules/delivery/delivery.service';
import { DeliveryController } from './modules/delivery/delivery.controller';
import { ResultsService } from './modules/results/results.service';
import { ResultsController } from './modules/results/results.controller';
import { InvigilationService } from './modules/invigilation/invigilation.service';
import { InvigilationController } from './modules/invigilation/invigilation.controller';
import { ReportsService } from './modules/reports/reports.service';
import { ReportsController } from './modules/reports/reports.controller';
import { HealthController } from './modules/health.controller';
import { JobsService } from './modules/jobs.service';
import { ExamEventsService } from './modules/control/events.service';
import { MonitorService } from './modules/control/monitor.service';
import { LifecycleService } from './modules/control/lifecycle.service';
import { ExamControlService } from './modules/control/control.service';
import { ExamControlController } from './modules/control/control.controller';

@Module({
  controllers: [AuthController, RegistrationController, OnboardingController, TeacherRegistrationController, TeacherController, TeacherAdminController, QuestionBanksController, DirectoryController, OrgController, CourseAssignmentsController, ExamsController, DeliveryController, ResultsController, InvigilationController, ReportsController, ExamControlController, HealthController, MetricsController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    PrismaService, KvService, QueuesService, MailService, MetricsService, AuditService, NotificationsService,
    AuthService, RegistrationService, OnboardingService, TeacherRegistrationService, TeacherService, TeacherAdminService, BankReviewService, DirectoryService, MfaService, OrgService, CourseAccessService, QuestionsService, ExamsService, DeliveryService, ResultsService, InvigilationService, ReportsService, ExamEventsService, MonitorService, LifecycleService, ExamControlService, JobsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
