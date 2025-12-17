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
  Modal,
  TextInput,
  Pressable,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { Addon, api } from '../../src/api/client';
import { Image } from 'expo-image';

// Recommended addons for users to install - paste these URLs
const RECOMMENDED_ADDON_URLS = `https://v3-cinemeta.strem.io/manifest.json;
https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/bmZ4LGRucCxhbXAsaGJtLGhsdSxwbXAsYXRwLHBjcCxkcGU6OnVzOjE3MzgxODc4Mzk1Njk%3D/manifest.json;
https://848b3516657c-usatv.baby-beamup.club/manifest.json;
https://thepiratebay-plus.strem.fun/manifest.json;
https://torrentio.strem.fun/manifest.json`;

// Quick install addons
const RECOMMENDED_ADDONS = [
  {
    name: 'Cinemeta',
    description: 'Movie & series metadata (Required)',
    url: 'https://v3-cinemeta.strem.io/manifest.json',
  },
  {
    name: 'Streaming Catalogs',
    description: 'Netflix, HBO, Disney+, Prime, Hulu & more',
    url: 'https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/bmZ4LGRucCxhbXAsaGJtLGhsdSxwbXAsYXRwLHBjcCxkcGU6OnVzOjE3MzgxODc4Mzk1Njk%3D/manifest.json',
  },
  {
    name: 'USA TV',
    description: 'Live USA TV channels',
    url: 'https://848b3516657c-usatv.baby-beamup.club/manifest.json',
  },
  {
    name: 'ThePirateBay+',
    description: 'Torrent streams from ThePirateBay',
    url: 'https://thepiratebay-plus.strem.fun/manifest.json',
  },
  {
    name: 'Torrentio',
    description: 'Multi-source torrent streams',
    url: 'https://torrentio.strem.fun/manifest.json',
  },
];

// No more manual addons needed
const MANUAL_ADDONS: any[] = [];

export default function AddonsScreen() {
  const { addons, isLoadingAddons, fetchAddons } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    fetchAddons();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAddons();
    setRefreshing(false);
  }, []);

  const handleInstallAddon = async () => {
    if (!addonUrl.trim()) {
      Alert.alert('Error', 'Please enter a manifest URL');
      return;
    }

    // Support multiple URLs separated by semicolon
    const urls = addonUrl.split(';').map(url => url.trim()).filter(url => url.length > 0);
    
    setIsInstalling(true);
    let successCount = 0;
    let failedUrls: string[] = [];

    for (const url of urls) {
      try {
        await api.addons.install(url);
        successCount++;
      } catch (error: any) {
        failedUrls.push(error.response?.data?.detail || url);
      }
    }

    setIsInstalling(false);
    setAddonUrl('');
    setShowModal(false);
    await fetchAddons();

    if (successCount > 0 && failedUrls.length === 0) {
      Alert.alert('Success', `${successCount} addon(s) installed successfully`);
    } else if (successCount > 0 && failedUrls.length > 0) {
      Alert.alert('Partial Success', `${successCount} installed, ${failedUrls.length} failed:\n${failedUrls.join('\n')}`);
    } else {
      Alert.alert('Error', `Failed to install:\n${failedUrls.join('\n')}`);
    }
  };

  const handleQuickInstall = async (url: string, name: string) => {
    setIsInstalling(true);
    try {
      await api.addons.install(url);
      await fetchAddons();
      Alert.alert('Success', `${name} installed successfully`);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || `Failed to install ${name}`);
    } finally {
      setIsInstalling(false);
    }
  };

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

  const isAddonInstalled = (manifestId: string) => {
    return addons.some(a => 
      a.manifest?.id === manifestId || 
      a.manifestUrl?.includes(manifestId.split('.')[0])
    );
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

  const renderRecommended = ({ item }: { item: typeof RECOMMENDED_ADDONS[0] }) => {
    const installed = addons.some(a => a.manifestUrl === item.url);
    
    return (
      <View style={styles.recommendedCard}>
        <View style={styles.recommendedInfo}>
          <Text style={styles.recommendedName}>{item.name}</Text>
          <Text style={styles.recommendedDesc} numberOfLines={2}>{item.description}</Text>
        </View>
        <TouchableOpacity
          style={[styles.installButton, installed && styles.installedButton]}
          onPress={() => !installed && handleQuickInstall(item.url, item.name)}
          disabled={installed || isInstalling}
        >
          {installed ? (
            <Ionicons name="checkmark" size={20} color="#8B5CF6" />
          ) : isInstalling ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="add" size={20} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>
    );
  };

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
        <TouchableOpacity style={styles.addButton} onPress={() => setShowModal(true)}>
          <Ionicons name="add-circle" size={28} color="#8B5CF6" />
        </TouchableOpacity>
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimer}>
        <Ionicons name="warning" size={16} color="#F59E0B" />
        <Text style={styles.disclaimerText}>
          Third-party addons may access content with legal implications. Use responsibly.
        </Text>
      </View>

      <FlatList
        data={[]}
        renderItem={() => null}
        ListHeaderComponent={
          <>
            {/* Recommended Addons */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quick Install</Text>
              <FlatList
                data={RECOMMENDED_ADDONS}
                renderItem={renderRecommended}
                keyExtractor={(item) => item.url}
                scrollEnabled={false}
              />
            </View>

            {/* Install All Button */}
            <View style={styles.section}>
              <TouchableOpacity
                style={styles.installAllButton}
                onPress={() => {
                  setAddonUrl(RECOMMENDED_ADDON_URLS);
                  setShowModal(true);
                }}
              >
                <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                <Text style={styles.installAllText}>Install All Recommended Addons</Text>
              </TouchableOpacity>
            </View>

            {/* Installed Addons */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                Installed ({addons.length})
              </Text>
            </View>
          </>
        }
        ListFooterComponent={
          addons.length > 0 ? (
            <FlatList
              data={addons}
              renderItem={renderAddon}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              contentContainerStyle={styles.installedList}
            />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="extension-puzzle-outline" size={48} color="#444444" />
              <Text style={styles.emptyText}>No addons installed</Text>
              <Text style={styles.emptySubtext}>Install addons above to access streams</Text>
            </View>
          )
        }
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

      {/* Install Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Install Addon</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Addon Manifest URL(s)</Text>
            <TextInput
              style={styles.input}
              placeholder="https://example.com/manifest.json"
              placeholderTextColor="#666666"
              value={addonUrl}
              onChangeText={setAddonUrl}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />

            <Text style={styles.hint}>
              Separate multiple URLs with a semicolon (;)
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                isInstalling && styles.submitButtonDisabled,
                pressed && { opacity: 0.8 }
              ]}
              onPress={handleInstallAddon}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitButtonText}>Install Addon(s)</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
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
  addButton: {
    padding: 4,
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  disclaimerText: {
    flex: 1,
    marginLeft: 8,
    color: '#F59E0B',
    fontSize: 12,
    lineHeight: 16,
  },
  section: {
    paddingHorizontal: 16,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#888888',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 12,
    marginTop: -8,
  },
  manualCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  configLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  configLinkText: {
    color: '#8B5CF6',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  installAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 8,
  },
  installAllText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  recommendedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  recommendedInfo: {
    flex: 1,
  },
  recommendedName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  recommendedDesc: {
    fontSize: 13,
    color: '#888888',
    marginTop: 4,
  },
  installButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  installedButton: {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
  },
  emptySubtext: {
    color: '#888888',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  installedList: {
    paddingHorizontal: 16,
    paddingBottom: 24,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#FFFFFF',
    minHeight: 50,
  },
  hint: {
    fontSize: 12,
    color: '#8B5CF6',
    marginTop: 8,
    marginBottom: 20,
  },
  submitButton: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
