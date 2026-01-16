import React, { useState } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuthStore } from '../../src/store/authStore';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const { width, height } = useWindowDimensions();
  
  // Detect if we're on a TV/landscape mode
  const isTV = width > height || width > 800;

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Error', 'Please enter username and password');
      return;
    }

    setIsLoading(true);
    try {
      await login(username.trim(), password);
      router.replace('/(tabs)/discover');
    } catch (error: any) {
      Alert.alert('Login Failed', error.response?.data?.detail || 'Invalid credentials');
    } finally {
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
          contentContainerStyle={[
            styles.scrollContent,
            isTV && styles.scrollContentTV
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.formWrapper, isTV && styles.formWrapperTV]}>
            <View style={styles.header}>
              <Image
                source={require('../../assets/images/logo_splash.png')}
                style={[styles.logo, isTV && styles.logoTV]}
                contentFit="contain"
              />
            </View>

            <View style={[styles.form, isTV && styles.formTV]}>
              <View style={[
                styles.inputContainer,
                focusedField === 'username' && styles.inputFocused
              ]}>
                <Ionicons name="person-outline" size={20} color="#888888" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Username"
                  placeholderTextColor="#888888"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              <View style={[
                styles.inputContainer,
                focusedField === 'password' && styles.inputFocused
              ]}>
                <Ionicons name="lock-closed-outline" size={20} color="#888888" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#888888"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                />
                <Pressable onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#888888" />
                </Pressable>
              </View>

              <Pressable
                style={({ pressed, focused }) => [
                  styles.loginButton,
                  isLoading && styles.loginButtonDisabled,
                  pressed && { opacity: 0.8 },
                  focusedField === 'button' && styles.loginButtonFocused,
                ]}
                onPress={handleLogin}
                onFocus={() => setFocusedField('button')}
                onBlur={() => setFocusedField(null)}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
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
    backgroundColor: '#0c0c0c',
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
    maxWidth: 450,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 280,
    height: 200,
  },
  logoTV: {
    width: 300,
    height: 150,
  },
  form: {
    width: '100%',
  },
  formTV: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputFocused: {
    borderColor: '#B8A05C',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
  },
  eyeButton: {
    padding: 8,
  },
  loginButton: {
    backgroundColor: '#B8A05C',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  loginButtonFocused: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.02 }],
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
});
