/* eslint-disable @typescript-eslint/no-explicit-any */
import { tradeApi } from '../trade';

jest.mock('../client', () => ({
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

import apiClient from '../client';

beforeEach(() => jest.clearAllMocks());

describe('tradeApi — notes', () => {
  describe('listNotes', () => {
    it('fetches notes for a trade', async () => {
      const mockNotes = {
        notes: [
          { id: 'n1', tradeId: 't1', authorAddress: 'GABC', content: 'hello', createdAt: '2024-01-01' },
        ],
      };
      (apiClient.get as jest.Mock).mockResolvedValue({ data: mockNotes });

      const result = await tradeApi.listNotes('t1');

      expect(apiClient.get).toHaveBeenCalledWith('/trades/t1/notes');
      expect(result).toEqual(mockNotes);
    });

    it('propagates API errors', async () => {
      (apiClient.get as jest.Mock).mockRejectedValue(new Error('Network error'));
      await expect(tradeApi.listNotes('t1')).rejects.toThrow('Network error');
    });
  });

  describe('addNote', () => {
    it('posts a note to the trade', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({ data: {} });

      await tradeApi.addNote('t1', 'goods arrived');

      expect(apiClient.post).toHaveBeenCalledWith('/trades/t1/notes', { content: 'goods arrived' });
    });

    it('propagates API errors', async () => {
      (apiClient.post as jest.Mock).mockRejectedValue(new Error('Unauthorized'));
      await expect(tradeApi.addNote('t1', 'note')).rejects.toThrow('Unauthorized');
    });
  });
});
