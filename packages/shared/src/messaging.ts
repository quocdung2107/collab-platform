export type ConversationAnchorType = 'group' | 'event' | 'task';

export interface ConversationSummaryDto {
  id: string;
  orgId: string;
  anchor: { type: ConversationAnchorType; id: string; name: string };
  lastSeq: number;
  lastMessageAt: string | null;
  lastReadSeq: number;
  /** Số tin người khác gửi, chưa xoá, có seq > lastReadSeq. */
  unreadCount: number;
  readOnly: boolean;
}

export interface MessageDto {
  id: string;
  seq: number;
  kind: 'user' | 'system';
  senderId: string | null;
  senderName: string | null;
  /** null khi tin đã xoá. */
  body: string | null;
  replyTo: { id: string; seq: number; senderName: string | null; excerpt: string | null } | null;
  mentions: Array<{ userId: string; displayName: string }>;
  clientMsgId: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface MessagePageDto {
  conversation: ConversationSummaryDto;
  messages: MessageDto[];
  /** Còn tin cũ hơn tin đầu trang. */
  hasMore: boolean;
}

export interface SendMessageInput {
  clientMsgId: string;
  body: string;
  replyToId?: string;
  mentionIds?: string[];
}
