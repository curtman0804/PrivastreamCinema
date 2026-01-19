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
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuthStore } from '../../src/store/authStore';

export default function LoginScreen() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [inputFocused, setInputFocused] = useState<string | null>(null);
  const [buttonFocused, setButtonFocused] = useState(false);
  const [eyeFocused, setEyeFocused] = useState(false);
  const { width, height } = useWindowDimensions();
  
  // Refs for focus management
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  
  const isTV = width > height || width > 800;

  // Navigate when authenticated
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
        errorMessage = 'Cannot connect to server. Check your internet connection.';
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
          contentContainerStyle={[
            styles.scrollContent,
            isTV && styles.scrollContentTV
          ]}
          keyboardShouldPersistTaps="always"
        >
          <View style={[styles.formWrapper, isTV && styles.formWrapperTV]}>
            <View style={styles.header}>
              <Image
                source={require('../../assets/images/logo_splash.png')}
                style={[styles.logo, isTV && styles.logoTV]}
                contentFit="contain"
              />
            </View>

            <View style={styles.form}>
              <View style={[
                styles.inputContainer,
                inputFocused === 'username' && styles.inputFocused
              ]}>
                <Ionicons name="person-outline" size={20} color="#888888" style={styles.inputIcon} />
                <TextInput
                  ref={usernameRef}
                  style={styles.input}
                  placeholder="Username"
                  placeholderTextColor="#888888"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onFocus={() => setInputFocused('username')}
                  onBlur={() => setInputFocused(null)}
                  editable={!isLoading}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  blurOnSubmit={false}
                />
              </View>

              <View style={[
                styles.inputContainer,
                inputFocused === 'password' && styles.inputFocused
              ]}>
                <Ionicons name="lock-closed-outline" size={20} color="#888888" style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#888888"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  onFocus={() => setInputFocused('password')}
                  onBlur={() => setInputFocused(null)}
                  editable={!isLoading}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable 
                  onPress={() => setShowPassword(!showPassword)} 
                  onFocus={() => setEyeFocused(true)}
                  onBlur={() => setEyeFocused(false)}
                  style={({ focused }) => [
                    styles.eyeButton,
                    (focused || eyeFocused) && styles.eyeButtonFocused,
                  ]}
                  disabled={isLoading}
                >
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#888888" />
                </Pressable>
              </View>

              <Pressable
                onPress={handleLogin}
                onFocus={() => setButtonFocused(true)}
                onBlur={() => setButtonFocused(false)}
                disabled={isLoading}
                style={({ pressed, focused }) => [
                  styles.loginButton,
                  isLoading && styles.loginButtonDisabled,
                  (focused || buttonFocused) && styles.loginButtonFocused,
                ]}
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
    borderWidth: 4,
    borderColor: 'transparent',
  },
  inputFocused: {
    borderColor: '#FFD700',
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
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  eyeButtonFocused: {
    borderColor: '#FFD700',
    backgroundColor: '#333333',
  },
  loginButton: {
    backgroundColor: '#B8A05C',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 4,
    borderColor: 'transparent',
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loginButtonFocused: {
    borderColor: '#FFD700',
    transform: [{ scale: 1.02 }],
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
});
