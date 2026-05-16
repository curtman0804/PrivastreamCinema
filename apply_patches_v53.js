/* eslint-disable */
// apply_patches_v53.js — REVERT my V51+V52 mistakes and ship the Stremio-style
// search pattern: a BARE TextInput that's directly D-pad-focusable on Android TV.
//
// THE PROBLEM I CAUSED:
//   V51 wrapped the TextInput in a Pressable so D-pad would land on it.
//   That Pressable then STOLE the OK-press, so pressing OK never actually
//   focused the TextInput — it just called handleRowPress which called focus()
//   too late and got swallowed.
//
//   V52 made it worse by adding an on-screen keyboard (which you do NOT want).
//
// THE STREMIO PATTERN:
//   TextInput is directly D-pad-focusable on Android TV when it has:
//     - hasTVPreferredFocus  → makes the D-pad land on it on screen mount
//     - autoFocus            → triggers focus() which pops the system IME
//     - showSoftInputOnFocus → forces the IME up regardless
//   No Pressable wrapper. No on-screen keyboard. Same as Stremio.
//
// This patch OVERWRITES SearchBar.tsx with the clean version and removes
// the TVKeyboard rendering. The TVKeyboard.tsx file is left on disk
// (unused) — safe to delete manually if you want.
//
// Backup of current file: SearchBar.tsx.bak.v53.<ts>

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'src', 'components', 'SearchBar.tsx');
if (!fs.existsSync(F)) {
  console.error('ERROR: ' + F + ' not found.');
  process.exit(1);
}

const bak = F + '.bak.v53.' + Date.now();
fs.copyFileSync(F, bak);
console.log('  [info] backup → ' + bak);

const CLEAN = `// PATCH_V53_STREMIO_PATTERN — clean SearchBar matching Stremio's Android TV
// search pattern: bare TextInput is directly D-pad-focusable. No Pressable
// wrapper, no on-screen keyboard. The system Gboard for TV pops up natively
// when the TextInput is focused.
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  placeholder = 'Search movies & TV shows...',
  initialValue = '',
}) => {
  const [query, setQuery] = useState(initialValue);
  const [inputFocused, setInputFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (initialValue) setQuery(initialValue);
  }, [initialValue]);

  // On Android TV, programmatic focus after mount reliably pops the system IME.
  // Stremio does the same — they don't rely on autoFocus alone.
  useEffect(() => {
    if (Platform.OS !== 'android' || initialValue) return;
    const t = setTimeout(() => {
      try { inputRef.current?.focus(); } catch (_) {}
    }, 250);
    return () => clearTimeout(t);
  }, [initialValue]);

  const handleSubmit = () => {
    if (query.trim()) onSearch(query.trim());
  };
  const handleClear = () => {
    setQuery('');
    onSearch('');
    try { inputRef.current?.focus(); } catch (_) {}
  };

  return (
    <View style={styles.container}>
      <View style={[styles.inputRow, inputFocused && styles.inputRowFocused]}>
        <Ionicons name="search" size={20} color="#888888" style={styles.icon} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#888888"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSubmit}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!initialValue}
          showSoftInputOnFocus={true}
          hasTVPreferredFocus={!initialValue}
          blurOnSubmit={false}
        />
        {query.length > 0 && (
          <Pressable onPress={handleClear} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#888888" />
          </Pressable>
        )}
      </View>
      {/* Explicit search button — focusable on Android TV/Firestick */}
      <Pressable
        onPress={handleSubmit}
        style={({focused}) => [
          styles.searchButton,
          focused && styles.searchButtonFocused
        ]}
      >
        <Ionicons name="search" size={20} color="#000" />
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 12,
    gap: 8,
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  inputRowFocused: {
    borderColor: '#B8A05C',
    backgroundColor: '#222',
  },
  icon: { marginRight: 8 },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
  },
  clearButton: { padding: 4 },
  searchButton: {
    backgroundColor: '#B8A05C',
    borderRadius: 12,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  searchButtonFocused: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.1 }],
  },
});
`;

fs.writeFileSync(F, CLEAN, 'utf8');
console.log('  [OK]   SearchBar.tsx rewritten clean (Stremio pattern)');
console.log('');
console.log('========================================');
console.log('  V53 done.');
console.log('========================================');
console.log('Rebuild APK, sideload, force-stop + relaunch on Streamer 4K.');
console.log('Expected:');
console.log('  ✓ Open Search → TextInput is auto-focused → system Gboard pops up.');
console.log('  ✓ Type via remote/keyboard → submit → results show.');
console.log('  ✓ Phone behavior unchanged.');
console.log('');
console.log('Verify:');
console.log('  findstr /S /C:"PATCH_V53" frontend\\\\src\\\\components\\\\SearchBar.tsx');
