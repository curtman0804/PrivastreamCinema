/**
 * Privastream Cinema - LOCAL Torrent Streaming Engine
 * Runs directly on the user's device via nodejs-mobile
 * 
 * Architecture (identical to Stremio):
 * - Video player connects to http://localhost:LOCAL_PORT/stream/{hash}
 * - Zero network latency between player and streaming server
 * - torrent-stream handles piece prioritization and range requests natively
 */

const rn_bridge = require('rn_bridge');
const http = require('http');
const url = require('url');
const path = require('path');
const os = require('os');

let torrentStream, PeerSearch, rangeParser, pump, mime;

try {
  torrentStream = require('torrent-stream');
  PeerSearch = require('peer-search');
  rangeParser = require('range-parser');
  pump = require('pump');
  mime = require('mime');
} catch (e) {
  rn_bridge.channel.send(JSON.stringify({ type: 'error', message: 'Missing dependencies: ' + e.message }));
  console.error('Missing dependencies:', e.message);
}

const PORT = 8088; // Local port for streaming
const engines = {};

// Default tracker list
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'udp://tracker.pirateparty.gr:6969/announce',
  'udp://tracker.cyberia.is:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
];

// Spoofed peer ID (looks like qBittorrent)
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
    if (engines[hash].swarm) engines[hash].swarm.resume();
    return engines[hash];
  }

  console.log('[LOCAL-ENGINE] Creating engine for ' + hash.substring(0, 8));

  // Build tracker list
  const trackers = [...DEFAULT_TRACKERS];
  if (options.sources) {
    options.sources.forEach(function(src) {
      if (typeof src === 'string') {
        var trackerUrl = null;
        if (src.startsWith('tracker:')) trackerUrl = src.substring(8);
        else if (src.startsWith('http') || src.startsWith('udp')) trackerUrl = src;
        if (trackerUrl && trackers.indexOf(trackerUrl) === -1) trackers.push(trackerUrl);
      }
    });
  }

  var engineOpts = {
    path: path.join(os.tmpdir(), 'privastream', hash),
    dht: true,
    tracker: true,
    connections: 200,
    uploads: 5,
    verify: true,
    id: generatePeerId(),
    trackers: trackers,
  };

  var magnet = 'magnet:?xt=urn:btih:' + hash;
  var engine = torrentStream(magnet, engineOpts);

  // PeerSearch for extra peer discovery
  engine.ready(function() {
    console.log('[LOCAL-ENGINE] ' + hash.substring(0, 8) + ' ready! Files: ' + engine.files.length);

    // Select largest video file
    var videoFile = null;
    var videoIdx = -1;
    var maxSize = 0;
    var videoExts = ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.wmv', '.flv'];

    engine.files.forEach(function(file, idx) {
      var ext = path.extname(file.name).toLowerCase();
      if (videoExts.indexOf(ext) >= 0 && file.length > maxSize) {
        maxSize = file.length;
        videoFile = file;
        videoIdx = idx;
      }
    });

    if (videoFile) {
      videoFile.select();
      engine._videoFile = videoFile;
      engine._videoIdx = videoIdx;
      console.log('[LOCAL-ENGINE] Selected: ' + videoFile.name + ' (' + (videoFile.length / 1024 / 1024).toFixed(1) + 'MB)');
    } else {
      var largest = engine.files[0];
      engine.files.forEach(function(f) { if (f.length > largest.length) largest = f; });
      largest.select();
      engine._videoFile = largest;
      console.log('[LOCAL-ENGINE] Fallback: ' + largest.name);
    }

    // Notify React Native that engine is ready
    rn_bridge.channel.send(JSON.stringify({
      type: 'engine_ready',
      infoHash: hash,
      fileName: engine._videoFile.name,
      fileSize: engine._videoFile.length,
    }));
  });

  // PeerSearch
  try {
    var peerSources = ['dht:' + hash];
    trackers.forEach(function(t) { peerSources.push('tracker:' + t); });
    new PeerSearch(peerSources, engine.swarm, { min: 40, max: 200 });
  } catch (e) {
    console.log('[LOCAL-ENGINE] PeerSearch failed:', e.message);
  }

  engine._lastAccess = Date.now();
  engines[hash] = engine;
  return engine;
}

function destroyEngine(infoHash) {
  var hash = infoHash.toLowerCase();
  var engine = engines[hash];
  if (!engine) return;
  engine.destroy(function() { console.log('[LOCAL-ENGINE] ' + hash.substring(0, 8) + ' destroyed'); });
  delete engines[hash];
}

function getStatus(engine) {
  if (!engine) return null;
  var file = engine._videoFile;
  var peers = engine.swarm ? engine.swarm.wires.filter(function(w) { return !w.peerChoking; }).length : 0;
  var totalPeers = engine.swarm ? engine.swarm.wires.length : 0;

  var stats = {
    peers: peers,
    totalPeers: totalPeers,
    downloadSpeed: engine.swarm ? engine.swarm.downloadSpeed() : 0,
    downloaded: engine.swarm ? engine.swarm.downloaded : 0,
  };

  if (file && engine.torrent) {
    stats.videoFile = file.name;
    stats.videoSize = file.length;
    var pieceLength = engine.torrent.pieceLength;
    var startPiece = Math.floor(file.offset / pieceLength);
    var endPiece = Math.floor((file.offset + file.length - 1) / pieceLength);
    var available = 0;
    for (var i = startPiece; i <= endPiece; i++) {
      if (engine.bitfield.get(i)) available++;
    }
    stats.progress = available / (endPiece - startPiece + 1);
    // Ready when first 5 pieces are available
    var firstNeeded = Math.min(5, endPiece - startPiece + 1);
    var firstAvailable = 0;
    for (var j = startPiece; j < startPiece + firstNeeded; j++) {
      if (engine.bitfield.get(j)) firstAvailable++;
    }
    stats.ready = firstAvailable >= firstNeeded;
  }
  return stats;
}

// ==================== LOCAL HTTP SERVER ====================

var server = http.createServer(function(req, res) {
  var parsed = url.parse(req.url, true);
  var parts = parsed.pathname.split('/').filter(Boolean);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

  // GET /health
  if (parsed.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', local: true, engines: Object.keys(engines).length }));
  }

  // POST /create/:hash
  if (req.method === 'POST' && parts[0] === 'create' && parts[1]) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      var opts = {};
      try { opts = JSON.parse(body); } catch(e) {}
      var eng = createEngine(parts[1], opts);
      // Wait for ready, timeout after 30s
      var waitTimeout = setTimeout(function() {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'creating', infoHash: parts[1].toLowerCase() }));
        }
      }, 30000);
      eng.ready(function() {
        clearTimeout(waitTimeout);
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(getStatus(eng)));
        }
      });
    });
    return;
  }

  // GET /status/:hash
  if (parts[0] === 'status' && parts[1]) {
    var eng = getEngine(parts[1]);
    if (!eng) { res.writeHead(404); return res.end('Not found'); }
    eng._lastAccess = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getStatus(eng)));
  }

  // GET /stream/:hash - Stream video (Stremio pattern)
  if (parts[0] === 'stream' && parts[1]) {
    var eng = getEngine(parts[1]);
    if (!eng) { res.writeHead(404); return res.end('Engine not found'); }
    eng._lastAccess = Date.now();
    if (!eng.torrent || !eng._videoFile) {
      eng.ready(function() { handleLocalStream(req, res, eng); });
      setTimeout(function() { if (!res.writableEnded) { res.writeHead(503); res.end('Not ready'); } }, 30000);
      return;
    }
    handleLocalStream(req, res, eng);
    return;
  }

  // POST /prefetch/:hash
  if (req.method === 'POST' && parts[0] === 'prefetch' && parts[1]) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      var eng = getEngine(parts[1]);
      if (!eng || !eng.torrent || !eng._videoFile) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not ready' }));
      }
      var params = {};
      try { params = JSON.parse(body); } catch(e) {}
      var file = eng._videoFile;
      var posBytes = params.position_bytes || 0;
      var pieceLength = eng.torrent.pieceLength;
      var bufferSize = 2 * 1024 * 1024;
      var startByte = Math.max(0, posBytes);
      var endByte = Math.min(file.length - 1, posBytes + bufferSize);
      var startPiece = Math.floor((file.offset + startByte) / pieceLength);
      var endPiece = Math.floor((file.offset + endByte) / pieceLength);

      // Trigger priority download via createReadStream
      try {
        var prefStream = file.createReadStream({ start: startByte, end: Math.min(startByte + 65536, endByte) });
        prefStream.on('data', function() {});
        prefStream.on('end', function() {});
        prefStream.on('error', function() {});
        setTimeout(function() { try { prefStream.destroy(); } catch(e) {} }, 1000);
      } catch(e) {}

      // Poll for pieces
      var waited = 0;
      var maxWait = 30000;
      var interval = 300;
      (function check() {
        if (waited >= maxWait) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'timeout', position_bytes: posBytes }));
        }
        var avail = 0;
        for (var i = startPiece; i <= endPiece; i++) {
          if (eng.bitfield.get(i)) avail++;
        }
        if (avail >= Math.min(3, endPiece - startPiece + 1)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: 'ready', wait_ms: waited, position_bytes: posBytes }));
        }
        waited += interval;
        setTimeout(check, interval);
      })();
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

function handleLocalStream(req, res, engine) {
  var file = engine._videoFile;
  if (!file) { res.writeHead(404); return res.end('No video file'); }

  req.connection.setTimeout(24 * 60 * 60 * 1000);

  var range = req.headers.range;
  var parsed = range ? rangeParser(file.length, range) : null;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime.lookup(file.name) || 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('transferMode.dlna.org', 'Streaming');

  if (req.method === 'HEAD') {
    if (parsed && parsed !== -1 && parsed !== -2 && parsed.length > 0) {
      var r = parsed[0];
      res.writeHead(206, { 'Content-Length': r.end - r.start + 1, 'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + file.length });
    } else {
      res.writeHead(200, { 'Content-Length': file.length });
    }
    return res.end();
  }

  if (parsed && parsed !== -1 && parsed !== -2 && parsed.length > 0) {
    var r = parsed[0];
    res.writeHead(206, { 'Content-Length': r.end - r.start + 1, 'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + file.length });
    var stream = file.createReadStream({ start: r.start, end: r.end });
    pump(stream, res);
  } else {
    res.writeHead(200, { 'Content-Length': file.length });
    var stream = file.createReadStream();
    pump(stream, res);
  }
}

server.listen(PORT, '127.0.0.1', function() {
  console.log('[LOCAL-ENGINE] Running on http://localhost:' + PORT);
  rn_bridge.channel.send(JSON.stringify({ type: 'server_ready', port: PORT }));
});

// Handle messages from React Native
rn_bridge.channel.on('message', function(msg) {
  try {
    var cmd = JSON.parse(msg);
    if (cmd.action === 'create') {
      createEngine(cmd.infoHash, cmd);
      rn_bridge.channel.send(JSON.stringify({ type: 'creating', infoHash: cmd.infoHash }));
    } else if (cmd.action === 'destroy') {
      destroyEngine(cmd.infoHash);
    } else if (cmd.action === 'status') {
      var eng = getEngine(cmd.infoHash);
      var status = eng ? getStatus(eng) : null;
      rn_bridge.channel.send(JSON.stringify({ type: 'status', infoHash: cmd.infoHash, data: status }));
    }
  } catch (e) {
    console.log('[LOCAL-ENGINE] Message error:', e);
  }
});

process.on('uncaughtException', function(err) {
  console.error('[LOCAL-ENGINE] Uncaught:', err);
  rn_bridge.channel.send(JSON.stringify({ type: 'error', message: err.message }));
});

console.log('[LOCAL-ENGINE] Privastream local engine starting...');
