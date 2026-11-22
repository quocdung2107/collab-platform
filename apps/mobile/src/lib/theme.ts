import { useColorScheme } from 'react-native';

/** Token màu tối thiểu, cùng tinh thần với apps/web (M2 sẽ mở rộng thành bộ component). */
const light = { bg: '#f2f4f7', card: '#ffffff', text: '#101828', muted: '#667085', border: '#e4e7ec', accent: '#2563eb', danger: '#d92d20', ok: '#079455' };
const dark = { bg: '#0c111d', card: '#161b26', text: '#f5f5f6', muted: '#94969c', border: '#333741', accent: '#528bff', danger: '#f97066', ok: '#47cd89' };
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
