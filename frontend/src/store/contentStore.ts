import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, ContentItem, DiscoverResponse, Addon, LibraryResponse, SearchResult, Stream } from '../api/client';

interface CurrentPlaying {
  contentType: string;
  contentId: string;
  title: string;
}

interface ContentState {
  discoverData: DiscoverResponse | null;
  addons: Addon[];
  library: LibraryResponse | null;
  searchResults: SearchResult[];
  searchMovies: SearchResult[];
  searchSeries: SearchResult[];
  searchHasMore: boolean;
  searchSkip: number;
  currentSearchQuery: string;
  streams: Stream[];
  currentPlaying: CurrentPlaying | null;
  isLoadingDiscover: boolean;
  isLoadingAddons: boolean;
  isLoadingLibrary: boolean;
  isLoadingSearch: boolean;
  isLoadingMoreSearch: boolean;
  isLoadingStreams: boolean;
  error: string | null;
  lastFetchTime: { [key: string]: number };
  fetchDiscover: (forceRefresh?: boolean) => Promise<void>;
  fetchAddons: (forceRefresh?: boolean) => Promise<void>;
  fetchLibrary: (forceRefresh?: boolean) => Promise<void>;
  search: (query: string) => Promise<void>;
  loadMoreSearch: () => Promise<void>;
  fetchStreams: (type: string, id: string) => Promise<Stream[]>;
  addToLibrary: (item: ContentItem) => Promise<void>;
  removeFromLibrary: (type: string, id: string) => Promise<void>;
  clearSearch: () => void;
  setCurrentPlaying: (info: CurrentPlaying | null) => void;
  resetStore: () => void;
  loadCachedData: () => Promise<void>;
}

const CACHE_KEYS = {
  discover: 'cache_discover',
  addons: 'cache_addons',
  library: 'cache_library',
};

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

const initialState = {
  discoverData: null,
  addons: [],
  library: null,
  searchResults: [],
  searchMovies: [],
  searchSeries: [],
  searchHasMore: false,
  searchSkip: 0,
  currentSearchQuery: '',
  currentPlaying: null,
  streams: [],
  isLoadingDiscover: false,
  isLoadingAddons: false,
  isLoadingLibrary: false,
  isLoadingSearch: false,
  isLoadingMoreSearch: false,
  isLoadingStreams: false,
  error: null,
  lastFetchTime: {},
};

// Helper to save to cache
const saveToCache = async (key: string, data: any) => {
  try {
    const cacheData = {
      data,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(key, JSON.stringify(cacheData));
  } catch (e) {
    console.log('[Cache] Error saving:', e);
  }
};

// Helper to load from cache
const loadFromCache = async (key: string): Promise<{ data: any; isValid: boolean } | null> => {
  try {
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      const isValid = Date.now() - timestamp < CACHE_DURATION;
      return { data, isValid };
    }
  } catch (e) {
    console.log('[Cache] Error loading:', e);
  }
  return null;
};

export const useContentStore = create<ContentState>((set, get) => ({
  ...initialState,

  resetStore: () => {
    set(initialState);
  },

  // Load all cached data on app start
  loadCachedData: async () => {
    try {
      // Load discover cache
      const discoverCache = await loadFromCache(CACHE_KEYS.discover);
      if (discoverCache?.data) {
        set({ discoverData: discoverCache.data });
      }

      // Load addons cache
      const addonsCache = await loadFromCache(CACHE_KEYS.addons);
      if (addonsCache?.data) {
        set({ addons: addonsCache.data });
      }

      // Load library cache
      const libraryCache = await loadFromCache(CACHE_KEYS.library);
      if (libraryCache?.data) {
        set({ library: libraryCache.data });
      }

      console.log('[Cache] Loaded cached data');
    } catch (e) {
      console.log('[Cache] Error loading cached data:', e);
    }
  },

  fetchDiscover: async (forceRefresh = false) => {
    const { discoverData, lastFetchTime } = get();
    
    // Check if we have cached data and it's still valid
    if (!forceRefresh && discoverData) {
      const lastFetch = lastFetchTime['discover'] || 0;
      if (Date.now() - lastFetch < CACHE_DURATION) {
        console.log('[ContentStore] Using cached discover data');
        return;
      }
    }

    // Try to load from AsyncStorage cache first if no data in memory
    if (!discoverData) {
      const cached = await loadFromCache(CACHE_KEYS.discover);
      if (cached?.data) {
        set({ discoverData: cached.data });
        if (cached.isValid && !forceRefresh) {
          console.log('[ContentStore] Using AsyncStorage cached discover data');
          return;
        }
      }
    }

    set({ isLoadingDiscover: true, error: null });
    try {
      const data = await api.content.getDiscover();
      set({ 
        discoverData: data, 
        isLoadingDiscover: false,
        lastFetchTime: { ...get().lastFetchTime, discover: Date.now() }
      });
      // Save to cache
      await saveToCache(CACHE_KEYS.discover, data);
    } catch (error: any) {
      console.log('[ContentStore] fetchDiscover error:', error);
      set({ error: error.message, isLoadingDiscover: false });
    }
  },

  fetchAddons: async (forceRefresh = false) => {
    const { addons, lastFetchTime } = get();
    
    // Check if we have cached data and it's still valid
    if (!forceRefresh && addons.length > 0) {
      const lastFetch = lastFetchTime['addons'] || 0;
      if (Date.now() - lastFetch < CACHE_DURATION) {
        console.log('[ContentStore] Using cached addons data');
        return;
      }
    }

    // Try to load from AsyncStorage cache first if no data in memory
    if (addons.length === 0) {
      const cached = await loadFromCache(CACHE_KEYS.addons);
      if (cached?.data) {
        set({ addons: cached.data });
        if (cached.isValid && !forceRefresh) {
          console.log('[ContentStore] Using AsyncStorage cached addons data');
          return;
        }
      }
    }

    set({ isLoadingAddons: true, error: null });
    try {
      const data = await api.addons.getAll();
      set({ 
        addons: data || [], 
        isLoadingAddons: false,
        lastFetchTime: { ...get().lastFetchTime, addons: Date.now() }
      });
      // Save to cache
      await saveToCache(CACHE_KEYS.addons, data);
    } catch (error: any) {
      console.log('[ContentStore] fetchAddons error:', error);
      set({ error: error.message, isLoadingAddons: false, addons: [] });
    }
  },

  fetchLibrary: async (forceRefresh = false) => {
    const { library, lastFetchTime } = get();
    
    // Check if we have cached data and it's still valid
    if (!forceRefresh && library) {
      const lastFetch = lastFetchTime['library'] || 0;
      if (Date.now() - lastFetch < CACHE_DURATION) {
        console.log('[ContentStore] Using cached library data');
        return;
      }
    }

    // Try to load from AsyncStorage cache first if no data in memory
    if (!library) {
      const cached = await loadFromCache(CACHE_KEYS.library);
      if (cached?.data) {
        set({ library: cached.data });
        if (cached.isValid && !forceRefresh) {
          console.log('[ContentStore] Using AsyncStorage cached library data');
          return;
        }
      }
    }

    set({ isLoadingLibrary: true, error: null });
    try {
      const data = await api.library.get();
      set({ 
        library: data, 
        isLoadingLibrary: false,
        lastFetchTime: { ...get().lastFetchTime, library: Date.now() }
      });
      // Save to cache
      await saveToCache(CACHE_KEYS.library, data);
    } catch (error: any) {
      console.log('[ContentStore] fetchLibrary error:', error);
      set({ error: error.message, isLoadingLibrary: false });
    }
  },

  search: async (query: string) => {
    if (!query.trim()) {
      set({ searchResults: [], searchMovies: [], searchSeries: [], searchHasMore: false, searchSkip: 0, currentSearchQuery: '' });
      return;
    }
    set({ isLoadingSearch: true, error: null, currentSearchQuery: query, searchSkip: 0 });
    try {
      const data = await api.content.search(query, 0, 30);
      const movies = data.movies || [];
      const series = data.series || [];
      const results = [...movies, ...series];
      set({ 
        searchResults: results, 
        searchMovies: movies,
        searchSeries: series,
        searchHasMore: data.hasMore || false,
        searchSkip: 30,
        isLoadingSearch: false 
      });
    } catch (error: any) {
      console.log('[ContentStore] search error:', error);
      set({ error: error.message, isLoadingSearch: false });
    }
  },

  loadMoreSearch: async () => {
    const { currentSearchQuery, searchSkip, searchMovies, searchSeries, isLoadingMoreSearch } = get();
    if (!currentSearchQuery || isLoadingMoreSearch) return;
    
    set({ isLoadingMoreSearch: true });
    try {
      const data = await api.content.search(currentSearchQuery, searchSkip, 30);
      const newMovies = data.movies || [];
      const newSeries = data.series || [];
      set({ 
        searchMovies: [...searchMovies, ...newMovies],
        searchSeries: [...searchSeries, ...newSeries],
        searchResults: [...searchMovies, ...newMovies, ...searchSeries, ...newSeries],
        searchHasMore: data.hasMore || false,
        searchSkip: searchSkip + 30,
        isLoadingMoreSearch: false 
      });
    } catch (error: any) {
      console.log('[ContentStore] loadMoreSearch error:', error);
      set({ error: error.message, isLoadingMoreSearch: false });
    }
  },

  fetchStreams: async (type: string, id: string) => {
    set({ isLoadingStreams: true, streams: [], error: null });
    
    try {
      const result = await api.addons.getAllStreams(type, id);
      const allStreams = result.streams || [];
      set({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error: any) {
      console.log('[ContentStore] fetchStreams error:', error);
      set({ streams: [], isLoadingStreams: false });
      return [];
    }
  },

  addToLibrary: async (item: ContentItem) => {
    try {
      await api.library.add(item);
      await get().fetchLibrary(true); // Force refresh
    } catch (error: any) {
      console.log('[ContentStore] addToLibrary error:', error);
      set({ error: error.message });
    }
  },

  removeFromLibrary: async (type: string, id: string) => {
    try {
      await api.library.remove(type, id);
      await get().fetchLibrary(true); // Force refresh
    } catch (error: any) {
      console.log('[ContentStore] removeFromLibrary error:', error);
      set({ error: error.message });
    }
  },

  clearSearch: () => {
    set({ searchResults: [], searchMovies: [], searchSeries: [], searchHasMore: false, searchSkip: 0, currentSearchQuery: '' });
  },

  setCurrentPlaying: (info: CurrentPlaying | null) => {
    set({ currentPlaying: info });
  },
}));