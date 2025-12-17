import React, { useEffect, useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { ServiceRow } from '../../src/components/ServiceRow';
import { ContentItem } from '../../src/api/client';

export default function DiscoverScreen() {
  const router = useRouter();
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons, addons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAddons();
    fetchDiscover();
  }, []);

  // Check if there's any content to display
  const hasContent = useMemo(() => {
    if (!discoverData?.services) return false;
    return Object.values(discoverData.services).some(
      (content: any) => 
        (content?.movies?.length > 0) || 
        (content?.series?.length > 0) || 
        (content?.channels?.length > 0)
    );
  }, [discoverData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAddons();
    await fetchDiscover();
    setRefreshing(false);
  }, []);

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    router.push(`/details/${item.type}/${id}`);
  };

  // Show loading only on initial load
  if (isLoadingDiscover && !discoverData) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/logo_launcher.png')}
          style={styles.headerLogo}
          contentFit="contain"
        />
        <Text style={styles.headerTitle}>Privastream Cinema</Text>
        <Pressable 
          style={styles.searchButton}
          onPress={() => router.push('/(tabs)/search')}
        >
          <Ionicons name="search" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Welcome Screen - No Addons */}
      {!hasContent && !isLoadingDiscover ? (
        <View style={styles.welcomeContainer}>
          <Text style={styles.welcomeText}>Welcome To</Text>
          <Image
            source={require('../../assets/images/logo_splash.png')}
            style={styles.welcomeLogo}
            contentFit="contain"
          />
          <Text style={styles.welcomeSubtext}>
            Go to the Addons tab to get started
          </Text>
          <TouchableOpacity 
            style={styles.goToAddonsButton}
            onPress={() => router.push('/(tabs)/addons')}
          >
            <Ionicons name="extension-puzzle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.goToAddonsText}>Go to Addons</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* Content ScrollView */
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
          {Object.entries(discoverData?.services || {}).map(([serviceName, content]) => (
            <View key={serviceName}>
              {content?.movies && content.movies.length > 0 && (
                <ServiceRow
                  serviceName={`${serviceName} Movies`}
                  items={content.movies}
                  onItemPress={handleItemPress}
                />
              )}
              {content?.series && content.series.length > 0 && (
                <ServiceRow
                  serviceName={`${serviceName} Series`}
                  items={content.series}
                  onItemPress={handleItemPress}
                />
              )}
              {/* USA TV Channels */}
              {content?.channels && content.channels.length > 0 && (
                <ServiceRow
                  serviceName={`${serviceName} Channels`}
                  items={content.channels.map((ch: any) => ({
                    ...ch,
                    type: 'tv' as const,
                  }))}
                  onItemPress={handleItemPress}
                />
              )}
            </View>
          ))}
          <View style={styles.bottomPadding} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  logoContainer: {
    flex: 1,
  },
  logo: {
    width: 140,
    height: 36,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  bottomPadding: {
    height: 100,
  },
  // Welcome Screen Styles
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  welcomeText: {
    color: '#888888',
    fontSize: 20,
    fontWeight: '500',
    marginBottom: 12,
  },
  welcomeLogo: {
    width: 300,
    height: 130,
    marginBottom: 40,
  },
  welcomeSubtext: {
    color: '#666666',
    fontSize: 17,
    textAlign: 'center',
    lineHeight: 26,
    marginBottom: 32,
  },
  goToAddonsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  goToAddonsText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});
