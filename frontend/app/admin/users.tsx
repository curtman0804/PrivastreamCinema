import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api, User } from '../../src/api/client';
import { useAuthStore } from '../../src/store/authStore';
import { colors } from '../../src/styles/colors';

interface UserFormData {
  username: string;
  password: string;
  email: string;
  is_admin: boolean;
}

interface EditFormData {
  username: string;
  email: string;
  password: string;
  is_admin: boolean;
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const { user: currentUser } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<UserFormData>({
    username: '',
    password: '',
    email: '',
    is_admin: false,
  });
  const [editFormData, setEditFormData] = useState<EditFormData>({
    username: '',
    email: '',
    password: '',
    is_admin: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addBtnFocused, setAddBtnFocused] = useState(false);

  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

  const fetchUsers = async () => {
    try {
      const response = await api.admin.getUsers();
      setUsers(response);
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsers();
    setRefreshing(false);
  }, []);

  const handleAddUser = async () => {
    if (!formData.username.trim() || !formData.password.trim()) {
      Alert.alert('Error', 'Username and password are required');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.admin.createUser(formData);
      Alert.alert('Success', 'User created successfully');
      setShowAddModal(false);
      setFormData({ username: '', password: '', email: '', is_admin: false });
      await fetchUsers();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to create user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setEditFormData({
      username: user.username,
      email: user.email || '',
      password: '',
      is_admin: user.is_admin,
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;

    const updateData: any = {};
    if (editFormData.username.trim() && editFormData.username !== editingUser.username) {
      updateData.username = editFormData.username.trim();
    }
    if (editFormData.email.trim() !== (editingUser.email || '')) {
      updateData.email = editFormData.email.trim();
    }
    if (editFormData.password.trim()) {
      updateData.password = editFormData.password.trim();
    }
    if (editFormData.is_admin !== editingUser.is_admin) {
      updateData.is_admin = editFormData.is_admin;
    }

    if (Object.keys(updateData).length === 0) {
      Alert.alert('No Changes', 'No fields were modified.');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.admin.updateUser(editingUser.id, updateData);
      Alert.alert('Success', 'User updated successfully');
      setShowEditModal(false);
      setEditingUser(null);
      await fetchUsers();
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.detail || 'Failed to update user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = (user: User) => {
    if (user.id === currentUser?.id) {
      Alert.alert('Error', 'You cannot delete your own account');
      return;
    }
    if (user.username === 'choyt') {
      Alert.alert('Error', 'Cannot delete the master admin account');
      return;
    }

    Alert.alert(
      'Delete User',
      `Are you sure you want to delete "${user.username}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.admin.deleteUser(user.id);
              await fetchUsers();
              Alert.alert('Success', 'User deleted');
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.detail || 'Failed to delete user');
            }
          },
        },
      ]
    );
  };

  const canDeleteUser = (user: User) => {
    return user.id !== currentUser?.id && user.username !== 'choyt';
  };

  const renderUser = ({ item }: { item: User }) => (
    <UserCard
      user={item}
      canDelete={canDeleteUser(item)}
      onEdit={() => handleEditUser(item)}
      onDelete={() => handleDeleteUser(item)}
    />
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>User Management</Text>
        <Pressable
          style={[styles.addButton, addBtnFocused && styles.addButtonFocused]}
          onFocus={() => setAddBtnFocused(true)}
          onBlur={() => setAddBtnFocused(false)}
          onPress={() => setShowAddModal(true)}
        >
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </Pressable>
      </View>

      <FlatList
        data={users}
        renderItem={renderUser}
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
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="people-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyText}>No users found</Text>
          </View>
        }
      />

      {/* Add User Modal */}
      <UserFormModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New User"
        submitLabel="Create User"
        formData={formData}
        setFormData={(data: any) => setFormData(data)}
        onSubmit={handleAddUser}
        isSubmitting={isSubmitting}
        isTV={isTV}
        showUsername={true}
        showPassword={true}
        passwordRequired={true}
      />

      {/* Edit User Modal */}
      <UserFormModal
        visible={showEditModal}
        onClose={() => { setShowEditModal(false); setEditingUser(null); }}
        title={`Edit ${editingUser?.username || 'User'}`}
        submitLabel="Save Changes"
        formData={editFormData}
        setFormData={(data: any) => setEditFormData(data)}
        onSubmit={handleSaveEdit}
        isSubmitting={isSubmitting}
        isTV={isTV}
        showUsername={true}
        showPassword={true}
        passwordRequired={false}
      />
    </SafeAreaView>
  );
}

// User Card Component
function UserCard({
  user,
  canDelete,
  onEdit,
  onDelete,
}: {
  user: User;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [editFocused, setEditFocused] = useState(false);
  const [trashFocused, setTrashFocused] = useState(false);

  return (
    <View style={styles.userCard}>
      <View style={styles.userInfo}>
        <View style={styles.avatarContainer}>
          <Ionicons
            name={user.is_admin ? 'shield' : 'person'}
            size={24}
            color={user.is_admin ? colors.primary : '#888888'}
          />
        </View>
        <View style={styles.userDetails}>
          <View style={styles.usernameRow}>
            <Text style={styles.username}>{user.username}</Text>
            {user.is_admin && (
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>Admin</Text>
              </View>
            )}
          </View>
          <Text style={styles.email}>{user.email || 'No email'}</Text>
        </View>
      </View>
      <View style={styles.cardActions}>
        {/* Edit button */}
        <Pressable
          style={[styles.actionButton, editFocused && styles.actionButtonFocused]}
          onFocus={() => setEditFocused(true)}
          onBlur={() => setEditFocused(false)}
          onPress={onEdit}
        >
          <Ionicons name="create-outline" size={22} color={colors.primary} />
        </Pressable>
        {/* Delete button - only show if allowed */}
        {canDelete && (
          <Pressable
            style={[styles.actionButton, trashFocused && styles.actionButtonFocused]}
            onFocus={() => setTrashFocused(true)}
            onBlur={() => setTrashFocused(false)}
            onPress={onDelete}
          >
            <Ionicons name="trash-outline" size={22} color="#FF4444" />
          </Pressable>
        )}
      </View>
    </View>
  );
}

// Shared User Form Modal (used for both Add and Edit)
function UserFormModal({
  visible,
  onClose,
  title,
  submitLabel,
  formData,
  setFormData,
  onSubmit,
  isSubmitting,
  isTV,
  showUsername,
  showPassword,
  passwordRequired,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  formData: any;
  setFormData: (data: any) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  isTV: boolean;
  showUsername: boolean;
  showPassword: boolean;
  passwordRequired: boolean;
}) {
  const [closeFocused, setCloseFocused] = useState(false);
  const [adminToggleFocused, setAdminToggleFocused] = useState(false);
  const [submitFocused, setSubmitFocused] = useState(false);
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, isTV && styles.modalContentTV]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Pressable
                style={[styles.modalCloseBtn, closeFocused && styles.modalCloseFocused]}
                onFocus={() => setCloseFocused(true)}
                onBlur={() => setCloseFocused(false)}
                onPress={onClose}
              >
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>

            {showUsername && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Username {passwordRequired ? '*' : ''}</Text>
                <TextInput
                  style={[styles.input, usernameFocused && styles.inputFocused]}
                  placeholder="Enter username"
                  placeholderTextColor="#666666"
                  value={formData.username}
                  onChangeText={(text) => setFormData({ ...formData, username: text })}
                  onFocus={() => setUsernameFocused(true)}
                  onBlur={() => setUsernameFocused(false)}
                  autoCapitalize="none"
                />
              </View>
            )}

            {showPassword && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>
                  Password {passwordRequired ? '*' : '(leave blank to keep current)'}
                </Text>
                <TextInput
                  style={[styles.input, passwordFocused && styles.inputFocused]}
                  placeholder={passwordRequired ? 'Enter password' : 'New password (optional)'}
                  placeholderTextColor="#666666"
                  value={formData.password}
                  onChangeText={(text) => setFormData({ ...formData, password: text })}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  secureTextEntry
                />
              </View>
            )}

            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={[styles.input, emailFocused && styles.inputFocused]}
                placeholder="Enter email (optional)"
                placeholderTextColor="#666666"
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text })}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <Pressable
              style={[styles.adminToggle, adminToggleFocused && styles.adminToggleFocused]}
              onFocus={() => setAdminToggleFocused(true)}
              onBlur={() => setAdminToggleFocused(false)}
              onPress={() => setFormData({ ...formData, is_admin: !formData.is_admin })}
            >
              <View style={[styles.checkbox, formData.is_admin && styles.checkboxChecked]}>
                {formData.is_admin && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
              </View>
              <Text style={styles.adminToggleText}>Admin privileges</Text>
            </Pressable>

            <Pressable
              style={[
                styles.submitButton,
                isSubmitting && styles.submitButtonDisabled,
                submitFocused && styles.submitButtonFocused,
              ]}
              onFocus={() => setSubmitFocused(true)}
              onBlur={() => setSubmitFocused(false)}
              onPress={onSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.submitButtonText}>{submitLabel}</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  listContent: {
    padding: 16,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  userInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  userDetails: {
    flex: 1,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  adminBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  adminBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  email: {
    fontSize: 13,
    color: '#888888',
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: '#888888',
    fontSize: 16,
    marginTop: 12,
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
    maxHeight: '85%',
  },
  modalContentTV: {
    marginHorizontal: 150,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalCloseBtn: {
    padding: 4,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 8,
  },
  modalCloseFocused: {
    borderColor: colors.primary,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#AAAAAA',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#2A2A2E',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  inputFocused: {
    borderColor: colors.primary,
  },
  adminToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    padding: 8,
    borderWidth: 3,
    borderColor: 'transparent',
    borderRadius: 8,
  },
  adminToggleFocused: {
    borderColor: colors.primary,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#666666',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  adminToggleText: {
    fontSize: 15,
    color: '#FFFFFF',
  },
  submitButton: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  submitButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700',
  },
});
