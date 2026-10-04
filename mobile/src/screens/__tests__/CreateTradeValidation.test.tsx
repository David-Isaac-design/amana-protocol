/**
 * Table-driven validation tests for CreateTradeScreen (issue #89).
 * Ensures mobile rejects the same inputs as the web wizard.
 */

// Import the validation functions directly — they are module-level functions
// in CreateTradeScreen. We re-export them via the validation module for
// testability, or test them through the component's reject/accept behaviour.

import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CreateTradeScreen from '../CreateTradeScreen';

jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../stores/tradeStore', () => ({
  useTradeStore: () => ({ createTrade: jest.fn() }),
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();

const mockNavigation = {
  navigate: mockNavigate,
  goBack: mockGoBack,
  replace: mockReplace,
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
} as any;

const mockRoute = { key: 'CreateTrade', name: 'CreateTrade', params: undefined } as any;

function renderScreen() {
  return render(<CreateTradeScreen navigation={mockNavigation} route={mockRoute} />);
}

describe('Step 1 validation', () => {
  const validStellarKey = 'GBDT6FOHFRHVJYECWJVYFJX3W43YV5BFBXBZV6HE4BBXWHIZM7VNBWF';

  interface Case {
    label: string;
    commodity?: string;
    quantity?: string;
    price?: string;
    address?: string;
    expectError: string;
  }

  const cases: Case[] = [
    { label: 'rejects empty commodity', quantity: '100', price: '50', address: validStellarKey, expectError: 'Select a commodity' },
    { label: 'rejects zero quantity', commodity: 'Maize', quantity: '0', price: '50', address: validStellarKey, expectError: 'Quantity must be greater than 0' },
    { label: 'rejects negative quantity', commodity: 'Maize', quantity: '-5', price: '50', address: validStellarKey, expectError: 'Quantity must be greater than 0' },
    { label: 'rejects zero price', commodity: 'Maize', quantity: '100', price: '0', address: validStellarKey, expectError: 'Price must be greater than 0' },
    { label: 'rejects invalid stellar address', commodity: 'Maize', quantity: '100', price: '50', address: 'notakey', expectError: 'Invalid Stellar public key' },
  ];

  test.each(cases)('$label', async ({ commodity, quantity, price, address, expectError }) => {
    const { getByText, getByPlaceholderText, queryByText } = renderScreen();

    // Select commodity if provided
    if (commodity) {
      fireEvent.press(getByText(commodity));
    }
    if (quantity !== undefined) {
      fireEvent.changeText(getByPlaceholderText('e.g. 500'), quantity);
    }
    if (price !== undefined) {
      fireEvent.changeText(getByPlaceholderText('e.g. 450'), price);
    }
    if (address !== undefined) {
      fireEvent.changeText(getByPlaceholderText('G...'), address);
    }

    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(queryByText(expectError)).toBeTruthy();
    });
  });

  test('accepts valid step 1 data and advances to step 2', async () => {
    const { getByText, getByPlaceholderText, queryByText } = renderScreen();

    fireEvent.press(getByText('Maize'));
    fireEvent.changeText(getByPlaceholderText('e.g. 500'), '100');
    fireEvent.changeText(getByPlaceholderText('e.g. 450'), '200');
    fireEvent.changeText(getByPlaceholderText('G...'), validStellarKey);
    fireEvent.press(getByText('Continue'));

    await waitFor(() => {
      expect(queryByText('Step 2: Negotiation')).toBeTruthy();
    });
  });
});

describe('Step 2 validation', () => {
  const validStellarKey = 'GBDT6FOHFRHVJYECWJVYFJX3W43YV5BFBXBZV6HE4BBXWHIZM7VNBWF';

  async function advanceToStep2(utils: ReturnType<typeof render>) {
    const { getByText, getByPlaceholderText } = utils;
    fireEvent.press(getByText('Maize'));
    fireEvent.changeText(getByPlaceholderText('e.g. 500'), '100');
    fireEvent.changeText(getByPlaceholderText('e.g. 450'), '200');
    fireEvent.changeText(getByPlaceholderText('G...'), validStellarKey);
    fireEvent.press(getByText('Continue'));
    await waitFor(() => getByText('Step 2: Negotiation'));
  }

  test('rejects delivery days = 0', async () => {
    const utils = renderScreen();
    await advanceToStep2(utils);
    fireEvent.changeText(utils.getByPlaceholderText('7'), '0');
    fireEvent.press(utils.getByText('Review'));
    await waitFor(() => {
      expect(utils.queryByText('Delivery window must be between 1 and 90 days')).toBeTruthy();
    });
  });

  test('rejects delivery days > 90', async () => {
    const utils = renderScreen();
    await advanceToStep2(utils);
    fireEvent.changeText(utils.getByPlaceholderText('7'), '91');
    fireEvent.press(utils.getByText('Review'));
    await waitFor(() => {
      expect(utils.queryByText('Delivery window must be between 1 and 90 days')).toBeTruthy();
    });
  });

  test('accepts delivery days = 90 and advances to review', async () => {
    const utils = renderScreen();
    await advanceToStep2(utils);
    fireEvent.changeText(utils.getByPlaceholderText('7'), '90');
    fireEvent.press(utils.getByText('Review'));
    await waitFor(() => {
      expect(utils.queryByText('Step 3: Review & Submit')).toBeTruthy();
    });
  });
});
