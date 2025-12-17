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

const SERVICES = ['All', 'Netflix', 'HBO Max', 'Disney+', 'Prime Video', 'Hulu', 'Paramount+', 'Apple TV+', 'USA TV'];

export default function DiscoverScreen() {
  const router = useRouter();
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons, addons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedService, setSelectedService] = useState('All');

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
    await fetchDiscover();
    setRefreshing(false);
  }, []);

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    router.push(`/details/${item.type}/${id}`);
  };

  const filteredServices = useMemo(() => {
    if (!discoverData?.services) return {};
    if (selectedService === 'All') return discoverData.services;
    return { [selectedService]: discoverData.services[selectedService] };
  }, [discoverData, selectedService]);

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
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.logo}
            contentFit="contain"
          />
        </View>
        <Pressable 
          style={styles.searchButton}
          onPress={() => router.push('/(tabs)/search')}
        >
          <Ionicons name="search" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Service Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsContainer}
        contentContainerStyle={styles.tabsContent}
      >
        {SERVICES.map((service) => (
          <TouchableOpacity
            key={service}
            style={[
              styles.serviceTab,
              selectedService === service && styles.serviceTabActive,
            ]}
            onPress={() => setSelectedService(service)}
          >
            <Text
              style={[
                styles.serviceTabText,
                selectedService === service && styles.serviceTabTextActive,
              ]}
            >
              {service}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

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
        {/* Welcome Screen - No Addons */}
        {!hasContent && !isLoadingDiscover && (
          <View style={styles.welcomeState}>
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
              style={styles.installButton}
              onPress={() => router.push('/(tabs)/addons')}
            >
              <Ionicons name="extension-puzzle-outline" size={20} color="#FFFFFF" />
              <Text style={styles.installButtonText}>Go to Addons</Text>
            </TouchableOpacity>
          </View>
        )}

        {Object.entries(filteredServices).map(([serviceName, content]) => (
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
    paddingVertical: 8,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 48,
    height: 48,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabsContainer: {
    maxHeight: 44,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  tabsContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  serviceTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    marginRight: 8,
  },
  serviceTabActive: {
    backgroundColor: '#8B5CF6',
  },
  serviceTabText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '600',
  },
  serviceTabTextActive: {
    color: '#FFFFFF',
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
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 80,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#888888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  installButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
