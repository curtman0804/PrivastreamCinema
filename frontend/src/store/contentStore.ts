import { create } from 'zustand';
import { api, ContentItem, DiscoverResponse, Addon, LibraryResponse, SearchResult, Stream } from '../api/client';
import { cachedFetch, CACHE_DURATIONS, clearCache } from '../utils/cache';

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
}

export const useContentStore = create<ContentState>((set, get) => ({
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

  fetchDiscover: async (forceRefresh = false) => {
    set({ isLoadingDiscover: true, error: null });
    try {
      if (forceRefresh) {
        await clearCache('discover');
      }
      const data = await cachedFetch(
        'discover',
        () => api.content.getDiscover(),
        CACHE_DURATIONS.MEDIUM // 30 minutes
      );
      set({ discoverData: data, isLoadingDiscover: false });
    } catch (error: any) {
      set({ error: error.message, isLoadingDiscover: false });
    }
  },

  fetchAddons: async (forceRefresh = false) => {
    set({ isLoadingAddons: true, error: null });
    try {
      if (forceRefresh) {
        await clearCache('addons');
      }
      const data = await cachedFetch(
        'addons',
        () => api.addons.getAll(),
        CACHE_DURATIONS.LONG // 2 hours
      );
      set({ addons: data, isLoadingAddons: false });
    } catch (error: any) {
      set({ error: error.message, isLoadingAddons: false });
    }
  },

  fetchLibrary: async (forceRefresh = false) => {
    set({ isLoadingLibrary: true, error: null });
    try {
      if (forceRefresh) {
        await clearCache('library');
      }
      const data = await cachedFetch(
        'library',
        () => api.library.get(),
        CACHE_DURATIONS.SHORT // 5 minutes - library changes more often
      );
      set({ library: data, isLoadingLibrary: false });
    } catch (error: any) {
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
      // Cache search results for 5 minutes
      const cacheKey = `search_${query.toLowerCase().trim()}`;
      const data = await cachedFetch(
        cacheKey,
        () => api.content.search(query, 0, 30),
        CACHE_DURATIONS.SHORT
      );
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
      set({ error: error.message, isLoadingSearch: false });
    }
  },

  loadMoreSearch: async () => {
    const { currentSearchQuery, searchSkip, isLoadingMoreSearch, searchHasMore, searchMovies, searchSeries } = get();
    if (!currentSearchQuery || isLoadingMoreSearch || !searchHasMore) return;
    
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
      set({ error: error.message, isLoadingMoreSearch: false });
    }
  },

  fetchStreams: async (type: string, id: string) => {
    set({ isLoadingStreams: true, streams: [], error: null });
    
    try {
      // Cache streams for 10 minutes
      const cacheKey = `streams_${type}_${id}`;
      const result = await cachedFetch(
        cacheKey,
        () => api.addons.getAllStreams(type, id),
        CACHE_DURATIONS.SHORT
      );
      const allStreams = result.streams || [];
      set({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error) {
      console.log('Failed to fetch streams:', error);
      set({ streams: [], isLoadingStreams: false });
      return [];
    }
  },

  addToLibrary: async (item: ContentItem) => {
    try {
      await api.library.add(item);
      await clearCache('library'); // Clear library cache after adding
      await get().fetchLibrary(true);
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  removeFromLibrary: async (type: string, id: string) => {
    try {
      await api.library.remove(type, id);
      await clearCache('library'); // Clear library cache after removing
      await get().fetchLibrary(true);
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  clearSearch: () => {
    set({ searchResults: [], searchMovies: [], searchSeries: [], searchHasMore: false, searchSkip: 0, currentSearchQuery: '' });
  },

  setCurrentPlaying: (info) => {
    set({ currentPlaying: info });
  },
}));
