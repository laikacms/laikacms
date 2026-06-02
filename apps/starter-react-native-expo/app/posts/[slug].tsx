import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchPost, type Post } from '../api';

export default function PostScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null | undefined>(undefined);

  useEffect(() => {
    if (!slug) return;
    fetchPost(slug).then(setPost);
  }, [slug]);

  if (post === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (post === null) {
    return (
      <SafeAreaView style={styles.container}>
        <Text>Post not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{post.title}</Text>
        {post.date ? <Text style={styles.date}>{new Date(post.date).toLocaleDateString()}</Text> : null}
        <Text style={styles.body}>{post.body}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { padding: 16 },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 4 },
  date: { color: '#666', marginBottom: 16 },
  body: { fontSize: 16, lineHeight: 24 },
});
