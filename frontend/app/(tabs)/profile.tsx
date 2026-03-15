import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/store/authStore';
import { colors } from '../../src/styles/colors';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

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
});
