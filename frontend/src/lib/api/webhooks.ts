import { request } from './client';

export interface Webhook {
  id: number;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export interface CreatedWebhook extends Webhook {
  secret: string;
}

const AVAILABLE_EVENTS = [
  'trade.created',
  'trade.completed',
  'trade.disputed',
  'vault.deposited',
  'vault.released',
];

export { AVAILABLE_EVENTS };

export const webhooksApi = {
  list: (token: string) =>
    request<{ webhooks: Webhook[] }>('/webhooks', { token }),
  create: (
    token: string,
    body: { url: string; events: string[]; secret?: string },
  ) =>
    request<CreatedWebhook>('/webhooks', {
      token,
      method: 'POST',
      body: JSON.stringify(body),
    }),
  remove: (token: string, id: number) =>
    request<{ message: string }>(`/webhooks/${id}`, { token, method: 'DELETE' }),
};
