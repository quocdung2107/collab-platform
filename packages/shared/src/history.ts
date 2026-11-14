/** Một dòng Lịch sử (F13): ai, khi nào, gì, trước → sau; hệ quả (cause_id) lồng bên dưới. */
export interface HistoryEntryDto {
  id: string;
  verb: string;
  actor: { userId: string; displayName: string } | null;
  occurredAt: string;
  text: string;
  changes: Array<{ field: string; before: string; after: string }>;
  consequences: HistoryEntryDto[];
}
