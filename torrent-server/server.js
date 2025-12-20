import WebTorrent from 'webtorrent';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';

const app = express();

// Configure WebTorrent for faster streaming like Stremio
const client = new WebTorrent({
  maxConns: 100,        // More connections for faster peer discovery
  uploadLimit: 0,       // Disable upload for faster download
  downloadLimit: -1,    // No download limit
});

app.use(cors());

// Store active torrents
const torrents = new Map();

// Stremio-style: Very low buffer threshold - start playing ASAP
const MIN_BUFFER_BYTES = 512 * 1024; // Just 512KB before starting playback
const CRITICAL_PIECES = 100; // Prioritize first 100 pieces

// Extended tracker list for faster peer discovery (like Stremio)
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.fastcast.nz',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://movies.zsw.ca:6969/announce',
];

// Get torrent status with Stremio-style readiness check
app.get('/status/:infoHash', (req, res) => {
  const { infoHash } = req.params;
  const infoHashLower = infoHash.toLowerCase();
  
  let torrent = torrents.get(infoHashLower);
  if (!torrent) {
    torrent = client.get(infoHash);
  }

  if (!torrent) {
    return res.json({
      status: 'not_found',
      ready: false,
      progress: 0,
      peers: 0,
      downloadSpeed: 0
    });
  }

  // Find the video file
  let videoFile = null;
  if (torrent.files) {
    videoFile = torrent.files.reduce((largest, file) => {
      const isVideo = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i.test(file.name);
      if (!isVideo) return largest;
      return (!largest || file.length > largest.length) ? file : largest;
    }, null);
  }

  // Stremio-style: Ready when we have metadata AND minimal buffer
  const downloaded = torrent.downloaded || 0;
  const isReady = torrent.ready && downloaded >= MIN_BUFFER_BYTES;
  
  // Determine status
  let status = 'downloading_metadata';
  if (torrent.ready) {
    if (downloaded >= MIN_BUFFER_BYTES) {
      status = 'ready';
    } else {
      status = 'buffering';
    }
  }

  res.json({
    status: status,
    ready: isReady,
    progress: Math.round(torrent.progress * 100),
    peers: torrent.numPeers,
    downloadSpeed: torrent.downloadSpeed,
    downloaded: downloaded,
    name: torrent.name,
    videoFile: videoFile ? videoFile.name : null,
    videoSize: videoFile ? videoFile.length : null,
    ready_threshold_mb: MIN_BUFFER_BYTES / (1024 * 1024)
  });
});

// Stream endpoint with Stremio-style optimizations
app.get('/stream/:infoHash', (req, res) => handleStream(req, res, 0));
app.get('/stream/:infoHash/:fileIdx', (req, res) => handleStream(req, res, parseInt(req.params.fileIdx, 10)));

function handleStream(req, res, fileIndex) {
  const { infoHash } = req.params;
  const infoHashLower = infoHash.toLowerCase();
  
  // Build magnet with many trackers for faster peer discovery
  let magnetURI = `magnet:?xt=urn:btih:${infoHash}`;
  TRACKERS.forEach(t => { magnetURI += `&tr=${encodeURIComponent(t)}`; });

  console.log(`📺 Stream request: ${infoHash}, fileIdx: ${fileIndex}`);

  let torrent = torrents.get(infoHashLower);
  if (!torrent) {
    torrent = client.get(infoHash);
  }

  const streamFile = (torrent) => {
    // Find the video file
    let file;
    if (fileIndex > 0 && torrent.files[fileIndex]) {
      file = torrent.files[fileIndex];
    } else {
      // Find largest video file
      file = torrent.files.reduce((largest, f) => {
        const isVideo = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i.test(f.name);
        if (!isVideo) return largest;
        return (!largest || f.length > largest.length) ? f : largest;
      }, null);
    }

    if (!file) {
      console.error('❌ No video file found');
      return res.status(404).send('No video file found');
    }

    // STREMIO-STYLE: Deselect all other files to focus bandwidth on video
    torrent.files.forEach(f => {
      if (f !== file) {
        f.deselect();
      }
    });

    // Select and prioritize the video file
    file.select();

    console.log(`▶️ Streaming: ${file.name} (${(file.length / (1024*1024*1024)).toFixed(2)} GB)`);

    // Detect MIME type
    const fileName = file.name.toLowerCase();
    let contentType = 'video/mp4';
    if (fileName.endsWith('.mkv')) contentType = 'video/x-matroska';
    else if (fileName.endsWith('.avi')) contentType = 'video/x-msvideo';
    else if (fileName.endsWith('.webm')) contentType = 'video/webm';
    else if (fileName.endsWith('.ts')) contentType = 'video/mp2t';

    const fileSize = file.length;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      console.log(`📊 Range: ${start}-${end}/${fileSize}`);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range',
      });

      const stream = file.createReadStream({ start, end });
      stream.pipe(res);
      
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
    } else {
      console.log('📊 Full file request');

      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Range',
      });

      const stream = file.createReadStream();
      stream.pipe(res);
      
      stream.on('error', (err) => {
        console.error('Stream error:', err);
        res.end();
      });
    }
  };

  if (torrent && torrent.ready) {
    console.log('✅ Torrent ready, streaming immediately');
    streamFile(torrent);
  } else if (torrent && typeof torrent.once === 'function') {
    console.log('⏳ Torrent loading, waiting for ready...');
    torrent.once('ready', () => {
      console.log('✅ Torrent now ready');
      streamFile(torrent);
    });
  } else {
    console.log('🆕 Adding new torrent...');
    
    // Remove any stale entry
    if (torrent) {
      torrents.delete(infoHashLower);
    }
    
    torrent = client.add(magnetURI, {
      announce: TRACKERS,
      path: '/tmp/webtorrent-' + infoHashLower,
    });

    torrents.set(infoHashLower, torrent);

    torrent.on('ready', () => {
      console.log(`✅ Torrent ready: ${torrent.name}, ${torrent.files.length} files`);
      
      // STREMIO-STYLE: Prioritize first pieces for instant playback
      // This makes the beginning of the file download first
      if (torrent.pieces) {
        const piecesToPrioritize = Math.min(CRITICAL_PIECES, torrent.pieces.length);
        for (let i = 0; i < piecesToPrioritize; i++) {
          torrent.critical(i);
        }
        console.log(`🚀 Prioritized first ${piecesToPrioritize} pieces for instant playback`);
      }
      
      streamFile(torrent);
    });

    torrent.on('error', (err) => {
      console.error('❌ Torrent error:', err);
      torrents.delete(infoHashLower);
      if (!res.headersSent) {
        res.status(500).send('Torrent error: ' + err.message);
      }
    });

    // Log download progress
    torrent.on('download', (bytes) => {
      if (torrent.progress < 0.01) { // Only log early progress
        console.log(`⬇️ Downloaded: ${(torrent.downloaded / (1024*1024)).toFixed(1)} MB, Speed: ${(torrent.downloadSpeed / (1024*1024)).toFixed(1)} MB/s, Peers: ${torrent.numPeers}`);
      }
    });
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeTorrents: client.torrents.length,
    minBufferMB: MIN_BUFFER_BYTES / (1024 * 1024)
  });
});

// Transcoded stream endpoint (for incompatible codecs)
app.get('/transcode/:infoHash', (req, res) => handleTranscode(req, res, 0));
app.get('/transcode/:infoHash/:fileIdx', (req, res) => handleTranscode(req, res, parseInt(req.params.fileIdx, 10)));

function handleTranscode(req, res, fileIndex) {
  const { infoHash } = req.params;
  const infoHashLower = infoHash.toLowerCase();
  
  console.log(`🔄 Transcode request: ${infoHash}, fileIdx: ${fileIndex}`);
  
  let torrent = torrents.get(infoHashLower);
  if (!torrent) {
    torrent = client.get(infoHashLower);
  }
  
  if (!torrent || !torrent.ready) {
    return res.status(404).send('Torrent not ready. Start with /stream first.');
  }
  
  // Find the video file
  let file = torrent.files[fileIndex];
  if (!file) {
    file = torrent.files.reduce((largest, f) => {
      const isVideo = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i.test(f.name);
      if (!isVideo) return largest;
      return (!largest || f.length > largest.length) ? f : largest;
    }, null);
  }
  
  if (!file) {
    return res.status(404).send('No video file found');
  }
  
  console.log(`🔄 Transcoding: ${file.name}`);
  
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  const inputStream = file.createReadStream();
  
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  
  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
    if (!res.headersSent) res.status(500).send('Transcoding error');
  });
  
  inputStream.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(res);
  
  res.on('close', () => {
    ffmpeg.kill('SIGTERM');
    inputStream.destroy();
  });
  
  inputStream.on('error', (err) => {
    console.error('Input stream error:', err);
    ffmpeg.kill('SIGTERM');
  });
}

const PORT = 8002;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Stremio-style WebTorrent server on port ${PORT}`);
  console.log(`📊 Min buffer: ${MIN_BUFFER_BYTES / (1024*1024)} MB`);
  console.log(`🎯 Critical pieces: ${CRITICAL_PIECES}`);
});
