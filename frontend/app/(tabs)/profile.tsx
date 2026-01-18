import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
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
            <Ionicons name="person" size={isTV ? 44 : 40} color="#B8A05C" />
          </View>
          <View style={styles.profileInfo}>
            <Text style={[styles.username, isTV && styles.usernameTV]}>{user?.username || 'User'}</Text>
            <Text style={[styles.email, isTV && styles.emailTV]}>{user?.email || ''}</Text>
          </View>
        </View>

        {/* Admin Section */}
        {user?.is_admin && (
          <View style={[styles.section, isTV && styles.sectionTV]}>
            <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>Admin</Text>
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

        <View style={[styles.section, isTV && styles.sectionTV]}>
          <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>Support</Text>
          <View style={styles.menuCard}>
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
    <TouchableOpacity
      style={[
        styles.menuItem,
        isFocused && styles.menuItemFocused,
        danger && isFocused && styles.menuItemFocusedDanger,
      ]}
      onPress={onPress}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      activeOpacity={0.7}
    >
      <View style={[styles.menuIconContainer, danger && styles.menuIconDanger]}>
        <Ionicons
          name={icon as any}
          size={isTV ? 24 : 22}
          color={danger ? '#FF4444' : '#B8A05C'}
        />
      </View>
      <View style={styles.menuTextContainer}>
        <Text style={[
          styles.menuTitle, 
          danger && styles.menuTitleDanger, 
          isTV && styles.menuTitleTV
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
        <Ionicons name="chevron-forward" size={22} color="#666666" />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
  },
  header: {
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
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerTitleTV: {
    fontSize: 32,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  profileSectionTV: {
    paddingHorizontal: 48,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarContainerTV: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  profileInfo: {
    marginLeft: 20,
  },
  username: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  usernameTV: {
    fontSize: 26,
  },
  email: {
    fontSize: 15,
    color: '#888888',
    marginTop: 4,
  },
  emailTV: {
    fontSize: 17,
  },
  section: {
    marginTop: 28,
    paddingHorizontal: 20,
  },
  sectionTV: {
    paddingHorizontal: 48,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888888',
    marginBottom: 10,
    marginLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitleTV: {
    fontSize: 15,
  },
  menuCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
  },
  menuItemFocused: {
    borderColor: '#B8A05C',
    backgroundColor: '#242424',
  },
  menuItemFocusedDanger: {
    borderColor: '#FF4444',
  },
  menuIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIconDanger: {
    backgroundColor: 'rgba(255, 68, 68, 0.15)',
  },
  menuTextContainer: {
    flex: 1,
    marginLeft: 14,
  },
  menuTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  menuTitleTV: {
    fontSize: 19,
  },
  menuTitleDanger: {
    color: '#FF4444',
  },
  menuSubtitle: {
    fontSize: 13,
    color: '#888888',
    marginTop: 3,
  },
  menuSubtitleTV: {
    fontSize: 15,
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#2a2a2a',
    marginLeft: 74,
  },
  bottomPadding: {
    height: 50,
  },
});