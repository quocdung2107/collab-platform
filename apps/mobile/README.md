# apps/mobile — app iOS + Android (AD-35)

React Native + Expo SDK 58, expo-router (`src/app`). Logic gọi API, Realtime và hiển thị dùng chung với web qua `packages/client`.

## Trạng thái: M0 (thử nghiệm kỹ thuật)

Màn hình duy nhất là **Kiểm tra M0**. Nó kiểm tra trên máy thật: đăng nhập Google, Sign in with Apple, gọi API `/v1/me`, Realtime `user:{id}`, push token + thông báo thử, và liên kết `collab://link-test`. M2 thay màn hình này bằng khung 4 tab.

## Việc chủ sản phẩm làm một lần

| # | Việc | Ở đâu |
| --- | --- | --- |
| 1 | Đăng ký **Apple Developer Program** (cá nhân) | developer.apple.com/programs |
| 2 | Tạo tài khoản **Expo** | expo.dev/signup |
| 3 | Thêm `collab://auth-callback` vào Redirect URLs | Supabase → Authentication → URL Configuration |
| 4 | Bật nhà cung cấp **Apple**, Client IDs = `com.quocdung2107.collab` (chỉ cần cho đăng nhập gốc trên iOS, không cần Services ID/khoá .p8) | Supabase → Authentication → Sign In / Providers → Apple |
| 5 | (Trước M3) tạo project **Firebase**, thêm app Android `com.quocdung2107.collab`, tải `google-services.json` | console.firebase.google.com |

## Build bản thử lên iPhone (chạy trên máy tính của bạn, Windows/Mac/Linux đều được)

```bash
git clone https://github.com/quocdung2107/collab-platform && cd collab-platform
pnpm install
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest init                 # tạo project trên Expo; in ra projectId
npx eas-cli@latest device:create        # quét mã QR bằng iPhone để đăng ký máy
EAS_PROJECT_ID=<projectId> npx eas-cli@latest build --profile development --platform ios
```

EAS hỏi đăng nhập Apple để tạo chứng chỉ (lần đầu). Build xong, mở liên kết EAS in ra trên iPhone để cài. Sau đó chạy `EAS_PROJECT_ID=<projectId> npx expo start` trên máy tính và mở app trên iPhone (cùng mạng Wi‑Fi) để nạp mã.

Android: thay `--platform ios` bằng `--platform android`; cài tệp APK trực tiếp, không cần đăng ký máy.

## Lệnh

| Lệnh | Việc |
| --- | --- |
| `pnpm --filter @collab/mobile start` | Máy chủ phát triển (dev client) |
| `pnpm --filter @collab/mobile typecheck` | Kiểm tra kiểu |
| `pnpm --filter @collab/mobile exec expo export --platform ios --platform android` | Đóng gói JS (CI chạy với `EXPO_OFFLINE=1`) |

## Cấu hình (`app.config.ts`)

Giá trị công khai có mặc định; ghi đè bằng biến môi trường khi build: `API_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EAS_PROJECT_ID`, `GOOGLE_SERVICES_FILE`, `LINK_DOMAIN`.

`LINK_DOMAIN` để trống cho tới khi có tên miền riêng. Khi có: đặt biến này, phục vụ `/.well-known/apple-app-site-association` và `/.well-known/assetlinks.json` ở gốc tên miền, rồi build lại.

Mã định danh `com.quocdung2107.collab` **không đổi được sau khi lên cửa hàng**; đổi trước M7 nếu cần.
