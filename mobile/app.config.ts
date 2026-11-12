import type { ConfigContext, ExpoConfig } from 'expo/config';

// Deep-link scheme + universal/app-link hosts. Keep in step with
// src/constants/links.ts and frontend/public/.well-known/* (issue #261).
const APP_SCHEME = 'amanavault';
const LINK_HOSTS = ['example.com', 'www.example.com'];

const config: ExpoConfig = {
  name: 'Amana Protocol',
  slug: 'amana-vault-mobile',
  version: '0.1.0',
  scheme: APP_SCHEME,
  platforms: ['ios', 'android', 'web'],
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  entryPoint: './src/index.tsx',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    supportsTabletMode: true,
    bundleIdentifier: 'com.amana.mobile',
    associatedDomains: LINK_HOSTS.map((h) => `applinks:${h}`),
  },
  android: {
    package: 'com.amana.mobile',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: LINK_HOSTS.flatMap((host) => [
          { scheme: 'https', host, pathPrefix: '/trades' },
          { scheme: 'https', host, pathPrefix: '/disputes' },
        ]),
        category: ['BROWSABLE', 'DEFAULT'],
      },
      {
        action: 'VIEW',
        data: [{ scheme: APP_SCHEME }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
};

export default ({ config: staticConfig }: ConfigContext): ExpoConfig => ({
  ...staticConfig,
  ...config,
  ios: { ...staticConfig.ios, ...config.ios },
  android: { ...staticConfig.android, ...config.android },
  web: { ...staticConfig.web, ...config.web },
});
