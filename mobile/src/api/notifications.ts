import apiClient from './client';

export interface InAppNotification {
  id: number;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  metadata: Record<string, string> | null;
  createdAt: string;
}

export interface NotificationListResult {
  notifications: InAppNotification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    unreadCount: number;
  };
}

export const notificationsApi = {
  async listNotifications(params?: {
    unreadOnly?: boolean;
    page?: number;
    limit?: number;
  }): Promise<NotificationListResult> {
    const response = await apiClient.get('/notifications', { params });
    return response.data;
  },

  async markRead(id: number): Promise<void> {
    await apiClient.patch(`/notifications/${id}/read`);
  },

  async markAllRead(): Promise<void> {
    await apiClient.post('/notifications/read-all');
  },
};
