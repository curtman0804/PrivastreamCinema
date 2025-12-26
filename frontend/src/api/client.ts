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
          const sInt = parseInt(parts[1], 10);
          const eInt = parseInt(parts[2], 10);
          
          // Function to check if a stream matches the EXACT target episode
          const isCorrectEpisode = (title: string): boolean => {
            const upper = title.toUpperCase();
            
            // Reject season packs and complete series immediately
            if (/COMPLETE|ALL\s*SEASONS|FULL\s*SERIES|SEASONS?\s*\d+\s*[-–]\s*\d+/i.test(upper)) {
              return false;
            }
            
            // Reject multi-season packs (e.g., "S01-S04" or "S01 S02 S03")
            if (/S\d{1,2}\s*[-–]\s*S\d{1,2}/i.test(upper) || /S\d{1,2}\s+S\d{1,2}/i.test(upper)) {
              return false;
            }
            
            // Look for episode ranges like S01E01-E03 or S01E01-03
            const rangePattern = /S(\d{1,2})E(\d{1,2})\s*[-–]\s*E?(\d{1,2})/gi;
            let rangeMatch;
            while ((rangeMatch = rangePattern.exec(upper)) !== null) {
              const s = parseInt(rangeMatch[1], 10);
              const startE = parseInt(rangeMatch[2], 10);
              const endE = parseInt(rangeMatch[3], 10);
              // If this is a range that includes our episode but also others, reject
              if (s === sInt && startE <= eInt && endE >= eInt && (startE !== eInt || endE !== eInt)) {
                return false; // This is a multi-episode file
              }
            }
            
            // Find ALL SxxEyy patterns in the title
            const allEpisodes: Array<{s: number, e: number}> = [];
            const sxePattern = /S(\d{1,2})E(\d{1,2})/gi;
            let match;
            while ((match = sxePattern.exec(upper)) !== null) {
              allEpisodes.push({ s: parseInt(match[1], 10), e: parseInt(match[2], 10) });
            }
            
            // Also check 1x05 format
            const xPattern = /(\d{1,2})X(\d{1,2})/gi;
            while ((match = xPattern.exec(upper)) !== null) {
              allEpisodes.push({ s: parseInt(match[1], 10), e: parseInt(match[2], 10) });
            }
            
            // If we found episode markers, check if ANY match our target
            if (allEpisodes.length > 0) {
              // Check if target episode is in the list
              const hasTarget = allEpisodes.some(ep => ep.s === sInt && ep.e === eInt);
              if (!hasTarget) {
                return false; // Target episode not found
              }
              
              // If there are multiple different episodes, reject (it's a pack)
              const uniqueEpisodes = allEpisodes.filter((ep, idx, arr) => 
                arr.findIndex(e => e.s === ep.s && e.e === ep.e) === idx
              );
              if (uniqueEpisodes.length > 1) {
                // Multiple episodes in title - could be a pack
                // Only allow if ALL episodes are the same as target
                const allSame = uniqueEpisodes.every(ep => ep.s === sInt && ep.e === eInt);
                if (!allSame) {
                  return false;
                }
              }
              
              return true; // Found exact target episode
            }
            
            // No episode marker found - could be a season pack or single episode
            // Check if it mentions just the season
            if (/\bS(\d{1,2})\b(?!E)/i.test(upper)) {
              // Has season but no episode - likely a season pack
              return false;
            }
            
            // No clear episode marker - let it through but with low confidence
            // (these are usually less accurate streams anyway)
            return true;
          };
          
          const beforeFilter = allStreams.length;
          allStreams = allStreams.filter((s: Stream) => {
            const titleAndName = `${s.title || ''} ${s.name || ''}`.toUpperCase();
            
            // FIRST: Check if title clearly indicates WRONG season
            // Look for patterns like "Season 4", "S04", "Сезон: 4", etc.
            const wrongSeasonPatterns = [
              // English patterns
              /SEASON\s*(\d+)/gi,
              /\bS(\d{1,2})\b(?!E)/gi,  // S04 without E (season pack indicator)
              // Russian patterns
              /СЕЗОН[:\s]*(\d+)/gi,
              /СЕЗОНЫ?[:\s]*(\d+)/gi,
            ];
            
            for (const pattern of wrongSeasonPatterns) {
              let match;
              pattern.lastIndex = 0; // Reset regex
              while ((match = pattern.exec(titleAndName)) !== null) {
                const foundSeason = parseInt(match[1], 10);
                if (foundSeason !== sInt) {
                  console.log(`[FILTER] Rejected (wrong season ${foundSeason} in title): ${titleAndName.substring(0, 60)}`);
                  return false;
                }
              }
            }
            
            // Check for multi-season packs in title (e.g., "S01-S04", "Seasons 1 to 3", "S01-03")
            const multiSeasonPatterns = [
              /S(\d{1,2})\s*[-–]\s*S?(\d{1,2})(?!E)/gi,  // S01-S04 or S01-04 (without E)
              /SEASONS?\s*(\d+)\s*(?:TO|[-–])\s*(\d+)/gi,  // Seasons 1 to 3
              /СЕЗОНЫ?\s*(\d+)\s*[-–]\s*(\d+)/gi,  // Russian season ranges
            ];
            
            for (const pattern of multiSeasonPatterns) {
              let match;
              pattern.lastIndex = 0;
              while ((match = pattern.exec(titleAndName)) !== null) {
                const startS = parseInt(match[1], 10);
                const endS = parseInt(match[2], 10);
                // If our target season is in this range but it's a multi-season pack, reject
                if (startS !== endS) {
                  console.log(`[FILTER] Rejected (multi-season pack S${startS}-S${endS}): ${titleAndName.substring(0, 60)}`);
                  return false;
                }
              }
            }
            
            // If Torrentio/TPB+ provided a specific filename, check that STRICTLY
            if (s.filename) {
              const filenameUpper = s.filename.toUpperCase();
              
              // Check if filename contains the EXACT target episode marker
              const targetPattern = new RegExp(`S0?${sInt}E0?${eInt}\\b`, 'i');
              if (!targetPattern.test(s.filename)) {
                console.log(`[FILTER] Rejected (filename no match): ${s.filename.substring(0, 60)}`);
                return false;
              }
              
              // Now check that the filename doesn't contain OTHER episodes
              const allEpisodesInFilename: Array<{s: number, e: number}> = [];
              const sxePattern = /S(\d{1,2})E(\d{1,2})/gi;
              let match;
              while ((match = sxePattern.exec(filenameUpper)) !== null) {
                allEpisodesInFilename.push({ s: parseInt(match[1], 10), e: parseInt(match[2], 10) });
              }
              
              // Check for episode ranges in filename (S01E01-E03 or S01E01-03)
              const rangeInFilename = /S(\d{1,2})E(\d{1,2})\s*[-–]\s*E?(\d{1,2})/gi;
              let rangeMatch;
              while ((rangeMatch = rangeInFilename.exec(filenameUpper)) !== null) {
                const s = parseInt(rangeMatch[1], 10);
                const startE = parseInt(rangeMatch[2], 10);
                const endE = parseInt(rangeMatch[3], 10);
                // Add all episodes in the range
                for (let e = startE; e <= endE; e++) {
                  if (!allEpisodesInFilename.some(ep => ep.s === s && ep.e === e)) {
                    allEpisodesInFilename.push({ s, e });
                  }
                }
              }
              
              // If multiple different episodes found in filename, reject
              const uniqueEps = allEpisodesInFilename.filter((ep, idx, arr) => 
                arr.findIndex(e => e.s === ep.s && e.e === ep.e) === idx
              );
              
              if (uniqueEps.length > 1) {
                // Check if ALL episodes match our target
                const hasOtherEpisodes = uniqueEps.some(ep => ep.s !== sInt || ep.e !== eInt);
                if (hasOtherEpisodes) {
                  console.log(`[FILTER] Rejected (multi-ep filename): ${s.filename.substring(0, 60)}`);
                  return false;
                }
              }
              
              console.log(`[FILTER] Approved via filename: ${s.filename.substring(0, 60)}`);
              return true;
            }
            
            // No filename - check title strictly
            const combined = `${s.title || ''} ${s.name || ''}`;
            const result = isCorrectEpisode(combined);
            if (!result) {
              console.log(`[FILTER] Rejected: ${combined.substring(0, 80)}`);
            }
            return result;
          });
          console.log(`[STREAMS] Episode filter: ${beforeFilter} -> ${allStreams.length} streams for S${String(sInt).padStart(2,'0')}E${String(eInt).padStart(2,'0')}`);
        }
      }
      
      // Sort by seeders (highest first)
      allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));
      
      console.log(`[STREAMS] Total streams after filter: ${allStreams.length}`);
      return { streams: allStreams };
    },
    
    fetchTorrentioStreams: async (type: string, id: string): Promise<Stream[]> => {
      // Use allorigins proxy for ALL platforms - direct fetch is blocked by Cloudflare
      const TORRENTIO_BASE = 'https://torrentio.strem.fun';
      const CONFIG = 'sort=seeders|qualityfilter=480p,scr,cam';
      const torrentioUrl = `${TORRENTIO_BASE}/${CONFIG}/stream/${type}/${id}.json`;
      
      try {
        let data: any;
        
        // Approach 1: Try allorigins (works for both web and mobile)
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
        
        // Approach 2: Try direct fetch as fallback (may work on some mobile networks)
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
        
        // Approach 3: Try backend proxy as last resort
        if (!data?.streams?.length) {
          try {
            console.log(`[TORRENTIO] Trying backend proxy...`);
            const response = await apiClient.get(`/api/addon-proxy/torrentio/${type}/${id}`);
            if (response.data?.streams?.length > 0) {
              console.log(`[TORRENTIO] Backend proxy success: ${response.data.streams.length} streams`);
              data = response.data;
            }
          } catch (e: any) {
            console.log(`[TORRENTIO] Backend proxy failed: ${e.message || e}`);
          }
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
            sources: stream.sources || ['tracker:udp://tracker.opentrackr.org:1337/announce'],
            addon: 'Torrentio',
            seeders: seeders,
            quality: quality,
            filename: filename,  // Specific episode file
            fileIdx: fileIdx,    // Index of the file in the torrent
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
      // Use allorigins proxy for ALL platforms - direct fetch is blocked by Cloudflare
      const TPB_BASE = 'https://thepiratebay-plus.strem.fun';
      const tpbUrl = `${TPB_BASE}/stream/${type}/${id}.json`;
      
      try {
        let data: any;
        
        // Approach 1: Try allorigins (works for both web and mobile)
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
        
        // Approach 2: Try direct fetch as fallback (may work on some mobile networks)
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
        
        // Approach 3: Try backend proxy as last resort
        if (!data?.streams?.length) {
          try {
            console.log(`[TPB+] Trying backend proxy...`);
            const response = await apiClient.get(`/api/addon-proxy/tpb/${type}/${id}`);
            if (response.data?.streams?.length > 0) {
              console.log(`[TPB+] Backend proxy success: ${response.data.streams.length} streams`);
              data = response.data;
            }
          } catch (e: any) {
            console.log(`[TPB+] Backend proxy failed: ${e.message || e}`);
          }
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
            sources: stream.sources || ['tracker:udp://tracker.opentrackr.org:1337/announce'],
            addon: 'ThePirateBay+',
            seeders: seeders,
            quality: quality,
            filename: filename,  // Specific episode file
            fileIdx: fileIdx,    // Index of the file in the torrent
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
      const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const params = fileIdx !== undefined && fileIdx !== null ? `?fileIdx=${fileIdx}` : '';
      return `${baseUrl}/api/stream/video/${infoHash}${params}`;
    },
  },
};

export default apiClient;
