import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Linking, Pressable } from 'react-native';
import * as Notifications from 'expo-notifications';
import { HELP_URL } from '../constants/support';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function HomeScreen() {
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log('Notification received:', response);
      }
    );

    return () => subscription.remove();
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Amana Mobile</Text>
        <Text style={styles.subtitle}>Trust as a Service for Agricultural Products</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Getting Started</Text>
        <Text style={styles.text}>
          This is your Amana mobile application. Connect your Stellar wallet to begin trading securely.
        </Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>About & Help</Text>
        <Text style={styles.text}>Questions about fees, disputes or cNGN? Read the FAQ or contact support.</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open Help and FAQ"
          onPress={() => Linking.openURL(HELP_URL)}
          style={styles.link}
          testID="help-faq-link"
        >
          <Text style={styles.linkText}>Help & FAQ</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  header: {
    marginBottom: 40,
    marginTop: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  content: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  text: {
    fontSize: 14,
    color: '#555',
    lineHeight: 22,
  },
  link: {
    marginTop: 12,
    paddingVertical: 8,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#b8860b',
  },
});
