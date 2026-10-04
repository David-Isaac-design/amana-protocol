/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  registerForPushNotifications,
  getStoredPushToken,
  storePushTokenOnBackend,
  setupNotificationListeners,
  setupForegroundNotificationHandler,
  scheduleLocalNotification,
  checkNotificationPermissions,
} from '../notification.service';

// Mock expo-notifications
jest.mock('expo-notifications', () => {
  const listeners = new Map<string, Set<(arg: any) => void>>();

  const addListener = (event: string, cb: (arg: any) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
    return { remove: jest.fn(() => listeners.get(event)!.delete(cb)) };
  };

  return {
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
    addNotificationResponseReceivedListener: jest.fn((cb) => addListener('response', cb)),
    addNotificationReceivedListener: jest.fn((cb) => addListener('received', cb)),
    scheduleNotificationAsync: jest.fn(),
    setNotificationChannelAsync: jest.fn(),
    AndroidImportance: { MAX: 5 },
    // Test helper
    _emit: (event: string, arg: any) => {
      listeners.get(event)?.forEach((cb) => cb(arg));
    },
  };
});

// Mock expo-secure-store
jest.mock('expo-secure-store', () => {
  let store: Record<string, string> = {};
  return {
    setItemAsync: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    deleteItemAsync: jest.fn(async (key: string) => { delete store[key]; }),
    _reset: () => { store = {}; },
  };
});

// Mock react-native Platform
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Mock global fetch
global.fetch = jest.fn();

import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore as any)._reset();
});

describe('registerForPushNotifications', () => {
  it('returns a token when permission is already granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[test]' });

    const token = await registerForPushNotifications();

    expect(token).toBe('ExponentPushToken[test]');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('amana_push_token', 'ExponentPushToken[test]');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests permission when not yet granted and returns token on success', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({ data: 'ExponentPushToken[new]' });

    const token = await registerForPushNotifications();

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(token).toBe('ExponentPushToken[new]');
  });

  it('returns null when permission is denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'undetermined' });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    const token = await registerForPushNotifications();

    expect(token).toBeNull();
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('returns null on unexpected error', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('hardware error'));

    const token = await registerForPushNotifications();

    expect(token).toBeNull();
  });
});

describe('getStoredPushToken', () => {
  it('returns stored token', async () => {
    await SecureStore.setItemAsync('amana_push_token', 'ExponentPushToken[stored]');
    const token = await getStoredPushToken();
    expect(token).toBe('ExponentPushToken[stored]');
  });

  it('returns null when nothing is stored', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const token = await getStoredPushToken();
    expect(token).toBeNull();
  });

  it('returns null on SecureStore error', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValue(new Error('keychain error'));
    const token = await getStoredPushToken();
    expect(token).toBeNull();
  });
});

describe('storePushTokenOnBackend', () => {
  it('returns true on 200 response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const result = await storePushTokenOnBackend('token123', 'auth456');
    expect(result).toBe(true);
  });

  it('returns false on non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false });
    const result = await storePushTokenOnBackend('token123', 'auth456');
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));
    const result = await storePushTokenOnBackend('token123', 'auth456');
    expect(result).toBe(false);
  });
});

describe('setupNotificationListeners', () => {
  it('calls the callback when a notification response is received', () => {
    const onTap = jest.fn();
    setupNotificationListeners(onTap);

    (Notifications as any)._emit('response', {
      notification: {
        request: { content: { data: { type: 'trade', tradeId: 'abc123' } } },
      },
    });

    expect(onTap).toHaveBeenCalledWith({ type: 'trade', tradeId: 'abc123' });
  });

  it('returns a cleanup function that removes the listener', () => {
    const onTap = jest.fn();
    const cleanup = setupNotificationListeners(onTap);
    cleanup();

    (Notifications as any)._emit('response', {
      notification: { request: { content: { data: {} } } },
    });

    expect(onTap).not.toHaveBeenCalled();
  });
});

describe('setupForegroundNotificationHandler', () => {
  it('calls the callback when a notification is received in foreground', () => {
    const onNotif = jest.fn();
    setupForegroundNotificationHandler(onNotif);

    const mockNotif = { request: { content: { title: 'Test' } } };
    (Notifications as any)._emit('received', mockNotif);

    expect(onNotif).toHaveBeenCalledWith(mockNotif);
  });
});

describe('scheduleLocalNotification', () => {
  it('schedules a notification and returns an identifier', async () => {
    (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('notif-id-1');

    const id = await scheduleLocalNotification('Hello', 'World', { type: 'general' });

    expect(id).toBe('notif-id-1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Hello', body: 'World' }),
        trigger: null,
      }),
    );
  });
});

describe('checkNotificationPermissions', () => {
  it('returns true when permission is granted (iOS)', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    expect(await checkNotificationPermissions()).toBe(true);
  });

  it('returns false when permission is denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    expect(await checkNotificationPermissions()).toBe(false);
  });
});
