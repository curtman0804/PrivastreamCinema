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
import { colors } from '../../src/styles/colors';

export default function AddonsScreen() {
  const { addons, isLoadingAddons, fetchAddons, fetchDiscover } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [deletingAddonId, setDeletingAddonId] = useState<string | null>(null);
  
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
    
    Alert.alert(
      `Share ${addonName}`,
      `${addonUrl}`,
      [
        { text: 'Copy & Share', onPress: async () => {
          try {
            await Share.share({
              message: `Check out this Stremio addon: ${addonName}\n\n${addonUrl}`,
              title: `Share ${addonName} Addon`,
            });
          } catch (error) {
            console.log('Share error:', error);
          }
        }},
        { text: 'OK', style: 'cancel' },
      ]
    );
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
    if (!item || !item.manifest) return null;
    
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
          style={({ focused }) => [styles.addButton, focused && styles.addButtonFocused]}
          onPress={() => setShowModal(true)}
        >
          <Ionicons name="add" size={24} color={colors.textPrimary} />
        </Pressable>
      </View>

      {isLoadingAddons && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading addons...</Text>
        </View>
      ) : addons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="extension-puzzle-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Addons Installed</Text>
          <Text style={styles.emptySubtitle}>Add Stremio addons to start streaming</Text>
          <Pressable
            style={({ focused }) => [styles.installButton, focused && styles.installButtonFocused]}
            onPress={() => setShowModal(true)}
          >
            <Ionicons name="add-circle-outline" size={20} color={colors.textPrimary} />
            <Text style={styles.installButtonText}>Install Addon</Text>
          </Pressable>
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
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}

      {/* Install Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isTV && styles.modalContentTV]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Install Addon</Text>
              <Pressable onPress={() => setShowModal(false)} style={styles.modalClose}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            
            <Text style={styles.modalLabel}>Manifest URL</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="https://example.com/manifest.json"
              placeholderTextColor={colors.textMuted}
              value={addonUrl}
              onChangeText={setAddonUrl}
              autoCapitalize="none"
              autoCorrect={false}
              multiline={true}
              numberOfLines={3}
            />
            
            <Text style={styles.modalHint}>
              Paste addon manifest URLs (separate with semicolon or new line)
            </Text>
            
            <Pressable
              style={({ focused }) => [
                styles.modalButton,
                isInstalling && styles.modalButtonDisabled,
                focused && styles.modalButtonFocused,
              ]}
              onPress={handleInstallAddon}
              disabled={isInstalling}
            >
              {isInstalling ? (
                <ActivityIndicator size="small" color={colors.textPrimary} />
              ) : (
                <Text style={styles.modalButtonText}>Install</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Addon Card Component
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

  return (
    <View
      style={styles.addonCard}
    >
      <View style={styles.addonIconContainer}>
        {addon.manifest.logo ? (
          <Image
            source={{ uri: addon.manifest.logo }}
            style={styles.addonLogo}
            contentFit="contain"
          />
        ) : (
          <Ionicons
            name={getAddonIcon(addon.manifest.types) as any}
            size={28}
            color={colors.primary}
          />
        )}
      </View>
      <View style={styles.addonInfo}>
        <Text style={styles.addonName}>{addon.manifest.name || 'Unknown Addon'}</Text>
        <Text style={styles.addonVersion}>v{addon.manifest.version || '?'}</Text>
        <Text style={styles.addonDescription} numberOfLines={2}>
          {addon.manifest.description || 'No description'}
        </Text>
        <View style={styles.addonTypes}>
          {(addon.manifest.types || []).map((type, index) => (
            <View key={index} style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{type}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.addonActions}>
        <Pressable 
          style={({ focused }) => [styles.actionButton, focused && styles.actionButtonFocused]} 
          onPress={onShare}
        >
          <Ionicons name="share-outline" size={20} color={colors.textSecondary} />
        </Pressable>
        <Pressable 
          style={({ focused }) => [styles.actionButton, focused && styles.actionButtonDeleteFocused]} 
          onPress={onUninstall} 
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Ionicons name="trash-outline" size={20} color={colors.error} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTV: {
    paddingHorizontal: 32,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.primary,
  },
  headerTitleTV: {
    fontSize: 28,
  },
  addButton: {
    backgroundColor: colors.primary,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: colors.primary,
  },
  addButtonFocused: {
    borderColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: colors.primaryDark,
    fontSize: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.primaryDark,
    textAlign: 'center',
    marginTop: 8,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 24,
    gap: 8,
  },
  installButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },
  installButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  listContent: {
    padding: 16,
  },
  addonCard: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundLight,
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  addonCardFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  addonIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  addonLogo: {
    width: 32,
    height: 32,
    borderRadius: 4,
  },
  addonInfo: {
    flex: 1,
  },
  addonName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  addonVersion: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  addonDescription: {
    fontSize: 13,
    color: colors.primaryDark,
    marginTop: 4,
  },
  addonTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    gap: 6,
  },
  typeBadge: {
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 11,
    color: colors.primary,
    textTransform: 'capitalize',
  },
  addonActions: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    padding: 8,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 8,
  },
  actionButtonFocused: {
    borderColor: colors.primary,
  },
  actionButtonDeleteFocused: {
    borderColor: colors.error,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.backgroundLight,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 24,
    paddingBottom: 40,
  },
  modalContentTV: {
    marginHorizontal: 100,
    marginBottom: 50,
    borderRadius: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.primary,
  },
  modalClose: {
    padding: 4,
  },
  modalLabel: {
    fontSize: 14,
    color: colors.primaryDark,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    color: colors.primary,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: 20,
  },
  modalButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonFocused: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },
  modalButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
});
