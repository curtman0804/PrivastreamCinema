import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
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
  const { width, height } = useWindowDimensions();
  
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
                />
              </View>

              <View style={[
                styles.inputContainer,
                inputFocused === 'password' && styles.inputFocused
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
                  onFocus={() => setInputFocused('password')}
                  onBlur={() => setInputFocused(null)}
                  editable={!isLoading}
                />
                <TouchableOpacity 
                  onPress={() => setShowPassword(!showPassword)} 
                  style={styles.eyeButton}
                  disabled={isLoading}
                >
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#888888" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[
                  styles.loginButton,
                  isLoading && styles.loginButtonDisabled,
                ]}
                onPress={handleLogin}
                disabled={isLoading}
                activeOpacity={0.7}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.loginButtonText}>Sign In</Text>
                )}
              </TouchableOpacity>
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
