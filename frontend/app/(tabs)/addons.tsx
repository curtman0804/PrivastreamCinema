import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { Addon, api } from '../../src/api/client';
import { Image } from 'expo-image';

export default function AddonsScreen() {
  const { addons, isLoadingAddons, fetchAddons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchAddons();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAddons();
    setRefreshing(false);
  }, []);

  const handleUninstall = async (addon: Addon) => {
    Alert.alert(
      'Uninstall Addon',
      `Are you sure you want to uninstall ${addon.manifest.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Uninstall',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.addons.uninstall(addon.id);
              await fetchAddons();
            } catch (error) {
              Alert.alert('Error', 'Failed to uninstall addon');
            }
          },
        },
      ]
    );
  };

  const getAddonIcon = (types: string[]) => {
    if (types.includes('movie')) return 'film-outline';
    if (types.includes('series')) return 'tv-outline';
    if (types.includes('tv')) return 'radio-outline';
    return 'extension-puzzle-outline';
  };

  const renderAddon = ({ item }: { item: Addon }) => (
    <View style={styles.addonCard}>
      <View style={styles.addonIconContainer}>
        {item.manifest.logo ? (
          <Image
            source={{ uri: item.manifest.logo }}
            style={styles.addonLogo}
            contentFit="contain"
          />
        ) : (
          <Ionicons
            name={getAddonIcon(item.manifest.types) as any}
            size={32}
            color="#8B5CF6"
          />
        )}
      </View>
      <View style={styles.addonInfo}>
        <Text style={styles.addonName}>{item.manifest.name}</Text>
        <Text style={styles.addonVersion}>v{item.manifest.version}</Text>
        <Text style={styles.addonDescription} numberOfLines={2}>
          {item.manifest.description}
        </Text>
        <View style={styles.addonTypes}>
          {item.manifest.types.map((type, index) => (
            <View key={index} style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{type}</Text>
            </View>
          ))}
        </View>
      </View>
      <TouchableOpacity
        style={styles.uninstallButton}
        onPress={() => handleUninstall(item)}
      >
        <Ionicons name="trash-outline" size={20} color="#FF4444" />
      </TouchableOpacity>
    </View>
  );

  if (isLoadingAddons && addons.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Addons</Text>
        <Text style={styles.addonCount}>{addons.length} installed</Text>
      </View>

      {addons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="extension-puzzle-outline" size={64} color="#444444" />
          <Text style={styles.emptyText}>No addons installed</Text>
          <Text style={styles.emptySubtext}>Install addons to access more content</Text>
        </View>
      ) : (
        <FlatList
          data={addons}
          renderItem={renderAddon}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#8B5CF6"
              colors={['#8B5CF6']}
            />
          }
        />
      )}
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
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  addonCount: {
    fontSize: 14,
    color: '#888888',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#888888',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
  },
  addonCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  addonIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addonLogo: {
    width: 40,
    height: 40,
  },
  addonInfo: {
    flex: 1,
  },
  addonName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  addonVersion: {
    fontSize: 12,
    color: '#888888',
    marginTop: 2,
  },
  addonDescription: {
    fontSize: 13,
    color: '#AAAAAA',
    marginTop: 4,
    lineHeight: 18,
  },
  addonTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    gap: 6,
  },
  typeBadge: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    color: '#8B5CF6',
    fontWeight: '600',
  },
  uninstallButton: {
    padding: 8,
    marginLeft: 8,
  },
});
