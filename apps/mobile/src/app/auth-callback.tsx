import { Redirect } from 'expo-router';

/** collab://auth-callback: phiên đã được xử lý trong signInWithGoogle (openAuthSessionAsync); chỉ quay về trang chính. */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
