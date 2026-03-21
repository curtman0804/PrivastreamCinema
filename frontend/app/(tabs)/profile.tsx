import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  Platform,
  useWindowDimensions,
  TextInput,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { useSettingsStore } from '../../src/store/settingsStore';
import { colors } from '../../src/styles/colors';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const {
    torrServerUrl,
    useExternalServer,
    isLoading: settingsLoading,
    setTorrServerUrl,
    setUseExternalServer,
    loadSettings,
    testConnection,
    clearTorrServerUrl,
  } = useSettingsStore();
  
  const [serverInput, setServerInput] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showServerSetup, setShowServerSetup] = useState(false);
  
  useEffect(() => {
    loadSettings();
  }, []);
  
  useEffect(() => {
    setServerInput(torrServerUrl);
  }, [torrServerUrl]);

  const handleLogout = () => {
    const doLogout = async () => {
      await logout();
      router.replace('/(auth)/login');
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Are you sure you want to logout?')) {
        doLogout();
      }
    } else {
      Alert.alert(
        'Logout',
        'Are you sure you want to logout?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout', style: 'destructive', onPress: doLogout },
        ]
      );
    }
  };
  
  const handleSaveServer = async () => {
    await setTorrServerUrl(serverInput);
    if (serverInput) {
      await setUseExternalServer(true);
      const result = await testConnection();
      setTestResult(result);
    } else {
      await setUseExternalServer(false);
      setTestResult(null);
    }
  };
  
  const handleTestConnection = async () => {
    setTestResult(null);
    const result = await testConnection();
    setTestResult(result);
  };
  
  const handleClearServer = async () => {
    await clearTorrServerUrl();
    setServerInput('');
    setTestResult(null);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Settings</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Profile Section */}
        <View style={styles.profileSection}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color={colors.primary} />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.username}>{user?.username || 'User'}</Text>
            <Text style={styles.email}>{user?.email || ''}</Text>
          </View>
        </View>

        {/* Streaming Server Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>STREAMING SERVER</Text>
          <View style={styles.menuCard}>
            <Pressable 
              style={styles.menuItem}
              onPress={() => setShowServerSetup(!showServerSetup)}
            >
              <View style={styles.menuIcon}>
                <Ionicons name="server-outline" size={22} color={colors.primary} />
              </View>
              <View style={styles.menuTextContainer}>
                <Text style={styles.menuTitle}>TorrServer</Text>
                <Text style={styles.menuSubtitle}>
                  {useExternalServer && torrServerUrl 
                    ? `Connected: ${torrServerUrl}` 
                    : 'Not configured (using built-in engine)'}
                </Text>
              </View>
              <Ionicons 
                name={showServerSetup ? "chevron-up" : "chevron-down"} 
                size={20} 
                color={colors.textMuted} 
              />
            </Pressable>
            
            {showServerSetup && (
              <View style={styles.serverSetupContainer}>
                <Text style={styles.serverSetupInfo}>
                  For instant playback on ALL torrents (like Stremio), run TorrServer on your own machine or VPS:
                </Text>
                <View style={styles.codeBlock}>
                  <Text style={styles.codeText}>
                    docker run -d -p 8090:8090 {'\n'}ghcr.io/yourok/torrserver
                  </Text>
                </View>
                <Text style={styles.serverSetupInfo}>
                  Then enter your server's URL below (e.g., http://192.168.1.100:8090):
                </Text>
                
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.serverInput}
                    value={serverInput}
                    onChangeText={setServerInput}
                    placeholder="http://your-server:8090"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                </View>
                
                <View style={styles.buttonRow}>
                  <Pressable style={styles.saveButton} onPress={handleSaveServer}>
                    {settingsLoading ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.saveButtonText}>Save & Test</Text>
                    )}
                  </Pressable>
                  
                  {torrServerUrl ? (
                    <Pressable style={styles.clearButton} onPress={handleClearServer}>
                      <Text style={styles.clearButtonText}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>
                
                {testResult && (
                  <View style={[
                    styles.testResultBox,
                    testResult.success ? styles.testResultSuccess : styles.testResultError,
                  ]}>
                    <Ionicons 
                      name={testResult.success ? "checkmark-circle" : "close-circle"} 
                      size={18} 
                      color={testResult.success ? '#4CAF50' : '#F44336'} 
                    />
                    <Text style={[
                      styles.testResultText,
                      testResult.success ? styles.testResultTextSuccess : styles.testResultTextError,
                    ]}>
                      {testResult.message}
                    </Text>
                  </View>
                )}
                
                {useExternalServer && torrServerUrl && (
                  <View style={styles.activeServerRow}>
                    <Ionicons name="flash" size={16} color="#4CAF50" />
                    <Text style={styles.activeServerText}>
                      External server active — all streams will use TorrServer
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Admin Section */}
        {user?.is_admin && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ADMIN</Text>
            <View style={styles.menuCard}>
              <MenuItem
                icon="people-outline"
                title="User Management"
                subtitle="Add or remove users"
                onPress={() => router.push('/admin/users')}
                isTV={isTV}
              />
            </View>
          </View>
        )}

        {/* General Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>GENERAL</Text>
          <View style={styles.menuCard}>
            <MenuItem
              icon="information-circle-outline"
              title="About"
              subtitle="Version 1.0.0"
              isTV={isTV}
            />
          </View>
        </View>

        {/* Account Section */}
        <View style={styles.section}>
          <View style={styles.menuCard}>
            <MenuItem
              icon="log-out-outline"
              title="Logout"
              onPress={handleLogout}
              showArrow={false}
              danger
              isTV={isTV}
            />
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Menu Item Component
function MenuItem({
  icon,
  title,
  subtitle,
  onPress,
  showArrow = true,
  danger = false,
  isTV = false,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  showArrow?: boolean;
  danger?: boolean;
  isTV?: boolean;
}) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      style={[styles.menuItem, isFocused && styles.menuItemFocused]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      disabled={!onPress}
    >
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <Ionicons
          name={icon as any}
          size={22}
          color={danger ? colors.error : colors.primary}
        />
      </View>
      <View style={styles.menuTextContainer}>
        <Text style={[styles.menuTitle, danger && styles.menuTitleDanger]}>
          {title}
        </Text>
        {subtitle && <Text style={styles.menuSubtitle}>{subtitle}</Text>}
      </View>
      {showArrow && (
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
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
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.backgroundLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfo: {
    marginLeft: 16,
  },
  username: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.primary,
  },
  email: {
    fontSize: 14,
    color: colors.primaryDark,
    marginTop: 4,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 8,
    marginLeft: 4,
    letterSpacing: 1,
  },
  menuCard: {
    backgroundColor: colors.backgroundLight,
    borderRadius: 12,
    overflow: 'hidden',
    alignSelf: 'stretch',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    minHeight: 72,
    maxHeight: 72,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 12,
  },
  menuItemFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIconDanger: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
  },
  menuTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.primary,
  },
  menuTitleDanger: {
    color: colors.error,
  },
  menuSubtitle: {
    fontSize: 13,
    color: colors.primaryDark,
    marginTop: 2,
  },
  bottomPadding: {
    height: 40,
  },
  // Server setup styles
  serverSetupContainer: {
    padding: 16,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  serverSetupInfo: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: 8,
    marginTop: 8,
  },
  codeBlock: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#4CAF50',
    lineHeight: 18,
  },
  inputRow: {
    marginTop: 8,
  },
  serverInput: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: colors.primary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  saveButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 14,
  },
  clearButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  clearButtonText: {
    color: colors.error,
    fontWeight: '600',
    fontSize: 14,
  },
  testResultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  testResultSuccess: {
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
  },
  testResultError: {
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
  },
  testResultText: {
    fontSize: 13,
    flex: 1,
  },
  testResultTextSuccess: {
    color: '#4CAF50',
  },
  testResultTextError: {
    color: '#F44336',
  },
  activeServerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 6,
  },
  activeServerText: {
    fontSize: 13,
    color: '#4CAF50',
    flex: 1,
  },
});
