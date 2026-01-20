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
          {
            text: 'Logout',
            style: 'destructive',
            onPress: doLogout,
          },
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Profile</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={[styles.profileSection, isTV && styles.profileSectionTV]}>
          <View style={[styles.avatarContainer, isTV && styles.avatarContainerTV]}>
            <Ionicons name="person" size={isTV ? 50 : 40} color="#B8A05C" />
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.username, isTV && styles.usernameTV]}>{user?.username || 'User'}</Text>
            <Text style={[styles.email, isTV && styles.emailTV]}>{user?.email || ''}</Text>
          </View>
        </View>

        {/* Admin Section - Only visible to admin users */}
        {user?.is_admin && (
          <View style={[styles.section, isTV && styles.sectionTV]}>
            <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>Admin</Text>
            <View style={[styles.menuCard, isTV && styles.menuCardTV]}>
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

        <View style={[styles.section, isTV && styles.sectionTV]}>
          <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>Support</Text>
          <View style={[styles.menuCard, isTV && styles.menuCardTV]}>
            <MenuItem
              icon="help-circle-outline"
              title="Help Center"
              subtitle="Get help with the app"
              isTV={isTV}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              icon="information-circle-outline"
              title="About"
              subtitle="Version 1.0.0"
              isTV={isTV}
            />
          </View>
        </View>

        <View style={[styles.section, isTV && styles.sectionTV]}>
          <View style={[styles.menuCard, isTV && styles.menuCardTV]}>
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

// Separate component for menu item with focus support
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
      style={({ focused }) => [
        styles.menuItem,
        isTV && styles.menuItemTV,
        (focused || isFocused) && styles.menuItemFocused,
      ]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      disabled={!onPress}
    >
      <View style={[
        styles.menuIconContainer, 
        isTV && styles.menuIconContainerTV,
        danger && styles.menuIconDanger,
      ]}>
        <Ionicons
          name={icon as any}
          size={isTV ? 26 : 22}
          color={danger ? '#FF4444' : '#B8A05C'}
        />
      </View>
      <View style={styles.menuTextContainer}>
        <Text style={[
          styles.menuTitle, 
          isTV && styles.menuTitleTV,
          danger && styles.menuTitleDanger,
        ]}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.menuSubtitle, isTV && styles.menuSubtitleTV]}>
            {subtitle}
          </Text>
        )}
      </View>
      {showArrow && (
        <Ionicons name="chevron-forward" size={isTV ? 24 : 20} color="#666666" />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTV: {
    paddingHorizontal: 32,
    paddingVertical: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerTitleTV: {
    fontSize: 32,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  profileSectionTV: {
    padding: 32,
  },
  avatarContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarContainerTV: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  profileInfo: {
    marginLeft: 16,
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  usernameTV: {
    fontSize: 24,
  },
  email: {
    fontSize: 14,
    color: '#888888',
    marginTop: 4,
  },
  emailTV: {
    fontSize: 16,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTV: {
    marginTop: 32,
    paddingHorizontal: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    marginBottom: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  sectionTitleTV: {
    fontSize: 15,
    marginBottom: 12,
  },
  menuCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuCardTV: {
    borderRadius: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 12,
  },
  menuItemTV: {
    padding: 20,
  },
  menuItemFocused: {
    borderColor: '#B8A05C',
    backgroundColor: 'rgba(184, 160, 92, 0.1)',
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIconContainerTV: {
    width: 50,
    height: 50,
    borderRadius: 12,
  },
  menuIconDanger: {
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
  },
  menuTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  menuTitleTV: {
    fontSize: 18,
  },
  menuTitleDanger: {
    color: '#FF4444',
  },
  menuSubtitle: {
    fontSize: 13,
    color: '#888888',
    marginTop: 2,
  },
  menuSubtitleTV: {
    fontSize: 14,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginLeft: 68,
  },
  bottomPadding: {
    height: 40,
  },
});
