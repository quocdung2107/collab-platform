/**
 * Lớp máy khách dùng chung cho apps/web và apps/mobile (AD-35): gọi API, hook tải dữ liệu, realtime,
 * và logic hiển thị thuần (lịch, lập lịch nhiều cấp). Không phụ thuộc DOM hay React Native.
 */
export * from './api.js';
export * from './hooks.js';
export * from './realtime.js';
export * from './datetime.js';
export * from './monthGrid.js';
export * from './planning.js';
export * from './workspaceGroups.js';
