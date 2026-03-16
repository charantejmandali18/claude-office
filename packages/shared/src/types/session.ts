export type SessionStatus = 'active' | 'idle' | 'stopped';

export interface Session {
  id: string;
  projectName: string;
  sessionId: string;
  teamName: string | null;
  status: SessionStatus;
  createdAt: Date;
  lastActive: Date;
  metadata: Record<string, unknown> | null;
}
