import React, { useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useContentStore } from '../../src/store/contentStore';
import { ServiceRow } from '../../src/components/ServiceRow';
import { ContentItem } from '../../src/api/client';

export default function DiscoverScreen() {
  const router = useRouter();
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons } = useContentStore();
  const [refreshing, setRefreshing] = React.useState(false);

  useEffect(() => {
    fetchDiscover();
    fetchAddons();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDiscover();
    setRefreshing(false);
  }, []);

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    router.push(`/details/${item.type}/${id}`);
  };

  if (isLoadingDiscover && !discoverData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
          <Text style={styles.loadingText}>Loading content...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.logoContainer}>
          <Ionicons name="tv" size={28} color="#8B5CF6" />
          <Text style={styles.headerTitle}>PrivastreamCinema</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#8B5CF6"
            colors={['#8B5CF6']}
          />
        }
      >
        {discoverData?.services && Object.entries(discoverData.services).map(([serviceName, content]) => (
          <View key={serviceName}>
            {content.movies && content.movies.length > 0 && (
              <ServiceRow
                serviceName={`${serviceName} Movies`}
                items={content.movies}
                onItemPress={handleItemPress}
              />
            )}
            {content.series && content.series.length > 0 && (
              <ServiceRow
                serviceName={`${serviceName} Series`}
                items={content.series}
                onItemPress={handleItemPress}
              />
            )}
          </View>
        ))}
        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginLeft: 10,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    marginTop: 12,
    fontSize: 16,
  },
  bottomPadding: {
    height: 20,
  },
});
