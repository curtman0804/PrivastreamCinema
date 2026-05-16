/* eslint-disable */
// apply_patches_v51.js — Make Search work on Google Streamer 4K / Android TV.
//
// ROOT CAUSE:
//   In frontend/src/components/SearchBar.tsx the <TextInput> sits inside a
//   bare <View>. On Android TV the D-pad can ONLY land on focusable views
//   (Pressable, TouchableOpacity, etc.). A naked TextInput is NOT focusable
//   via D-pad — the focus engine jumps right past it, so the soft keyboard
//   never pops up.
//
// FIX:
//   1. Wrap the input row in a <Pressable> that, on select, programmatically
//      calls inputRef.current?.focus() — this pops the TV soft IME.
//   2. Add hasTVPreferredFocus + autoFocus on the TextInput so the screen
//      lands on it automatically when opened.
//   3. Add showSoftInputOnFocus={true} to force the IME to appear.
//   4. Add visual focus styling so users see the input is selected.
//
// Idempotent. CRLF-safe. .bak.v51.<ts> backup in
// C:\Users\Curtm\PrivastreamCinema\frontend\src\components\.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'src', 'components', 'SearchBar.tsx');
const MARK = 'PATCH_V51_TV_SEARCH';

if (!fs.existsSync(F)) {
  console.error('ERROR: ' + F + ' not found.');
  process.exit(1);
}

let raw = fs.readFileSync(F, 'utf8');
const hadCRLF = raw.indexOf('\r\n') >= 0;
let src = raw.replace(/\r\n/g, '\n');

if (src.includes(MARK)) {
  console.log('[OK] V51 already applied. No changes made.');
  process.exit(0);
}

let fails = 0;
function fail(m) { fails++; console.log('  [FAIL] ' + m); }
function ok(m) { console.log('  [OK]   ' + m); }

// ─── 1. Add useRef + Platform imports ───
const oldImport = `import React, { useState, useEffect } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native';`;
const newImport = `import React, { useState, useEffect, useRef } from 'react'; // ${MARK}
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  Platform, // ${MARK}
} from 'react-native';`;
if (!src.includes(oldImport)) {
  fail('imports anchor not found');
} else {
  src = src.replace(oldImport, newImport);
  ok('added useRef + Platform imports');
}

// ─── 2. Add isTV + inputRef + showSoftInput state right after useState(initialValue) ───
const oldState = `  const [query, setQuery] = useState(initialValue);`;
const newState = `  const [query, setQuery] = useState(initialValue);
  // ${MARK} — TV-specific input handling.
  const inputRef = useRef<TextInput>(null);
  const [rowFocused, setRowFocused] = useState(false);
  const isAndroid = Platform.OS === 'android';
  const handleRowPress = () => {
    // On Android TV, programmatically focusing the input pops the soft IME.
    try { inputRef.current?.focus(); } catch (_) {}
  };`;

if (!src.includes(oldState)) {
  fail('useState anchor not found');
} else {
  src = src.replace(oldState, newState);
  ok('added inputRef + handleRowPress for TV');
}

// ─── 3. Replace the input row JSX ───
const oldRow = `      <View style={styles.inputRow}>
        <Ionicons name="search" size={20} color="#888888" style={styles.icon} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#888888"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={handleClear} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#888888" />
          </Pressable>
        )}
      </View>`;

const newRow = `      {/* ${MARK} — input row is now a Pressable so D-pad on Android TV can focus it. */}
      <Pressable
        onPress={handleRowPress}
        onFocus={() => setRowFocused(true)}
        onBlur={() => setRowFocused(false)}
        hasTVPreferredFocus={isAndroid && !initialValue}
        style={[
          styles.inputRow,
          rowFocused && styles.inputRowFocused,
        ]}
      >
        <Ionicons name="search" size={20} color="#888888" style={styles.icon} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor="#888888"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!initialValue}
          showSoftInputOnFocus={true}
          blurOnSubmit={false}
        />
        {query.length > 0 && (
          <Pressable onPress={handleClear} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#888888" />
          </Pressable>
        )}
      </Pressable>`;

if (!src.includes(oldRow)) {
  fail('input row JSX anchor not found');
} else {
  src = src.replace(oldRow, newRow);
  ok('wrapped input row in Pressable + added autoFocus/showSoftInputOnFocus');
}

// ─── 4. Add inputRowFocused style ───
const oldStyleHook = `  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },`;
const newStyleHook = `  inputRow: {
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
  inputRowFocused: { // ${MARK}
    borderColor: '#B8A05C',
    backgroundColor: '#222',
  },`;
if (!src.includes(oldStyleHook)) {
  fail('inputRow style anchor not found');
} else {
  src = src.replace(oldStyleHook, newStyleHook);
  ok('added inputRowFocused style');
}

// ─── Save ───
if (fails > 0) {
  console.log('\n[FAIL] ' + fails + ' anchor(s) failed — V51 NOT applied. Original file unchanged.');
  process.exit(1);
}

const bak = F + '.bak.v51.' + Date.now();
fs.copyFileSync(F, bak);
console.log('  [info] backup → ' + bak);
fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('\n========================================');
console.log('  V51 done. SearchBar is now TV-friendly.');
console.log('========================================');
console.log('Rebuild APK, sideload to Streamer 4K, force-stop + relaunch.');
console.log('Expected:');
console.log('  ✓ Open Search tab on Streamer → input row has gold focus border.');
console.log('  ✓ Press OK on remote → soft keyboard pops up automatically.');
console.log('  ✓ Type via remote/keyboard → query updates → press Search.');
console.log('  ✓ Phone behavior unchanged.');
console.log('');
console.log('Verify in code (Windows CMD):');
console.log('  findstr /S /C:"PATCH_V51" frontend\\src\\components\\SearchBar.tsx');
