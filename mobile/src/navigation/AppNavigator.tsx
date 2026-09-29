import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import type { LinkingOptions, NavigationContainerRef } from '@react-navigation/native';
import { ActivityIndicator, Linking, View } from 'react-native';

import type { RootStackParamList } from '../types/navigation';
import WalletConnectScreen from '../screens/WalletConnectScreen';
import TradeListScreen from '../screens/TradeListScreen';
import TradeDetailScreen from '../screens/TradeDetailScreen';
import DisputeDetailScreen from '../screens/DisputeDetailScreen';
import CreateTradeScreen from '../screens/CreateTradeScreen';
import EvidenceCaptureScreen from '../screens/EvidenceCaptureScreen';
import VaultDashboard from '../screens/VaultDashboard';
import { useDeepLink } from '../hooks/useDeepLink';

// Admin screens are lazy-loaded and only registered for admin users (issue #100).
// This keeps the initial JS bundle smaller for the vast majority of users who
// never access the admin area.
const AdminStreamsOverviewScreen = lazy(
  () => import('../screens/AdminStreamsOverviewScreen'),
);
const AdminTradesBatchScreen = lazy(
  () => import('../screens/AdminTradesBatchScreen'),
);
const AdminContractScreen = lazy(
  () => import('../screens/AdminContractScreen'),
);
const AdminFeaturesScreen = lazy(
  () => import('../screens/AdminFeaturesScreen'),
);
const AdminActionSuccessScreen = lazy(
  () => import('../screens/AdminActionSuccessScreen'),
);
import {
  LINK_PREFIXES,
  LINKING_SCREEN_CONFIG,
  parseDeepLink,
  requiresAuth,
} from '../constants/links';

const Stack = createStackNavigator<RootStackParamList>();

/**
 * Deep linking configuration (issue #261). Path <-> screen mapping is the
 * shared table in constants/links.ts so the web app and hosted
 * apple-app-site-association / assetlinks.json stay consistent.
 *
 * `getStateFromPath` runs our own parser first: an unrecognised link falls
 * through to react-navigation's default (which no-ops to the initial route
 * rather than crashing), and a link that needs auth while signed out resolves
 * to WalletConnect — useDeepLink parks the real target and resumes it on login.
 */
function makeLinking(isAuthenticated: boolean): LinkingOptions<RootStackParamList> {
  return {
    prefixes: LINK_PREFIXES,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: { screens: LINKING_SCREEN_CONFIG as any },
    getStateFromPath: (path, options) => {
      const target = parseDeepLink(path);
      if (target && requiresAuth(target) && !isAuthenticated) {
        // Land on WalletConnect; useDeepLink parks the real target and
        // resumes it once a token appears (login-then-continue).
        return { routes: [{ name: 'WalletConnect' }] };
      }
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nav = require('@react-navigation/native');
      return nav.getStateFromPath(path, options);
    },
  };
}

interface AppNavigatorProps {
  isAuthenticated: boolean;
  /** When true the admin screen stack is registered and lazy-loaded (issue #100). */
  isAdmin?: boolean;
}

export function AppNavigator({ isAuthenticated, isAdmin = false }: AppNavigatorProps) {
  const { handleUrl, resumePendingDeepLink } = useDeepLink();
  const navRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);
  const linking = useMemo(() => makeLinking(isAuthenticated), [isAuthenticated]);

  // Cold start: route (or park) the URL the app was opened with.
  useEffect(() => {
    Linking.getInitialURL().then((url) => handleUrl(url, navRef.current));
    // Warm start: route links received while the app is running.
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url, navRef.current));
    return () => sub.remove();
  }, [handleUrl]);

  // Login-then-continue: replay a parked link once authenticated.
  useEffect(() => {
    if (isAuthenticated) {
      resumePendingDeepLink(navRef.current);
    }
  }, [isAuthenticated, resumePendingDeepLink]);

  return (
    <NavigationContainer
      ref={navRef}
      linking={linking}
      fallback={null}
      onReady={() => {
        if (isAuthenticated) {
          resumePendingDeepLink(navRef.current);
        }
      }}
    >
      <Stack.Navigator
        initialRouteName={isAuthenticated ? 'TradeList' : 'WalletConnect'}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="WalletConnect" component={WalletConnectScreen} />
        <Stack.Screen name="TradeList" component={TradeListScreen} />
        <Stack.Screen name="TradeDetail" component={TradeDetailScreen} />
        <Stack.Screen name="DisputeDetail" component={DisputeDetailScreen} />
        <Stack.Screen name="CreateTrade" component={CreateTradeScreen} />
        <Stack.Screen name="EvidenceCapture" component={EvidenceCaptureScreen} />
        <Stack.Screen name="VaultDashboard" component={VaultDashboard} />
        {isAdmin && (
          <Suspense
            fallback={
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#2d6a2d" />
              </View>
            }
          >
            <Stack.Screen name="AdminStreamsOverview" component={AdminStreamsOverviewScreen} />
            <Stack.Screen name="AdminTradesBatch" component={AdminTradesBatchScreen} />
            <Stack.Screen name="AdminContract" component={AdminContractScreen} />
            <Stack.Screen name="AdminFeatures" component={AdminFeaturesScreen} />
            <Stack.Screen name="AdminActionSuccess" component={AdminActionSuccessScreen} />
          </Suspense>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
