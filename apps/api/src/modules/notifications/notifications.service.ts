import { Injectable } from '@nestjs/common';
import type { Role } from '@oes/shared';
import { PrismaService } from '../../infra/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(userIds: string[], title: string, body: string, link?: string) {
    if (!userIds.length) return 0;
    const r = await this.prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, title, body, link })) });
    return r.count;
  }
  async notifyRole(role: Role, title: string, body: string, link?: string) {
    const users = await this.prisma.user.findMany({ where: { role, active: true }, select: { id: true } });
    return this.notify(users.map((u) => u.id), title, body, link);
  }
  list(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({ where: { userId, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  async unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }
  markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }
  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
