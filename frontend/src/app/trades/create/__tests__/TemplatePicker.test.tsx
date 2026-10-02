import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Step1Details from '../steps/Step1Details';
import { TradeProvider } from '../TradeContext';
import type { TradeTemplate } from '@/lib/tradeTemplates';

// Mock @stellar/stellar-sdk
jest.mock('@stellar/stellar-sdk', () => ({
  StrKey: {
    isValidEd25519PublicKey: jest.fn((address: string) => {
      return (address.startsWith('G') || address.startsWith('M')) && address.length >= 40;
    }),
  },
}));

// Mock tradeTemplates module
const mockLoadTemplates = jest.fn<TradeTemplate[], []>();
jest.mock('@/lib/tradeTemplates', () => ({
  loadTemplates: (...args: Parameters<typeof mockLoadTemplates>) => mockLoadTemplates(...args),
  saveTemplate: jest.fn(),
  deleteTemplate: jest.fn(),
}));

const sampleTemplates: TradeTemplate[] = [
  {
    id: 'tpl-001',
    name: 'Maize 500kg',
    savedAt: '2026-01-01T00:00:00.000Z',
    data: {
      commodity: 'Maize',
      quantity: '500',
      unit: 'kg',
      pricePerUnit: '450',
      currency: 'NGN',
    },
  },
  {
    id: 'tpl-002',
    name: 'Rice 100 bags',
    savedAt: '2026-01-02T00:00:00.000Z',
    data: {
      commodity: 'Rice',
      quantity: '100',
      unit: 'bags (50kg)',
      pricePerUnit: '800',
      currency: 'NGN',
    },
  },
];

const renderWithProvider = () =>
  render(
    <TradeProvider>
      <Step1Details />
    </TradeProvider>
  );

describe('TemplatePicker', () => {
  beforeEach(() => {
    mockLoadTemplates.mockReset();
  });

  it('renders template picker when templates exist', () => {
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    const picker = screen.getByTestId('template-picker');
    expect(picker).toBeInTheDocument();
  });

  it('is hidden when no templates exist', () => {
    mockLoadTemplates.mockReturnValue([]);
    renderWithProvider();

    expect(screen.queryByTestId('template-picker')).not.toBeInTheDocument();
  });

  it('shows all template names as options', () => {
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    const picker = screen.getByTestId('template-picker');
    const options = Array.from(picker.querySelectorAll('option')).map((o) => o.textContent);
    expect(options).toContain('Maize 500kg');
    expect(options).toContain('Rice 100 bags');
  });

  it('shows placeholder option as default', () => {
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    const picker = screen.getByTestId('template-picker') as HTMLSelectElement;
    expect(picker.value).toBe('');
  });

  it('selecting a template prefills commodity field', async () => {
    const user = userEvent.setup();
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    const picker = screen.getByTestId('template-picker');
    await user.selectOptions(picker, 'tpl-001');

    const commoditySelect = screen.getByLabelText(/commodity/i);
    expect(commoditySelect).toHaveValue('Maize');
  });

  it('selecting a template prefills quantity field', async () => {
    const user = userEvent.setup();
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    const picker = screen.getByTestId('template-picker');
    await user.selectOptions(picker, 'tpl-001');

    const quantityInput = screen.getByLabelText(/quantity/i);
    expect(quantityInput).toHaveValue(500);
  });

  it('resets select to placeholder after selecting a template', async () => {
    const user = userEvent.setup();
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    const picker = screen.getByTestId('template-picker') as HTMLSelectElement;
    await user.selectOptions(picker, 'tpl-001');

    expect(picker.value).toBe('');
  });

  it('renders a label for the template picker', () => {
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    expect(screen.getByText(/start from template/i)).toBeInTheDocument();
  });

  it('renders helper note text', () => {
    mockLoadTemplates.mockReturnValue(sampleTemplates);
    renderWithProvider();

    expect(
      screen.getByText(/selecting a template prefills the form/i)
    ).toBeInTheDocument();
  });
});
