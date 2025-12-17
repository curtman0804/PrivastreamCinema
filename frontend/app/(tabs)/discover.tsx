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
  const { discoverData, isLoadingDiscover, fetchDiscover, fetchAddons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedService, setSelectedService] = useState('All');

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
});
