import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import apiClient from '../api/client';
import EvidenceCaptureScreen from './EvidenceCaptureScreen';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../api/client', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const post = apiClient.post as jest.Mock;

function renderScreen() {
  return render(
    <EvidenceCaptureScreen
      navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never}
      route={{ params: { tradeId: 'trade-123456789012' } } as never}
    />,
  );
}

describe('EvidenceCaptureScreen uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Simulate Capture')?.onPress?.();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows upload percentage and aborts the request when cancelled', async () => {
    let rejectUpload!: (error: Error) => void;
    post.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUpload = reject;
      }),
    );

    const screen = renderScreen();
    fireEvent.press(screen.getByText('Tap to record'));
    fireEvent.press(screen.getByText('☁️ Upload Video'));

    const requestConfig = post.mock.calls[0][2];
    expect(requestConfig.signal.aborted).toBe(false);
    act(() => requestConfig.onUploadProgress({ loaded: 25, total: 100 }));
    expect(screen.getByText('25% uploaded')).toBeTruthy();
    expect(
      screen.getByLabelText('Evidence upload progress').props.accessibilityValue,
    ).toEqual({ min: 0, max: 100, now: 25 });

    fireEvent.press(screen.getByLabelText('Cancel evidence upload'));
    expect(requestConfig.signal.aborted).toBe(true);
    expect(screen.getByText('Ready to upload')).toBeTruthy();

    await act(async () => {
      rejectUpload(new Error('Request canceled'));
      await Promise.resolve();
    });
    expect(screen.queryByText(/Upload failed:/)).toBeNull();
  });

  it('shows a clear connection message when the upload fails without details', async () => {
    post.mockRejectedValue(new Error('Network Error'));

    const screen = renderScreen();
    fireEvent.press(screen.getByText('Tap to record'));
    fireEvent.press(screen.getByText('☁️ Upload Video'));

    expect(
      await screen.findByText(
        "Upload failed: We couldn't upload your evidence. Check your connection and try again.",
      ),
    ).toBeTruthy();
  });
});
