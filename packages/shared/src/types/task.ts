export type TaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentId: string | null;
  createdById: string;
  parentTaskId: string | null;
  projectId: string | null;
  result: Record<string, unknown> | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
