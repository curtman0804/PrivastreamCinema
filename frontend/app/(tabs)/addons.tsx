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
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { Addon, api } from '../../src/api/client';
import { Image } from 'expo-image';

export default function AddonsScreen() {
  const { addons, isLoadingAddons, fetchAddons, fetchDiscover } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [deletingAddonId, setDeletingAddonId] = useState<string | null>(null);

  useEffect(() => {
    fetchAddons(true); // Force refresh on mount
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAddons(true);
    setRefreshing(false);
  }, []);

  const handleInstallAddon = async () => {
    if (!addonUrl.trim()) {
      Alert.alert('Error', 'Please enter a manifest URL');
      return;
    }

    const urls = addonUrl
      .split(/[;\n]/)
      .map(url => url.trim())
      .filter(url => url.length > 0);
    
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
    await fetchAddons(true);
    
    if (successCount > 0) {
      await fetchDiscover(true);
    }

    if (successCount > 0 && failedUrls.length === 0) {
      Alert.alert('Success', `${successCount} addon(s) installed successfully.`);
    } else if (successCount > 0 && failedUrls.length > 0) {
      Alert.alert('Partial Success', `${successCount} installed, ${failedUrls.length} failed`);
    } else {
      Alert.alert('Error', 'Failed to install addon(s)');
    }
  };

  const handleShareAddon = async (addon: Addon) => {
    const addonUrl = (addon as any).manifestUrl || addon.url || '';
    const addonName = addon.manifest?.name || 'Addon';
    
    if (!addonUrl) {
      Alert.alert('No URL', 'This addon does not have a shareable URL.');
      return;
    }
    
    try {
      await Share.share({
        message: `Check out this Stremio addon: ${addonName}\n\n${addonUrl}`,
        title: `Share ${addonName} Addon`,
      });
    } catch (error) {
      console.log('Share error:', error);
    }
  };
  
  const handleUninstall = async (addon: Addon) => {
    if (deletingAddonId) return;
    
    Alert.alert(
      'Uninstall Addon',
      `Are you sure you want to uninstall ${addon.manifest?.name || 'this addon'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Uninstall', 
          style: 'destructive', 
          onPress: async () => {
            setDeletingAddonId(addon.id);
            try {
              await api.addons.uninstall(addon.id);
              await fetchAddons(true);
              await fetchDiscover(true);
              Alert.alert('Success', 'Addon has been uninstalled');
            } catch (error: any) {
              Alert.alert('Error', 'Failed to uninstall addon');
            } finally {
              setDeletingAddonId(null);
            }
          }
        },
      ]
    );
  };

  const getAddonIcon = (types?: string[]) => {
    if (!types) return 'extension-puzzle-outline';
    if (types.includes('movie')) return 'film-outline';
    if (types.includes('series')) return 'tv-outline';
    if (types.includes('tv')) return 'radio-outline';
    return 'extension-puzzle-outline';
  };

  const renderAddon = ({ item }: { item: Addon }) => {
    // Safety check for malformed addon data
    if (!item || !item.manifest) {
      return null;
    }
    
    return (
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
              color="#B8A05C"
            />
          )}
        </View>
        <View style={styles.addonInfo}>
          <Text style={styles.addonName}>{item.manifest.name || 'Unknown Addon'}</Text>
          <Text style={styles.addonVersion}>v{item.manifest.version || '?'}</Text>
          <Text style={styles.addonDescription} numberOfLines={2}>
            {item.manifest.description || 'No description'}
          </Text>
          <View style={styles.addonTypes}>
            {(item.manifest.types || []).map((type, index) => (
              <View key={index} style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{type}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.addonActions}>
          <Pressable
            style={styles.shareButton}
            onPress={() => handleShareAddon(item)}
          >
            <Ionicons name="share-outline" size={22} color="#B8A05C" />
          </Pressable>
          
          <Pressable
            style={styles.deleteButton}
            onPress={() => handleUninstall(item)}
            disabled={deletingAddonId === item.id}
          >
            {deletingAddonId === item.id ? (
              <ActivityIndicator size="small" color="#FF4444" />
            ) : (
              <Ionicons name="trash-outline" size={22} color="#FF4444" />
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Addons</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowModal(true)}
        >
          <Ionicons name="add" size={24} color="#0c0c0c" />
        </TouchableOpacity>
      </View>

      {isLoadingAddons && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.loadingText}>Loading addons...</Text>
        </View>
      ) : addons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="extension-puzzle-outline" size={64} color="#666" />
          <Text style={styles.emptyTitle}>No Addons Installed</Text>
          <Text style={styles.emptySubtitle}>
            Tap the + button to add Stremio addons
          </Text>
          <TouchableOpacity
            style={styles.installButton}
            onPress={() => setShowModal(true)}
          >
            <Ionicons name="add-circle-outline" size={20} color="#0c0c0c" />
            <Text style={styles.installButtonText}>Install Addon</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={addons}
          renderItem={renderAddon}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#B8A05C"
              colors={['#B8A05C']}
            />
          }
        />
      )}

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
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalLabel}>Manifest URL</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="https://example.com/manifest.json"
              placeholderTextColor="#666"
              value={addonUrl}
              onChangeText={setAddonUrl}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={true}
              numberOfLines={3}
            />
            
            <Text style={styles.modalHint}>
              Paste one or more addon manifest URLs (separate with semicolon or new line)
            </Text>
            
            <TouchableOpacity
              style={[styles.modalButton, isInstalling && styles.modalButtonDisabled]}
              onPress={handleInstallAddon}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <ActivityIndicator size="small" color="#0c0c0c" />
              ) : (
                <Text style={styles.modalButtonText}>Install</Text>
              )}
            </TouchableOpacity>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  addButton: {
    backgroundColor: '#B8A05C',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#999',
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B8A05C',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  installButtonText: {
    color: '#0c0c0c',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
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
    borderRadius: 8,
  },
  addonInfo: {
    flex: 1,
  },
  addonName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  addonVersion: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  addonDescription: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  addonTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  typeBadge: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    color: '#B8A05C',
    textTransform: 'capitalize',
  },
  addonActions: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  shareButton: {
    padding: 8,
  },
  deleteButton: {
    padding: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
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
    fontWeight: 'bold',
    color: '#fff',
  },
  modalLabel: {
    fontSize: 14,
    color: '#999',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    marginBottom: 20,
  },
  modalButton: {
    backgroundColor: '#B8A05C',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonText: {
    color: '#0c0c0c',
    fontSize: 16,
    fontWeight: '600',
  },
});
