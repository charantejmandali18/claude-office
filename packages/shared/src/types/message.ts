export type SenderType = 'USER' | 'AGENT' | 'SYSTEM';
export type MessageType = 'CHAT' | 'COMMAND' | 'REPORT' | 'VOICE';
export type ConversationStatus = 'ACTIVE' | 'ARCHIVED';

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderType: SenderType;
  content: string;
  messageType: MessageType;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface Conversation {
  id: string;
  title: string | null;
  participants: string[];
  status: ConversationStatus;
  createdAt: Date;
  updatedAt: Date;
}
