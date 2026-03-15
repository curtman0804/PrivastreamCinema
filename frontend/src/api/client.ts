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
  // Use environment variable for backend URL (works across preview and production)
  const envUrl = process.env.EXPO_PUBLIC_BACKEND_URL 
    || Constants.expoConfig?.extra?.backendUrl;
  return envUrl || '';
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
  // Stream info for resuming playback
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
      // Frontend meta cache (10 min TTL)
      const cacheKey = `meta:${type}:${id}`;
      if (!((api as any)._metaCache)) (api as any)._metaCache = new Map();
      const cached = (api as any)._metaCache.get(cacheKey);
      if (cached && Date.now() - cached.time < 600000) {
        console.log(`[META] CACHE HIT for ${type}/${id}`);
        return cached.data;
      }
      
      const encodedId = encodeURIComponent(id);
      const response = await apiClient.get(`/api/content/meta/${type}/${encodedId}`);
      
      // Cache the result
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
      
      // Frontend stream cache (2 min TTL)
      const cacheKey = `streams:${type}:${id}`;
      const cached = (api as any)._streamCache?.get(cacheKey);
      if (cached && Date.now() - cached.time < 120000) {
        console.log(`[STREAMS] CACHE HIT: ${cached.streams.length} streams`);
        if (onProgress) onProgress(cached.streams);
        return { streams: cached.streams };
      }
      
      // Encode ID to handle URLs and special characters
      const encodedId = encodeURIComponent(id);
      
      // For TV channels, only fetch from backend (USAATV addon)
      // Torrentio/TPB don't have TV streams and always return 403, wasting time
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
      
      // PROGRESSIVE LOADING: Fire all fetches simultaneously,
      // display results as each source responds (no waiting for slowest)
      let allStreams: Stream[] = [];
      const existingHashes = new Set<string>();
      
      // Helper to merge new streams and notify
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
          // Sort by seeders
          allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
          console.log(`[STREAMS] ${sourceName}: +${deduplicated.length} streams (total: ${allStreams.length}) in ${Date.now() - startTime}ms`);
          if (onProgress) onProgress([...allStreams]);
        } else {
          console.log(`[STREAMS] ${sourceName}: 0 new streams in ${Date.now() - startTime}ms`);
        }
      };
      
      // Episode filter function (used for series)
      const filterForEpisode = (streams: Stream[]): Stream[] => {
        if (type !== 'series' || !id.includes(':')) return streams;
        
        const parts = id.split(':');
        if (parts.length < 3) return streams;
        
        const sInt = parseInt(parts[1], 10);
        const eInt = parseInt(parts[2], 10);
        
        return streams.filter((s: Stream) => {
          const titleAndName = `${s.title || ''} ${s.name || ''} ${s.filename || ''}`.toUpperCase();
          
          // Reject season packs
          if (/COMPLETE|ALL\s*SEASONS|FULL\s*SERIES/i.test(titleAndName)) return false;
          if (/S\d{1,2}\s*[-–]\s*S\d{1,2}/i.test(titleAndName)) return false;
          
          // Check for wrong season
          const seasonMatch = titleAndName.match(/\bS(\d{1,2})(?=E)/i);
          if (seasonMatch && parseInt(seasonMatch[1], 10) !== sInt) return false;
          
          // Check for specific episode match
          const targetPattern = new RegExp(`S0?${sInt}E0?${eInt}\\b`, 'i');
          if (s.filename && targetPattern.test(s.filename)) return true;
          if (targetPattern.test(titleAndName)) return true;
          
          // Check for episode ranges
          const rangePattern = /S(\d{1,2})E(\d{1,2})\s*[-–]\s*E?(\d{1,2})/gi;
          let rangeMatch;
          while ((rangeMatch = rangePattern.exec(titleAndName)) !== null) {
            const startE = parseInt(rangeMatch[2], 10);
            const endE = parseInt(rangeMatch[3], 10);
            if (parseInt(rangeMatch[1], 10) === sInt && startE <= eInt && endE >= eInt) {
              if (startE !== eInt || endE !== eInt) return false; // Multi-episode pack
            }
          }
          
          // No clear marker - let through
          return true;
        });
      };
      
      // Fire all 3 fetches simultaneously - DON'T WAIT for all to finish
      const backendPromise = apiClient.get(`/api/streams/${type}/${encodedId}`)
        .then(r => {
          const streams = filterForEpisode(r.data.streams || []);
          // MERGE backend streams instead of overwriting (fixes streams disappearing)
          mergeAndNotify(streams, 'Backend');
        })
        .catch(e => console.log(`[STREAMS] Backend failed:`, e));
      
      const torrentioPromise = api.addons.fetchTorrentioStreams(type, id)
        .then(streams => mergeAndNotify(filterForEpisode(streams), 'Torrentio'))
        .catch(e => console.log(`[STREAMS] Torrentio failed:`, e));
      
      const tpbPromise = api.addons.fetchTPBStreams(type, id)
        .then(streams => mergeAndNotify(filterForEpisode(streams), 'TPB+'))
        .catch(e => console.log(`[STREAMS] TPB+ failed:`, e));
      
      // Wait for all to complete
      await Promise.allSettled([backendPromise, torrentioPromise, tpbPromise]);
      
      console.log(`[STREAMS] All sources done: ${allStreams.length} total streams in ${Date.now() - startTime}ms`);
      
      // Final sort by seeders (highest first) to ensure best streams are on top
      allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
      
      // Cache the result
      if (!((api as any)._streamCache)) (api as any)._streamCache = new Map();
      (api as any)._streamCache.set(cacheKey, { streams: allStreams, time: Date.now() });
      
      return { streams: allStreams };
    },
    
    fetchTorrentioStreams: async (type: string, id: string): Promise<Stream[]> => {
      const TORRENTIO_BASE = 'https://torrentio.strem.fun';
      const CONFIG = 'sort=seeders|qualityfilter=480p,scr,cam';
      const torrentioUrl = `${TORRENTIO_BASE}/${CONFIG}/stream/${type}/${id}.json`;
      
      // 3-second timeout wrapper
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
      
      try {
        let data: any;
        
        // RACE all 3 approaches with 3s timeout each
        const racePromises = [
          withTimeout(fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(torrentioUrl)}`, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            console.log(`[TORRENTIO] allorigins: ${result.streams.length} streams`);
            return result;
          }), 3000),
          withTimeout(fetch(torrentioUrl, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            console.log(`[TORRENTIO] direct: ${result.streams.length} streams`);
            return result;
          }), 3000),
          withTimeout(apiClient.get(`/api/addon-proxy/torrentio/${type}/${id}`).then(r => {
            if (!r.data?.streams?.length) throw new Error('No streams');
            console.log(`[TORRENTIO] backend proxy: ${r.data.streams.length} streams`);
            return r.data;
          }), 3000),
        ];
        
        try {
          data = await Promise.any(racePromises);
        } catch (e) {
          console.log(`[TORRENTIO] All approaches failed`);
          return [];
        }
        
        const rawStreams = data?.streams || [];
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
          
          // Get the specific episode filename from behaviorHints (Torrentio provides this)
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
            filename: filename,  // Specific episode file
            fileIdx: fileIdx,    // Index of the file in the torrent
          };
        }).filter((s: any) => {
          if (!s.infoHash) return false;
          
          // If searching for a MOVIE, reject series episodes (S01E01, S02E05, etc.)
          if (type === 'movie') {
            const combined = `${s.name || ''} ${s.title || ''}`.toLowerCase();
            const episodePattern = /S\d{1,2}E\d{1,2}/i;
            if (episodePattern.test(combined)) {
              console.log(`[TORRENTIO] Filtered series episode from movie search: ${s.title?.substring(0, 50)}`);
              return false;
            }
          }
          
          return true;
        });
        
        console.log(`[TORRENTIO] Parsed streams with infoHash: ${parsedStreams.length}`);
        return parsedStreams;
      } catch (e: any) {
        console.log(`[TORRENTIO] Fetch error: ${e.message || e}`);
      }
      return [];
    },
    
    fetchTPBStreams: async (type: string, id: string): Promise<Stream[]> => {
      const TPB_BASE = 'https://thepiratebay-plus.strem.fun';
      const tpbUrl = `${TPB_BASE}/stream/${type}/${id}.json`;
      
      // 3-second timeout wrapper
      const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
      
      try {
        let data: any;
        
        // RACE all 3 approaches with 3s timeout each
        const racePromises = [
          withTimeout(fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(tpbUrl)}`, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            console.log(`[TPB+] allorigins: ${result.streams.length} streams`);
            return result;
          }), 3000),
          withTimeout(fetch(tpbUrl, {
            method: 'GET', headers: { 'Accept': 'application/json' },
          }).then(async r => {
            if (!r.ok) throw new Error(`Status ${r.status}`);
            const result = await r.json();
            if (!result?.streams?.length) throw new Error('No streams');
            console.log(`[TPB+] direct: ${result.streams.length} streams`);
            return result;
          }), 3000),
          withTimeout(apiClient.get(`/api/addon-proxy/tpb/${type}/${id}`).then(r => {
            if (!r.data?.streams?.length) throw new Error('No streams');
            console.log(`[TPB+] backend proxy: ${r.data.streams.length} streams`);
            return r.data;
          }), 3000),
        ];
        
        try {
          data = await Promise.any(racePromises);
        } catch (e) {
          console.log(`[TPB+] All approaches failed`);
          return [];
        }
        
        const rawStreams = data?.streams || [];
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
          
          // Get the specific episode filename from behaviorHints (TPB+ may provide this)
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
            filename: filename,  // Specific episode file
            fileIdx: fileIdx,    // Index of the file in the torrent
          };
        }).filter((s: any) => {
          if (!s.infoHash) return false;
          
          // CRITICAL: Filter out adult/porn content that doesn't match the actual movie
          const combined = `${s.name || ''} ${s.title || ''}`.toLowerCase();
          const adultKeywords = [
            'xxx', 'porn', 'adult', 'herlimit', 'blacked', 'vixen', 'tushy',
            'brazzers', 'bangbros', 'naughty', 'milf', 'stepmom', 'stepsister',
            'onlyfans', 'leaked', 'nude', 'naked', 'sex tape', 'hardcore',
            'deepthroat', 'blowjob', 'handjob', 'anal', 'creampie', 'gangbang',
            'threesome', 'orgy', 'escort', 'hooker', 'slut', 'whore',
            'hentai', 'rule34', 'sfm', 'overwatch', 'animated cartoon'
          ];
          
          for (const keyword of adultKeywords) {
            if (combined.includes(keyword)) {
              console.log(`[TPB+] Filtered adult content: ${s.title?.substring(0, 50)}`);
              return false;
            }
          }
          
          // CRITICAL: If searching for a MOVIE, reject series episodes (S01E01, S02E05, etc.)
          if (type === 'movie') {
            const episodePattern = /S\d{1,2}E\d{1,2}/i;
            if (episodePattern.test(combined)) {
              console.log(`[TPB+] Filtered series episode from movie search: ${s.title?.substring(0, 50)}`);
              return false;
            }
          }
          
          return true;
        });
        
        console.log(`[TPB+] Parsed streams with infoHash (after adult filter): ${parsedStreams.length}`);
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
      // Pass fileIdx and filename to tell the torrent server which file to play
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
      // Return the full URL for the video stream with optional fileIdx
      // Use the hardcoded backend URL for mobile builds
      const baseUrl = Platform.OS === 'web' ? '' : (process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '');
      const params = fileIdx !== undefined && fileIdx !== null ? `?fileIdx=${fileIdx}` : '';
      return `${baseUrl}/api/stream/video/${infoHash}${params}`;
    },
  },
  watchProgress: {
    // Get all continue watching items
    getAll: async (): Promise<{ continueWatching: WatchProgress[] }> => {
      try {
        const response = await apiClient.get('/api/watch-progress');
        return response.data;
      } catch (err) {
        console.log('[API] Watch progress fetch error:', err);
        return { continueWatching: [] };
      }
    },
    // Get progress for specific content
    get: async (contentId: string): Promise<{ progress: WatchProgress | null }> => {
      try {
        const response = await apiClient.get(`/api/watch-progress/${encodeURIComponent(contentId)}`);
        return response.data;
      } catch (err) {
        console.log('[API] Watch progress get error:', err);
        return { progress: null };
      }
    },
    // Save watch progress
    save: async (progress: Omit<WatchProgress, 'percent_watched' | 'updated_at'>): Promise<{ message: string; percent_watched: number }> => {
      try {
        const response = await apiClient.post('/api/watch-progress', progress);
        return response.data;
      } catch (err) {
        console.log('[API] Watch progress save error:', err);
        return { message: 'Error', percent_watched: 0 };
      }
    },
    // Delete watch progress (remove from continue watching)
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