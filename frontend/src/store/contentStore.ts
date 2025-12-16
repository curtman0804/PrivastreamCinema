import { create } from 'zustand';
import { api, ContentItem, DiscoverResponse, Addon, LibraryResponse, SearchResult, Stream } from '../api/client';

interface ContentState {
  discoverData: DiscoverResponse | null;
  addons: Addon[];
  library: LibraryResponse | null;
  searchResults: SearchResult[];
  streams: Stream[];
  isLoadingDiscover: boolean;
  isLoadingAddons: boolean;
  isLoadingLibrary: boolean;
  isLoadingSearch: boolean;
  isLoadingStreams: boolean;
  error: string | null;
  fetchDiscover: () => Promise<void>;
  fetchAddons: () => Promise<void>;
  fetchLibrary: () => Promise<void>;
  search: (query: string) => Promise<void>;
  fetchStreams: (type: string, id: string) => Promise<Stream[]>;
  addToLibrary: (item: ContentItem) => Promise<void>;
  removeFromLibrary: (type: string, id: string) => Promise<void>;
  clearSearch: () => void;
}

export const useContentStore = create<ContentState>((set, get) => ({
  discoverData: null,
  addons: [],
  library: null,
  searchResults: [],
  streams: [],
  isLoadingDiscover: false,
  isLoadingAddons: false,
  isLoadingLibrary: false,
  isLoadingSearch: false,
  isLoadingStreams: false,
  error: null,

  fetchDiscover: async () => {
    set({ isLoadingDiscover: true, error: null });
    try {
      const data = await api.content.getDiscover();
      set({ discoverData: data, isLoadingDiscover: false });
    } catch (error: any) {
      set({ error: error.message, isLoadingDiscover: false });
    }
  },

  fetchAddons: async () => {
    set({ isLoadingAddons: true, error: null });
    try {
      const data = await api.addons.getAll();
      set({ addons: data, isLoadingAddons: false });
    } catch (error: any) {
      set({ error: error.message, isLoadingAddons: false });
    }
  },

  fetchLibrary: async () => {
    set({ isLoadingLibrary: true, error: null });
    try {
      const data = await api.library.get();
      set({ library: data, isLoadingLibrary: false });
    } catch (error: any) {
      set({ error: error.message, isLoadingLibrary: false });
    }
  },

  search: async (query: string) => {
    if (!query.trim()) {
      set({ searchResults: [] });
      return;
    }
    set({ isLoadingSearch: true, error: null });
    try {
      const data = await api.content.search(query);
      const results = [...(data.movies || []), ...(data.series || [])];
      set({ searchResults: results, isLoadingSearch: false });
    } catch (error: any) {
      set({ error: error.message, isLoadingSearch: false });
    }
  },

  fetchStreams: async (type: string, id: string) => {
    set({ isLoadingStreams: true, streams: [], error: null });
    const { addons } = get();
    const allStreams: Stream[] = [];
    
    // Get streams from all stream-capable addons
    const streamAddons = addons.filter(addon => 
      addon.manifest.resources.includes('stream') ||
      addon.manifest.resources.some((r: any) => r?.name === 'stream')
    );

    for (const addon of streamAddons) {
      try {
        const result = await api.addons.getStreams(addon.id, type, id);
        if (result.streams) {
          allStreams.push(...result.streams);
        }
      } catch (e) {
        // Ignore errors from individual addons
        console.log(`Failed to get streams from ${addon.manifest.name}`);
      }
    }

    set({ streams: allStreams, isLoadingStreams: false });
    return allStreams;
  },

  addToLibrary: async (item: ContentItem) => {
    try {
      await api.library.add(item);
      await get().fetchLibrary();
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  removeFromLibrary: async (type: string, id: string) => {
    try {
      await api.library.remove(type, id);
      await get().fetchLibrary();
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  clearSearch: () => {
    set({ searchResults: [] });
  },
}));
