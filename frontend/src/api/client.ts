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
  return 'https://streamingnest.preview.emergentagent.com';
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
  title?: string;  // Alternative field name for episode title
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
  channels: ContentItem[];
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
      
      // Fetch from backend first - encode ID to handle URLs and special characters
      const encodedId = encodeURIComponent(id);
      let allStreams: Stream[] = [];
      
      try {
        const response = await apiClient.get(`/api/streams/${type}/${encodedId}`);
        allStreams = response.data.streams || [];
        console.log(`[STREAMS] Backend returned ${allStreams.length} streams`);
      } catch (e) {
        console.log(`[STREAMS] Backend fetch failed:`, e);
      }
      
      // CLIENT-SIDE FETCHING: Bypass Cloudflare by fetching directly from the app
      // This works because mobile apps and browsers appear as regular users, not servers
      
      // Fetch from Torrentio (supports movie, series, anime with tt/kitsu prefixes)
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
      
      // Fetch from ThePirateBay+ (supports movie, series with tt prefix)
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
      
      // Filter for correct episode if this is a series episode (id format: tt1234567:1:5)
      if (type === 'series' && id.includes(':')) {
        const parts = id.split(':');
        if (parts.length >= 3) {
          const targetSeason = parts[1].padStart(2, '0');
          const targetEpisode = parts[2].padStart(2, '0');
          const sInt = String(parseInt(parts[1], 10));
          const eInt = String(parseInt(parts[2], 10));
          
          // Patterns that match the target episode
          const targetPatterns = [
            `S${targetSeason}E${targetEpisode}`,  // S01E05
            `S${sInt}E${eInt}`,                    // S1E5
            `S${sInt}E${targetEpisode}`,           // S1E05
            `S${targetSeason}E${eInt}`,            // S01E5
            `${sInt}X${targetEpisode}`,            // 1x05
          ].map(p => p.toUpperCase());
          
          // Function to check if a stream is for a WRONG episode
          const isWrongEpisode = (title: string): boolean => {
            const upper = title.toUpperCase();
            
            // Look for SxxEyy patterns
            const sxePatterns = upper.match(/S(\d{1,2})E(\d{1,2})/g) || [];
            for (const match of sxePatterns) {
              const m = match.match(/S(\d{1,2})E(\d{1,2})/);
              if (m) {
                const foundS = m[1].padStart(2, '0');
                const foundE = m[2].padStart(2, '0');
                if (foundS !== targetSeason || foundE !== targetEpisode) {
                  return true; // Wrong episode
                }
              }
            }
            
            // Look for 1x05 patterns
            const xPatterns = upper.match(/(\d{1,2})X(\d{1,2})/g) || [];
            for (const match of xPatterns) {
              const m = match.match(/(\d{1,2})X(\d{1,2})/);
              if (m) {
                const foundS = m[1].padStart(2, '0');
                const foundE = m[2].padStart(2, '0');
                if (foundS !== targetSeason || foundE !== targetEpisode) {
                  return true; // Wrong episode
                }
              }
            }
            
            // Check for season packs (e.g., "S01-S04" or "S01 S02 S03")
            if (/S\d{1,2}[-\s]S\d{1,2}/i.test(title) || /S\d{1,2}\s+S\d{1,2}/i.test(title)) {
              return true; // Season pack
            }
            
            // Check for "Complete Series" or "All Seasons"
            if (/COMPLETE|ALL\s*SEASONS|FULL\s*SERIES/i.test(title)) {
              return true;
            }
            
            // Check for Russian "Сезон: X" that doesn't match
            const russianSeason = title.match(/СЕЗОН[:\s]*(\d+)/i);
            if (russianSeason) {
              const foundS = russianSeason[1].padStart(2, '0');
              if (foundS !== targetSeason) {
                return true;
              }
            }
            
            return false;
          };
          
          const beforeFilter = allStreams.length;
          allStreams = allStreams.filter((s: Stream) => {
            const combined = `${s.title || ''} ${s.name || ''}`;
            return !isWrongEpisode(combined);
          });
          console.log(`[STREAMS] Episode filter: ${beforeFilter} -> ${allStreams.length} streams for S${targetSeason}E${targetEpisode}`);
        }
      }
      
      // Sort by seeders (highest first)
      allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
      
      console.log(`[STREAMS] Total streams after filter: ${allStreams.length}`);
      return { streams: allStreams };
    },
    
    fetchTorrentioStreams: async (type: string, id: string): Promise<Stream[]> => {
      // For web: use backend proxy to bypass CORS
      // For mobile: direct fetch (no CORS restrictions)
      const isWeb = Platform.OS === 'web';
      
      try {
        let data: any;
        
        if (isWeb) {
          // Use backend proxy to bypass CORS on web
          console.log(`[TORRENTIO] Using backend proxy for web`);
          const response = await apiClient.get(`/api/addon-proxy/torrentio/${type}/${id}`);
          data = response.data;
        } else {
          // Direct fetch on mobile (no CORS)
          const TORRENTIO_BASE = 'https://torrentio.strem.fun';
          const CONFIG = 'sort=seeders|qualityfilter=480p,scr,cam';
          const torrentioUrl = `${TORRENTIO_BASE}/${CONFIG}/stream/${type}/${id}.json`;
          console.log(`[TORRENTIO] Direct fetch: ${torrentioUrl}`);
          
          const response = await fetch(torrentioUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
          });
          
          if (!response.ok) {
            console.log(`[TORRENTIO] Response status: ${response.status}`);
            return [];
          }
          
          data = await response.json();
        }
        
        const rawStreams = data.streams || [];
        console.log(`[TORRENTIO] Raw streams count: ${rawStreams.length}`);
        
        // Parse Torrentio streams
        const parsedStreams = rawStreams.map((stream: any) => {
          const name = stream.name || '';
          const title = stream.title || '';
          
          // Extract infoHash from multiple possible sources
          let infoHash = stream.infoHash;
          if (!infoHash && stream.behaviorHints?.bingeGroup?.length === 40) {
            infoHash = stream.behaviorHints.bingeGroup;
          }
          if (!infoHash && stream.url?.includes('magnet:')) {
            const match = stream.url.match(/btih:([a-fA-F0-9]{40})/i);
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
        }).filter((s: any) => s.infoHash);
        
        console.log(`[TORRENTIO] Parsed streams with infoHash: ${parsedStreams.length}`);
        return parsedStreams;
      } catch (e: any) {
        console.log(`[TORRENTIO] Fetch error: ${e.message || e}`);
      }
      return [];
    },
    
    fetchTPBStreams: async (type: string, id: string): Promise<Stream[]> => {
      // For web: use backend proxy to bypass CORS
      // For mobile: direct fetch (no CORS restrictions)
      const isWeb = Platform.OS === 'web';
      
      try {
        let data: any;
        
        if (isWeb) {
          // Use backend proxy to bypass CORS on web
          console.log(`[TPB+] Using backend proxy for web`);
          const response = await apiClient.get(`/api/addon-proxy/tpb/${type}/${id}`);
          data = response.data;
        } else {
          // Direct fetch on mobile (no CORS)
          const TPB_BASE = 'https://thepiratebay-plus.strem.fun';
          const tpbUrl = `${TPB_BASE}/stream/${type}/${id}.json`;
          console.log(`[TPB+] Direct fetch: ${tpbUrl}`);
          
          const response = await fetch(tpbUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
            },
          });
          
          if (!response.ok) {
            console.log(`[TPB+] Response status: ${response.status}`);
            return [];
          }
          
          data = await response.json();
        }
        
        const rawStreams = data.streams || [];
        console.log(`[TPB+] Raw streams count: ${rawStreams.length}`);
        
        // Parse TPB+ streams
        const parsedStreams = rawStreams.map((stream: any) => {
          const name = stream.name || '';
          const title = stream.title || '';
          
          // Extract infoHash from multiple possible sources
          let infoHash = stream.infoHash;
          if (!infoHash && stream.behaviorHints?.bingeGroup?.length === 40) {
            infoHash = stream.behaviorHints.bingeGroup;
          }
          if (!infoHash && stream.url?.includes('magnet:')) {
            const match = stream.url.match(/btih:([a-fA-F0-9]{40})/i);
            if (match) infoHash = match[1];
          }
          
          // Parse seeders from title (various formats)
          let seeders = 0;
          const seederMatch = title.match(/👤\s*(\d+)/) || title.match(/Seeds?:\s*(\d+)/i) || title.match(/(\d+)\s*seeds?/i);
          if (seederMatch) seeders = parseInt(seederMatch[1], 10);
          
          // Determine quality
          const quality = name.toUpperCase().includes('4K') || name.includes('2160') ? '4K' :
                         name.includes('1080') ? '1080p' :
                         name.includes('720') ? '720p' : 'SD';
          
          return {
            name: `🏴‍☠️ ${name}`,
            title: title,
            infoHash: infoHash?.toLowerCase(),
            sources: ['tracker:udp://tracker.opentrackr.org:1337/announce'],
            addon: 'ThePirateBay+',
            seeders: seeders,
            quality: quality,
          };
        }).filter((s: any) => s.infoHash);
        
        console.log(`[TPB+] Parsed streams with infoHash: ${parsedStreams.length}`);
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
