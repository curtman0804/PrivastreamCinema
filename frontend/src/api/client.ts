import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// ============================================
// HARDCODED BACKEND URL - CHANGE THIS IF NEEDED
// ============================================
const BACKEND_URL = 'http://71.9.152.146:8001';

// Get the backend URL based on environment
const getBaseUrl = () => {
  // For web, use relative URL (proxied through same domain)
  if (Platform.OS === 'web') {
    return '';
  }
  
  // ALWAYS use hardcoded URL for mobile
  console.log('[API] Using hardcoded backend URL:', BACKEND_URL);
  return BACKEND_URL;
};

const BASE_URL = getBaseUrl();

const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// Add auth token to requests
apiClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Log every request for debugging
  console.log('[API] Request:', config.method?.toUpperCase(), config.baseURL + config.url);
  return config;
});

// Handle 401/403 responses - clear invalid auth
apiClient.interceptors.response.use(
  (response) => {
    console.log('[API] Response OK:', response.config.url);
    return response;
  },
  async (error) => {
    console.log('[API] Response ERROR:', error.message, error.config?.url);
    
    const requestUrl = error.config?.url || '';
    const isAuthEndpoint = requestUrl.includes('/auth/') || requestUrl.includes('/login');
    if ((error.response?.status === 401 || error.response?.status === 403) && isAuthEndpoint) {
      console.log('[API] Auth error on auth endpoint, clearing stored credentials');
      await AsyncStorage.removeItem('auth_token');
      await AsyncStorage.removeItem('user');
    }
    
    // Auto-retry on server errors (502, 503, 520, etc.)
    const config = error.config;
    if (!config || config.__retryCount >= 3) {
      return Promise.reject(error);
    }
    
    const status = error.response?.status || 0;
    const isServerError = status >= 500 || status === 0;
    
    if (isServerError && !config.__retryCount) {
      config.__retryCount = 0;
    }
    
    if (isServerError && config.__retryCount < 3) {
      config.__retryCount = (config.__retryCount || 0) + 1;
      const delay = config.__retryCount * 1500;
      console.log(`[API] Server error ${status}, retrying in ${delay}ms (attempt ${config.__retryCount}/3)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return apiClient(config);
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
  directUrl?: string;
  proxyUrl?: string;
  provider?: string;
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
  externalUrl?: string;
  requiresWebView?: boolean;
  isLive?: boolean;
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
      const response = await apiClient.get('/api/content/discover-organized', { timeout: 120000 });
      return response.data;
    },
    search: async (query: string, skip: number = 0, limit: number = 30): Promise<{ movies: SearchResult[]; series: SearchResult[]; hasMore: boolean; total: number }> => {
      const response = await apiClient.get(`/api/content/search?q=${encodeURIComponent(query)}&skip=${skip}&limit=${limit}`);
      return response.data;
    },
    getMeta: async (type: string, id: string): Promise<ContentItem> => {
      const cacheKey = `meta:${type}:${id}`;
      if (!((api as any)._metaCache)) (api as any)._metaCache = new Map();
      const cached = (api as any)._metaCache.get(cacheKey);
      if (cached && Date.now() - cached.time < 600000) {
        console.log(`[META] CACHE HIT for ${type}/${id}`);
        return cached.data;
      }
      
      const encodedId = encodeURIComponent(id);
      const response = await apiClient.get(`/api/content/meta/${type}/${encodedId}`);
      
      (api as any)._metaCache.set(cacheKey, { data: response.data, time: Date.now() });
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
    getAllStreams: async (type: string, id: string, onProgress?: (streams: Stream[]) => void): Promise<{ streams: Stream[] }> => {
      console.log(`[STREAMS] ========== Fetching streams for ${type}/${id} ==========`);
      const startTime = Date.now();
      
      const cacheKey = `streams:${type}:${id}`;
      const cached = (api as any)._streamCache?.get(cacheKey);
      if (cached && Date.now() - cached.time < 120000) {
        console.log(`[STREAMS] CACHE HIT: ${cached.streams.length} streams`);
        if (onProgress) onProgress(cached.streams);
        return { streams: cached.streams };
      }
      
      const encodedId = encodeURIComponent(id);
      
      if (type === 'tv') {
        try {
          const result = await apiClient.get(`/api/streams/${type}/${encodedId}`);
          const streams = result.data.streams || [];
          console.log(`[STREAMS] TV: ${streams.length} streams in ${Date.now() - startTime}ms`);
          if (onProgress) onProgress(streams);
          return { streams };
        } catch (e) {
          console.log(`[STREAMS] TV backend fetch failed:`, e);
          return { streams: [] };
        }
      }
      
      let allStreams: Stream[] = [];
      const existingHashes = new Set<string>();
      
      const mergeAndNotify = (newStreams: Stream[], sourceName: string) => {
        const deduplicated = newStreams.filter((s: Stream) => {
          if (s.infoHash) {
            const hash = s.infoHash.toLowerCase();
            if (existingHashes.has(hash)) return false;
            existingHashes.add(hash);
          }
          return true;
        });
        if (deduplicated.length > 0) {
          allStreams = [...allStreams, ...deduplicated];
          allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
          console.log(`[STREAMS] ${sourceName}: +${deduplicated.length} streams (total: ${allStreams.length}) in ${Date.now() - startTime}ms`);
          if (onProgress) onProgress([...allStreams]);
        } else {
          console.log(`[STREAMS] ${sourceName}: 0 new streams in ${Date.now() - startTime}ms`);
        }
      };
      
      const filterForEpisode = (streams: Stream[]): Stream[] => {
        if (type !== 'series' || !id.includes(':')) return streams;
        
        const parts = id.split(':');
        if (parts.length < 3) return streams;
        
        const sInt = parseInt(parts[1], 10);
        const eInt = parseInt(parts[2], 10);
        
        return streams.filter((s: Stream) => {
          const titleAndName = `${s.title || ''} ${s.name || ''} ${s.filename || ''}`.toUpperCase();
          
          if (/COMPLETE|ALL\s*SEASONS|FULL\s*SERIES/i.test(titleAndName)) return false;
          if (/S\d{1,2}\s*[-–]\s*S\d{1,2}/i.test(titleAndName)) return false;
          
          const seasonMatch = titleAndName.match(/\bS(\d{1,2})(?=E)/i);
          if (seasonMatch && parseInt(seasonMatch[1], 10) !== sInt) return false;
          
          const targetPattern = new RegExp(`S0?${sInt}E0?${eInt}\\b`, 'i');
          if (s.filename && targetPattern.test(s.filename)) return true;
          if (targetPattern.test(titleAndName)) return true;
          
          const rangePattern = /S(\d{1,2})E(\d{1,2})\s*[-–]\s*E?(\d{1,2})/gi;
          let rangeMatch;
          while ((rangeMatch = rangePattern.exec(titleAndName)) !== null) {
            const startE = parseInt(rangeMatch[2], 10);
            const endE = parseInt(rangeMatch[3], 10);
            if (parseInt(rangeMatch[1], 10) === sInt && startE <= eInt && endE >= eInt) {
              if (startE !== eInt || endE !== eInt) return false;
            }
          }
          
          // Check if there are ANY other episode refs that didn't match our target
          const anyEpPattern = /S\d{1,2}E\d{1,2}/i;
          if (anyEpPattern.test(titleAndName)) {
            // Has episode info but didn't match target - wrong episode
            return false;
          }
          
          // No explicit episode info - season/complete pack.
          // Only keep if source provided fileIdx (e.g. Torrentio resolves correct file)
          if (s.fileIdx !== undefined && s.fileIdx !== null) return true;
          
          // Season pack without fileIdx - will play wrong file
          return false;
        });
      };
      
      const backendPromise = apiClient.get(`/api/streams/${type}/${encodedId}`)
        .then(r => {
          const streams = filterForEpisode(r.data.streams || []);
          mergeAndNotify(streams, 'Backend');
        })
        .catch(e => console.log(`[STREAMS] Backend failed:`, e));
      
      const torrentioPromise = api.addons.fetchTorrentioStreams(type, id)
        .then(streams => mergeAndNotify(filterForEpisode(streams), 'Torrentio'))
        .catch(e => console.log(`[STREAMS] Torrentio failed:`, e));
      
      const tpbPromise = api.addons.fetchTPBStreams(type, id)
        .then(streams => mergeAndNotify(filterForEpisode(streams), 'TPB+'))
        .catch(e => console.log(`[STREAMS] TPB+ failed:`, e));
      
      await Promise.allSettled([backendPromise, torrentioPromise, tpbPromise]);
      
      console.log(`[STREAMS] All sources done: ${allStreams.length} total streams in ${Date.now() - startTime}ms`);
      
      allStreams.forEach((s: any) => {
        if (!s.seeders && s.title) {
          const m = s.title.match(/👤\s*(\d+)/);
          if (m) s.seeders = parseInt(m[1], 10);
        }
        if (!s.seeders && s.title) {
          const m = s.title.match(/🌱\s*(\d+)/);
          if (m) s.seeders = parseInt(m[1], 10);
        }
      });
      allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
      
      if (!((api as any)._streamCache)) (api as any)._streamCache = new Map();
      (api as any)._streamCache.set(cacheKey, { streams: allStreams, time: Date.now() });
      
      return { streams: allStreams };
    },
    
    fetchTorrentioStreams: async (type: string, id: string): Promise<Stream[]> => {
      const TORRENTIO_BASE = 'https://torrentio.strem.fun';
      const CONFIG = 'sort=seeders|qualityfilter=480p,scr,cam';
      const torrentioUrl = `${TORRENTIO_BASE}/${CONFIG}/stream/${type}/${id}.json`;
      
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
      
      try {
        let data: any;
        
        const racePromises = [
          withTimeout(fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(torrentioUrl)}`, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            return result;
          }), 2500),
          withTimeout(fetch(torrentioUrl, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            return result;
          }), 2500),
          withTimeout(apiClient.get(`/api/addon-proxy/torrentio/${type}/${id}`).then(r => {
            if (!r.data?.streams?.length) throw new Error('No streams');
            return r.data;
          }), 2500),
        ];
        
        try {
          data = await Promise.any(racePromises);
        } catch (e) {
          return [];
        }
        
        const rawStreams = data?.streams || [];
        
        const parsedStreams = rawStreams.map((stream: any) => {
          const name = stream.name || '';
          const title = stream.title || '';
          
          let infoHash = stream.infoHash;
          if (!infoHash && stream.behaviorHints?.bingeGroup?.length === 40) {
            infoHash = stream.behaviorHints.bingeGroup;
          }
          if (!infoHash && stream.url?.includes('magnet:')) {
            const match = stream.url.match(/btih:([a-fA-F0-9]{40})/i);
            if (match) infoHash = match[1];
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
            sources: stream.sources || ['tracker:http://tracker.opentrackr.org:1337/announce'],
            addon: 'Torrentio',
            seeders: seeders,
            quality: quality,
            filename: filename,
            fileIdx: fileIdx,
          };
        }).filter((s: any) => {
          if (!s.infoHash) return false;
          
          if (type === 'movie') {
            const combined = `${s.name || ''} ${s.title || ''}`.toLowerCase();
            const episodePattern = /S\d{1,2}E\d{1,2}/i;
            if (episodePattern.test(combined)) return false;
          }
          
          return true;
        });
        
        return parsedStreams;
      } catch (e: any) {
        console.log(`[TORRENTIO] Fetch error: ${e.message || e}`);
      }
      return [];
    },
    
    fetchTPBStreams: async (type: string, id: string): Promise<Stream[]> => {
      const TPB_BASE = 'https://thepiratebay-plus.strem.fun';
      const tpbUrl = `${TPB_BASE}/stream/${type}/${id}.json`;
      
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
      
      try {
        let data: any;
        
        const racePromises = [
          withTimeout(fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(tpbUrl)}`, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            return result;
          }), 2500),
          withTimeout(fetch(tpbUrl, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            return result;
          }), 2500),
          withTimeout(apiClient.get(`/api/addon-proxy/tpb/${type}/${id}`).then(r => {
            if (!r.data?.streams?.length) throw new Error('No streams');
            return r.data;
          }), 2500),
        ];
        
        try {
          data = await Promise.any(racePromises);
        } catch (e) {
          return [];
        }
        
        const rawStreams = data?.streams || [];
        
        const parsedStreams = rawStreams.map((stream: any) => {
          const name = stream.name || '';
          const title = stream.title || '';
          
          let infoHash = stream.infoHash;
          if (!infoHash && stream.behaviorHints?.bingeGroup?.length === 40) {
            infoHash = stream.behaviorHints.bingeGroup;
          }
          if (!infoHash && stream.url?.includes('magnet:')) {
            const match = stream.url.match(/btih:([a-fA-F0-9]{40})/i);
            if (match) infoHash = match[1];
          }
          
          let seeders = 0;
          const seederMatch = title.match(/👤\s*(\d+)/) || title.match(/Seeds?:\s*(\d+)/i) || title.match(/(\d+)\s*seeds?/i);
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
            sources: stream.sources || ['tracker:http://tracker.opentrackr.org:1337/announce'],
            addon: 'ThePirateBay+',
            seeders: seeders,
            quality: quality,
            filename: filename,
            fileIdx: fileIdx,
          };
        }).filter((s: any) => {
          if (!s.infoHash) return false;
          
          const combined = `${s.name || ''} ${s.title || ''}`.toLowerCase();
          const adultKeywords = ['xxx', 'porn', 'adult', 'herlimit', 'blacked', 'vixen', 'tushy', 'brazzers', 'bangbros', 'naughty', 'milf', 'stepmom', 'stepsister', 'onlyfans', 'leaked', 'nude', 'naked', 'sex tape', 'hardcore'];
          
          for (const keyword of adultKeywords) {
            if (combined.includes(keyword)) return false;
          }
          
          if (type === 'movie') {
            const episodePattern = /S\d{1,2}E\d{1,2}/i;
            if (episodePattern.test(combined)) return false;
          }
          
          return true;
        });
        
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
    resolveCode: async (code: string): Promise<{ url: string; code: string }> => {
      const response = await apiClient.get(`/api/addons/resolve-code/${code}`);
      return response.data;
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
    updateUser: async (userId: string, userData: { username?: string; email?: string; password?: string; is_admin?: boolean }): Promise<User> => {
      const response = await apiClient.put(`/api/admin/users/${userId}`, userData);
      return response.data;
    },
    deleteUser: async (userId: string): Promise<void> => {
      await apiClient.delete(`/api/admin/users/${userId}`);
    },
  },
  subtitles: {
    get: async (contentType: string, contentId: string): Promise<{
      subtitles: Array<{ id: string; url: string; lang: string; langName: string; }>;
    }> => {
      try {
        const response = await apiClient.get(`/api/subtitles/${contentType}/${contentId}`);
        return response.data;
      } catch (err) {
        return { subtitles: [] };
      }
    },
  },
  stream: {
    start: async (infoHash: string, fileIdx?: number, filename?: string, sources?: string[], season?: number, episode?: number): Promise<{ status: string; info_hash: string }> => {
      const params = new URLSearchParams();
      if (fileIdx !== undefined && fileIdx !== null) {
        params.append('fileIdx', String(fileIdx));
      }
      if (filename) {
        params.append('filename', filename);
      }
      const queryString = params.toString();
      const url = `/api/stream/start/${infoHash}${queryString ? '?' + queryString : ''}`;
      const body: any = {};
      if (sources && sources.length > 0) {
        body.sources = sources;
      }
      // Also put fileIdx, filename, season, episode in body for middleware
      if (fileIdx !== undefined && fileIdx !== null) body.fileIdx = fileIdx;
      if (filename) body.filename = filename;
      if (season !== undefined) body.season = season;
      if (episode !== undefined) body.episode = episode;
      const response = await apiClient.post(url, body);
      return response.data;
    },
    status: async (infoHash: string): Promise<{
      status: string;
      progress?: number;
      ready_progress?: number;
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
    prewarm: async (infoHash: string, sources?: string[]): Promise<{ status: string }> => {
      try {
        const body: any = {};
        if (sources && sources.length > 0) {
          body.sources = sources;
        }
        const response = await apiClient.post(`/api/stream/prewarm/${infoHash}`, body);
        return response.data;
      } catch (err) {
        return { status: 'failed' };
      }
    },
    getVideoUrl: (infoHash: string, fileIdx?: number, torrServerUrl?: string): string => {
      if (torrServerUrl) {
        const magnetLink = `magnet:?xt=urn:btih:${infoHash}`;
        const idxParam = fileIdx !== undefined && fileIdx !== null ? `&index=${fileIdx}` : '&index=0';
        return `${torrServerUrl}/stream?link=${encodeURIComponent(magnetLink)}${idxParam}&play`;
      }
      
      // USE HARDCODED URL FOR VIDEO STREAMING
      const baseUrl = Platform.OS === 'web' ? '' : BACKEND_URL;
      const params = fileIdx !== undefined && fileIdx !== null ? `?fileIdx=${fileIdx}` : '';
      return `${baseUrl}/api/stream/video/${infoHash}${params}`;
    },
    seek: async (infoHash: string, positionBytes: number): Promise<{ status: string }> => {
      try {
        const response = await apiClient.post(`/api/stream/seek/${infoHash}`, {
          position_bytes: positionBytes,
        });
        return response.data;
      } catch (err) {
        return { status: 'failed' };
      }
    },
    prefetch: async (infoHash: string, positionBytes: number): Promise<{ status: string; wait_ms?: number }> => {
      try {
        const response = await apiClient.post(`/api/stream/prefetch/${infoHash}`, {
          position_bytes: positionBytes,
        }, { timeout: 35000 });
        return response.data;
      } catch (err) {
        return { status: 'error' };
      }
    },
  },
  watchProgress: {
    getAll: async (): Promise<{ continueWatching: WatchProgress[] }> => {
      try {
        const response = await apiClient.get('/api/watch-progress');
        return response.data;
      } catch (err) {
        return { continueWatching: [] };
      }
    },
    get: async (contentId: string): Promise<{ progress: WatchProgress | null }> => {
      try {
        const response = await apiClient.get(`/api/watch-progress/${encodeURIComponent(contentId)}`);
        return response.data;
      } catch (err) {
        return { progress: null };
      }
    },
    save: async (progress: Omit<WatchProgress, 'percent_watched' | 'updated_at'>): Promise<{ message: string; percent_watched: number }> => {
      try {
        const response = await apiClient.post('/api/watch-progress', progress);
        return response.data;
      } catch (err) {
        return { message: 'Error', percent_watched: 0 };
      }
    },
    delete: async (contentId: string): Promise<{ message: string }> => {
      try {
        const response = await apiClient.delete(`/api/watch-progress/${encodeURIComponent(contentId)}`);
        return response.data;
      } catch (err) {
        return { message: 'Error' };
      }
    },
  },
};

export default apiClient;