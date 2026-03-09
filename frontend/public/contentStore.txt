import { create } from 'zustand';
import { api, ContentItem, DiscoverResponse, Addon, LibraryResponse, SearchResult, Stream } from '../api/client';

// ============================================================
// MODULE-LEVEL CACHES — persist across screen mounts/unmounts
// These are NOT in zustand to avoid triggering re-renders
// ============================================================
const _metaCache: Record<string, ContentItem> = {};
const _streamsCache: Record<string, Stream[]> = {};

export const getMetaCache = (key: string) => _metaCache[key] || null;
export const setMetaCache = (key: string, data: ContentItem) => { _metaCache[key] = data; };
export const getStreamsCache = (key: string) => _streamsCache[key] || null;
export const setStreamsCache = (key: string, data: Stream[]) => { _streamsCache[key] = data; };

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
  selectedItem: ContentItem | null;
  currentPlaying: CurrentPlaying | null;
  isLoadingDiscover: boolean;
  isLoadingAddons: boolean;
  isLoadingLibrary: boolean;
  isLoadingSearch: boolean;
  isLoadingMoreSearch: boolean;
  isLoadingStreams: boolean;
  error: string | null;
  setSelectedItem: (item: ContentItem | null) => void;
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
}

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
  selectedItem: null,
  streams: [],
  isLoadingDiscover: false,
  isLoadingAddons: false,
  isLoadingLibrary: false,
  isLoadingSearch: false,
  isLoadingMoreSearch: false,
  isLoadingStreams: false,
  error: null,
};

export const useContentStore = create<ContentState>((set, get) => ({
  ...initialState,

  setSelectedItem: (item: ContentItem | null) => {
    set({ selectedItem: item });
  },

  resetStore: () => {
    set(initialState);
  },

  fetchDiscover: async (forceRefresh = false) => {
    const currentData = get().discoverData;
    // Show cached data immediately (stale-while-revalidate)
    if (currentData && !forceRefresh) {
      // Still refresh in background, but don't show loading spinner
      api.content.getDiscover().then(data => {
        set({ discoverData: data });
      }).catch(err => {
        console.log('[ContentStore] Background refresh error:', err);
      });
      return;
    }
    set({ isLoadingDiscover: true, error: null });
    try {
      const data = await api.content.getDiscover();
      set({ discoverData: data, isLoadingDiscover: false });
    } catch (error: any) {
      console.log('[ContentStore] fetchDiscover error:', error);
      set({ error: error.message, isLoadingDiscover: false, discoverData: currentData || null });
    }
  },

  fetchAddons: async (forceRefresh = false) => {
    set({ isLoadingAddons: true, error: null });
    try {
      const data = await api.addons.getAll();
      set({ addons: data || [], isLoadingAddons: false });
    } catch (error: any) {
      console.log('[ContentStore] fetchAddons error:', error);
      set({ error: error.message, isLoadingAddons: false, addons: [] });
    }
  },

  fetchLibrary: async (forceRefresh = false) => {
    set({ isLoadingLibrary: true, error: null });
    try {
      const data = await api.library.get();
      set({ library: data, isLoadingLibrary: false });
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
    const cacheKey = `${type}/${id}`;
    
    // CHECK CACHE FIRST — instant return if we have data
    const cached = getStreamsCache(cacheKey);
    if (cached && cached.length > 0) {
      set({ streams: cached, isLoadingStreams: false, error: null });
      return cached;
    }
    
    set({ isLoadingStreams: true, streams: [], error: null });
    
    try {
      // Progressive loading: show streams as each source responds
      const result = await api.addons.getAllStreams(type, id, (partialStreams: Stream[]) => {
        set({ streams: partialStreams });
        if (partialStreams.length > 0) {
          set({ isLoadingStreams: false });
        }
      });
      const allStreams = result.streams || [];
      // Cache the result for instant re-access
      setStreamsCache(cacheKey, allStreams);
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
      await get().fetchLibrary();
    } catch (error: any) {
      console.log('[ContentStore] addToLibrary error:', error);
      set({ error: error.message });
    }
  },

  removeFromLibrary: async (type: string, id: string) => {
    try {
      await api.library.remove(type, id);
      await get().fetchLibrary();
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
