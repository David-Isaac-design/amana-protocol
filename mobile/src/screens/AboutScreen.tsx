import { View, Text, TouchableOpacity, StyleSheet, Linking, ScrollView, useColorScheme } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { StackScreenProps } from '@react-navigation/stack';
import type { RootStackParamList } from '../types/navigation';
import { SUPPORT_EMAIL } from '../constants/support';
import { getTheme } from '../constants/theme';

type Props = StackScreenProps<RootStackParamList, 'About'>;

export default function AboutScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const theme = getTheme(scheme);

  const version = Constants.expoConfig?.version ?? Constants.manifest?.version ?? 'unknown';
  const buildNumber =
    (Constants.expoConfig?.ios?.buildNumber ??
      Constants.expoConfig?.android?.versionCode?.toString() ??
      Constants.manifest?.ios?.buildNumber ??
      'N/A') as string;
  const network =
    (Constants.expoConfig?.extra?.STELLAR_NETWORK ??
      Constants.manifest?.extra?.STELLAR_NETWORK ??
      'unknown') as string;
  const apiBaseUrl =
    (Constants.expoConfig?.extra?.API_BASE_URL ??
      Constants.manifest?.extra?.API_BASE_URL ??
      'unknown') as string;

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backBtn, { color: theme.primary }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>About</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
          <InfoRow label="App Version" value={version} theme={theme} />
          <InfoRow label="Build Number" value={buildNumber} theme={theme} />
          <InfoRow label="Network" value={network} theme={theme} />
          <InfoRow label="API Base URL" value={apiBaseUrl} theme={theme} mono last />
        </View>

        <TouchableOpacity
          style={[styles.supportBtn, { backgroundColor: theme.primary }]}
          onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          accessibilityRole="link"
          accessibilityLabel="Contact support"
        >
          <Text style={[styles.supportBtnText, { color: theme.primaryText }]}>Contact Support</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function InfoRow({
  label,
  value,
  mono,
  last,
  theme,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
      <Text style={[styles.label, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.textPrimary }, mono && styles.mono]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { fontSize: 14, fontWeight: '500' },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 16, gap: 16 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  label: { fontSize: 14, flex: 1 },
  value: { fontSize: 14, fontWeight: '600', flex: 1.5, textAlign: 'right' },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  supportBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  supportBtnText: { fontSize: 15, fontWeight: '600' },
});
