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

// Reusable TV-friendly focus button
function FocusButton({ 
  onPress, 
  children, 
  disabled, 
  style, 
  focusedStyle,
}: { 
  onPress: () => void; 
  children: React.ReactNode; 
  disabled?: boolean;
  style?: any;
  focusedStyle?: any;
}) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <Pressable
      style={[
        style || { padding: 4, borderWidth: 3, borderColor: 'transparent', borderRadius: 8 },
        isFocused && (focusedStyle || { borderColor: colors.primary }),
      ]}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
      disabled={disabled}
    >
      {children}
    </Pressable>
  );
}

export default function AddonsScreen() {
  const { addons, isLoadingAddons, fetchAddons, fetchDiscover } = useContentStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [addonUrl, setAddonUrl] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [isResolvingCode, setIsResolvingCode] = useState(false);
  const [inputMode, setInputMode] = useState<'url' | 'code'>('code');
  const [deletingAddonId, setDeletingAddonId] = useState<string | null>(null);
  const [addBtnFocused, setAddBtnFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [urlTabFocused, setUrlTabFocused] = useState(false);
  const [codeTabFocused, setCodeTabFocused] = useState(false);
  
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

  const handleResolveAndInstall = async () => {
    const code = shortCode.trim();
    if (!code) {
      Alert.alert('Error', 'Please enter a Downloader code');
      return;
    }

    setIsResolvingCode(true);
    try {
      const response = await api.addons.resolveCode(code);
      const resolvedUrl = response.url;
      setIsResolvingCode(false);
      
      // Now install with the resolved URL
      setIsInstalling(true);
      try {
        await api.addons.install(resolvedUrl);
        setShowModal(false);
        setShortCode('');
        await fetchAddons(true);
        fetchDiscover(true);
        Alert.alert('Success', 'Addon installed!');
      } catch (error: any) {
        const msg = error?.response?.data?.detail || error.message || 'Failed to install addon';
        Alert.alert('Install Failed', msg);
      } finally {
        setIsInstalling(false);
      }
    } catch (error: any) {
      setIsResolvingCode(false);
      const msg = error?.response?.data?.detail || error.message || 'Failed to resolve code';
      Alert.alert('Invalid Code', msg);
    }
  };

  const handleInstallAddon = async () => {
    const urls = addonUrl.split(/[;\n]+/).map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      Alert.alert('Error', 'Please enter at least one manifest URL');
      return;
    }

    setIsInstalling(true);
    let successCount = 0;
    let failCount = 0;

    for (const url of urls) {
      try {
        await api.addons.install(url);
        successCount++;
      } catch (error: any) {
        console.log(`Failed to install ${url}:`, error?.response?.data || error.message);
        failCount++;
      }
    }

    setIsInstalling(false);

    if (successCount > 0) {
      setShowModal(false);
      setAddonUrl('');
      await fetchAddons(true);
      fetchDiscover(true);
    }

    if (failCount > 0) {
      Alert.alert(
        'Installation Results',
        `${successCount} addon(s) installed successfully, ${failCount} failed.`
      );
    } else if (successCount > 0) {
      Alert.alert('Success', `${successCount} addon(s) installed!`);
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

  const handleUninstall = (addon: Addon) => {
    Alert.alert(
      'Uninstall Addon',
      `Remove "${addon.manifest?.name || 'addon'}"? This will remove all content from this addon.`,
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
              fetchDiscover(true);
            } catch (error: any) {
              Alert.alert('Error', error?.response?.data?.detail || 'Failed to uninstall addon');
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
      {/* Header */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Addons</Text>
        <Pressable
          style={[styles.addButton, addBtnFocused && styles.addButtonFocused]}
          onFocus={() => setAddBtnFocused(true)}
          onBlur={() => setAddBtnFocused(false)}
          onPress={() => setShowModal(true)}
        >
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimer}>
        <Ionicons name="alert-circle" size={22} color={colors.primary} style={{ marginRight: 8, marginTop: 2 }} />
        <Text style={styles.disclaimerText}>
          This app enables third-party addons. All content is provided externally; the app developer assumes no responsibility for its legality, accuracy, or availability.
        </Text>
      </View>

      {/* Addon List */}
      {isLoadingAddons && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading addons...</Text>
        </View>
      ) : addons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="extension-puzzle-outline" size={64} color={colors.primary} />
          <Text style={styles.emptyTitle}>No Addons Installed</Text>
          <Text style={styles.emptySubtitle}>Install addons to start streaming</Text>
          <FocusButton
            onPress={() => setShowModal(true)}
            style={styles.installButton}
            focusedStyle={styles.installButtonFocused}
          >
            <Ionicons name="extension-puzzle" size={20} color={colors.primary} />
            <Text style={styles.installButtonText}>Install Addon</Text>
          </FocusButton>
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
              <FocusButton onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </FocusButton>
            </View>

            {/* Tab switcher */}
            <View style={styles.tabRow}>
              <Pressable
                style={[
                  styles.tab,
                  inputMode === 'code' && styles.tabActive,
                  codeTabFocused && styles.tabFocused,
                ]}
                onFocus={() => setCodeTabFocused(true)}
                onBlur={() => setCodeTabFocused(false)}
                onPress={() => setInputMode('code')}
              >
                <Ionicons name="keypad-outline" size={18} color={inputMode === 'code' ? colors.primary : '#888888'} />
                <Text style={[styles.tabText, inputMode === 'code' && styles.tabTextActive]}>Downloader Code</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.tab,
                  inputMode === 'url' && styles.tabActive,
                  urlTabFocused && styles.tabFocused,
                ]}
                onFocus={() => setUrlTabFocused(true)}
                onBlur={() => setUrlTabFocused(false)}
                onPress={() => setInputMode('url')}
              >
                <Ionicons name="link-outline" size={18} color={inputMode === 'url' ? colors.primary : '#888888'} />
                <Text style={[styles.tabText, inputMode === 'url' && styles.tabTextActive]}>Manifest URL</Text>
              </Pressable>
            </View>

            {inputMode === 'code' ? (
              <>
                <Text style={styles.modalLabel}>Downloader Code</Text>
                <TextInput
                  style={[styles.modalInput, codeFocused && styles.modalInputFocused]}
                  placeholder="e.g. 970280"
                  placeholderTextColor="#666666"
                  value={shortCode}
                  onChangeText={setShortCode}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="number-pad"
                />
                <Text style={styles.modalHint}>
                  Enter the code from AFTVnews Downloader link shortener
                </Text>
                <FocusButton 
                  onPress={handleResolveAndInstall} 
                  disabled={isInstalling || isResolvingCode}
                  style={[styles.modalButton, (isInstalling || isResolvingCode) && styles.modalButtonDisabled]}
                  focusedStyle={styles.modalButtonFocused}
                >
                  {isResolvingCode ? (
                    <View style={styles.buttonRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.modalButtonText}>  Resolving code...</Text>
                    </View>
                  ) : isInstalling ? (
                    <View style={styles.buttonRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.modalButtonText}>  Installing...</Text>
                    </View>
                  ) : (
                    <Text style={styles.modalButtonText}>Install</Text>
                  )}
                </FocusButton>
              </>
            ) : (
              <>
                <Text style={styles.modalLabel}>Manifest URL</Text>
                <TextInput
                  style={[styles.modalInput, inputFocused && styles.modalInputFocused]}
                  placeholder="https://example.com/manifest.json"
                  placeholderTextColor="#666666"
                  value={addonUrl}
                  onChangeText={setAddonUrl}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  autoCapitalize="none"
                  autoCorrect={false}
                  multiline={true}
                  numberOfLines={3}
                />
                <Text style={styles.modalHint}>
                  Paste addon manifest URLs (separate with semicolon or new line)
                </Text>
                <FocusButton 
                  onPress={handleInstallAddon} 
                  disabled={isInstalling}
                  style={[styles.modalButton, isInstalling && styles.modalButtonDisabled]}
                  focusedStyle={styles.modalButtonFocused}
                >
                  {isInstalling ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={styles.modalButtonText}>Install</Text>
                  )}
                </FocusButton>
              </>
            )}
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
  const [shareFocused, setShareFocused] = useState(false);
  const [trashFocused, setTrashFocused] = useState(false);

  return (
    <View style={styles.addonCard}>
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
          style={[styles.actionButton, shareFocused && styles.actionButtonFocused]}
          onFocus={() => setShareFocused(true)}
          onBlur={() => setShareFocused(false)}
          onPress={onShare}
        >
          <Ionicons name="share-outline" size={22} color={shareFocused ? colors.primary : '#888888'} />
        </Pressable>
        <Pressable 
          style={[styles.actionButton, trashFocused && styles.actionButtonFocused]}
          onFocus={() => setTrashFocused(true)}
          onBlur={() => setTrashFocused(false)}
          onPress={onUninstall} 
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color={colors.error} />
          ) : (
            <Ionicons name="trash-outline" size={22} color="#FF4444" />
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
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerTV: {
    paddingHorizontal: 40,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary,
  },
  headerTitleTV: {
    fontSize: 32,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#888888',
  },
  addButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  disclaimerText: {
    flex: 1,
    fontSize: 17,
    color: colors.primary,
    lineHeight: 24,
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textMuted,
    marginTop: 12,
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
    color: colors.primary,
    textAlign: 'center',
    marginTop: 8,
  },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 24,
    gap: 8,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  installButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
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
    gap: 12,
  },
  actionButton: {
    padding: 10,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 10,
  },
  actionButtonFocused: {
    borderColor: colors.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: '#1E1E22',
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 20,
  },
  modalContentTV: {
    marginHorizontal: 150,
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
    color: '#FFFFFF',
  },
  modalLabel: {
    fontSize: 14,
    color: '#AAAAAA',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#2A2A2E',
    borderRadius: 8,
    padding: 14,
    color: '#FFFFFF',
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  modalInputFocused: {
    borderColor: colors.primary,
  },
  modalHint: {
    fontSize: 12,
    color: '#666666',
    marginTop: 8,
    marginBottom: 20,
  },
  modalButton: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  modalButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2A2A2E',
    gap: 6,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  tabActive: {
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
    borderColor: colors.primary,
  },
  tabFocused: {
    borderColor: colors.primary,
  },
  tabText: {
    fontSize: 13,
    color: '#888888',
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.primary,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});