// Stremio-inspired color palette for PrivastreamCinema
// Based on Stremio's design system

export const colors = {
  // Primary colors
  primary: '#8A5AAB',           // Stremio purple accent
  primaryLight: '#A374C4',
  primaryDark: '#6B4488',
  
  // Accent colors (our brand tan)
  accent: '#B8A05C',
  accentLight: '#D4BC78',
  accentDark: '#9A8540',
  
  // Background colors
  background: '#0F0F0F',        // Main app background
  backgroundLight: '#161616',   // Cards, elevated surfaces
  backgroundLighter: '#1E1E1E', // Hover states
  surface: '#242424',           // Input fields, modals
  surfaceLight: '#2D2D2D',
  overlay: 'rgba(0, 0, 0, 0.8)',
  
  // Text colors
  textPrimary: '#FFFFFF',
  textSecondary: '#B0B0B0',
  textMuted: '#707070',
  textDisabled: '#505050',
  
  // Focus/Selection
  focusGlow: 'rgba(138, 90, 171, 0.6)',  // Purple glow for focus
  focusBorder: '#8A5AAB',
  selectionBackground: 'rgba(138, 90, 171, 0.2)',
  
  // Status colors
  success: '#4CAF50',
  warning: '#FF9800',
  error: '#F44336',
  info: '#2196F3',
  
  // Progress bar
  progressBackground: 'rgba(255, 255, 255, 0.3)',
  progressFill: '#FFFFFF',
  
  // Border colors
  border: '#2A2A2A',
  borderLight: '#3A3A3A',
};

// Stremio poster shape ratios
export const posterShapes = {
  poster: 1.5,      // 2:3 aspect ratio (standard movie posters)
  landscape: 0.5625, // 16:9 aspect ratio
  square: 1,        // 1:1 aspect ratio
};

// Focus ring style (Stremio uses thin glow, not thick border)
export const focusStyle = {
  shadowColor: colors.focusGlow,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 1,
  shadowRadius: 8,
  elevation: 8,
};

export default colors;
