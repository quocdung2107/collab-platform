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
  /** Thẻ đối tượng nhắc tới trong tin (references) và Task sinh ra từ tin (created_from), dựng theo quyền người xem. */
  cards: ObjectCardDto[];
  /** Tệp đính kèm (F9b); tin đã xoá → rỗng. Tải qua GET /v1/attachments/:id/url. */
  attachments: AttachmentDto[];
}

export interface AttachmentDto {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedBy: { userId: string; displayName: string };
  createdAt: string;
}

/** Thẻ đối tượng (CONTEXT_ENGINE §5): available = false → "Nội dung bị giới hạn", không có tiêu đề. */
export interface ObjectCardDto {
  relation: 'references' | 'created_from';
  type: 'event' | 'task' | 'group';
  id: string;
  available: boolean;
  title: string | null;
  subtitle: string | null;
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
  /** Thẻ chèn chủ động; đường dẫn nội bộ (#event=…, #task=…, #group=…) trong nội dung được nhận diện thêm. */
  refs?: Array<{ type: 'event' | 'task' | 'group'; id: string }>;
  /** Khoá đã tải lên qua POST /v1/organizations/:orgId/uploads. */
  attachments?: Array<{ key: string; filename: string }>;
}
