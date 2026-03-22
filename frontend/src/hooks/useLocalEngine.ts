/**
 * Hook to manage the local Node.js torrent streaming engine
 * This is the bridge between React Native and the embedded Node.js runtime
 * 
 * When nodejs-mobile is available (native build), it runs the torrent engine locally.
 * When not available (web/Expo Go), it falls back to the cloud backend.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';

let Nodejs: any = null;

// Try to import nodejs-mobile (only available in native builds)
try {
  Nodejs = require('nodejs-mobile-react-native').default;
} catch (e) {
  console.log('[LOCAL-ENGINE] nodejs-mobile not available, using cloud backend');
}

const LOCAL_PORT = 8088;
const LOCAL_BASE_URL = `http://localhost:${LOCAL_PORT}`;

export interface LocalEngineState {
  isAvailable: boolean;  // Is nodejs-mobile installed?
  isRunning: boolean;    // Is the local server running?
  port: number;
  baseUrl: string;
}

export function useLocalEngine() {
  const [state, setState] = useState<LocalEngineState>({
    isAvailable: !!Nodejs,
    isRunning: false,
    port: LOCAL_PORT,
    baseUrl: LOCAL_BASE_URL,
  });
  const startedRef = useRef(false);

  // Start the Node.js engine on mount
  useEffect(() => {
    if (!Nodejs || startedRef.current) return;
    
    try {
      console.log('[LOCAL-ENGINE] Starting Node.js runtime...');
      Nodejs.start('main.js');
      startedRef.current = true;

      // Listen for messages from Node.js
      const handleMessage = (msg: string) => {
        try {
          const data = JSON.parse(msg);
          
          if (data.type === 'server_ready') {
            console.log(`[LOCAL-ENGINE] Server ready on port ${data.port}`);
            setState(prev => ({ ...prev, isRunning: true, port: data.port }));
          } else if (data.type === 'engine_ready') {
            console.log(`[LOCAL-ENGINE] Engine ready: ${data.fileName} (${(data.fileSize / 1024 / 1024).toFixed(1)}MB)`);
          } else if (data.type === 'error') {
            console.error(`[LOCAL-ENGINE] Error: ${data.message}`);
          }
        } catch (e) {
          // Non-JSON message, ignore
        }
      };

      Nodejs.channel.addListener('message', handleMessage);
      
      return () => {
        Nodejs.channel.removeListener('message', handleMessage);
      };
    } catch (e) {
      console.log('[LOCAL-ENGINE] Failed to start:', e);
    }
  }, []);

  // Create a torrent engine locally
  const createEngine = useCallback((infoHash: string, sources?: string[]) => {
    if (!Nodejs || !state.isRunning) return;
    Nodejs.channel.send(JSON.stringify({
      action: 'create',
      infoHash,
      sources: sources || [],
    }));
  }, [state.isRunning]);

  // Get the local stream URL for a torrent
  const getStreamUrl = useCallback((infoHash: string): string | null => {
    if (!state.isRunning) return null;
    return `${LOCAL_BASE_URL}/stream/${infoHash}`;
  }, [state.isRunning]);

  // Get the local status URL
  const getStatusUrl = useCallback((infoHash: string): string | null => {
    if (!state.isRunning) return null;
    return `${LOCAL_BASE_URL}/status/${infoHash}`;
  }, [state.isRunning]);

  return {
    ...state,
    createEngine,
    getStreamUrl,
    getStatusUrl,
  };
}
