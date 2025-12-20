import WebTorrent from 'webtorrent';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';

const app = express();
const client = new WebTorrent();

app.use(cors());

// Store active torrents
const torrents = new Map();

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
      downloadSpeed: 0
    });
  }

  res.json({
    ready: torrent.ready,
    progress: Math.round(torrent.progress * 100),
    peers: torrent.numPeers,
    downloadSpeed: torrent.downloadSpeed,
    downloaded: torrent.downloaded,
    name: torrent.name
  });
});

// Add torrent and stream endpoint
app.get('/stream/:infoHash', (req, res) => {
  const { infoHash } = req.params;
  const infoHashLower = infoHash.toLowerCase();
  
  // Build magnet with trackers for faster peer discovery
  const trackers = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://explodie.org:6969/announce',
    'udp://tracker.coppersurfer.tk:6969/announce',
    'udp://tracker.leechers-paradise.org:6969/announce',
    'udp://p4p.arenabg.com:1337/announce',
  ];
  
  let magnetURI = `magnet:?xt=urn:btih:${infoHash}`;
  trackers.forEach(t => { magnetURI += `&tr=${encodeURIComponent(t)}`; });

  console.log('Stream request for:', infoHash);

  // Check if torrent already added using our Map first
  let torrent = torrents.get(infoHashLower);
  if (!torrent) {
    // Fallback to client.get() but normalize the infoHash
    torrent = client.get(infoHash) || client.get(magnetURI);
  }
  console.log('Torrent from storage:', torrent ? 'found' : 'not found');

  const handleTorrent = (torrent) => {
    // Find largest video file
    const file = torrent.files.reduce((largest, file) => {
      const isVideo = /\.(mp4|mkv|avi|webm|mov|m4v|ts)$/i.test(file.name);
      if (!isVideo) return largest;
      return (!largest || file.length > largest.length) ? file : largest;
    }, null);

    if (!file) {
      console.error('No video file found in torrent');
      return res.status(404).send('No video file found');
    }

    console.log('Streaming file:', file.name, 'Size:', (file.length / (1024*1024*1024)).toFixed(2), 'GB');

    // Set proper headers for video streaming with CORS
    const fileSize = file.length;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      console.log(`Serving range: ${start}-${end}/${fileSize}`);

      // Detect MIME type based on file extension
      const fileName = file.name.toLowerCase();
      let contentType = 'video/mp4'; // default
      if (fileName.endsWith('.mkv')) {
        contentType = 'video/x-matroska';
      } else if (fileName.endsWith('.avi')) {
        contentType = 'video/x-msvideo';
      } else if (fileName.endsWith('.webm')) {
        contentType = 'video/webm';
      } else if (fileName.endsWith('.ts')) {
        contentType = 'video/mp2t';
      }
      console.log(`File: ${file.name}, Content-Type: ${contentType}`);

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
        res.end();
      });
      stream.pipe(res);
    } else {
      console.log('Serving full file');

      // Detect MIME type based on file extension
      const fileName = file.name.toLowerCase();
      let contentType = 'video/mp4'; // default
      if (fileName.endsWith('.mkv')) {
        contentType = 'video/x-matroska';
      } else if (fileName.endsWith('.avi')) {
        contentType = 'video/x-msvideo';
      } else if (fileName.endsWith('.webm')) {
        contentType = 'video/webm';
      } else if (fileName.endsWith('.ts')) {
        contentType = 'video/mp2t';
      }
      console.log(`File: ${file.name}, Content-Type: ${contentType}`);

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
      }, 15000); // 15 second absolute timeout
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

// Transcoded stream endpoint - converts to H.264/AAC for browser compatibility
app.get('/transcode/:infoHash', (req, res) => {
  handleTranscode(req, res, 0);
});

app.get('/transcode/:infoHash/:fileIdx', (req, res) => {
  handleTranscode(req, res, parseInt(req.params.fileIdx || '0', 10));
});

function handleTranscode(req, res, fileIndex) {
  const { infoHash } = req.params;
  const infoHashLower = infoHash.toLowerCase();
  
  console.log(`📺 Transcode request for ${infoHash}, fileIdx: ${fileIndex}`);
  
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
    // Find largest video file
    const videoFiles = torrent.files
      .filter(f => /\.(mp4|mkv|avi|webm|mov|wmv|flv|ts)$/i.test(f.name))
      .sort((a, b) => b.length - a.length);
    file = videoFiles[0];
  }
  
  if (!file) {
    return res.status(404).send('No video file found');
  }
  
  console.log(`Transcoding: ${file.name} (${(file.length / 1024 / 1024 / 1024).toFixed(2)} GB)`);
  
  // Set headers for streaming
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  // Create read stream from torrent
  const inputStream = file.createReadStream();
  
  // Spawn FFmpeg to transcode
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',           // Read from stdin
    '-c:v', 'libx264',        // H.264 video codec
    '-preset', 'ultrafast',   // Fastest encoding for real-time
    '-tune', 'zerolatency',   // Low latency
    '-crf', '23',             // Quality (lower = better, 23 is default)
    '-c:a', 'aac',            // AAC audio codec
    '-b:a', '128k',           // Audio bitrate
    '-ac', '2',               // Stereo audio
    '-movflags', 'frag_keyframe+empty_moov+faststart', // For streaming
    '-f', 'mp4',              // Output format
    'pipe:1'                  // Write to stdout
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  // Handle errors
  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
    if (!res.headersSent) {
      res.status(500).send('Transcoding error');
    }
  });
  
  ffmpeg.stderr.on('data', (data) => {
    // Log FFmpeg progress (optional, can be noisy)
    // console.log('FFmpeg:', data.toString());
  });
  
  // Pipe torrent stream to FFmpeg, FFmpeg output to response
  inputStream.pipe(ffmpeg.stdin);
  ffmpeg.stdout.pipe(res);
  
  // Handle client disconnect
  res.on('close', () => {
    console.log('Client disconnected, killing FFmpeg');
    ffmpeg.kill('SIGTERM');
    inputStream.destroy();
  });
  
  inputStream.on('error', (err) => {
    console.error('Input stream error:', err);
    ffmpeg.kill('SIGTERM');
  });
});

const PORT = 8002;
app.listen(PORT, () => {
  console.log(`🚀 WebTorrent streaming server running on port ${PORT}`);
});
