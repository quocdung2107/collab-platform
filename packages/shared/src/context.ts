import type { ObjectCardDto } from './messaging.js';

/** Một tin nhắn nhắc tới đối tượng (khối Liên quan, CONTEXT_ENGINE §3.1). */
export interface RelatedMessageDto {
  linkId: string;
  messageId: string;
  conversationId: string;
  anchor: { type: 'group' | 'event' | 'task'; id: string; name: string };
  senderName: string | null;
  excerpt: string;
  createdAt: string;
}

/** Khối Liên quan của Event/Task. hiddenCount = số mục người xem không có quyền (chỉ đếm). */
export interface RelatedDto {
  messages: RelatedMessageDto[];
  objects: Array<ObjectCardDto & { linkId: string; canUnlink: boolean }>;
  hiddenCount: number;
}

/** Nguồn gốc của Task tạo từ tin nhắn (created_from). available = false → "Tin nhắn gốc không khả dụng". */
export interface TaskSourceDto {
  available: boolean;
  messageId: string | null;
  conversationId: string | null;
  anchor: { type: 'group' | 'event' | 'task'; id: string; name: string } | null;
  senderName: string | null;
  excerpt: string | null;
}
