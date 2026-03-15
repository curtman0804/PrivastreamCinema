import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  findNodeHandle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuthStore } from '../../src/store/authStore';
import { colors } from '../../src/styles/colors';

export default function LoginScreen() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const signInRef = useRef<View>(null);
  
  const isTV = width > height || width > 800;
  
  // State for TV focus handling
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [signInFocused, setSignInFocused] = useState(false);

  // Auto-focus username field on mount for TV navigation
  useEffect(() => {
    if (isTV) {
      // Small delay to ensure component is mounted
      const timer = setTimeout(() => {
        usernameRef.current?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isTV]);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/(tabs)/discover');
    }
  }, [isAuthenticated]);

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    
    if (!trimmedUsername || !trimmedPassword) {
      Alert.alert('Error', 'Please enter username and password');
      return;
    }

    setIsLoading(true);
    
    try {
      await login(trimmedUsername, trimmedPassword);
    } catch (error: any) {
      let errorMessage = 'Invalid credentials';
      if (error.message?.includes('Network Error')) {
        errorMessage = 'Cannot connect to server. Check your connection.';
      } else if (error.response?.data?.detail) {
        errorMessage = error.response.data.detail;
      } else if (error.message) {
        errorMessage = error.message;
      }
      Alert.alert('Login Failed', errorMessage);
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, isTV && styles.scrollContentTV]}
          keyboardShouldPersistTaps="always"
        >
          <View style={[styles.formWrapper, isTV && styles.formWrapperTV]}>
            {/* Logo */}
            <View style={styles.header}>
              <Image
                source={require('../../assets/images/logo_splash.png')}
                style={[styles.logo, isTV && styles.logoTV]}
                contentFit="contain"
              />
            </View>

            {/* Form */}
            <View style={styles.form}>
              {/* Username Field - TV Optimized */}
              <Pressable
                style={[
                  styles.inputContainer, 
                  (focusedField === 'username' || usernameFocused) && styles.inputFocused
                ]}
                onPress={() => usernameRef.current?.focus()}
                onFocus={() => {
                  setUsernameFocused(true);
                  usernameRef.current?.focus();
                }}
                onBlur={() => setUsernameFocused(false)}
                accessible={true}
                accessibilityLabel="Username input"
              >
                <Ionicons name="person-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  ref={usernameRef}
                  style={styles.input}
                  placeholder="Username"
                  placeholderTextColor={colors.textMuted}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => {
                    setFocusedField('username');
                    setUsernameFocused(true);
                  }}
                  onBlur={() => {
                    setFocusedField(null);
                    setUsernameFocused(false);
                  }}
                  editable={!isLoading}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  blurOnSubmit={false}
                />
              </Pressable>

              {/* Password Field - TV Optimized */}
              <Pressable
                style={[
                  styles.inputContainer, 
                  (focusedField === 'password' || passwordFocused) && styles.inputFocused
                ]}
                onPress={() => passwordRef.current?.focus()}
                onFocus={() => {
                  setPasswordFocused(true);
                  passwordRef.current?.focus();
                }}
                onBlur={() => setPasswordFocused(false)}
                accessible={true}
                accessibilityLabel="Password input"
              >
                <Ionicons name="lock-closed-outline" size={20} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  onFocus={() => {
                    setFocusedField('password');
                    setPasswordFocused(true);
                  }}
                  onBlur={() => {
                    setFocusedField(null);
                    setPasswordFocused(false);
                  }}
                  editable={!isLoading}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <Ionicons 
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'} 
                    size={20} 
                    color={colors.textMuted} 
                  />
                </Pressable>
              </Pressable>

              {/* Sign In Button - TV Optimized */}
              <Pressable
                ref={signInRef}
                onPress={handleLogin}
                disabled={isLoading}
                onFocus={() => setSignInFocused(true)}
                onBlur={() => setSignInFocused(false)}
                style={[
                  styles.loginButton,
                  isLoading && styles.loginButtonDisabled,
                  signInFocused && styles.loginButtonFocused,
                ]}
                accessible={true}
                accessibilityLabel="Sign in button"
                accessibilityRole="button"
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.textPrimary} />
                ) : (
                  <Text style={styles.loginButtonText}>Sign In</Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scrollContentTV: {
    alignItems: 'center',
  },
  formWrapper: {
    width: '100%',
  },
  formWrapperTV: {
    maxWidth: 400,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  footer: {
    alignItems: 'center',
    marginTop: 32,
  },
  logo: {
    width: 400,
    height: 200,
  },
  logoTV: {
    width: 480,
    height: 240,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.backgroundLight,
    borderRadius: 8,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputFocused: {
    borderColor: colors.primary,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 16,
  },
  eyeButton: {
    padding: 8,
  },
  loginButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonFocused: {
    transform: [{ scale: 1.02 }],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 8,
  },
  loginButtonText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
});
