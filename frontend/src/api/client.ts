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
  // Production backend URL - hardcoded for standalone APK builds
  // This ensures the app always connects to the correct backend
  return 'https://streamsphere-86.preview.emergentagent.com';
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

// Handle 401/403 responses - clear invalid auth
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      // Token is invalid or expired - clear stored auth
      console.log('[API] Auth error, clearing stored credentials');
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('user');
    }
    return Promise.reject(error);
  }
);

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
  title?: string;
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
  videos?: Episode[];
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
    filename?: string;
  };
  filename?: string;
  fileIdx?: number;
  addon?: string;
  seeders?: number;
  quality?: string;
}

export interface LibraryResponse {
  movies: ContentItem[];
  series: ContentItem[];
  channels: ContentItem[];
}

export interface WatchProgress {
  content_id: string;
  content_type: string;
  title: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  progress: number;
  duration: number;
  percent_watched: number;
  season?: number;
  episode?: number;
  episode_title?: string;
  series_id?: string;
  stream_info_hash?: string;
  stream_url?: string;
  stream_file_idx?: number;
  stream_filename?: string;
  updated_at?: string;
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
    search: async (query: string, skip: number = 0, limit: number = 30): Promise<{ movies: SearchResult[]; series: SearchResult[]; hasMore: boolean; total: number }> => {
      const response = await apiClient.get(`/api/content/search?q=${encodeURIComponent(query)}&skip=${skip}&limit=${limit}`);
      return response.data;
    },
    getMeta: async (type: string, id: string): Promise<ContentItem> => {
      const encodedId = encodeURIComponent(id);
      const response = await apiClient.get(`/api/content/meta/${type}/${encodedId}`);
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
      console.log(`[STREAMS] ========== Fetching streams for ${type}/${id} ==========`);
      
      const encodedId = encodeURIComponent(id);
      let allStreams: Stream[] = [];
      
      try {
        const response = await apiClient.get(`/api/streams/${type}/${encodedId}`);
        allStreams = response.data.streams || [];
        console.log(`[STREAMS] Backend returned ${allStreams.length} streams`);
      } catch (e) {
        console.log(`[STREAMS] Backend fetch failed:`, e);
      }
      
      // Fetch from Torrentio
      try {
        const torrentioStreams = await api.addons.fetchTorrentioStreams(type, id);
        console.log(`[STREAMS] Torrentio client-side: ${torrentioStreams.length} streams`);
        if (torrentioStreams.length > 0) {
          const existingHashes = new Set(allStreams.map((s: Stream) => s.infoHash?.toLowerCase()).filter(Boolean));
          const newStreams = torrentioStreams.filter((s: Stream) => 
            s.infoHash && !existingHashes.has(s.infoHash.toLowerCase())
          );
          console.log(`[STREAMS] Adding ${newStreams.length} new Torrentio streams`);
          allStreams = [...allStreams, ...newStreams];
        }
      } catch (e: any) {
        console.log(`[STREAMS] Torrentio client-side error: ${e.message || e}`);
      }
      
      // Fetch from ThePirateBay+
      try {
        const tpbStreams = await api.addons.fetchTPBStreams(type, id);
        console.log(`[STREAMS] TPB+ client-side: ${tpbStreams.length} streams`);
        if (tpbStreams.length > 0) {
          const existingHashes = new Set(allStreams.map((s: Stream) => s.infoHash?.toLowerCase()).filter(Boolean));
          const newStreams = tpbStreams.filter((s: Stream) => 
            s.infoHash && !existingHashes.has(s.infoHash.toLowerCase())
          );
          console.log(`[STREAMS] Adding ${newStreams.length} new TPB+ streams`);
          allStreams = [...allStreams, ...newStreams];
        }
      } catch (e: any) {
        console.log(`[STREAMS] TPB+ client-side error: ${e.message || e}`);
      }
      
      // Sort by seeders
      allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
      
      console.log(`[STREAMS] Total streams: ${allStreams.length}`);
      return { streams: allStreams };
    },
    
    fetchTorrentioStreams: async (type: string, id: string): Promise<Stream[]> => {
      const TORRENTIO_BASE = 'https://torrentio.strem.fun';
      const CONFIG = 'sort=seeders|qualityfilter=480p,scr,cam';
      const torrentioUrl = `${TORRENTIO_BASE}/${CONFIG}/stream/${type}/${id}.json`;
      
      try {
        let data: any;
        
        try {
          console.log(`[TORRENTIO] Trying allorigins proxy...`);
          const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(torrentioUrl)}`;
          const response = await fetch(allOriginsUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          });
          if (response.ok) {
            const result = await response.json();
            if (result?.streams?.length > 0) {
              console.log(`[TORRENTIO] allorigins success: ${result.streams.length} streams`);
              data = result;
            }
          }
        } catch (e: any) {
          console.log(`[TORRENTIO] allorigins failed: ${e.message || e}`);
        }
        
        if (!data?.streams?.length) {
          try {
            console.log(`[TORRENTIO] Trying direct fetch...`);
            const response = await fetch(torrentioUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
            });
            if (response.ok) {
              const result = await response.json();
              if (result?.streams?.length > 0) {
                console.log(`[TORRENTIO] Direct fetch success: ${result.streams.length} streams`);
                data = result;
              }
            }
          } catch (e: any) {
            console.log(`[TORRENTIO] Direct fetch failed: ${e.message || e}`);
          }
        }
        
        const rawStreams = data?.streams || [];
        
        const parsedStreams = rawStreams.map((stream: any) => {
          const name = stream.name || '';
          const title = stream.title || '';
          
          let infoHash = stream.infoHash;
          if (!infoHash && stream.behaviorHints?.bingeGroup?.length === 40) {
            infoHash = stream.behaviorHints.bingeGroup;
          }
          
          let seeders = 0;
          const seederMatch = title.match(/👤\s*(\d+)/);
          if (seederMatch) seeders = parseInt(seederMatch[1], 10);
          
          const quality = name.toUpperCase().includes('4K') || name.includes('2160') ? '4K' :
                         name.includes('1080') ? '1080p' :
                         name.includes('720') ? '720p' : 'SD';
          
          const filename = stream.behaviorHints?.filename || '';
          const fileIdx = stream.fileIdx;
          
          return {
            name: `⚡ ${name}`,
            title: title,
            infoHash: infoHash?.toLowerCase(),
            sources: stream.sources || ['tracker:udp://tracker.opentrackr.org:1337/announce'],
            addon: 'Torrentio',
            seeders: seeders,
            quality: quality,
            filename: filename,
            fileIdx: fileIdx,
          };
        }).filter((s: any) => s.infoHash);
        
        return parsedStreams;
      } catch (e: any) {
        console.log(`[TORRENTIO] Fetch error: ${e.message || e}`);
      }
      return [];
    },
    
    fetchTPBStreams: async (type: string, id: string): Promise<Stream[]> => {
      const TPB_BASE = 'https://thepiratebay-plus.strem.fun';
      const tpbUrl = `${TPB_BASE}/stream/${type}/${id}.json`;
      
      try {
        let data: any;
        
        try {
          console.log(`[TPB+] Trying allorigins proxy...`);
          const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(tpbUrl)}`;
          const response = await fetch(allOriginsUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          });
          if (response.ok) {
            const result = await response.json();
            if (result?.streams?.length > 0) {
              console.log(`[TPB+] allorigins success: ${result.streams.length} streams`);
              data = result;
            }
          }
        } catch (e: any) {
          console.log(`[TPB+] allorigins failed: ${e.message || e}`);
        }
        
        if (!data?.streams?.length) {
          try {
            console.log(`[TPB+] Trying direct fetch...`);
            const response = await fetch(tpbUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/json' },
            });
            if (response.ok) {
              const result = await response.json();
              if (result?.streams?.length > 0) {
                console.log(`[TPB+] Direct fetch success: ${result.streams.length} streams`);
                data = result;
              }
            }
          } catch (e: any) {
            console.log(`[TPB+] Direct fetch failed: ${e.message || e}`);
          }
        }
        
        const rawStreams = data?.streams || [];
        
        const parsedStreams = rawStreams.map((stream: any) => {
          const name = stream.name || '';
          const title = stream.title || '';
          
          let infoHash = stream.infoHash;
          if (!infoHash && stream.behaviorHints?.bingeGroup?.length === 40) {
            infoHash = stream.behaviorHints.bingeGroup;
          }
          
          let seeders = 0;
          const seederMatch = title.match(/👤\s*(\d+)/) || title.match(/Seeds?:\s*(\d+)/i);
          if (seederMatch) seeders = parseInt(seederMatch[1], 10);
          
          const quality = name.toUpperCase().includes('4K') || name.includes('2160') ? '4K' :
                         name.includes('1080') ? '1080p' :
                         name.includes('720') ? '720p' : 'SD';
          
          const filename = stream.behaviorHints?.filename || '';
          const fileIdx = stream.fileIdx;
          
          return {
            name: `🏴‍☠️ ${name}`,
            title: title,
            infoHash: infoHash?.toLowerCase(),
            sources: stream.sources || ['tracker:udp://tracker.opentrackr.org:1337/announce'],
            addon: 'ThePirateBay+',
            seeders: seeders,
            quality: quality,
            filename: filename,
            fileIdx: fileIdx,
          };
        }).filter((s: any) => s.infoHash);
        
        return parsedStreams;
      } catch (e: any) {
        console.log(`[TPB+] Fetch error: ${e.message || e}`);
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
  subtitles: {
    get: async (contentType: string, contentId: string): Promise<{
      subtitles: Array<{
        id: string;
        url: string;
        lang: string;
        langName: string;
      }>;
    }> => {
      try {
        const response = await apiClient.get(`/api/subtitles/${contentType}/${contentId}`);
        return response.data;
      } catch (err) {
        console.log('[API] Subtitles fetch error:', err);
        return { subtitles: [] };
      }
    },
  },
  stream: {
    start: async (infoHash: string, fileIdx?: number, filename?: string): Promise<{ status: string; info_hash: string }> => {
      const params = new URLSearchParams();
      if (fileIdx !== undefined && fileIdx !== null) {
        params.append('fileIdx', String(fileIdx));
      }
      if (filename) {
        params.append('filename', filename);
      }
      const queryString = params.toString();
      const url = `/api/stream/start/${infoHash}${queryString ? '?' + queryString : ''}`;
      const response = await apiClient.post(url);
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
    getVideoUrl: (infoHash: string, fileIdx?: number): string => {
      const baseUrl = Platform.OS === 'web' ? '' : 'https://streamsphere-86.preview.emergentagent.com';
      const params = fileIdx !== undefined && fileIdx !== null ? `?fileIdx=${fileIdx}` : '';
      return `${baseUrl}/api/stream/video/${infoHash}${params}`;
    },
  },
  watchProgress: {
    getAll: async (): Promise<{ continueWatching: WatchProgress[] }> => {
      try {
        const response = await apiClient.get('/api/watch-progress');
        return response.data;
      } catch (err) {
        console.log('[API] Watch progress fetch error:', err);
        return { continueWatching: [] };
      }
    },
    get: async (contentId: string): Promise<{ progress: WatchProgress | null }> => {
      try {
        const response = await apiClient.get(`/api/watch-progress/${encodeURIComponent(contentId)}`);
        return response.data;
      } catch (err) {
        console.log('[API] Watch progress get error:', err);
        return { progress: null };
      }
    },
    save: async (progress: Omit<WatchProgress, 'percent_watched' | 'updated_at'>): Promise<{ message: string; percent_watched: number }> => {
      try {
        const response = await apiClient.post('/api/watch-progress', progress);
        return response.data;
      } catch (err) {
        console.log('[API] Watch progress save error:', err);
        return { message: 'Error', percent_watched: 0 };
      }
    },
    delete: async (contentId: string): Promise<{ message: string }> => {
      try {
        const response = await apiClient.delete(`/api/watch-progress/${encodeURIComponent(contentId)}`);
        return response.data;
      } catch (err) {
        console.log('[API] Watch progress delete error:', err);
        return { message: 'Error' };
      }
    },
  },
};

export default apiClient;