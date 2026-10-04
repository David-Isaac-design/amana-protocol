import * as SecureStore from 'expo-secure-store';

import { readTokenWithMigration } from './authStore';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const get = SecureStore.getItemAsync as jest.Mock;
const set = SecureStore.setItemAsync as jest.Mock;
const del = SecureStore.deleteItemAsync as jest.Mock;

describe('readTokenWithMigration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('migrates the legacy key to the new key', async () => {
    get.mockImplementation(async (k: string) =>
      k === 'amana_token' ? 'tok' : null,
    );
    await expect(readTokenWithMigration()).resolves.toBe('tok');
    expect(set).toHaveBeenCalledWith('innov8_token', 'tok');
    expect(del).toHaveBeenCalledWith('amana_token');
  });

  it('uses the new key without touching the legacy one', async () => {
    get.mockResolvedValue('new');
    await expect(readTokenWithMigration()).resolves.toBe('new');
    expect(set).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('returns null when neither key exists', async () => {
    get.mockResolvedValue(null);
    await expect(readTokenWithMigration()).resolves.toBeNull();
  });
});
