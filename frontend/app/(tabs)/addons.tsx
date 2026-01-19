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
  Pressable,
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
  const { addons, isLoadingAddons, fetchAddons, fetchDiscover } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [deletingAddonId, setDeletingAddonId] = useState<string | null>(null);
  const [addButtonFocused, setAddButtonFocused] = useState(false);
  const [installButtonFocused, setInstallButtonFocused] = useState(false);
  const [modalInstallFocused, setModalInstallFocused] = useState(false);
  const [modalCloseFocused, setModalCloseFocused] = useState(false);
  
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

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

  const renderAddon = ({ item }: { item: Addon }) => {
    if (!item || !item.manifest) {
      return null;
    }
    
    return (
      <AddonCard 
        addon={item}
        isTV={isTV}
        onShare={() => handleShareAddon(item)}
        onUninstall={() => handleUninstall(item)}
        isDeleting={deletingAddonId === item.id}
        getAddonIcon={getAddonIcon}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Addons</Text>
        <Pressable
          style={({ focused }) => [
            styles.addButton,
            isTV && styles.addButtonTV,
            (focused || addButtonFocused) && styles.buttonFocused,
          ]}
          onPress={() => setShowModal(true)}
          onFocus={() => setAddButtonFocused(true)}
          onBlur={() => setAddButtonFocused(false)}
        >
          <Ionicons name="add" size={isTV ? 28 : 24} color="#0c0c0c" />
        </Pressable>
      </View>

      {isLoadingAddons && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
          <Text style={styles.loadingText}>Loading addons...</Text>
        </View>
      ) : addons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="extension-puzzle-outline" size={isTV ? 80 : 64} color="#666" />
          <Text style={[styles.emptyTitle, isTV && styles.emptyTitleTV]}>No Addons Installed</Text>
          <Text style={[styles.emptySubtitle, isTV && styles.emptySubtitleTV]}>
            Tap the + button to add Stremio addons
          </Text>
          <Pressable
            style={({ focused }) => [
              styles.installButton,
              isTV && styles.installButtonTV,
              (focused || installButtonFocused) && styles.buttonFocused,
            ]}
            onPress={() => setShowModal(true)}
            onFocus={() => setInstallButtonFocused(true)}
            onBlur={() => setInstallButtonFocused(false)}
          >
            <Ionicons name="add-circle-outline" size={isTV ? 24 : 20} color="#0c0c0c" />
            <Text style={[styles.installButtonText, isTV && styles.installButtonTextTV]}>Install Addon</Text>
          </Pressable>
        </View>
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
              <Pressable 
                onPress={() => setShowModal(false)}
                onFocus={() => setModalCloseFocused(true)}
                onBlur={() => setModalCloseFocused(false)}
                style={({ focused }) => [
                  styles.modalCloseButton,
                  (focused || modalCloseFocused) && styles.smallButtonFocused,
                ]}
              >
                <Ionicons name="close" size={24} color="#fff" />
              </Pressable>
            </View>
            
            <Text style={styles.modalLabel}>Manifest URL</Text>
            <TextInput
              style={[styles.modalInput, isTV && styles.modalInputTV]}
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
            
            <Pressable
              style={({ focused }) => [
                styles.modalButton,
                isTV && styles.modalButtonTV,
                isInstalling && styles.modalButtonDisabled,
                (focused || modalInstallFocused) && styles.buttonFocused,
              ]}
              onPress={handleInstallAddon}
              onFocus={() => setModalInstallFocused(true)}
              onBlur={() => setModalInstallFocused(false)}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <ActivityIndicator size="small" color="#0c0c0c" />
              ) : (
                <Text style={[styles.modalButtonText, isTV && styles.modalButtonTextTV]}>Install</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Separate component for addon card with focus support
function AddonCard({ 
  addon, 
  isTV, 
  onShare, 
  onUninstall, 
  isDeleting,
  getAddonIcon,
}: {
  addon: Addon;
  isTV: boolean;
  onShare: () => void;
  onUninstall: () => void;
  isDeleting: boolean;
  getAddonIcon: (types?: string[]) => string;
}) {
  const [cardFocused, setCardFocused] = useState(false);
  const [shareFocused, setShareFocused] = useState(false);
  const [deleteFocused, setDeleteFocused] = useState(false);

  return (
    <View style={[
      styles.addonCard,
      isTV && styles.addonCardTV,
      cardFocused && styles.addonCardFocused,
    ]}>
      <View style={[styles.addonIconContainer, isTV && styles.addonIconContainerTV]}>
        {addon.manifest.logo ? (
          <Image
            source={{ uri: addon.manifest.logo }}
            style={[styles.addonLogo, isTV && styles.addonLogoTV]}
            contentFit="contain"
          />
        ) : (
          <Ionicons
            name={getAddonIcon(addon.manifest.types) as any}
            size={isTV ? 36 : 32}
            color="#B8A05C"
          />
        )}
      </View>
      <View style={styles.addonInfo}>
        <Text style={[styles.addonName, isTV && styles.addonNameTV]}>{addon.manifest.name || 'Unknown Addon'}</Text>
        <Text style={[styles.addonVersion, isTV && styles.addonVersionTV]}>v{addon.manifest.version || '?'}</Text>
        <Text style={[styles.addonDescription, isTV && styles.addonDescriptionTV]} numberOfLines={2}>
          {addon.manifest.description || 'No description'}
        </Text>
        <View style={styles.addonTypes}>
          {(addon.manifest.types || []).map((type, index) => (
            <View key={index} style={[styles.typeBadge, isTV && styles.typeBadgeTV]}>
              <Text style={[styles.typeBadgeText, isTV && styles.typeBadgeTextTV]}>{type}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.addonActions}>
        <Pressable
          style={({ focused }) => [
            styles.actionButton,
            isTV && styles.actionButtonTV,
            (focused || shareFocused) && styles.actionButtonFocused,
          ]}
          onPress={onShare}
          onFocus={() => setShareFocused(true)}
          onBlur={() => setShareFocused(false)}
        >
          <Ionicons name="share-outline" size={isTV ? 24 : 20} color="#B8A05C" />
        </Pressable>
        
        <Pressable
          style={({ focused }) => [
            styles.actionButton,
            isTV && styles.actionButtonTV,
            (focused || deleteFocused) && styles.deleteButtonFocused,
          ]}
          onPress={onUninstall}
          onFocus={() => setDeleteFocused(true)}
          onBlur={() => setDeleteFocused(false)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#FF4444" />
          ) : (
            <Ionicons name="trash-outline" size={isTV ? 24 : 20} color="#FF4444" />
          )}
        </Pressable>
      </View>
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
    paddingHorizontal: 32,
    paddingVertical: 20,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  addButtonTV: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  buttonFocused: {
    borderColor: '#FFD700',
    transform: [{ scale: 1.1 }],
  },
  smallButtonFocused: {
    borderWidth: 2,
    borderColor: '#FFD700',
    borderRadius: 8,
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
  emptyTitleTV: {
    fontSize: 26,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
  emptySubtitleTV: {
    fontSize: 18,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#B8A05C',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  installButtonTV: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 12,
  },
  installButtonText: {
    color: '#0c0c0c',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  installButtonTextTV: {
    fontSize: 18,
  },
  listContent: {
    padding: 16,
  },
  listContentTV: {
    padding: 24,
  },
  addonCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  addonCardTV: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 16,
  },
  addonCardFocused: {
    borderColor: '#FFD700',
  },
  addonIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addonIconContainerTV: {
    width: 60,
    height: 60,
    borderRadius: 14,
    marginRight: 16,
  },
  addonLogo: {
    width: 36,
    height: 36,
    borderRadius: 6,
  },
  addonLogoTV: {
    width: 44,
    height: 44,
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
  addonNameTV: {
    fontSize: 18,
  },
  addonVersion: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  addonVersionTV: {
    fontSize: 14,
  },
  addonDescription: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  addonDescriptionTV: {
    fontSize: 14,
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
  typeBadgeTV: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  typeBadgeText: {
    fontSize: 11,
    color: '#B8A05C',
    textTransform: 'capitalize',
  },
  typeBadgeTextTV: {
    fontSize: 12,
  },
  addonActions: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  actionButtonTV: {
    padding: 12,
    borderRadius: 10,
  },
  actionButtonFocused: {
    borderColor: '#FFD700',
    backgroundColor: 'rgba(184, 160, 92, 0.2)',
  },
  deleteButtonFocused: {
    borderColor: '#FFD700',
    backgroundColor: 'rgba(255, 68, 68, 0.2)',
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
  modalContentTV: {
    marginHorizontal: 100,
    marginBottom: 50,
    borderRadius: 20,
    padding: 32,
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
  modalTitleTV: {
    fontSize: 24,
  },
  modalCloseButton: {
    padding: 4,
    borderRadius: 8,
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
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modalInputTV: {
    fontSize: 16,
    padding: 16,
    minHeight: 100,
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
    borderWidth: 3,
    borderColor: 'transparent',
  },
  modalButtonTV: {
    padding: 18,
    borderRadius: 12,
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonText: {
    color: '#0c0c0c',
    fontSize: 16,
    fontWeight: '600',
  },
  modalButtonTextTV: {
    fontSize: 18,
  },
});
