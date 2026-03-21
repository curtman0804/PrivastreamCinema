import WebTorrent from 'webtorrent';
import express from 'express';
import cors from 'cors';
import path from 'path';

const app = express();
app.use(express.json()); // Parse JSON request bodies

// Get correct MIME type from filename
function getMimeType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
    '.ts': 'video/mp2t',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
  };
  return mimeTypes[ext] || 'video/mp4';
}

// Create WebTorrent client optimized for container/K8s environments (no UDP)
const client = new WebTorrent({
  maxConns: 100,
  dht: false,            // Disabled - UDP blocked in K8s
  lsd: false,            // Disabled - not useful in containers
  webSeeds: true,
  utp: false,            // Disabled - UDP blocked in K8s
  tracker: {
    announce: [
      // WebSocket trackers (work over HTTPS - best for containers)
      'wss://tracker.openwebtorrent.com',
      'wss://tracker.btorrent.xyz',
      'wss://tracker.files.fm:7073/announce',
      'wss://spacetradersapi-chatbox.herokuapp.com:443/announce',
      // HTTP trackers (work through standard ports - K8s friendly)
      'http://tracker.openbittorrent.com:80/announce',
      'http://tracker3.itzmx.com:6961/announce',
      'http://tracker.bt4g.com:2095/announce',
      'http://tracker.files.fm:6969/announce',
      'http://t.nyaatracker.com:80/announce',
      'http://tracker.gbitt.info:80/announce',
      'http://tracker.ccp.ovh:6969/announce',
      'http://open.acgnxtracker.com:80/announce',
      'http://tracker.dler.org:6969/announce',
      'http://opentracker.i2p.rocks:6969/announce',
      'http://tracker.opentrackr.org:1337/announce',
      'https://tracker.lilithraws.org:443/announce',
      'https://tr.burnabyhighstar.com:443/announce',
      'https://tracker.tamersunion.org:443/announce',
      'https://tracker.imgoingto.icu:443/announce',
    ]
  }
});

app.use(cors());

// Store active torrents and their start times
const torrents = new Map();
const torrentStartTimes = new Map();

// Periodically log status for debugging
setInterval(() => {
  const activeTorrents = client.torrents.length;
  const totalPeers = client.torrents.reduce((sum, t) => sum + t.numPeers, 0);
  if (activeTorrents > 0) {
    console.log(`📊 Active torrents: ${activeTorrents}, Total peers: ${totalPeers}`);
  }
}, 30000);

// Pre-warm: start downloading a torrent without streaming
app.post('/prewarm/:infoHash', (req, res) => {
  const { infoHash } = req.params;
  const infoHashLower = infoHash.toLowerCase();
  
  // Check if already started
  let torrent = torrents.get(infoHashLower);
  if (!torrent) {
    torrent = client.torrents.find(t => t.infoHash && t.infoHash.toLowerCase() === infoHashLower);
  }
  
  if (torrent) {
    return res.json({
      status: torrent.ready ? 'ready' : 'warming',
      peers: torrent.numPeers,
      progress: Math.round(torrent.progress * 100)
    });
  }
  
  // Start the torrent
  const trackers = [
    // WebSocket trackers - KEY for peer discovery in K8s (where UDP is blocked)
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.files.fm:7073/announce',
    'wss://spacetradersapi-chatbox.herokuapp.com:443/announce',
    'wss://tracker.webtorrent.dev',
    // HTTP/HTTPS trackers
    'http://tracker.openbittorrent.com:80/announce',
    'http://tracker3.itzmx.com:6961/announce',
    'http://tracker.bt4g.com:2095/announce',
    'http://tracker.files.fm:6969/announce',
    'http://tracker.opentrackr.org:1337/announce',
    'http://tracker2.dler.org:80/announce',
    'http://tracker.mywaifu.best:6969/announce',
    'http://tracker.renfei.net:8080/announce',
    'http://tracker.tritan.gg:8080/announce',
    'http://open.trackerlist.xyz:80/announce',
    'http://1337.abcvg.info:80/announce',
    'http://tracker.ghostchu-services.top:80/announce',
    'http://wepzone.net:6969/announce',
    'http://tracker.qu.ax:6969/announce',
    'https://tracker.lilithraws.org:443/announce',
    'https://tr.burnabyhighstar.com:443/announce',
    'https://tracker.tamersunion.org:443/announce',
    'https://tracker.bt4g.com:443/announce',
    'https://tracker.zhuqiy.com:443/announce',
    'https://tracker.moeblog.cn:443/announce',
  ];
  
  // Add extra trackers from the request body (from Torrentio stream sources)
  let extraTrackers = [];
  try {
    if (req.body && req.body.trackers && Array.isArray(req.body.trackers)) {
      extraTrackers = req.body.trackers.filter(t => t.startsWith('http'));
      console.log(`📡 Got ${extraTrackers.length} extra trackers from Torrentio`);
    }
  } catch (e) {}
  
  const allTrackers = [...trackers, ...extraTrackers];
  
  let magnetURI = `magnet:?xt=urn:btih:${infoHash}`;
  allTrackers.forEach(t => { magnetURI += `&tr=${encodeURIComponent(t)}`; });
  
  try {
    const newTorrent = client.add(magnetURI, { maxWebConns: 10, storeCacheSlots: 50 });
    torrents.set(infoHashLower, newTorrent);
    torrentStartTimes.set(infoHashLower, Date.now());
    console.log(`🔥 Pre-warming torrent: ${infoHash}`);
    
    newTorrent.on('error', (err) => {
      console.error('Pre-warm torrent error:', err);
    });
    
    res.json({ status: 'warming', info_hash: infoHash });
  } catch (err) {
    console.error('Pre-warm error:', err);
    res.json({ status: 'error', error: err.message });
  }
});

// Get torrent status
app.get('/status/:infoHash', (req, res) => {
  const { infoHash } = req.params;
  const magnetURI = `magnet:?xt=urn:btih:${infoHash}`;

  // Check our Map first, then fallback to client.get()
  let torrent = torrents.get(infoHash.toLowerCase());
  if (!torrent) {
    torrent = client.get(infoHash) || client.get(magnetURI);
  }

  if (!torrent) {
    return res.json({
      ready: false,
      progress: 0,
      peers: 0,
      downloadSpeed: 0,
      status: 'not_found'
    });
  }

  // Find the largest video file for filename info
  let videoFileName = '';
  if (torrent.files && torrent.files.length > 0) {
    const videoFile = torrent.files.reduce((largest, f) => {
      const isVideo = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i.test(f.name);
      if (!isVideo) return largest;
      return (!largest || f.length > largest.length) ? f : largest;
    }, null);
    if (videoFile) videoFileName = videoFile.name;
  }

  res.json({
    ready: torrent.ready,
    progress: Math.round(torrent.progress * 100),
    peers: torrent.numPeers,
    downloadSpeed: torrent.downloadSpeed,
    downloaded: torrent.downloaded,
    name: torrent.name,
    videoFileName: videoFileName,
    status: torrent.ready ? 'ready' : 'buffering'
  });
});

// Add torrent and stream endpoint
app.get('/stream/:infoHash', (req, res) => {
  const { infoHash } = req.params;
  const infoHashLower = infoHash.toLowerCase();
  
  // HTTP/WSS-only trackers (UDP is blocked in K8s/container production environments)
  const trackers = [
    // WebSocket trackers (work over HTTPS - best for containers)
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.files.fm:7073/announce',
    'wss://spacetradersapi-chatbox.herokuapp.com:443/announce',
    // HTTP trackers (verified working 2026)
    'http://tracker.opentrackr.org:1337/announce',
    'http://tracker.bt4g.com:2095/announce',
    'http://tracker2.dler.org:80/announce',
    'http://tracker.renfei.net:8080/announce',
    'http://tracker.tritan.gg:8080/announce',
    'http://tracker.sbsub.com:2710/announce',
    'http://tracker.mywaifu.best:6969/announce',
    'http://tracker.moxing.party:6969/announce',
    'http://tracker.ipv6tracker.org:80/announce',
    'http://tracker.bz:80/announce',
    'http://tracker.bittor.pw:1337/announce',
    'http://open.trackerlist.xyz:80/announce',
    'http://open.acgtracker.com:1096/announce',
    'http://bvarf.tracker.sh:2086/announce',
    'http://bt1.xxxxbt.cc:6969/announce',
    'http://tracker.ghostchu-services.top:80/announce',
    'http://tracker.dler.org:6969/announce',
    'http://tr.nyacat.pw:80/announce',
    'http://1337.abcvg.info:80/announce',
    'http://wepzone.net:6969/announce',
    'http://tracker.wepzone.net:6969/announce',
    'http://tracker.qu.ax:6969/announce',
    'http://tracker.darkness.services:6969/announce',
    'http://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce',
    'http://www.genesis-sp.org:2710/announce',
    'http://tracker.skyts.net:6969/announce',
    // HTTPS trackers
    'https://tracker.zhuqiy.com:443/announce',
    'https://tracker.pmman.tech:443/announce',
    'https://tracker.moeblog.cn:443/announce',
    'https://tracker.bt4g.com:443/announce',
    'https://tr.zukizuki.org:443/announce',
    'https://tracker.ghostchu-services.top:443/announce',
    'https://tr.nyacat.pw:443/announce',
  ];
  
  let magnetURI = `magnet:?xt=urn:btih:${infoHash}`;
  trackers.forEach(t => { magnetURI += `&tr=${encodeURIComponent(t)}`; });

  // Get fileIdx and filename from query params for specific file selection
  const requestedFileIdx = req.query.fileIdx !== undefined ? parseInt(req.query.fileIdx, 10) : null;
  const requestedFilename = req.query.filename || null;

  console.log('Stream request for:', infoHash, 'fileIdx:', requestedFileIdx, 'filename:', requestedFilename);

  // Check if torrent already added using our Map first
  let torrent = torrents.get(infoHashLower);
  if (!torrent) {
    // Fallback to client.get() but normalize the infoHash
    torrent = client.get(infoHash) || client.get(magnetURI);
  }
  console.log('Torrent from storage:', torrent ? 'found' : 'not found');

  const handleTorrent = (torrent) => {
    let file = null;
    
    // Method 1: Select by fileIdx if provided
    if (requestedFileIdx !== null && requestedFileIdx >= 0 && requestedFileIdx < torrent.files.length) {
      file = torrent.files[requestedFileIdx];
      console.log('Selected file by fileIdx:', requestedFileIdx, '->', file?.name);
    }
    
    // Method 2: Select by filename match if provided
    if (!file && requestedFilename) {
      // Try exact match first
      file = torrent.files.find(f => f.name === requestedFilename);
      // Try partial match (filename might be truncated)
      if (!file) {
        const searchName = requestedFilename.toLowerCase();
        file = torrent.files.find(f => f.name.toLowerCase().includes(searchName) || searchName.includes(f.name.toLowerCase()));
      }
      // Try matching the episode pattern from filename
      if (!file) {
        const episodeMatch = requestedFilename.match(/S(\d{1,2})E(\d{1,2})/i);
        if (episodeMatch) {
          const episodePattern = new RegExp(`S0?${parseInt(episodeMatch[1])}E0?${parseInt(episodeMatch[2])}`, 'i');
          file = torrent.files.find(f => {
            const isVideo = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i.test(f.name);
            return isVideo && episodePattern.test(f.name);
          });
        }
      }
      if (file) {
        console.log('Selected file by filename match:', file.name);
      }
    }
    
    // Method 3: Fallback to largest video file
    if (!file) {
      file = torrent.files.reduce((largest, f) => {
        const isVideo = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i.test(f.name);
        if (!isVideo) return largest;
        return (!largest || f.length > largest.length) ? f : largest;
      }, null);
      console.log('Selected largest video file as fallback:', file?.name);
    }

    if (!file) {
      console.error('No video file found in torrent');
      return res.status(404).send('No video file found');
    }

    const contentType = getMimeType(file.name);
    console.log('Streaming file:', file.name, 'Size:', (file.length / (1024*1024*1024)).toFixed(2), 'GB', 'MIME:', contentType);

    // Set proper headers for video streaming with CORS
    const fileSize = file.length;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      console.log(`Serving range: ${start}-${end}/${fileSize}`);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range',
      });

      const stream = file.createReadStream({ start, end });
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      stream.pipe(res);
    } else {
      console.log('Serving full file');

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range',
      });

      const stream = file.createReadStream();
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      stream.pipe(res);
    }
  };

  const handleTorrentWhenReady = (torrent) => {
    console.log('Torrent metadata loaded:', torrent.name);
    console.log('Peers:', torrent.numPeers, 'Progress:', (torrent.progress * 100).toFixed(2) + '%');

    const startStreaming = () => {
      // Start immediately if peers exist, otherwise wait briefly
      const checkAndStream = () => {
        if (torrent.numPeers > 0) {
          console.log('✅ Torrent has peers, starting stream immediately. Peers:', torrent.numPeers);
          handleTorrent(torrent);
        } else {
          console.log('⏳ No peers yet, starting anyway (DHT will find peers during stream)');
          // Start immediately - buffering will handle peer discovery
          handleTorrent(torrent);
        }
      };

      // Reduced wait: Only 500ms to quickly check for peers
      setTimeout(checkAndStream, 500);
    };

    // Wait for torrent to be ready (has selected files)
    if (torrent.ready) {
      console.log('Torrent already ready');
      startStreaming();
    } else {
      console.log('Waiting for torrent to be ready...');
      torrent.on('ready', () => {
        console.log('✅ Torrent ready event fired');
        startStreaming();
      });

      // Fallback timeout in case ready event doesn't fire
      setTimeout(() => {
        if (!res.headersSent) {
          console.log('⚠️ Timeout - forcing stream start');
          handleTorrent(torrent);
        }
      }, 60000); // 60 second absolute timeout (HTTP trackers need time to respond)
    }
  };

  if (torrent && typeof torrent.on === 'function') {
    console.log('Using existing torrent');
    handleTorrentWhenReady(torrent);
  } else {
    console.log('Adding new torrent...');
    try {
      // Double-check that we don't already have this torrent
      const existingTorrent = client.torrents.find(t =>
        t.infoHash && t.infoHash.toLowerCase() === infoHashLower
      );

      if (existingTorrent) {
        console.log('Found existing torrent by infoHash search');
        torrents.set(infoHashLower, existingTorrent);
        handleTorrentWhenReady(existingTorrent);
        return;
      }

      const newTorrent = client.add(magnetURI, {
        // Optimize for streaming
        maxWebConns: 10,
        storeCacheSlots: 50
      });

      torrents.set(infoHashLower, newTorrent);
      torrentStartTimes.set(infoHashLower, Date.now());

      newTorrent.on('error', (err) => {
        console.error('Torrent error:', err);
        if (!res.headersSent) {
          res.status(500).send('Torrent error: ' + err.message);
        }
      });

      handleTorrentWhenReady(newTorrent);
    } catch (err) {
      console.error('Error adding torrent:', err);
      res.status(500).send('Error adding torrent: ' + err.message);
    }
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeTorrents: client.torrents.length
  });
});

const PORT = process.env.PORT || 8002;
app.listen(PORT, () => {
  console.log(`🚀 WebTorrent streaming server running on port ${PORT}`);
});
