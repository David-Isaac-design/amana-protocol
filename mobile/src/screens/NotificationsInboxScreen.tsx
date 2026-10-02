import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { notificationsApi, InAppNotification } from '../api/notifications';
import { getTheme } from '../constants/theme';

type Props = StackScreenProps<RootStackParamList, 'NotificationsInbox'>;

function NotificationItem({
  item,
  onPress,
  onMarkRead,
  theme,
}: {
  item: InAppNotification;
  onPress: (item: InAppNotification) => void;
  onMarkRead: (id: number) => void;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.item,
        { backgroundColor: item.isRead ? theme.surface : theme.unreadBg, borderBottomColor: theme.border },
      ]}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      <View style={styles.itemContent}>
        {!item.isRead && <View style={[styles.unreadDot, { backgroundColor: theme.primary }]} />}
        <View style={styles.itemText}>
          <Text style={[styles.title, { color: theme.textPrimary }, !item.isRead && styles.titleUnread]}>
            {item.title}
          </Text>
          <Text style={[styles.message, { color: theme.textSecondary }]} numberOfLines={2}>
            {item.message}
          </Text>
          <Text style={[styles.time, { color: theme.textMuted }]}>
            {new Date(item.createdAt).toLocaleString()}
          </Text>
        </View>
      </View>
      {!item.isRead && (
        <TouchableOpacity
          style={[styles.readBtn, { borderColor: theme.primary }]}
          onPress={() => onMarkRead(item.id)}
          accessibilityLabel="Mark as read"
        >
          <Text style={[styles.readBtnText, { color: theme.primary }]}>Mark read</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

export default function NotificationsInboxScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const theme = getTheme(scheme);

  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadNotifications = useCallback(async (p = 1, replace = false) => {
    try {
      const result = await notificationsApi.listNotifications({ page: p, limit: 20 });
      setNotifications((prev) =>
        replace ? result.notifications : [...prev, ...result.notifications],
      );
      setUnreadCount(result.pagination.unreadCount);
      setHasMore(p < result.pagination.totalPages);
      setPage(p);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications(1, true);
  }, [loadNotifications]);

  const handleMarkRead = useCallback(
    async (id: number) => {
      await notificationsApi.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    },
    [],
  );

  const handleMarkAllRead = useCallback(async () => {
    await notificationsApi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }, []);

  const handlePress = useCallback(
    (item: InAppNotification) => {
      if (!item.isRead) {
        handleMarkRead(item.id);
      }
      const tradeId = item.metadata?.tradeId;
      if (tradeId) {
        navigation.navigate('TradeDetail', { tradeId });
      }
    },
    [navigation, handleMarkRead],
  );

  const loadMore = useCallback(() => {
    if (hasMore && !loading) {
      loadNotifications(page + 1);
    }
  }, [hasMore, loading, page, loadNotifications]);

  if (loading && notifications.length === 0) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backBtn, { color: theme.primary }]}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.badgeBg }]}>
              <Text style={[styles.badgeText, { color: theme.badgeText }]}>{unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={handleMarkAllRead}>
            <Text style={[styles.markAllBtn, { color: theme.primary }]}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 70 }} />
        )}
      </View>

      <FlatList
        data={notifications}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <NotificationItem
            item={item}
            onPress={handlePress}
            onMarkRead={handleMarkRead}
            theme={theme}
          />
        )}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: theme.textMuted }]}>No notifications yet</Text>
          </View>
        }
        ListFooterComponent={
          loading && notifications.length > 0 ? (
            <ActivityIndicator style={styles.footer} color={theme.primary} />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { fontSize: 14, fontWeight: '500' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  markAllBtn: { fontSize: 13, fontWeight: '500' },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  itemContent: { flexDirection: 'row', gap: 10 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  itemText: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '500' },
  titleUnread: { fontWeight: '700' },
  message: { fontSize: 13, lineHeight: 18 },
  time: { fontSize: 11, marginTop: 2 },
  readBtn: {
    alignSelf: 'flex-end',
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  readBtnText: { fontSize: 11, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15 },
  footer: { padding: 16 },
});
