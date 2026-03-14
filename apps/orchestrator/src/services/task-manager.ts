import type { PrismaClient, Prisma } from '@prisma/client';
import type { TaskStatus, TaskPriority } from '@rigelhq/shared';
import type { EventBus } from './event-bus.js';

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  createdById: string;
  assignedAgentId?: string;
  parentTaskId?: string;
  projectId?: string;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<string, TaskStatus[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['IN_REVIEW', 'FAILED', 'CANCELLED'],
  IN_REVIEW: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['PENDING'], // Allow retry
  CANCELLED: [],
};

export class TaskManager {
  constructor(
    private db: PrismaClient,
    private eventBus: EventBus,
  ) {}

  async createTask(input: CreateTaskInput) {
    const task = await this.db.task.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        priority: input.priority ?? 'MEDIUM',
        createdById: input.createdById,
        assignedAgentId: input.assignedAgentId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        projectId: input.projectId ?? null,
        status: 'PENDING',
      },
    });

    await this.publishTaskUpdate(task.id, 'PENDING');
    return task;
  }

  async updateStatus(taskId: string, newStatus: TaskStatus) {
    const task = await this.db.task.findUniqueOrThrow({ where: { id: taskId } });
    const currentStatus = task.status as string;

    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`);
    }

    const data: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'IN_PROGRESS') data.startedAt = new Date();
    if (newStatus === 'COMPLETED' || newStatus === 'FAILED') data.completedAt = new Date();

    const updated = await this.db.task.update({ where: { id: taskId }, data });
    await this.publishTaskUpdate(taskId, newStatus);
    return updated;
  }

  async setResult(taskId: string, result: Record<string, unknown>) {
    return this.db.task.update({
      where: { id: taskId },
      data: { result: result as Prisma.InputJsonValue },
    });
  }

  async getTask(taskId: string) {
    return this.db.task.findUnique({ where: { id: taskId } });
  }

  async getTasksByAgent(agentId: string) {
    return this.db.task.findMany({
      where: { assignedAgentId: agentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActiveTasks() {
    return this.db.task.findMany({
      where: { status: { in: ['PENDING', 'IN_PROGRESS', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async publishTaskUpdate(taskId: string, status: TaskStatus): Promise<void> {
    await this.eventBus.publish({
      id: `task-${taskId}-${Date.now()}`,
      agentId: 'system',
      runId: 'system',
      seq: 0,
      stream: 'lifecycle',
      timestamp: Date.now(),
      data: { taskId, status },
    });
  }
}
