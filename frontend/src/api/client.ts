import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Get the backend URL based on environment
const getBaseUrl = () => {
  // For web, use relative URL (proxied through same domain)
  if (Platform.OS === 'web') {
    return '';
  }
  // For mobile (Expo Go), use the full backend URL
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl;
  if (backendUrl) {
    return backendUrl;
  }
  // Fallback - try the packager hostname
  return 'https://privastream-7.preview.emergentagent.com';
};

const BASE_URL = getBaseUrl();

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface User {
  id: string;
  username: string;
  email: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Episode {
  id: string;
  season: number;
  episode: number;
  name: string;
  thumbnail?: string;
  overview?: string;
  released?: string;
}

export interface ContentItem {
  id: string;
  imdb_id?: string;
  name: string;
  type: 'movie' | 'series';
  poster: string;
  year?: string;
  imdbRating?: string | number;
  description?: string;
  genre?: string[];
  cast?: string[];
  director?: string[];
  runtime?: string;
  background?: string;
  logo?: string;
  trailerStreams?: { title: string; ytId: string }[];
  videos?: Episode[];  // Episodes for series
}

export interface DiscoverResponse {
  continueWatching: ContentItem[];
  services: {
    [key: string]: {
      movies: ContentItem[];
      series: ContentItem[];
    };
  };
}

export interface Addon {
  id: string;
  userId: string;
  manifestUrl: string;
  manifest: {
    id: string;
    name: string;
    version: string;
    description: string;
    logo: string | null;
    types: string[];
    resources: string[];
  };
  installed: boolean;
  installedAt: string;
}

export interface Stream {
  name: string;
  title?: string;
  url?: string;
  infoHash?: string;
  sources?: string[];
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
  };
}

export interface LibraryResponse {
  movies: ContentItem[];
  series: ContentItem[];
}

export interface SearchResult {
  id: string;
  name: string;
  poster: string;
  type: 'movie' | 'series';
  year?: string;
  imdbRating?: number;
}

export const api = {
  auth: {
    login: async (username: string, password: string): Promise<AuthResponse> => {
      const response = await apiClient.post('/api/auth/login', { username, password });
      return response.data;
    },
    register: async (username: string, email: string, password: string): Promise<AuthResponse> => {
      const response = await apiClient.post('/api/auth/register', { username, email, password });
      return response.data;
    },
  },
  content: {
    getDiscover: async (): Promise<DiscoverResponse> => {
      const response = await apiClient.get('/api/content/discover-organized');
      return response.data;
    },
    search: async (query: string): Promise<{ movies: SearchResult[]; series?: SearchResult[] }> => {
      const response = await apiClient.get(`/api/content/search?q=${encodeURIComponent(query)}`);
      return response.data;
    },
    getMeta: async (type: string, id: string): Promise<ContentItem> => {
      const response = await apiClient.get(`/api/content/meta/${type}/${id}`);
      return response.data;
    },
  },
  addons: {
    getAll: async (): Promise<Addon[]> => {
      const response = await apiClient.get('/api/addons');
      return response.data;
    },
    getStreams: async (addonId: string, type: string, id: string): Promise<{ streams: Stream[] }> => {
      const response = await apiClient.get(`/api/addons/${addonId}/stream/${type}/${id}`);
      return response.data;
    },
    getAllStreams: async (type: string, id: string): Promise<{ streams: Stream[] }> => {
      // Fetch from backend first
      const response = await apiClient.get(`/api/streams/${type}/${id}`);
      let allStreams = response.data.streams || [];
      
      // Also fetch directly from Torrentio on the client (bypasses Cloudflare)
      try {
        const torrentioStreams = await api.addons.fetchTorrentioStreams(type, id);
        if (torrentioStreams.length > 0) {
          // Merge and dedupe by infoHash
          const existingHashes = new Set(allStreams.map((s: Stream) => s.infoHash?.toLowerCase()).filter(Boolean));
          const newStreams = torrentioStreams.filter((s: Stream) => 
            s.infoHash && !existingHashes.has(s.infoHash.toLowerCase())
          );
          allStreams = [...allStreams, ...newStreams];
        }
      } catch (e) {
        console.log('Client-side Torrentio fetch failed, using backend streams:', e);
      }
      
      // Sort by seeders (highest first)
      allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
      
      return { streams: allStreams };
    },
    
    fetchTorrentioStreams: async (type: string, id: string): Promise<Stream[]> => {
      // Direct client-side fetch from Torrentio (mobile apps bypass Cloudflare)
      try {
        const torrentioUrl = `https://torrentio.strem.fun/sort=seeders|qualityfilter=480p,scr,cam/stream/${type}/${id}.json`;
        const response = await fetch(torrentioUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          const rawStreams = data.streams || [];
          
          // Parse Torrentio streams
          return rawStreams.map((stream: any) => {
            const name = stream.name || '';
            const title = stream.title || '';
            
            // Extract infoHash
            let infoHash = stream.infoHash;
            if (!infoHash && stream.behaviorHints?.bingeGroup?.length === 40) {
              infoHash = stream.behaviorHints.bingeGroup;
            }
            if (!infoHash && stream.url?.includes('magnet:')) {
              const match = stream.url.match(/btih:([a-fA-F0-9]{40})/);
              if (match) infoHash = match[1];
            }
            
            // Parse seeders from title (format: "👤 123")
            let seeders = 0;
            const seederMatch = title.match(/👤\s*(\d+)/);
            if (seederMatch) seeders = parseInt(seederMatch[1], 10);
            
            // Determine quality
            const quality = name.toUpperCase().includes('4K') || name.includes('2160') ? '4K' :
                           name.includes('1080') ? '1080p' :
                           name.includes('720') ? '720p' : 'SD';
            
            return {
              name: `⚡ ${name}`,
              title: title,
              infoHash: infoHash?.toLowerCase(),
              sources: ['tracker:udp://tracker.opentrackr.org:1337/announce'],
              addon: 'Torrentio',
              seeders: seeders,
              quality: quality,
            };
          }).filter((s: Stream) => s.infoHash);
        }
      } catch (e) {
        console.log('Torrentio direct fetch error:', e);
      }
      return [];
    },
    install: async (manifestUrl: string): Promise<Addon> => {
      const response = await apiClient.post('/api/addons/install', { manifestUrl });
      return response.data;
    },
    uninstall: async (addonId: string): Promise<void> => {
      await apiClient.delete(`/api/addons/${addonId}`);
    },
  },
  library: {
    get: async (): Promise<LibraryResponse> => {
      const response = await apiClient.get('/api/library');
      return response.data;
    },
    add: async (item: ContentItem): Promise<void> => {
      await apiClient.post('/api/library', item);
    },
    remove: async (type: string, id: string): Promise<void> => {
      await apiClient.delete(`/api/library/${type}/${id}`);
    },
  },
  admin: {
    getUsers: async (): Promise<User[]> => {
      const response = await apiClient.get('/api/admin/users');
      return response.data;
    },
    createUser: async (userData: { username: string; password: string; email?: string; is_admin?: boolean }): Promise<User> => {
      const response = await apiClient.post('/api/admin/users', userData);
      return response.data;
    },
    updateUser: async (userId: string, userData: { email?: string; password?: string; is_admin?: boolean }): Promise<User> => {
      const response = await apiClient.put(`/api/admin/users/${userId}`, userData);
      return response.data;
    },
    deleteUser: async (userId: string): Promise<void> => {
      await apiClient.delete(`/api/admin/users/${userId}`);
    },
  },
  stream: {
    start: async (infoHash: string): Promise<{ status: string; info_hash: string }> => {
      const response = await apiClient.post(`/api/stream/start/${infoHash}`);
      return response.data;
    },
    status: async (infoHash: string): Promise<{
      status: string;
      progress?: number;
      peers?: number;
      download_rate?: number;
      upload_rate?: number;
      video_file?: string;
      video_size?: number;
      downloaded?: number;
    }> => {
      const response = await apiClient.get(`/api/stream/status/${infoHash}`);
      return response.data;
    },
    getVideoUrl: (infoHash: string): string => {
      // Return the full URL for the video stream
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      return `${baseUrl}/api/stream/video/${infoHash}`;
    },
  },
};

export default apiClient;
