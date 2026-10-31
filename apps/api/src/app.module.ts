import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CONFIG, loadConfig } from './config';
import { PrismaService } from './infra/prisma.service';
import { RedisService } from './infra/redis.service';
import { QueuesService } from './infra/queues.service';
import { MailService } from './infra/mail.service';
import { AuthGuard } from './common/auth';
import { AllExceptionsFilter } from './common/errors';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
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

@Module({
  controllers: [AuthController, OrgController, CourseAssignmentsController, ExamsController, DeliveryController, ResultsController, InvigilationController, ReportsController, HealthController],
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    PrismaService, RedisService, QueuesService, MailService, AuditService, NotificationsService,
    AuthService, MfaService, OrgService, CourseAccessService, QuestionsService, ExamsService, DeliveryService, ResultsService, InvigilationService, ReportsService, JobsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
