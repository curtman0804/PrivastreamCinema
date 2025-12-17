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

    // Support multiple URLs separated by semicolon or newline
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
    await fetchAddons();
    
    // Refresh discover page content after addon install
    if (successCount > 0) {
      await fetchDiscover();
    }

    if (successCount > 0 && failedUrls.length === 0) {
      Alert.alert('Success', `${successCount} addon(s) installed successfully. Go to Discover tab to see content.`);
    } else if (successCount > 0 && failedUrls.length > 0) {
      Alert.alert('Partial Success', `${successCount} installed, ${failedUrls.length} failed:\n${failedUrls.join('\n')}`);
    } else {
      Alert.alert('Error', `Failed to install:\n${failedUrls.join('\n')}`);
    }
  };

  const [deletingAddonId, setDeletingAddonId] = useState<string | null>(null);
  
  const handleUninstall = async (addon: Addon) => {
    if (deletingAddonId) return; // Prevent double-tap
    
    const doUninstall = async () => {
      setDeletingAddonId(addon.id);
      try {
        console.log('Calling API to delete addon:', addon.id);
        await api.addons.uninstall(addon.id);
        console.log('API call successful');
        // Force immediate UI update
        await fetchAddons();
        await fetchDiscover();
        if (Platform.OS === 'web') {
          alert(`${addon.manifest.name} has been uninstalled`);
        } else {
          Alert.alert('Success', `${addon.manifest.name} has been uninstalled`);
        }
      } catch (error: any) {
        console.log('Uninstall error:', error);
        const errorMsg = `Failed to uninstall: ${error?.message || 'Unknown error'}`;
        if (Platform.OS === 'web') {
          alert(errorMsg);
        } else {
          Alert.alert('Error', errorMsg);
        }
      } finally {
        setDeletingAddonId(null);
      }
    };
    
    // Use different confirmation for web vs native
    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to uninstall ${addon.manifest.name}?`)) {
        doUninstall();
      }
    } else {
      Alert.alert(
        'Uninstall Addon',
        `Are you sure you want to uninstall ${addon.manifest.name}?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Uninstall', style: 'destructive', onPress: doUninstall },
        ]
      );
    }
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
      <Pressable
        style={({ pressed }) => [
          styles.deleteButton,
          pressed && { opacity: 0.6, transform: [{ scale: 0.95 }] }
        ]}
        onPress={() => {
          console.log('Delete button pressed for:', item.manifest.name, 'ID:', item.id);
          handleUninstall(item);
        }}
        hitSlop={10}
        disabled={deletingAddonId === item.id}
      >
        {deletingAddonId === item.id ? (
          <ActivityIndicator size="small" color="#FF4444" />
        ) : (
          <Ionicons name="trash-outline" size={22} color="#FF4444" />
        )}
      </Pressable>
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
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Addons</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowModal(true)}>
          <Ionicons name="add-circle" size={32} color="#8B5CF6" />
        </TouchableOpacity>
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimer}>
        <Ionicons name="shield-checkmark" size={18} color="#8B5CF6" />
        <Text style={styles.disclaimerText}>
          You are responsible for the addons you install. The app does not host or distribute any content.
        </Text>
      </View>

      {/* Addon List or Empty State */}
      {addons.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name="extension-puzzle-outline" size={64} color="#333333" />
          </View>
          <Text style={styles.emptyTitle}>No Addons Installed</Text>
          <Text style={styles.emptySubtext}>
            Tap the <Ionicons name="add-circle" size={18} color="#8B5CF6" /> button in the top right to install addons.
          </Text>
          <Text style={styles.emptyHint}>
            You'll need to find addon manifest URLs from Stremio addon sources.
          </Text>
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
          ListHeaderComponent={
            <Text style={styles.installedCount}>
              {addons.length} addon{addons.length !== 1 ? 's' : ''} installed
            </Text>
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
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Install Addon</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={28} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Addon Manifest URL</Text>
            <TextInput
              style={styles.input}
              placeholder="https://example.com/manifest.json"
              placeholderTextColor="#666666"
              value={addonUrl}
              onChangeText={setAddonUrl}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.hint}>
              Paste a Stremio addon manifest URL. You can install multiple addons by separating URLs with a semicolon (;) or new line.
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
                <>
                  <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>Install Addon</Text>
                </>
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
    alignItems: 'flex-start',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.2)',
  },
  disclaimerText: {
    flex: 1,
    marginLeft: 10,
    color: '#AAAAAA',
    fontSize: 13,
    lineHeight: 18,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
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
    marginBottom: 16,
  },
  emptyHint: {
    color: '#666666',
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  installedCount: {
    fontSize: 13,
    color: '#888888',
    marginTop: 16,
    marginBottom: 12,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  addonCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#222222',
  },
  addonIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  addonLogo: {
    width: 40,
    height: 40,
  },
  addonInfo: {
    flex: 1,
  },
  addonName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  addonVersion: {
    fontSize: 12,
    color: '#666666',
    marginTop: 2,
  },
  addonDescription: {
    fontSize: 13,
    color: '#AAAAAA',
    marginTop: 6,
    lineHeight: 18,
  },
  addonTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 6,
  },
  typeBadge: {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 11,
    color: '#A78BFA',
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  deleteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    alignSelf: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
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
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#AAAAAA',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#FFFFFF',
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#333333',
  },
  hint: {
    fontSize: 13,
    color: '#666666',
    marginTop: 10,
    marginBottom: 24,
    lineHeight: 18,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    height: 54,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
