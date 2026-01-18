import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  TouchableOpacity,
  Platform,
  Share,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { Addon, api } from '../../src/api/client';
import { Image } from 'expo-image';

export default function AddonsScreen() {
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  const { addons, isLoadingAddons, fetchAddons, fetchDiscover } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [deletingAddonId, setDeletingAddonId] = useState<string | null>(null);
  const [addButtonFocused, setAddButtonFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [installButtonFocused, setInstallButtonFocused] = useState(false);
  const [cancelButtonFocused, setCancelButtonFocused] = useState(false);

  useEffect(() => {
    fetchAddons(true);
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

  const AddonCard = ({ item }: { item: Addon }) => {
    const [cardFocused, setCardFocused] = useState(false);
    const [shareFocused, setShareFocused] = useState(false);
    const [deleteFocused, setDeleteFocused] = useState(false);

    if (!item || !item.manifest) {
      return null;
    }

    return (
      <View style={[
        styles.addonCard,
        cardFocused && styles.addonCardFocused,
      ]}>
        <TouchableOpacity
          style={styles.addonMainContent}
          onFocus={() => setCardFocused(true)}
          onBlur={() => setCardFocused(false)}
          activeOpacity={0.8}
        >
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
                size={isTV ? 32 : 28}
                color="#B8A05C"
              />
            )}
          </View>
          <View style={styles.addonInfo}>
            <Text style={[styles.addonName, isTV && styles.addonNameTV]}>{item.manifest.name || 'Unknown Addon'}</Text>
            <Text style={styles.addonVersion}>v{item.manifest.version || '?'}</Text>
            <Text style={[styles.addonDescription, isTV && styles.addonDescriptionTV]} numberOfLines={2}>
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
        </TouchableOpacity>
        <View style={styles.addonActions}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              shareFocused && styles.actionButtonFocused,
            ]}
            onPress={() => handleShareAddon(item)}
            onFocus={() => setShareFocused(true)}
            onBlur={() => setShareFocused(false)}
          >
            <Ionicons name="share-outline" size={isTV ? 22 : 20} color="#B8A05C" />
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[
              styles.actionButton,
              deleteFocused && styles.deleteButtonFocused,
            ]}
            onPress={() => handleUninstall(item)}
            onFocus={() => setDeleteFocused(true)}
            onBlur={() => setDeleteFocused(false)}
            disabled={deletingAddonId === item.id}
          >
            {deletingAddonId === item.id ? (
              <ActivityIndicator size="small" color="#FF4444" />
            ) : (
              <Ionicons name="trash-outline" size={isTV ? 22 : 20} color="#FF4444" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderAddon = ({ item }: { item: Addon }) => <AddonCard item={item} />;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Addons</Text>
        <TouchableOpacity
          style={[
            styles.addButton,
            addButtonFocused && styles.addButtonFocused,
          ]}
          onPress={() => setShowModal(true)}
          onFocus={() => setAddButtonFocused(true)}
          onBlur={() => setAddButtonFocused(false)}
        >
          <Ionicons name="add" size={isTV ? 26 : 24} color="#0c0c0c" />
        </TouchableOpacity>
      </View>

      {isLoadingAddons && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.loadingText}>Loading addons...</Text>
        </View>
      ) : addons.length === 0 ? (
        <EmptyState 
          onPress={() => setShowModal(true)} 
          isTV={isTV}
        />
      ) : (
        <FlatList
          data={addons}
          renderItem={renderAddon}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, isTV && styles.listContentTV]}
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
          <View style={[styles.modalContent, isTV && styles.modalContentTV]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, isTV && styles.modalTitleTV]}>Install Addon</Text>
              <TouchableOpacity 
                onPress={() => setShowModal(false)}
                style={[
                  styles.closeButton,
                  cancelButtonFocused && styles.closeButtonFocused,
                ]}
                onFocus={() => setCancelButtonFocused(true)}
                onBlur={() => setCancelButtonFocused(false)}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalLabel}>Manifest URL</Text>
            <TextInput
              style={[
                styles.modalInput,
                inputFocused && styles.modalInputFocused,
              ]}
              placeholder="https://example.com/manifest.json"
              placeholderTextColor="#666"
              value={addonUrl}
              onChangeText={setAddonUrl}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={true}
              numberOfLines={3}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
            />
            
            <Text style={styles.modalHint}>
              Paste one or more addon manifest URLs (separate with semicolon or new line)
            </Text>
            
            <TouchableOpacity
              style={[
                styles.modalButton, 
                isInstalling && styles.modalButtonDisabled,
                installButtonFocused && styles.modalButtonFocused,
              ]}
              onPress={handleInstallAddon}
              onFocus={() => setInstallButtonFocused(true)}
              onBlur={() => setInstallButtonFocused(false)}
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

function EmptyState({ onPress, isTV }: { onPress: () => void; isTV: boolean }) {
  const [buttonFocused, setButtonFocused] = useState(false);
  
  return (
    <View style={styles.emptyContainer}>
      <Ionicons name="extension-puzzle-outline" size={isTV ? 72 : 64} color="#666" />
      <Text style={[styles.emptyTitle, isTV && styles.emptyTitleTV]}>No Addons Installed</Text>
      <Text style={[styles.emptySubtitle, isTV && styles.emptySubtitleTV]}>
        Tap the + button to add Stremio addons
      </Text>
      <TouchableOpacity
        style={[
          styles.installButton,
          buttonFocused && styles.installButtonFocused,
        ]}
        onPress={onPress}
        onFocus={() => setButtonFocused(true)}
        onBlur={() => setButtonFocused(false)}
      >
        <Ionicons name="add-circle-outline" size={22} color="#0c0c0c" />
        <Text style={styles.installButtonText}>Install Addon</Text>
      </TouchableOpacity>
    </View>
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
  headerTV: {
    paddingHorizontal: 48,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerTitleTV: {
    fontSize: 32,
  },
  addButton: {
    backgroundColor: '#B8A05C',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  addButtonFocused: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.1 }],
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
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
  },
  emptyTitleTV: {
    fontSize: 28,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#999',
    textAlign: 'center',
    marginTop: 10,
  },
  emptySubtitleTV: {
    fontSize: 18,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B8A05C',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 28,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  installButtonFocused: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.05 }],
  },
  installButtonText: {
    color: '#0c0c0c',
    fontSize: 17,
    fontWeight: '600',
    marginLeft: 10,
  },
  listContent: {
    padding: 16,
  },
  listContentTV: {
    paddingHorizontal: 48,
  },
  addonCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  addonCardFocused: {
    borderColor: '#B8A05C',
    backgroundColor: '#242424',
  },
  addonMainContent: {
    flex: 1,
    flexDirection: 'row',
  },
  addonIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  addonLogo: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  addonInfo: {
    flex: 1,
  },
  addonName: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#fff',
  },
  addonNameTV: {
    fontSize: 20,
  },
  addonVersion: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  addonDescription: {
    fontSize: 13,
    color: '#999',
    marginTop: 6,
    lineHeight: 18,
  },
  addonDescriptionTV: {
    fontSize: 15,
  },
  addonTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  typeBadge: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginRight: 8,
    marginBottom: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    color: '#B8A05C',
    textTransform: 'capitalize',
    fontWeight: '500',
  },
  addonActions: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  actionButton: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  actionButtonFocused: {
    borderColor: '#B8A05C',
    backgroundColor: '#2a2a2a',
  },
  deleteButtonFocused: {
    borderColor: '#FF4444',
    backgroundColor: '#2a2a2a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 500,
  },
  modalContentTV: {
    maxWidth: 600,
    padding: 32,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalTitleTV: {
    fontSize: 26,
  },
  closeButton: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  closeButtonFocused: {
    borderColor: '#B8A05C',
  },
  modalLabel: {
    fontSize: 14,
    color: '#999',
    marginBottom: 10,
  },
  modalInput: {
    backgroundColor: '#2a2a2a',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    minHeight: 90,
    textAlignVertical: 'top',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modalInputFocused: {
    borderColor: '#B8A05C',
  },
  modalHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 10,
    marginBottom: 24,
  },
  modalButton: {
    backgroundColor: '#B8A05C',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonFocused: {
    borderColor: '#FFFFFF',
  },
  modalButtonText: {
    color: '#0c0c0c',
    fontSize: 17,
    fontWeight: '600',
  },
});