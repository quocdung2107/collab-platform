// Metro cho monorepo (Expo tự cấu hình watchFolders từ SDK 52). Thêm hai điều cho các gói nội bộ viết bằng TS:
// 1) '@collab/shared' trỏ thẳng vào mã nguồn (gói này xuất dist/ cho API Node, app không cần build trước);
// 2) import tương đối có đuôi '.js' trong packages/*/src (kiểu ESM của Node) được thử lại với '.ts'/'.tsx'.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const packagesDir = path.resolve(__dirname, '../../packages');
const sharedEntry = path.join(packagesDir, 'shared/src/index.ts');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@collab/shared') return { type: 'sourceFile', filePath: sharedEntry };
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && context.originModulePath.startsWith(packagesDir)) {
    for (const ext of ['.ts', '.tsx']) {
      try {
        return context.resolveRequest(context, moduleName.slice(0, -3) + ext, platform);
      } catch {
        // thử đuôi tiếp theo
      }
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
