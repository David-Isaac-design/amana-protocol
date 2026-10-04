import { ColorSchemeName } from 'react-native';

export interface AppTheme {
  background: string;
  surface: string;
  border: string;
  primary: string;
  primaryText: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  successBg: string;
  successBorder: string;
  chip: string;
  chipBorder: string;
  inputBg: string;
  headerBg: string;
  cardBg: string;
  unreadBg: string;
  badgeBg: string;
  badgeText: string;
}

const light: AppTheme = {
  background: '#f0f4f0',
  surface: '#fff',
  border: '#e0e8e0',
  primary: '#2d6a2d',
  primaryText: '#fff',
  textPrimary: '#1a3a1a',
  textSecondary: '#333',
  textMuted: '#888',
  successBg: '#f0f8f0',
  successBorder: '#d0e8d0',
  chip: '#fff',
  chipBorder: '#d0d8d0',
  inputBg: '#fff',
  headerBg: '#fff',
  cardBg: '#fff',
  unreadBg: '#eef6ee',
  badgeBg: '#e53935',
  badgeText: '#fff',
};

const dark: AppTheme = {
  background: '#0f1f0f',
  surface: '#1a2e1a',
  border: '#2a4a2a',
  primary: '#4caf50',
  primaryText: '#fff',
  textPrimary: '#e8f5e9',
  textSecondary: '#c8e6c9',
  textMuted: '#81c784',
  successBg: '#1b3a1b',
  successBorder: '#2d6a2d',
  chip: '#1a2e1a',
  chipBorder: '#2a4a2a',
  inputBg: '#1a2e1a',
  headerBg: '#122112',
  cardBg: '#1a2e1a',
  unreadBg: '#1e3c1e',
  badgeBg: '#e53935',
  badgeText: '#fff',
};

export function getTheme(scheme: ColorSchemeName): AppTheme {
  return scheme === 'dark' ? dark : light;
}
