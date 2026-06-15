// v237 — paginated grid screen, dynamic columns by orientation/device
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, useWindowDimensions, ActivityIndicator, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function SeeAllScreen() {
  const { catalogId, type, name } = useLocalSearchParams<{ catalogId: string; type: string; name?: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const isLandscape = width > height;
  const cols = isTablet ? (isLandscape ? 7 : 5) : (isLandscape ? 6 : 3);
  const cellWidth = (width - 32 - (cols - 1) * 8) / cols;
  const cellHeight = cellWidth * 1.5;

  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const fetchPage = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    try {
      const tok = ''; // assume cookie auth handled elsewhere; fallback to global
      const r = await fetch(`${BACKEND}/api/catalog/${type}/${catalogId}?offset=${page * 30}&limit=30`);
      if (r.ok) {
        const d = await r.json();
        const newItems = (d.metas || d.items || []) as any[];
        if (newItems.length === 0) setDone(true);
        else { setItems((prev) => [...prev, ...newItems]); setPage((p) => p + 1); }
      }
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [catalogId, type, page, loading, done]);

  useEffect(() => { fetchPage(); }, []);

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={{ width: cellWidth, height: cellHeight, marginRight: 8, marginBottom: 12 }}
      onPress={() => router.push({ pathname: `/details/${type}/${item.id}` as any, params: { name: item.name } })}
    >
      {item.poster ? (
        <Image source={{ uri: item.poster }} style={{ width: '100%', height: '100%', borderRadius: 6, backgroundColor: '#222' }} />
      ) : (
        <View style={{ flex: 1, backgroundColor: '#222', borderRadius: 6, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#888', fontSize: 10, textAlign: 'center', padding: 8 }}>{item.name}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingHorizontal: 16, paddingTop: 12 }}>
      <Stack.Screen options={{ title: name || catalogId || 'See All', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff' }} />
      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        numColumns={cols}
        estimatedItemSize={cellHeight + 12}
        onEndReached={fetchPage}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loading ? <ActivityIndicator color="#fff" style={{ marginVertical: 20 }} /> : null}
      />
    </View>
  );
}
