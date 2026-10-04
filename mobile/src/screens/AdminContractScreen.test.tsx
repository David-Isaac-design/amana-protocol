import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import AdminContractScreen from './AdminContractScreen';
import { useAuthStore } from '../stores/authStore';
import { adminApi } from '../api/admin';
import { AdminApiError } from '../api/errors';
import { SigningError, submitAndConfirm } from '../services/adminSigning';
const mockSubmit = submitAndConfirm as jest.Mock;

jest.mock('../stores/authStore', () => ({
  useAuthStore: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/adminSigning', () => ({
  ...jest.requireActual('../services/adminSigning'),
  submitAndConfirm: jest.fn(),
}));

jest.mock('../api/admin', () => ({
  adminApi: {
    addMediator: jest.fn(),
    removeMediator: jest.fn(),
    updateContractFeeBps: jest.fn(),
  },
}));

const mockAddMediator = adminApi.addMediator as jest.MockedFunction<
  typeof adminApi.addMediator
>;
const mockUpdateFee = adminApi.updateContractFeeBps as jest.MockedFunction<
  typeof adminApi.updateContractFeeBps
>;

const STELLAR_PUBKEY = 'G'.padEnd(56, 'A');

describe('AdminContractScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as jest.Mock).mockReturnValue({
      role: 'admin',
      clearAuth: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('shows an access message for non-admin users', () => {
    (useAuthStore as jest.Mock).mockReturnValue({ role: 'user' });
    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByText } = render(
      <AdminContractScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );
    expect(getByText('Admin access required')).toBeTruthy();
  });

  it('surfaces the add-mediator unsignedXdr after a successful call', async () => {
    mockAddMediator.mockResolvedValue({
      unsignedXdr: 'XDR_ADD_MEDIATOR',
    });

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(
      <AdminContractScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    fireEvent.changeText(
      getByTestId('admin-contract-add-input'),
      STELLAR_PUBKEY,
    );
    await act(async () => {
      fireEvent.press(getByTestId('admin-contract-add'));
    });

    expect(mockAddMediator).toHaveBeenCalledWith(STELLAR_PUBKEY);
    expect(await findByTestId('admin-contract-add-xdr')).toBeTruthy();
  });

  it('shows a banner and recovers when the fee update throws VALIDATION_ERROR', async () => {
    mockUpdateFee.mockRejectedValueOnce(
      new AdminApiError({
        code: 'VALIDATION_ERROR',
        message: 'feeBps out of range',
        status: 400,
      }),
    );

    const navigation = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(
      <AdminContractScreen
        navigation={navigation as any}
        route={{} as any}
      />,
    );

    fireEvent.changeText(getByTestId('admin-contract-fee-input'), '500');
    await act(async () => {
      fireEvent.press(getByTestId('admin-contract-fee'));
    });

    expect(await findByTestId('admin-error-banner')).toBeTruthy();
    await waitFor(() => expect(mockUpdateFee).toHaveBeenCalledWith(500));
  });

  describe.each([
    ['success', () => mockSubmit.mockResolvedValueOnce('hash'), 'Transaction confirmed.'],
    ['timeout', () => mockSubmit.mockRejectedValueOnce(new SigningError('timeout', 't')), 'Timed out waiting for confirmation. Check the network before retrying.'],
  ])('wallet signing %s path', (_n, arrange, text) => {
    it('submits signed XDR and shows the outcome', async () => {
      mockAddMediator.mockResolvedValue({ unsignedXdr: 'XDR' });
      arrange();
      const nav = { goBack: jest.fn(), navigate: jest.fn() };
      const { getByTestId, findByTestId } = render(
        <AdminContractScreen navigation={nav as any} route={{} as any} />,
      );
      fireEvent.changeText(getByTestId('admin-contract-add-input'), STELLAR_PUBKEY);
      await act(async () => {
        fireEvent.press(getByTestId('admin-contract-add'));
      });
      fireEvent.changeText(await findByTestId('admin-contract-add-sign-signed-input'), 'SIGNED');
      await act(async () => {
        fireEvent.press(getByTestId('admin-contract-add-sign-submit'));
      });
      expect(mockSubmit).toHaveBeenCalledWith('SIGNED');
      expect((await findByTestId('admin-contract-add-sign-status')).props.children).toBe(text);
    });
  });

  it('does not submit when the wallet is rejected', async () => {
    mockAddMediator.mockResolvedValue({ unsignedXdr: 'XDR' });
    const nav = { goBack: jest.fn(), navigate: jest.fn() };
    const { getByTestId, findByTestId } = render(
      <AdminContractScreen navigation={nav as any} route={{} as any} />,
    );
    fireEvent.changeText(getByTestId('admin-contract-add-input'), STELLAR_PUBKEY);
    await act(async () => {
      fireEvent.press(getByTestId('admin-contract-add'));
    });
    fireEvent.press(await findByTestId('admin-contract-add-sign-reject'));
    expect((await findByTestId('admin-contract-add-sign-status')).props.children).toBe(
      'Signing rejected. Nothing was submitted.',
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
