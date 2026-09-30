import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import apiClient from '../api/client';
import { useAuthStore } from '../stores/authStore';

type Props = StackScreenProps<RootStackParamList, 'EvidenceCapture'>;

type MediaType = 'video' | 'photo';
type UploadState = 'idle' | 'captured' | 'uploading' | 'done' | 'error';

interface CapturedMedia {
  type: MediaType;
  uri: string;
  name: string;
}

export default function EvidenceCaptureScreen({ route, navigation }: Props) {
  const { tradeId } = route.params;
  const insets = useSafeAreaInsets();
  const { token } = useAuthStore();

  const [selectedType, setSelectedType] = useState<MediaType>('video');
  const [captured, setCaptured] = useState<CapturedMedia | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadController = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      uploadController.current?.abort();
    },
    [],
  );

  // In a production build this would call expo-image-picker or expo-camera.
  // Those packages are not yet installed; this placeholder simulates the capture step.
  const handleCapture = () => {
    Alert.alert(
      selectedType === 'video' ? 'Record Video' : 'Take Photo',
      'In a production build this opens the device camera. For now, a placeholder file is used.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Simulate Capture',
          onPress: () => {
            const ext = selectedType === 'video' ? 'mp4' : 'jpg';
            setCaptured({
              type: selectedType,
              uri: `file://simulated-evidence-${Date.now()}.${ext}`,
              name: `evidence-${tradeId}-${Date.now()}.${ext}`,
            });
            setUploadState('captured');
          },
        },
      ]
    );
  };

  const handleUpload = async () => {
    if (!captured) return;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploadState('uploading');
    setUploadError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      // React Native FormData accepts { uri, name, type } objects
      formData.append('file', {
        uri: captured.uri,
        name: captured.name,
        type: captured.type === 'video' ? 'video/mp4' : 'image/jpeg',
      } as unknown as Blob);
      formData.append('tradeId', tradeId);
      formData.append('mediaType', captured.type);

      const uploadOptions = {
        signal: controller.signal,
        onUploadProgress: (event: { loaded: number; total?: number }) => {
          if (typeof event.total !== 'number' || event.total <= 0) return;
          setUploadProgress(
            Math.min(100, Math.round((event.loaded / event.total) * 100)),
          );
        },
      };
      await apiClient.post(`/trades/${tradeId}/evidence`, formData, {
        ...uploadOptions,
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (controller.signal.aborted) return;
      uploadController.current = null;
      setUploadState('done');
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      uploadController.current = null;
      const msg =
        err instanceof Error && err.message && err.message !== 'Network Error'
          ? err.message
          : "We couldn't upload your evidence. Check your connection and try again.";
      setUploadError(msg);
      setUploadState('error');
    }
  };

  const handleCancelUpload = () => {
    uploadController.current?.abort();
    uploadController.current = null;
    setUploadProgress(0);
    setUploadError(null);
    setUploadState('captured');
  };

  const handleReset = () => {
    uploadController.current?.abort();
    uploadController.current = null;
    setCaptured(null);
    setUploadState('idle');
    setUploadError(null);
    setUploadProgress(0);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Upload Evidence</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.tradeRef}>Trade: #{tradeId.slice(0, 12)}…</Text>

        {/* Success state */}
        {uploadState === 'done' ? (
          <View style={styles.successCard}>
            <Text style={styles.successIcon}>✅</Text>
            <Text style={styles.successTitle}>Evidence Uploaded</Text>
            <Text style={styles.successBody}>
              Your {captured?.type} has been submitted. A mediator will review it shortly.
            </Text>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => navigation.navigate('TradeDetail', { tradeId })}
            >
              <Text style={styles.doneBtnText}>Back to Trade</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Media type selector */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Evidence Type</Text>
              <View style={styles.typeRow}>
                {(['video', 'photo'] as MediaType[]).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeBtn, selectedType === t && styles.typeBtnActive]}
                    onPress={
                      uploadState === 'uploading'
                        ? undefined
                        : () => {
                            setSelectedType(t);
                            handleReset();
                          }
                    }
                    disabled={uploadState === 'uploading'}
                  >
                    <Text style={styles.typeIcon}>{t === 'video' ? '🎥' : '📷'}</Text>
                    <Text style={[styles.typeLabel, selectedType === t && styles.typeLabelActive]}>
                      {t === 'video' ? 'Video' : 'Photo'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Capture area */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {selectedType === 'video' ? 'Record Delivery Video' : 'Take Delivery Photo'}
              </Text>
              <Text style={styles.hint}>
                {selectedType === 'video'
                  ? 'Record a video showing the goods and their condition. The driver should be present.'
                  : 'Take a clear photo of the goods showing any damage or discrepancy.'}
              </Text>

              {/* Capture preview / placeholder */}
              <TouchableOpacity
                style={[styles.captureArea, captured && styles.captureAreaDone]}
                onPress={uploadState === 'idle' || uploadState === 'error' ? handleCapture : undefined}
                activeOpacity={0.8}
              >
                {captured ? (
                  <View style={styles.capturedPreview}>
                    <Text style={styles.capturedIcon}>{selectedType === 'video' ? '🎬' : '🖼️'}</Text>
                    <Text style={styles.capturedName}>{captured.name}</Text>
                    <Text style={styles.capturedReady}>Ready to upload</Text>
                  </View>
                ) : (
                  <View style={styles.capturePlaceholder}>
                    <Text style={styles.captureIcon}>{selectedType === 'video' ? '🎥' : '📷'}</Text>
                    <Text style={styles.captureLabel}>
                      Tap to {selectedType === 'video' ? 'record' : 'capture'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              {captured && uploadState !== 'uploading' && (
                <TouchableOpacity style={styles.retakeBtn} onPress={handleReset}>
                  <Text style={styles.retakeBtnText}>↩ Retake</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Error */}
            {uploadState === 'error' && uploadError && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>Upload failed: {uploadError}</Text>
              </View>
            )}

            {/* Upload button */}
            {captured && uploadState === 'uploading' && (
              <View style={styles.uploadProgressSection}>
                <View
                  style={styles.progressTrack}
                  accessibilityRole="progressbar"
                  accessibilityLabel="Evidence upload progress"
                  accessibilityValue={{ min: 0, max: 100, now: uploadProgress }}
                >
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${uploadProgress}%` },
                    ]}
                  />
                </View>
                <Text style={styles.progressText}>{uploadProgress}% uploaded</Text>
                <TouchableOpacity
                  style={styles.cancelUploadBtn}
                  onPress={handleCancelUpload}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel evidence upload"
                >
                  <Text style={styles.cancelUploadBtnText}>Cancel upload</Text>
                </TouchableOpacity>
              </View>
            )}

            {captured && uploadState !== 'uploading' && (
              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={handleUpload}
              >
                <Text style={styles.uploadBtnText}>
                  ☁️ Upload {selectedType === 'video' ? 'Video' : 'Photo'}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f4f0' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e8e0',
  },
  backText: { fontSize: 14, color: '#2d6a2d', fontWeight: '500', width: 60 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1a3a1a' },
  content: { padding: 16, gap: 16 },
  tradeRef: { fontSize: 12, color: '#888', fontFamily: 'monospace' },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1a3a1a' },
  hint: { fontSize: 13, color: '#666', lineHeight: 20 },
  typeRow: { flexDirection: 'row', gap: 12 },
  typeBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e0e8e0',
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  typeBtnActive: { borderColor: '#2d6a2d', backgroundColor: '#f0f8f0' },
  typeIcon: { fontSize: 28 },
  typeLabel: { fontSize: 14, fontWeight: '600', color: '#888' },
  typeLabelActive: { color: '#2d6a2d' },
  captureArea: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#d0d8d0',
    borderStyle: 'dashed',
    minHeight: 160,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8faf8',
  },
  captureAreaDone: { borderColor: '#2d6a2d', borderStyle: 'solid', backgroundColor: '#f0f8f0' },
  capturePlaceholder: { alignItems: 'center', gap: 8 },
  captureIcon: { fontSize: 48 },
  captureLabel: { fontSize: 14, color: '#888' },
  capturedPreview: { alignItems: 'center', gap: 6, padding: 16 },
  capturedIcon: { fontSize: 40 },
  capturedName: { fontSize: 12, color: '#555', fontFamily: 'monospace' },
  capturedReady: { fontSize: 13, color: '#2d6a2d', fontWeight: '600' },
  retakeBtn: { alignSelf: 'center' },
  retakeBtnText: { color: '#888', fontSize: 13 },
  errorBanner: { backgroundColor: '#FEE2E2', padding: 12, borderRadius: 8 },
  errorText: { color: '#DC2626', fontSize: 13, lineHeight: 19 },
  uploadBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  uploadBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  uploadProgressSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#e0e8e0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#2d6a2d',
  },
  progressText: { color: '#1a3a1a', fontSize: 14, fontWeight: '600' },
  cancelUploadBtn: {
    borderWidth: 1,
    borderColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  cancelUploadBtnText: { color: '#DC2626', fontSize: 14, fontWeight: '600' },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  successIcon: { fontSize: 56 },
  successTitle: { fontSize: 22, fontWeight: '700', color: '#1a3a1a' },
  successBody: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 22 },
  doneBtn: {
    backgroundColor: '#2d6a2d',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  doneBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
