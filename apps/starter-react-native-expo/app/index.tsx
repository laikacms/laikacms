import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchPosts, type PostSummary } from './api';

export default function HomeScreen() {
  const [posts, setPosts] = useState<PostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPosts()
      .then(setPosts)
      .catch(e => setError(String(e)));
  }, []);

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.error}>Couldn't reach the API: {error}</Text>
        <Text style={styles.hint}>
          Set EXPO_PUBLIC_API_BASE to a reachable URL (LAN IP, ngrok, deployed Workers URL).
        </Text>
      </SafeAreaView>
    );
  }

  if (!posts) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (posts.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <Text>No posts yet — add one in the admin UI.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={posts}
        keyExtractor={p => p.key}
        renderItem={({ item }) => (
          <Link href={`/posts/${item.slug}`} style={styles.row}>
            <Text style={styles.title}>{item.title ?? item.slug}</Text>
          </Link>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  title: { fontSize: 17, color: '#0070f3' },
  error: { color: '#c00', marginBottom: 12 },
  hint: { color: '#666' },
});
