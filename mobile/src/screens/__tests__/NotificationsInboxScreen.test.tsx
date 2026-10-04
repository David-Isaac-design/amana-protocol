/**
 * Tests for NotificationsInboxScreen (issue #88).
 * Covers list rendering, unread styling, mark-as-read, and deep-link navigation.
 */

import { render, fireEvent, waitFor } from '@testing-library/react-native';
import NotificationsInboxScreen from '../NotificationsInboxScreen';
import { notificationsApi } from '../../api/notifications';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../api/notifications', () => ({
  notificationsApi: {
    listNotifications: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  dispatch: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  isFocused: jest.fn(() => true),
  canGoBack: jest.fn(() => true),
  reset: jest.fn(),
  getParent: jest.fn(),
  getState: jest.fn(),
  setParams: jest.fn(),
  replace: jest.fn(),
} as any;

const mockRoute = { key: 'NotificationsInbox', name: 'NotificationsInbox', params: undefined } as any;

const mockList = notificationsApi.listNotifications as jest.MockedFunction<typeof notificationsApi.listNotifications>;
const mockMarkRead = notificationsApi.markRead as jest.MockedFunction<typeof notificationsApi.markRead>;
const mockMarkAllRead = notificationsApi.markAllRead as jest.MockedFunction<typeof notificationsApi.markAllRead>;

const makeNotification = (id: number, isRead = false, tradeId?: string) => ({
  id,
  title: `Notification ${id}`,
  message: `Message for notification ${id}`,
  type: 'INFO',
  isRead,
  metadata: tradeId ? { tradeId } : null,
  createdAt: new Date().toISOString(),
});

const emptyResult = {
  notifications: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0, unreadCount: 0 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMarkRead.mockResolvedValue(undefined);
  mockMarkAllRead.mockResolvedValue(undefined);
});

test('renders empty state when no notifications', async () => {
  mockList.mockResolvedValue(emptyResult);
  const { getByText } = render(
    <NotificationsInboxScreen navigation={mockNavigation} route={mockRoute} />,
  );
  await waitFor(() => {
    expect(getByText('No notifications yet')).toBeTruthy();
  });
});

test('renders notification list', async () => {
  mockList.mockResolvedValue({
    notifications: [makeNotification(1, false), makeNotification(2, true)],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1, unreadCount: 1 },
  });
  const { getByText } = render(
    <NotificationsInboxScreen navigation={mockNavigation} route={mockRoute} />,
  );
  await waitFor(() => {
    expect(getByText('Notification 1')).toBeTruthy();
    expect(getByText('Notification 2')).toBeTruthy();
  });
});

test('shows unread badge count', async () => {
  mockList.mockResolvedValue({
    notifications: [makeNotification(1, false)],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1, unreadCount: 1 },
  });
  const { getByText } = render(
    <NotificationsInboxScreen navigation={mockNavigation} route={mockRoute} />,
  );
  await waitFor(() => {
    expect(getByText('1')).toBeTruthy();
  });
});

test('tapping mark-read calls API and updates item', async () => {
  mockList.mockResolvedValue({
    notifications: [makeNotification(1, false)],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1, unreadCount: 1 },
  });
  const { getByText, queryByText } = render(
    <NotificationsInboxScreen navigation={mockNavigation} route={mockRoute} />,
  );
  await waitFor(() => getByText('Mark read'));
  fireEvent.press(getByText('Mark read'));
  await waitFor(() => {
    expect(mockMarkRead).toHaveBeenCalledWith(1);
    expect(queryByText('Mark read')).toBeNull();
  });
});

test('tapping notification with tradeId navigates to TradeDetail', async () => {
  mockList.mockResolvedValue({
    notifications: [makeNotification(1, true, 'trade-abc')],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1, unreadCount: 0 },
  });
  const { getByText } = render(
    <NotificationsInboxScreen navigation={mockNavigation} route={mockRoute} />,
  );
  await waitFor(() => getByText('Notification 1'));
  fireEvent.press(getByText('Notification 1'));
  expect(mockNavigate).toHaveBeenCalledWith('TradeDetail', { tradeId: 'trade-abc' });
});

test('mark all read button calls API and clears unread', async () => {
  mockList.mockResolvedValue({
    notifications: [makeNotification(1, false), makeNotification(2, false)],
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1, unreadCount: 2 },
  });
  const { getByText, queryByText } = render(
    <NotificationsInboxScreen navigation={mockNavigation} route={mockRoute} />,
  );
  await waitFor(() => getByText('Mark all read'));
  fireEvent.press(getByText('Mark all read'));
  await waitFor(() => {
    expect(mockMarkAllRead).toHaveBeenCalled();
    expect(queryByText('Mark all read')).toBeNull();
  });
});
