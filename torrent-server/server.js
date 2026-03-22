/**
 * Privastream Cinema - Torrent Streaming Server
 * 
 * Based on Stremio's enginefs architecture:
 * - Uses torrent-stream for native BitTorrent (TCP/uTP, not WebRTC)
 * - PeerSearch for aggressive peer discovery (DHT + trackers)
 * - Proper HTTP range request support with pump/backpressure
 * - Automatic piece prioritization via createReadStream
 */

const http = require('http');
const url = require('url');
const path = require('path');
const os = require('os');
const fs = require('fs');

let torrentStream, PeerSearch, rangeParser, pump, mime;

try {
  torrentStream = require('torrent-stream');
  PeerSearch = require('peer-search');
  rangeParser = require('range-parser');
  pump = require('pump');
  mime = require('mime');
} catch (e) {
  console.error('Missing dependencies, installing...', e.message);
  process.exit(1);
}

const PORT = process.env.TORRENT_PORT || 8002;

// ==================== ENGINE MANAGEMENT ====================

const engines = {};

// Stremio-like defaults
const ENGINE_TIMEOUT = 5 * 60 * 1000; // 5 min idle = destroy
const STREAM_TIMEOUT = 30 * 1000; // 30s stream inactivity

// Default tracker list - comprehensive for maximum peer discovery
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'udp://tracker.pirateparty.gr:6969/announce',
  'udp://tracker.cyberia.is:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://9.rarbg.to:2710/announce',
];

// Spoofed peer ID prefix (looks like qBittorrent)
function generatePeerId() {
  const prefix = '-qB4510-';
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let id = prefix;
  for (let i = 0; i < 12; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function getEngine(infoHash) {
  return engines[infoHash.toLowerCase()];
}

function createEngine(infoHash, options = {}) {
  const hash = infoHash.toLowerCase();
  
  if (engines[hash]) {
    // Engine exists, resume swarm and return
    const e = engines[hash];
    if (e.swarm) e.swarm.resume();
    
    // Add any new tracker sources
    if (options.sources && options.sources.length > 0 && e.swarm && e.swarm.peerSearch) {
      // PeerSearch is already running, add new sources
      console.log(`[ENGINE] Adding ${options.sources.length} new sources to existing engine ${hash.substring(0, 8)}`);
    }
    
    return e;
  }

  console.log(`[ENGINE] Creating new engine for ${hash.substring(0, 8)}...`);

  // Build peer search sources (Stremio pattern)
  const peerSources = ['dht:' + hash];
  
  // Add default trackers
  DEFAULT_TRACKERS.forEach(t => peerSources.push('tracker:' + t));
  
  // Add extra trackers from Torrentio/user
  if (options.sources) {
    options.sources.forEach(src => {
      if (typeof src === 'string') {
        if (src.startsWith('tracker:')) {
          peerSources.push(src);
        } else if (src.startsWith('http') || src.startsWith('udp')) {
          peerSources.push('tracker:' + src);
        }
      }
    });
  }

  const engineOpts = {
    path: path.join(os.tmpdir(), 'privastream', hash),
    dht: false,    // Disabled - using PeerSearch instead (Stremio pattern)
    tracker: false, // Disabled - using PeerSearch instead
    connections: 200, // Max peers
    uploads: 10,
    verify: true,
    id: generatePeerId(),
  };

  const magnet = `magnet:?xt=urn:btih:${hash}`;
  const engine = torrentStream(magnet, engineOpts);

  // Use PeerSearch for aggressive peer discovery (Stremio's secret sauce)
  engine.ready(function() {
    console.log(`[ENGINE] ${hash.substring(0, 8)} ready! Files: ${engine.files.length}`);
    
    // Find and select the largest video file
    let videoFile = null;
    let videoIdx = -1;
    let maxSize = 0;
    
    const videoExts = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.wmv', '.flv'];
    engine.files.forEach((file, idx) => {
      const ext = path.extname(file.name).toLowerCase();
      if (videoExts.includes(ext) && file.length > maxSize) {
        maxSize = file.length;
        videoFile = file;
        videoIdx = idx;
      }
    });

    if (videoFile) {
      // Select the video file for download (Stremio pattern: select() without priority starts downloading)
      videoFile.select();
      engine._videoFile = videoFile;
      engine._videoIdx = videoIdx;
      console.log(`[ENGINE] Selected video: ${videoFile.name} (${(videoFile.length / 1024 / 1024).toFixed(1)}MB)`);
    } else {
      // Fallback: select the largest file
      let largest = engine.files[0];
      let largestIdx = 0;
      engine.files.forEach((f, i) => {
        if (f.length > largest.length) {
          largest = f;
          largestIdx = i;
        }
      });
      largest.select();
      engine._videoFile = largest;
      engine._videoIdx = largestIdx;
      console.log(`[ENGINE] No video found, selected largest file: ${largest.name}`);
    }
  });

  // PeerSearch - this is what makes Stremio fast
  try {
    new PeerSearch(peerSources, engine.swarm, {
      min: 40,
      max: 200,
      cooloff_time: 30,
      cooloff_requests: 15,
    });
    console.log(`[ENGINE] PeerSearch started with ${peerSources.length} sources`);
  } catch (e) {
    console.error(`[ENGINE] PeerSearch failed:`, e.message);
  }

  // Logging
  engine.on('download', function(pieceIndex) {
    // Log occasionally
    if (pieceIndex % 50 === 0) {
      const peers = engine.swarm ? engine.swarm.wires.filter(w => !w.peerChoking).length : 0;
      const dlSpeed = engine.swarm ? (engine.swarm.downloadSpeed() / 1024).toFixed(0) : 0;
      console.log(`[ENGINE] ${hash.substring(0, 8)} piece ${pieceIndex}, ${peers} peers, ${dlSpeed}KB/s`);
    }
  });

  engine.on('idle', function() {
    console.log(`[ENGINE] ${hash.substring(0, 8)} idle (all selected pieces downloaded)`);
  });

  // Auto-cleanup after inactivity
  engine._lastAccess = Date.now();
  engine._cleanupTimer = setInterval(() => {
    if (Date.now() - engine._lastAccess > ENGINE_TIMEOUT) {
      console.log(`[ENGINE] ${hash.substring(0, 8)} inactive for ${ENGINE_TIMEOUT/1000}s, destroying`);
      destroyEngine(hash);
    }
  }, 60000);

  engines[hash] = engine;
  return engine;
}

function destroyEngine(infoHash) {
  const hash = infoHash.toLowerCase();
  const engine = engines[hash];
  if (!engine) return;
  
  if (engine._cleanupTimer) clearInterval(engine._cleanupTimer);
  engine.destroy(function() {
    console.log(`[ENGINE] ${hash.substring(0, 8)} destroyed`);
  });
  delete engines[hash];
}

// ==================== HTTP SERVER ====================

function getVideoFile(engine, fileIdx) {
  if (fileIdx !== undefined && fileIdx !== null && !isNaN(fileIdx)) {
    const idx = parseInt(fileIdx);
    if (engine.files[idx]) return engine.files[idx];
  }
  return engine._videoFile || null;
}

function getEngineStats(engine, fileIdx) {
  if (!engine) return null;
  
  const file = getVideoFile(engine, fileIdx);
  const peers = engine.swarm ? engine.swarm.wires.filter(w => !w.peerChoking).length : 0;
  const totalPeers = engine.swarm ? engine.swarm.wires.length : 0;
  
  const stats = {
    infoHash: engine.infoHash,
    name: engine.torrent ? engine.torrent.name : null,
    peers: peers,
    totalPeers: totalPeers,
    downloaded: engine.swarm ? engine.swarm.downloaded : 0,
    downloadSpeed: engine.swarm ? engine.swarm.downloadSpeed() : 0,
    uploadSpeed: engine.swarm ? engine.swarm.uploadSpeed() : 0,
    files: engine.files ? engine.files.map((f, i) => ({
      name: f.name,
      length: f.length,
      index: i,
    })) : [],
  };

  if (file && engine.torrent) {
    stats.videoFile = file.name;
    stats.videoSize = file.length;
    stats.videoIdx = engine.files.indexOf(file);
    
    // Calculate file-specific progress
    const pieceLength = engine.torrent.pieceLength;
    const startPiece = Math.floor(file.offset / pieceLength);
    const endPiece = Math.floor((file.offset + file.length - 1) / pieceLength);
    let availablePieces = 0;
    for (let i = startPiece; i <= endPiece; i++) {
      if (engine.bitfield.get(i)) availablePieces++;
    }
    const totalPieces = endPiece - startPiece + 1;
    stats.progress = availablePieces / totalPieces;
    stats.availablePieces = availablePieces;
    stats.totalPieces = totalPieces;
    
    // Check if first pieces are available (for readiness)
    const firstPiecesNeeded = Math.min(5, totalPieces); // Need at least first 5 pieces
    let firstPiecesAvailable = 0;
    for (let i = startPiece; i < startPiece + firstPiecesNeeded; i++) {
      if (engine.bitfield.get(i)) firstPiecesAvailable++;
    }
    stats.ready = firstPiecesAvailable >= firstPiecesNeeded;
    stats.firstPiecesAvailable = firstPiecesAvailable;
    stats.firstPiecesNeeded = firstPiecesNeeded;
  }

  return stats;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const parts = parsed.pathname.split('/').filter(Boolean);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // GET /health
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', engines: Object.keys(engines).length }));
  }

  // POST /create/:infoHash - Create/get engine
  if (req.method === 'POST' && parts[0] === 'create' && parts[1]) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      let options = {};
      try { options = JSON.parse(body); } catch(e) {}
      
      const engine = createEngine(parts[1], options);
      
      // Wait for engine to be ready, then return stats
      const waitReady = (attempts) => {
        if (attempts <= 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'creating', infoHash: parts[1].toLowerCase() }));
        }
        
        if (engine.torrent && engine._videoFile) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(getEngineStats(engine)));
        }
        
        setTimeout(() => waitReady(attempts - 1), 500);
      };
      
      engine.ready(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getEngineStats(engine)));
      });
      
      // Timeout after 30s if not ready
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'creating', infoHash: parts[1].toLowerCase() }));
        }
      }, 30000);
    });
    return;
  }

  // GET /status/:infoHash - Get engine stats
  if (parts[0] === 'status' && parts[1]) {
    const engine = getEngine(parts[1]);
    if (!engine) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Engine not found' }));
    }
    engine._lastAccess = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getEngineStats(engine, parts[2])));
  }

  // GET /stream/:infoHash/:fileIdx? - Stream video (Stremio enginefs pattern)
  if (parts[0] === 'stream' && parts[1]) {
    const engine = getEngine(parts[1]);
    if (!engine) {
      res.writeHead(404);
      return res.end('Engine not found');
    }
    
    engine._lastAccess = Date.now();
    
    if (!engine.torrent) {
      // Engine not ready yet, wait
      engine.ready(() => handleStream(req, res, engine, parts[2]));
      setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(503);
          res.end('Engine not ready');
        }
      }, 30000);
      return;
    }
    
    handleStream(req, res, engine, parts[2]);
    return;
  }

  // GET /destroy/:infoHash - Destroy engine
  if (parts[0] === 'destroy' && parts[1]) {
    destroyEngine(parts[1]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'destroyed' }));
  }

  // POST /prefetch/:infoHash - Pre-fetch pieces at a byte position (for seeking)
  // This is the key to fast seeking - we download pieces BEFORE telling the player to seek
  if (req.method === 'POST' && parts[0] === 'prefetch' && parts[1]) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const engine = getEngine(parts[1]);
      if (!engine || !engine.torrent || !engine._videoFile) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Engine not ready' }));
      }
      
      let params = {};
      try { params = JSON.parse(body); } catch(e) {}
      
      const file = engine._videoFile;
      const positionBytes = params.position_bytes || 0;
      const pieceLength = engine.torrent.pieceLength;
      
      // Calculate which pieces we need for this position
      // We need pieces covering a ~2MB buffer at the seek position
      const bufferSize = 2 * 1024 * 1024; // 2MB prefetch buffer
      const startByte = Math.max(0, positionBytes);
      const endByte = Math.min(file.length - 1, positionBytes + bufferSize);
      
      const startPiece = Math.floor((file.offset + startByte) / pieceLength);
      const endPiece = Math.floor((file.offset + endByte) / pieceLength);
      
      console.log(`[PREFETCH] ${parts[1].substring(0, 8)} seeking to byte ${positionBytes}, pieces ${startPiece}-${endPiece}`);
      
      // Use file.select() to prioritize these pieces
      // Then use createReadStream which auto-prioritizes
      // But we also manually deselect and reselect to force priority
      try {
        file.deselect();
        file.select(); // Re-select from beginning
        // Create a read stream at the seek position - this triggers piece priority
        const prefetchStream = file.createReadStream({ start: startByte, end: Math.min(startByte + 65536, endByte) });
        prefetchStream.on('data', () => {}); // Consume data to trigger download
        prefetchStream.on('end', () => {});
        prefetchStream.on('error', () => {});
        // Destroy after we've triggered the prioritization
        setTimeout(() => {
          try { prefetchStream.destroy(); } catch(e) {}
        }, 1000);
      } catch(e) {
        console.log(`[PREFETCH] Priority set error (non-fatal):`, e.message);
      }
      
      // Poll until pieces are available (max 30 seconds)
      const maxWait = 30000;
      const checkInterval = 300;
      let waited = 0;
      
      const checkPieces = () => {
        if (waited >= maxWait) {
          // Timeout - return partial status
          let available = 0;
          for (let i = startPiece; i <= endPiece; i++) {
            if (engine.bitfield.get(i)) available++;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: 'timeout',
            available: available,
            needed: endPiece - startPiece + 1,
            position_bytes: positionBytes,
          }));
        }
        
        // Check if enough pieces are available
        let available = 0;
        const needed = endPiece - startPiece + 1;
        for (let i = startPiece; i <= endPiece; i++) {
          if (engine.bitfield.get(i)) available++;
        }
        
        // We need at least 3 pieces (enough for player to start buffering from this position)
        const minPiecesNeeded = Math.min(3, needed);
        
        if (available >= minPiecesNeeded) {
          console.log(`[PREFETCH] ${parts[1].substring(0, 8)} ready at byte ${positionBytes}: ${available}/${needed} pieces in ${waited}ms`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: 'ready',
            available: available,
            needed: needed,
            position_bytes: positionBytes,
            wait_ms: waited,
          }));
        }
        
        waited += checkInterval;
        setTimeout(checkPieces, checkInterval);
      };
      
      checkPieces();
    });
    return;
  }

  // GET /list - List all engines
  if (parsed.pathname === '/list') {
    const list = {};
    for (const hash in engines) {
      list[hash] = getEngineStats(engines[hash]);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }

  res.writeHead(404);
  res.end('Not found');
});

/**
 * Handle video streaming with range requests (Stremio enginefs pattern)
 * This is the core of how Stremio serves video - createReadStream + pump
 */
function handleStream(req, res, engine, fileIdx) {
  const file = getVideoFile(engine, fileIdx);
  if (!file) {
    res.writeHead(404);
    return res.end('Video file not found');
  }

  // Set connection timeout to 24 hours (for long videos)
  req.connection.setTimeout(24 * 60 * 60 * 1000);

  const range = req.headers.range;
  const parsedRange = range ? rangeParser(file.length, range) : null;

  // Set common headers
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime.lookup(file.name) || 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  // DLNA headers for smart TV compatibility
  res.setHeader('transferMode.dlna.org', 'Streaming');
  res.setHeader('contentFeatures.dlna.org', 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000');

  if (req.method === 'HEAD') {
    if (parsedRange && parsedRange !== -1 && parsedRange !== -2 && parsedRange.length > 0) {
      const r = parsedRange[0];
      res.writeHead(206, {
        'Content-Length': r.end - r.start + 1,
        'Content-Range': `bytes ${r.start}-${r.end}/${file.length}`,
      });
    } else {
      res.writeHead(200, { 'Content-Length': file.length });
    }
    return res.end();
  }

  if (parsedRange && parsedRange !== -1 && parsedRange !== -2 && parsedRange.length > 0) {
    // Range request (seeking/playback)
    const r = parsedRange[0];
    
    res.writeHead(206, {
      'Content-Length': r.end - r.start + 1,
      'Content-Range': `bytes ${r.start}-${r.end}/${file.length}`,
    });

    // This is the key: createReadStream with start/end automatically
    // prioritizes the required pieces in torrent-stream!
    const stream = file.createReadStream({ start: r.start, end: r.end });
    pump(stream, res);
  } else {
    // Full file request (initial probe)
    res.writeHead(200, { 'Content-Length': file.length });
    const stream = file.createReadStream();
    pump(stream, res);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[TORRENT-SERVER] Stremio-style torrent streaming server on port ${PORT}`);
  console.log(`[TORRENT-SERVER] Using torrent-stream + PeerSearch (native BitTorrent)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[TORRENT-SERVER] Shutting down...');
  for (const hash in engines) {
    destroyEngine(hash);
  }
  server.close();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[TORRENT-SERVER] Uncaught exception:', err);
});
