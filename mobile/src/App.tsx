import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainerRef } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View, useColorScheme } from 'react-native';

import { useAuthStore } from './stores/authStore';
import {
  registerForPushNotifications,
  storePushTokenOnBackend,
  setupNotificationListeners,
  checkNotificationPermissions,
} from './services/notification.service';
import type { RootStackParamList } from './types/navigation';
import { AppNavigator } from './navigation/AppNavigator';
import type { NotificationData } from './services/notification.service';

export default function App() {
  const scheme = useColorScheme();
  const { getToken, token } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(false);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList> | null>(null);

  useEffect(() => {
    getToken().finally(() => setBootstrapped(true));
  }, [getToken]);

  useEffect(() => {
    if (!token) return;

    const setupNotifications = async () => {
      const hasPermission = await checkNotificationPermissions();
      if (!hasPermission) return;

      const pushToken = await registerForPushNotifications();
      if (pushToken) {
        await storePushTokenOnBackend(pushToken, token);
      }
    };

    setupNotifications();

    const unsubscribe = setupNotificationListeners((data: NotificationData) => {
      if (data.tradeId && navigationRef.current) {
        navigationRef.current.navigate('TradeDetail', { tradeId: data.tradeId });
      } else if (data.screen && navigationRef.current) {
        navigationRef.current.navigate(data.screen as any);
      }
    });

    return unsubscribe;
  }, [token]);

  const isDark = scheme === 'dark';

  if (!bootstrapped) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: isDark ? '#0f1f0f' : '#f0f4f0' }}>
        <ActivityIndicator size="large" color={isDark ? '#4caf50' : '#2d6a2d'} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppNavigator isAuthenticated={!!token} />
        <StatusBar style={isDark ? 'light' : 'dark'} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
