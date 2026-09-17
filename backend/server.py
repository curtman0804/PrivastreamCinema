from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse, Response, FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
import hashlib
import base64  # V739B1_TUNNEL_PROVISIONING
import jwt
import httpx
from cryptography.fernet import Fernet, InvalidToken
import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit
try:
    import libtorrent as lt
    LIBTORRENT_AVAILABLE = True
except ImportError:
    lt = None
    LIBTORRENT_AVAILABLE = False
    logging.warning("libtorrent not available - streaming via torrent-stream server only")
import threading
import time
import tempfile
import shutil
import subprocess
import fcntl  # V178A_LEADER_LOCK — flock-based worker leader election
import signal
import atexit

ROOT_DIR = Path(__file__).parent

# Global reference to torrent-server subprocess
_torrent_server_process: Optional[subprocess.Popen] = None
load_dotenv(ROOT_DIR / '.env')

# JWT Secret
JWT_SECRET = os.environ.get('JWT_SECRET', 'privastream-cinema-secret-key-2025')
JWT_ALGORITHM = "HS256"

# V509_PREMIUMIZE_SERVER_SECURITY - Premiumize credentials are encrypted at rest.
def _get_premiumize_fernet() -> Fernet:
    key = os.environ.get("PREMIUMIZE_FERNET_KEY", "").strip()
    if not key:
        raise RuntimeError("PREMIUMIZE_FERNET_KEY is not configured")
    return Fernet(key.encode("utf-8"))

def encrypt_premiumize_key(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError("Premiumize API key is empty")
    return _get_premiumize_fernet().encrypt(value.encode("utf-8")).decode("utf-8")

def decrypt_premiumize_key(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError("Encrypted Premiumize API key is empty")
    try:
        return _get_premiumize_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Unable to decrypt Premiumize API key") from exc

# ==================== IN-MEMORY CACHE ====================
# Cache discover results per user to avoid re-fetching from external APIs
_discover_cache: Dict[str, Any] = {}  # {user_id: {"data": ..., "expires": datetime}}
DISCOVER_CACHE_TTL = 300  # 5 minutes

# Shared HTTP client for external API calls (reuse connections)
_shared_http_client: Optional[httpx.AsyncClient] = None

async def get_shared_http_client() -> httpx.AsyncClient:
    global _shared_http_client
    if _shared_http_client is None or _shared_http_client.is_closed:
        _shared_http_client = httpx.AsyncClient(follow_redirects=True, timeout=15.0, limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))
    return _shared_http_client

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'privastream')]

# Create the main app
app = FastAPI(title="PrivastreamCinema API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ==================== V656 SERVER-SIDE P2P KILL SWITCH ====================
# V656_SERVER_P2P_KILL_SWITCH
# Production infrastructure must never initiate BitTorrent/P2P.
# Block the legacy singular /api/stream/* surface before route execution.
# The plural /api/streams discovery API is intentionally unaffected.
_V656_P2P_PATH_PREFIX = "/api/stream/"

# V725_HETZNER_PROXY_KILL_SWITCH
# The legacy media proxy routes accept caller-controlled destination URLs.
# They are currently unused and must not provide arbitrary outbound network
# access from production infrastructure.
_V725_PROXY_PATH_PREFIX = "/api/proxy/"

@app.middleware("http")
async def v656_block_server_side_p2p(request: Request, call_next):
    if request.url.path.startswith(_V656_P2P_PATH_PREFIX):
        logger.warning(
            "V656_P2P_BLOCK method=%s path=%s",
            request.method,
            request.url.path,
        )
        return Response(
            content='{"detail":"Server-side P2P streaming is disabled"}',
            status_code=410,
            media_type="application/json",
        )

    if request.url.path.startswith(_V725_PROXY_PATH_PREFIX):
        logger.warning(
            "V725_PROXY_BLOCK method=%s path=%s",
            request.method,
            request.url.path,
        )
        return Response(
            content='{"detail":"Server-side media proxying is disabled"}',
            status_code=410,
            media_type="application/json",
        )

    return await call_next(request)
# ================== /V656 SERVER-SIDE P2P KILL SWITCH ====================

# Security
security = HTTPBearer()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==================== FALLBACK MANIFESTS ====================
# For Cloudflare-protected addons, use these manifest definitions

FALLBACK_MANIFESTS = {
    "thepiratebay-plus.strem.fun": {
        "id": "com.stremio.thepiratebay.plus",
        "version": "1.4.0",
        "name": "ThePirateBay+",
        "description": "Search for movies, series and anime from ThePirateBay",
        "catalogs": [],
        "resources": ["stream"],
        "types": ["movie", "series"],
        "idPrefixes": ["tt"],
        "background": "https://i.imgur.com/t8wVwcg.jpg",
        "logo": "https://i.imgur.com/dPa2clS.png"
    },
    "torrentio.strem.fun": {
        "id": "com.stremio.torrentio.addon",
        "version": "0.0.15",
        "name": "Torrentio",
        "description": "Provides torrent streams from scraped torrent providers. Currently supports YTS(+), EZTV(+), RARBG(+), 1337x(+), ThePirateBay(+), KickassTorrents(+), TorrentGalaxy(+), MagnetDL(+), HorribleSubs(+), NyaaSi(+), TokyoTosho(+), AniDex(+), Rutor(+), Rutracker(+), Comando(+), BluDV(+), and more.",
        "catalogs": [],
        "resources": [{"name": "stream", "types": ["movie", "series", "anime"], "idPrefixes": ["tt", "kitsu"]}],
        "types": ["movie", "series", "anime", "other"],
        "background": "https://torrentio.strem.fun/images/background_v1.jpg",
        "logo": "https://torrentio.strem.fun/images/logo_v1.png"
    },
    # Adult content addons
    "stremio-porn-jrm3.onrender.com": {
        "id": "org.stremio.porn",
        "version": "0.0.4",
        "name": "Porn",
        "description": "Watch porn videos and webcam streams from TastyBlacks, EbonyGalore, PornHub, RedTube, YouPorn, SpankWire, Porn.com, Chaturbate",
        "catalogs": [
            {"type": "movie", "id": "porn_videos", "name": "Porn Videos"},
            {"type": "tv", "id": "porn_live", "name": "Live Cams"}
        ],
        "resources": ["catalog", "meta", "stream"],
        "types": ["movie", "tv"],
        "idPrefixes": ["porn_"],
        "logo": "https://stremio-porn-jrm3.onrender.com/logo.png",
        "behaviorHints": {"adult": True}
    },
    "dirty-pink.ers.pw": {
        "id": "pw.ers.porntube",
        "version": "0.5.1",
        "name": "Porn Tube",
        "description": "Porn torrents, including VR. Supports Real-Debrid & Easynews",
        "catalogs": [
            {"type": "movie", "id": "tpdb_catalog", "name": "PornTube New"}
        ],
        "resources": ["catalog", "meta", "stream"],
        "types": ["movie"],
        "logo": "https://dirty-pink.ers.pw/logo-v0-3-0.png",
        "behaviorHints": {"adult": True}
    },
    "1fe84bc728af-stremio-porn.baby-beamup.club": {
        "id": "stremio_porn_plus",
        "version": "0.0.9",
        "name": "Porn+",
        "description": "Watch porn videos and webcam streams from RedTube, Chaturbate",
        "catalogs": [
            {"type": "movie", "id": "porn_id:RedTube-movie-top", "name": "Porn: RedTube"},
            {"type": "tv", "id": "porn_id:Chaturbate-tv-Featured", "name": "Chaturbate Live"}
        ],
        "resources": ["catalog", "meta", "stream"],
        "types": ["movie", "tv"],
        "idPrefixes": ["porn_id"],
        "logo": "https://1fe84bc728af-stremio-porn.baby-beamup.club/logo.png",
        "behaviorHints": {"adult": True}
    }
}

# ==================== TORRENT STREAMING SERVER ====================
# This provides Stremio-like torrent streaming capabilities

class TorrentStreamer:
    """Handles torrent downloading and HTTP streaming like Stremio - OPTIMIZED FOR K8s (HTTP trackers only)"""
    MAX_SESSIONS = 3  # Keep 3 active torrents - allows switching between streams
    
    def __init__(self):
        self.sessions = {}  # infoHash -> session data
        self.download_dir = tempfile.mkdtemp(prefix="privastream_")
        # MASSIVE HTTP/HTTPS tracker list - UDP is blocked in K8s
        # More trackers = more peers discovered = faster playback
        self.trackers = [
            # === HIGH-RELIABILITY HTTP TRACKERS (verified 2026) ===
            "http://tracker.opentrackr.org:1337/announce",
            "http://tracker.bt4g.com:2095/announce",
            "http://tracker2.dler.org:80/announce",
            "http://tracker.renfei.net:8080/announce",
            "http://tracker.tritan.gg:8080/announce",
            "http://tracker.sbsub.com:2710/announce",
            "http://tracker.mywaifu.best:6969/announce",
            "http://tracker.moxing.party:6969/announce",
            "http://tracker.ipv6tracker.org:80/announce",
            "http://tracker.bz:80/announce",
            "http://tracker.bittor.pw:1337/announce",
            "http://open.trackerlist.xyz:80/announce",
            "http://open.acgtracker.com:1096/announce",
            "http://bvarf.tracker.sh:2086/announce",
            "http://bt1.xxxxbt.cc:6969/announce",
            "http://tracker.ghostchu-services.top:80/announce",
            "http://tracker.dler.org:6969/announce",
            "http://tr.nyacat.pw:80/announce",
            "http://1337.abcvg.info:80/announce",
            "http://wepzone.net:6969/announce",
            "http://tracker.wepzone.net:6969/announce",
            "http://tracker.qu.ax:6969/announce",
            "http://tracker.darkness.services:6969/announce",
            "http://bittorrent-tracker.e-n-c-r-y-p-t.net:1337/announce",
            "http://www.genesis-sp.org:2710/announce",
            "http://tracker.skyts.net:6969/announce",
            "http://tr.highstar.shop:80/announce",
            "http://tracker.dhitechnical.com:6969/announce",
            "http://lucke.fenesisu.moe:6969/announce",
            # === ADDITIONAL HTTP TRACKERS (expanded for max peer coverage) ===
            "http://echostar.ddnsfree.com:8080/announce",
            "http://tracker.exe.in.th:6969/announce",
            "http://ipv4.rer.lol:2710/announce",
            "http://retracker.joxnet.ru:80/announce",
            "http://fosstorrents.com:6969/announce",
            "http://retracker.sevstar.net:2710/announce",
            "http://buny.uk:6969/announce",
            "http://torrenttracker.nwc.acsalaska.net:6969/announce",
            "http://tracker.gbitt.info:80/announce",
            "http://reisub.nsupdate.info:6969/announce",
            "http://filetracker.xyz:11451/announce",
            "http://tracker1.itzmx.com:8080/announce",
            "http://tracker.xn--djrq4gl4hvoi.top:80/announce",
            "http://107.189.10.20.sslip.io:7777/announce",
            # === HTTPS TRACKERS (TLS encrypted, reliable) ===
            "https://tracker.zhuqiy.com:443/announce",
            "https://tracker.pmman.tech:443/announce",
            "https://tracker.moeblog.cn:443/announce",
            "https://tracker.bt4g.com:443/announce",
            "https://tr.zukizuki.org:443/announce",
            "https://tracker.ghostchu-services.top:443/announce",
            "https://tr.nyacat.pw:443/announce",
            "https://t.213891.xyz:443/announce",
            "https://shahidrazi.online:443/announce",
            "https://tracker.nekomi.cn:443/announce",
            "https://tracker.cyber-hub.net:443/announce",
            "https://bittorrent.gongt.net:443/announce",
            "https://tracker.mlsub.net:443/announce",
            # === UDP TRACKERS (DHT now enabled - these may work) ===
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://open.tracker.cl:1337/announce",
            "udp://tracker.openbittorrent.com:6969/announce",
            "udp://open.stealth.si:80/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://tracker.tiny-vps.com:6969/announce",
            "udp://tracker.moeking.me:6969/announce",
            "udp://explodie.org:6969/announce",
            "udp://tracker.pomf.se:80/announce",
            "udp://tracker.leechers-paradise.org:6969/announce",
            "udp://tracker.coppersurfer.tk:6969/announce",
            "udp://9.rarbg.to:2710/announce",
        ]
        logger.info(f"TorrentStreamer initialized with {len(self.trackers)} HTTP trackers. Download dir: {self.download_dir}")
        
        self.lt_session = None
        if LIBTORRENT_AVAILABLE:
            # Create ONE shared libtorrent session - optimized for K8s (TCP ONLY)
            settings = {
                'listen_interfaces': '0.0.0.0:6881,[::]:6881,0.0.0.0:6891,[::]:6891',
                'enable_dht': True,
                'enable_lsd': True,
                'enable_upnp': False,
                'enable_natpmp': False,
                'enable_outgoing_tcp': True,
                'enable_incoming_tcp': True,
                'enable_outgoing_utp': True,
                'enable_incoming_utp': True,
                'dht_bootstrap_nodes': 'router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881,dht.aelitis.com:6881,router.bitcomet.com:6881,dht.libtorrent.org:25401',
                'announce_to_all_trackers': True,
                'announce_to_all_tiers': True,
                'tracker_completion_timeout': 30,
                'tracker_receive_timeout': 10,
                'stop_tracker_timeout': 1,
                'min_announce_interval': 30,
                'connection_speed': 500,
                'connections_limit': 2000,
                'download_rate_limit': 0,
                'upload_rate_limit': 2 * 1024 * 1024,
                'unchoke_slots_limit': 64,
                'max_peerlist_size': 10000,
                'peer_connect_timeout': 5,
                'handshake_timeout': 5,
                'torrent_connect_boost': 200,
                'peer_timeout': 30,
                'inactivity_timeout': 30,
                'request_timeout': 10,
                'cache_size': 4096,
                'disk_io_read_mode': 0,
                'disk_io_write_mode': 0,
                'aio_threads': 8,
                'request_queue_time': 3,
                'max_out_request_queue': 2000,
                'whole_pieces_threshold': 5,
                'max_allowed_in_request_queue': 4000,
                'send_buffer_watermark': 1024 * 1024,
                'send_buffer_watermark_factor': 200,
                'recv_socket_buffer_size': 2 * 1024 * 1024,
                'send_socket_buffer_size': 2 * 1024 * 1024,
                'mixed_mode_algorithm': 0,
                'rate_limit_ip_overhead': False,
                'allow_multiple_connections_per_ip': True,
                'seed_choking_algorithm': 1,
                'choking_algorithm': 1,
                'max_rejects': 10,
                'smooth_connects': False,
                'always_send_user_agent': True,
                'no_connect_privileged_ports': False,
            }
            self.lt_session = lt.session(settings)
            logger.info("Shared libtorrent session started (DHT+TCP+uTP enabled, full peer discovery)")
        else:
            logger.warning("libtorrent not available - streaming via torrent-stream server only")
    
    def _evict_oldest(self):
        """Remove the oldest session to make room for new ones"""
        if len(self.sessions) >= self.MAX_SESSIONS:
            oldest_hash = min(self.sessions.keys(), key=lambda k: self.sessions[k]['created'])
            logger.info(f"Evicting oldest torrent session: {oldest_hash}")
            self.cleanup_session(oldest_hash)
            # Also do a disk cleanup
            self._cleanup_disk()
    
    def get_session(self, info_hash: str, extra_trackers: list = None):
        """Get or create a torrent handle using the shared session"""
        info_hash = info_hash.lower()
        
        if not LIBTORRENT_AVAILABLE or self.lt_session is None:
            # Return a stub session when libtorrent not available
            if info_hash not in self.sessions:
                self.sessions[info_hash] = {
                    'session': None,
                    'handle': None,
                    'created': time.time(),
                    'video_file': None,
                    'video_path': None,
                    'save_path': self.download_dir,
                }
            return self.sessions[info_hash]
        
        if info_hash in self.sessions and self.sessions[info_hash].get('handle'):
            # Add extra trackers to existing session if provided
            if extra_trackers:
                handle = self.sessions[info_hash]['handle']
                if handle.is_valid():
                    for tracker_url in extra_trackers:
                        if tracker_url.startswith('http') or tracker_url.startswith('udp'):
                            try:
                                handle.add_tracker({'url': tracker_url, 'tier': 0})
                            except:
                                pass
                    handle.force_reannounce()
            return self.sessions[info_hash]
        
        # Evict oldest if at max capacity
        self._evict_oldest()
        
        # Build magnet URI with ALL trackers (our list + Torrentio's trackers)
        all_trackers = list(self.trackers)
        if extra_trackers:
            for t in extra_trackers:
                if (t.startswith('http') or t.startswith('udp')) and t not in all_trackers:
                    all_trackers.append(t)
        
        magnet = f"magnet:?xt=urn:btih:{info_hash}"
        for tracker in all_trackers:
            magnet += f"&tr={tracker}"
        
        logger.info(f"Adding torrent {info_hash} with {len(all_trackers)} trackers (HTTP+UDP)")
        
        # Use the modern API (parse_magnet_uri + add_torrent)
        params = lt.parse_magnet_uri(magnet)
        params.save_path = self.download_dir
        
        handle = self.lt_session.add_torrent(params)
        # Sequential download for streaming
        handle.set_flags(lt.torrent_flags.sequential_download)
        
        # Force immediate announce to all trackers for fastest peer discovery
        handle.force_reannounce(0)
        
        self.sessions[info_hash] = {
            'session': self.lt_session,
            'handle': handle,
            'created': time.time(),
            'video_file': None,
            'video_path': None,
            'save_path': self.download_dir,
        }
        
        logger.info(f"Added torrent {info_hash} to shared session with force-reannounce")
        return self.sessions[info_hash]
    
    def get_status(self, info_hash: str) -> dict:
        """Get download status for a torrent"""
        info_hash = info_hash.lower()
        
        if info_hash not in self.sessions:
            return {"status": "not_found"}
        
        data = self.sessions[info_hash]
        handle = data.get('handle')
        
        if not LIBTORRENT_AVAILABLE or handle is None:
            # When libtorrent is not available, return minimal status
            # The torrent-stream server handles the actual streaming
            return {
                "status": "delegated",
                "progress": 0,
                "peers": 0,
                "download_rate": 0,
                "ready": False,
                "engine": "torrent-stream-only"
            }
        
        if not handle.is_valid():
            return {"status": "invalid"}
        
        s = handle.status()
        
        # Check if we have metadata
        if not handle.has_metadata():
            return {
                "status": "downloading_metadata",
                "progress": 0,
                "peers": s.num_peers,
                "download_rate": s.download_rate,
            }
        
        # Find video file if not already found
        if not data['video_file']:
            ti = handle.get_torrent_info()
            files = ti.files()
            
            # Collect all video files, categorized by format preference
            # MP4/M4V are preferred (best Android TV compatibility)
            # MKV works but may have codec issues on some TV hardware decoders
            mp4_videos = []  # .mp4, .m4v - best compatibility
            other_videos = []  # .mkv, .avi, .webm, .mov, .ts
            
            for i in range(files.num_files()):
                file_path = files.file_path(i)
                file_size = files.file_size(i)
                
                # Check if it's a video file
                if any(file_path.lower().endswith(ext) for ext in ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.ts']):
                    video_info = {
                        'index': i,
                        'path': file_path,
                        'size': file_size,
                    }
                    if file_path.lower().endswith('.mp4') or file_path.lower().endswith('.m4v'):
                        mp4_videos.append(video_info)
                    else:
                        other_videos.append(video_info)
            
            # Pick the largest MP4 first, then largest MKV/other as fallback
            # Android TV hardware decoders handle MP4 containers much better
            largest_video = None
            if mp4_videos:
                largest_video = max(mp4_videos, key=lambda v: v['size'])
                logger.info(f"Selected MP4 video (Android TV preferred): {largest_video['path']}")
            elif other_videos:
                largest_video = max(other_videos, key=lambda v: v['size'])
                logger.info(f"No MP4 found, using: {largest_video['path']}")
            
            largest_size = largest_video['size'] if largest_video else 0
            
            if largest_video:
                data['video_file'] = largest_video
                data['video_path'] = os.path.join(self.download_dir, largest_video['path'])
                
                # ===== STREAMING-OPTIMIZED PIECE PRIORITIZATION =====
                num_pieces = ti.num_pieces()
                piece_length = ti.piece_length()
                
                # Calculate piece range for video file
                file_offset = files.file_offset(largest_video['index'])
                start_piece = file_offset // piece_length
                end_piece = (file_offset + largest_video['size']) // piece_length
                video_pieces = end_piece - start_piece + 1
                
                # Set priorities - 0 = don't download, 7 = highest
                priorities = [0] * num_pieces  # Don't download non-video files
                
                # Calculate how many pieces we need for fast start (aim for ~3-5MB)
                # This is enough for ffmpeg to analyze the file and start transcoding
                bytes_for_header = 5 * 1024 * 1024  # 5MB header
                header_pieces = max(20, min(bytes_for_header // piece_length, video_pieces // 4))
                
                # PRIORITY STRATEGY FOR STREAMING:
                # 1. First ~5MB (header/moov atom): CRITICAL (priority 7)
                # 2. Next ~10MB: HIGH (priority 6) - for buffer
                # 3. Last 2MB: CRITICAL (priority 7) - ExoPlayer reads end for moov atom!
                # 4. Rest of video: NORMAL (priority 1) - sequential download handles this
                
                # Set base priority for all video pieces
                for i in range(start_piece, end_piece + 1):
                    priorities[i] = 1
                
                # CRITICAL: First header_pieces get highest priority
                for i in range(start_piece, min(start_piece + header_pieces, end_piece + 1)):
                    priorities[i] = 7
                
                # HIGH: Next buffer pieces
                buffer_pieces = header_pieces * 2
                for i in range(start_piece + header_pieces, min(start_piece + header_pieces + buffer_pieces, end_piece + 1)):
                    priorities[i] = 6
                
                # CRITICAL: Last pieces - ExoPlayer reads the end for moov atom / mkv seekhead
                last_piece_count = max(10, 2 * 1024 * 1024 // piece_length)  # ~2MB from end
                for i in range(max(start_piece, end_piece - last_piece_count), end_piece + 1):
                    priorities[i] = 7  # Same as header - MUST download these early
                
                # First set FILE priorities (which file to download)
                # This must be called BEFORE prioritize_pieces() because it overrides piece priorities!
                file_priorities = [0] * files.num_files()
                file_priorities[largest_video['index']] = 4  # Download video file
                handle.prioritize_files(file_priorities)
                
                # THEN set PIECE priorities (which parts of the file to download first)
                # This MUST be called AFTER prioritize_files() to override its settings
                handle.prioritize_pieces(priorities)
                
                logger.info(f"Found video: {largest_video['path']} ({largest_size / 1024 / 1024:.1f} MB)")
                logger.info(f"Piece info: {video_pieces} pieces @ {piece_length // 1024}KB each, prioritizing first {header_pieces} + {buffer_pieces} buffer")
        
        # Calculate progress and readiness
        video_file = data.get('video_file')
        if video_file:
            video_size = video_file['size']
            downloaded_bytes = int(s.progress * video_size) if s.progress > 0 else 0
            
            # Check if file exists and has content
            video_path = data.get('video_path')
            file_exists = video_path and os.path.exists(video_path)
            file_size_on_disk = os.path.getsize(video_path) if file_exists else 0
            
            # CRITICAL: Check if the video file has valid header data on disk
            # libtorrent writes partial piece data to disk even before pieces are "complete"
            # So we check the actual file content instead of piece status
            first_pieces_ready = False
            last_pieces_ready = False
            try:
                if file_exists and file_size_on_disk > 0:
                    # Check for valid video header in first 32 bytes
                    with open(video_path, 'rb') as f:
                        header = f.read(32)
                        has_ftyp = b'ftyp' in header  # MP4/M4V
                        has_ebml = header[:4] == b'\x1a\x45\xdf\xa3'  # MKV/WebM
                        has_avi = header[:4] == b'RIFF'  # AVI
                        has_valid_header = has_ftyp or has_ebml or has_avi
                    
                    # Ready when: valid video header + at least 2MB on disk
                    # 2MB is enough for ExoPlayer to start - it handles its own buffering
                    min_buffer = 2 * 1024 * 1024  # 2MB minimum buffer - quick start
                    first_pieces_ready = has_valid_header and file_size_on_disk >= min_buffer
                    
                    if first_pieces_ready:
                        logger.info(f"Video file ready: {os.path.basename(video_path)}, "
                                   f"header={'ftyp' if has_ftyp else 'ebml' if has_ebml else 'avi'}, "
                                   f"size_on_disk={file_size_on_disk/1024/1024:.1f}MB, peers={s.num_peers}")
                
                # Last pieces: check if end of file has data (for moov atom)
                last_pieces_ready = True  # Don't block on last pieces
            except Exception as e:
                logger.warning(f"File check error: {e}")
                first_pieces_ready = file_size_on_disk >= 512 * 1024
            
            # Ready = first pieces of video are downloaded (header/moov atom at beginning)
            # Last pieces are prioritized at 7 but we don't wait for them - ExoPlayer handles buffering
            is_ready = first_pieces_ready
            min_bytes_for_playback = 2 * 1024 * 1024  # 2MB for readiness - quick start
            ready_threshold = min_bytes_for_playback
            
            return {
                "status": "ready" if is_ready else "buffering",
                "progress": s.progress * 100,
                "ready_progress": min(100, (downloaded_bytes / ready_threshold) * 100) if ready_threshold > 0 else 0,
                "peers": s.num_peers,
                "download_rate": s.download_rate,
                "upload_rate": s.upload_rate,
                "video_file": video_file['path'],
                "video_size": video_size,
                "downloaded": downloaded_bytes,
                "file_ready": file_exists,
                "first_pieces_ready": first_pieces_ready,
                "last_pieces_ready": last_pieces_ready,
                "ready_threshold_mb": ready_threshold / (1024 * 1024),
            }
        
        return {
            "status": "buffering",
            "progress": s.progress * 100,
            "peers": s.num_peers,
            "download_rate": s.download_rate,
        }
    
    def get_video_path(self, info_hash: str) -> Optional[str]:
        """Get the path to the video file"""
        info_hash = info_hash.lower()
        if info_hash in self.sessions:
            return self.sessions[info_hash].get('video_path')
        return None
    
    def cleanup_old_sessions(self, max_age_hours=1):
        """Remove old torrent sessions and their downloaded files"""
        current_time = time.time()
        to_remove = []
        
        for info_hash, data in self.sessions.items():
            if current_time - data['created'] > max_age_hours * 3600:
                to_remove.append(info_hash)
        
        for info_hash in to_remove:
            try:
                data = self.sessions[info_hash]
                data['session'].remove_torrent(data['handle'])
                # Clean up downloaded files
                video_path = data.get('video_path')
                if video_path and os.path.exists(video_path):
                    os.remove(video_path)
                    logger.info(f"Removed file: {video_path}")
                del self.sessions[info_hash]
                logger.info(f"Cleaned up session for {info_hash}")
            except Exception as e:
                logger.error(f"Error cleaning up session {info_hash}: {e}")
        
        # Also clean up any orphaned files in the download directory
        try:
            if os.path.exists(self.download_dir):
                total_size = sum(
                    os.path.getsize(os.path.join(dp, f))
                    for dp, dn, fns in os.walk(self.download_dir)
                    for f in fns
                )
                if total_size > 5 * 1024 * 1024 * 1024:  # Over 5GB
                    logger.warning(f"Download dir is {total_size / (1024**3):.1f}GB, cleaning up...")
                    # Remove oldest session's files
                    if self.sessions:
                        oldest = min(self.sessions.keys(), key=lambda k: self.sessions[k]['created'])
                        self.cleanup_session(oldest)
        except Exception as e:
            logger.error(f"Error checking disk usage: {e}")
    
    def cleanup_session(self, info_hash):
        """Clean up a specific torrent session and its files"""
        info_hash = info_hash.lower()
        if info_hash in self.sessions:
            try:
                data = self.sessions[info_hash]
                if LIBTORRENT_AVAILABLE and data.get('session') and data.get('handle'):
                    try:
                        data['session'].remove_torrent(data['handle'])
                    except Exception:
                        pass
                # Clean up ALL files in the torrent's download subdirectory
                save_path = data.get('save_path', '')
                if save_path and os.path.exists(save_path):
                    import shutil
                    shutil.rmtree(save_path, ignore_errors=True)
                    logger.info(f"Removed directory: {save_path}")
                else:
                    video_path = data.get('video_path')
                    if video_path and os.path.exists(video_path):
                        os.remove(video_path)
                del self.sessions[info_hash]
                logger.info(f"Cleaned up session for {info_hash}")
            except Exception as e:
                logger.error(f"Error cleaning up session {info_hash}: {e}")
    
    def _cleanup_disk(self):
        """Emergency cleanup - remove ALL orphaned torrent files"""
        try:
            import shutil
            for item in os.listdir('/tmp'):
                if item.startswith('privastream_'):
                    path = os.path.join('/tmp', item)
                    # Don't remove the current download dir
                    if path != self.download_dir:
                        shutil.rmtree(path, ignore_errors=True)
                        logger.info(f"Cleaned orphaned dir: {path}")
        except Exception as e:
            logger.error(f"Disk cleanup error: {e}")

# Global torrent streamer instance
# V656_NO_SERVER_P2P_RUNTIME
# Privastream-controlled infrastructure must not initialize a BitTorrent engine.
# Legacy route implementations remain below but are blocked by the V656 HTTP kill switch.
torrent_streamer = None

# Background cleanup task
async def periodic_cleanup():
    """Run cleanup every 10 minutes"""
    while True:
        await asyncio.sleep(600)
        try:
            torrent_streamer.cleanup_old_sessions(max_age_hours=1)
        except Exception as e:
            logger.error(f"Periodic cleanup error: {e}")


# ==================== MODELS ====================

class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    password_hash: str
    email: Optional[str] = None
    is_admin: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)
    premiumize_api_key_encrypted: Optional[str] = None

class UserCreate(BaseModel):
    username: str
    password: str
    email: Optional[str] = None
    is_admin: bool = False
    premiumize_api_key: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    is_admin: bool = False
    created_at: datetime

class AuthResponse(BaseModel):
    user: UserResponse
    token: str

class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    is_admin: Optional[bool] = None
    premiumize_api_key: Optional[str] = None

class PremiumizeCacheCheckRequest(BaseModel):
    items: List[str]

class PremiumizeDirectDLRequest(BaseModel):
    src: str


# V759_ADULT_TRANSCODE_MODEL
class AdultTranscodeSessionRequest(BaseModel):
    source_url: str
    content_id: str


class PremiumizeConfigureRequest(BaseModel):
    api_key: str


# ==================== V739B1 TUNNEL PROVISIONING MODELS ====================
# V739B1_TUNNEL_PROVISIONING
#
# The Android installation owns its WireGuard PRIVATE key.
# The backend receives only the corresponding PUBLIC key.
# No tunnel private key is stored in MongoDB or returned by this API.
class TunnelProvisionRequest(BaseModel):
    device_id: str
    public_key: str
    platform: Optional[str] = None
    app_version: Optional[str] = None


class TunnelProvisionResponse(BaseModel):
    device_id: str
    address: str
    dns: str
    server_public_key: str
    endpoint: str
    allowed_ips: str
    persistent_keepalive: int
    app_only_package: str

class AddonInstall(BaseModel):
    manifestUrl: str

class LibraryItem(BaseModel):
    id: str
    imdb_id: Optional[str] = None
    name: str
    type: str
    poster: str
    year: Optional[str] = None
    added_at: datetime = Field(default_factory=datetime.utcnow)

class WatchProgress(BaseModel):
    content_id: str  # IMDB ID (e.g., tt1234567 or tt1234567:1:1 for episodes)
    content_type: str  # movie, series
    title: str
    poster: Optional[str] = None
    backdrop: Optional[str] = None
    logo: Optional[str] = None
    progress: float  # Current position in seconds
    duration: float  # Total duration in seconds
    percent_watched: Optional[float] = 0  # Percentage watched (0-100) - calculated on backend
    season: Optional[int] = None  # For series
    episode: Optional[int] = None  # For series
    episode_title: Optional[str] = None  # Episode title
    series_id: Optional[str] = None  # Parent series ID for episodes
    # Stream info for resuming playback
    stream_info_hash: Optional[str] = None  # Torrent info hash
    stream_url: Optional[str] = None  # Direct stream URL
    stream_file_idx: Optional[int] = None  # File index for torrents
    stream_filename: Optional[str] = None  # Filename for torrents
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ==================== HELPERS ====================

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, password_hash: str) -> bool:
    return hash_password(password) == password_hash

def create_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(days=30)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> User:
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        user_data = await db.users.find_one({"id": user_id})
        if not user_data:
            raise HTTPException(status_code=401, detail="User not found")
        return User(**user_data)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

def get_premiumize_key_for_user(user: User) -> str:
    encrypted = (user.premiumize_api_key_encrypted or "").strip()
    if not encrypted:
        raise HTTPException(status_code=409, detail="Premiumize is not configured for this account")
    try:
        return decrypt_premiumize_key(encrypted)
    except Exception:
        logger.exception("Failed to decrypt Premiumize credential for user %s", user.id)
        raise HTTPException(status_code=500, detail="Premiumize credential is unavailable")

def get_base_url(manifest_url: str) -> str:
    """Extract base URL from manifest URL"""
    if manifest_url.endswith('/manifest.json'):
        return manifest_url[:-14]
    return manifest_url.rsplit('/', 1)[0]


# ==================== V726 OUTBOUND ADDON SECURITY ====================
# Server-side addon egress is restricted to explicitly approved HTTPS
# endpoints. V726_EXTRA_ADDON_HOSTS may contain additional exact hosts.
_V726_ALLOWED_ADDON_HOSTS = frozenset({
    "07b88951aaab-jaxxx-v2.baby-beamup.club",
    "1fe84bc728af-stremio-porn.baby-beamup.club",
    "dirty-pink.ers.pw",
    "ptube.ers.pw",
    "7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club",
    "cinemeta-catalogs.strem.io",
    "mediafusion.elfhosted.com",
    "thepiratebay-plus.strem.fun",
    "torrentio.strem.fun",
    "v3-cinemeta.strem.io",
})

_V726_EXTRA_ADDON_HOSTS = frozenset(
    host.strip().rstrip(".").lower()
    for host in os.environ.get("V726_EXTRA_ADDON_HOSTS", "").split(",")
    if host.strip()
)

_V726_REDIRECT_CODES = {301, 302, 303, 307, 308}
_V726_MAX_REDIRECTS = 3


def _v726_addon_host_allowed(host: str) -> bool:
    host = str(host or "").strip().rstrip(".").lower()

    if not host:
        return False

    return (
        host in _V726_ALLOWED_ADDON_HOSTS
        or host in _V726_EXTRA_ADDON_HOSTS
    )


async def _v726_validate_addon_url(url: str) -> str:
    value = str(url or "").strip()

    if not value or len(value) > 8192:
        raise ValueError("Addon URL is empty or too long")

    if "\\" in value:
        raise ValueError("Addon URL contains a backslash")

    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError("Addon URL contains control characters")

    if any(ch.isspace() for ch in value):
        raise ValueError("Addon URL contains whitespace")

    try:
        parsed = urlsplit(value)
        host = str(parsed.hostname or "").strip().rstrip(".").lower()
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Addon URL could not be parsed") from exc

    if parsed.scheme.lower() != "https":
        raise ValueError("Addon URL must use HTTPS")

    if not parsed.netloc or not host:
        raise ValueError("Addon URL has no hostname")

    if parsed.username is not None or parsed.password is not None:
        raise ValueError("Addon URL credentials are not allowed")

    if port not in (None, 443):
        raise ValueError("Addon URL must use HTTPS port 443")

    if not _v726_addon_host_allowed(host):
        raise ValueError("Addon hostname is not approved")

    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            host,
            443,
            0,
            socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise ValueError("Addon hostname could not be resolved") from exc

    resolved_ips = {
        str(entry[4][0]).split("%", 1)[0]
        for entry in addresses
        if entry and len(entry) >= 5 and entry[4]
    }

    if not resolved_ips:
        raise ValueError("Addon hostname resolved to no addresses")

    for raw_ip in resolved_ips:
        try:
            address = ipaddress.ip_address(raw_ip)
        except ValueError as exc:
            raise ValueError(
                "Addon hostname returned an invalid address"
            ) from exc

        if not address.is_global:
            raise ValueError(
                "Addon hostname resolved to a non-public address"
            )

    return value


async def _v726_safe_addon_get(
    client: httpx.AsyncClient,
    url: str,
    *,
    timeout: float,
) -> httpx.Response:
    current_url = str(url or "").strip()

    for redirect_count in range(_V726_MAX_REDIRECTS + 1):
        current_url = await _v726_validate_addon_url(current_url)

        response = await client.get(
            current_url,
            timeout=timeout,
            follow_redirects=False,
        )

        if response.status_code not in _V726_REDIRECT_CODES:
            return response

        location = response.headers.get("location")

        if not location:
            return response

        if redirect_count >= _V726_MAX_REDIRECTS:
            raise ValueError("Addon URL exceeded redirect limit")

        current_url = urljoin(current_url, location)

    raise ValueError("Addon redirect handling failed")
# ================== /V726 OUTBOUND ADDON SECURITY ====================

def get_fallback_manifest(url: str) -> Optional[Dict]:
    """Check if we have a fallback manifest for this URL"""
    for key, manifest in FALLBACK_MANIFESTS.items():
        if key in url:
            return manifest
    return None


# ==================== INIT DEFAULT ADMIN & TORRENT SERVER ====================

# ═══ V178A_LEADER_LOCK ══════════════════════════════════════════════════
# Under gunicorn with N>1 workers, every worker invokes the @app startup
# event.  The torrent-server subprocess and the periodic_cleanup task
# must only run ONCE per host.  We use a non-blocking POSIX file lock:
# the first worker to grab /tmp/privastream_leader.lock becomes leader;
# others skip those steps.  If the leader dies, the OS releases the lock
# and a future worker restart will pick up leadership.
_V178A_LEADER_LOCK_PATH = "/tmp/privastream_leader.lock"
_v178a_leader_fd = None
_v178a_is_leader = False

def _v178a_acquire_leader_lock() -> bool:
    """Try to become the singleton "leader" worker.  Returns True only
    inside the worker that succeeds; subsequent calls in the same
    process also return True (cached).  Workers that fail to acquire
    return False and should skip leader-only startup work."""
    global _v178a_leader_fd, _v178a_is_leader
    if _v178a_is_leader:
        return True
    try:
        fd = open(_V178A_LEADER_LOCK_PATH, "w")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fd.write(str(os.getpid()))
        fd.flush()
        _v178a_leader_fd = fd  # keep FD alive — closing releases the lock
        _v178a_is_leader = True
        return True
    except (IOError, OSError):
        try:
            if _v178a_leader_fd:
                _v178a_leader_fd.close()
        except Exception:
            pass
        _v178a_leader_fd = None
        _v178a_is_leader = False
        return False
# ═══ /V178A_LEADER_LOCK ═════════════════════════════════════════════════

def start_torrent_server():
    """Legacy torrent-server startup is permanently disabled by V656."""
    logger.warning("V656: embedded torrent-server startup blocked")
    return False

    # Legacy implementation retained below for reference only.
    global _torrent_server_process
    
    torrent_server_dir = Path(__file__).parent.parent / 'torrent-server'
    server_js = torrent_server_dir / 'server.js'
    
    if not server_js.exists():
        logger.warning(f"Torrent server not found at {server_js}")
        return False
    
    # Check if node_modules exists, if not install
    node_modules = torrent_server_dir / 'node_modules'
    if not node_modules.exists():
        logger.info("Installing torrent-server dependencies...")
        try:
            subprocess.run(
                ['npm', 'install', '--production'],
                cwd=str(torrent_server_dir),
                check=True,
                capture_output=True,
                timeout=120
            )
            logger.info("Torrent-server dependencies installed")
        except Exception as e:
            logger.error(f"Failed to install torrent-server dependencies: {e}")
            return False
    
    # Start the server
    try:
        env = os.environ.copy()
        env['PORT'] = '8002'
        env['NODE_ENV'] = 'production'
        
        _torrent_server_process = subprocess.Popen(
            ['node', str(server_js)],
            cwd=str(torrent_server_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        logger.info(f"Started torrent-server (PID: {_torrent_server_process.pid}) on port 8002")
        return True
    except Exception as e:
        logger.error(f"Failed to start torrent-server: {e}")
        return False

def stop_torrent_server():
    """Stop the torrent-server subprocess"""
    global _torrent_server_process
    if _torrent_server_process:
        logger.info(f"Stopping torrent-server (PID: {_torrent_server_process.pid})")
        try:
            _torrent_server_process.terminate()
            _torrent_server_process.wait(timeout=5)
        except:
            _torrent_server_process.kill()
        _torrent_server_process = None

# Register cleanup on exit
atexit.register(stop_torrent_server)

@app.on_event("startup")
async def create_default_admin():
    """Create default admin user if not exists and start torrent server.

    V178A_LEADER_LOCK: torrent-server subprocess and periodic cleanup
    task are gated to a single elected leader worker so multi-worker
    gunicorn deployments do not spawn N torrent-servers fighting over
    port 8002.  The admin upsert is idempotent and runs in every
    worker so each has a primed cache."""
    # V656_P2P_STARTUP_DISABLED
    # No leader election, torrent-server subprocess, or torrent cleanup task.
    _v178a_leader = False
    logger.info("V656: server-side P2P runtime disabled")
    existing = await db.users.find_one({"username": "choyt"})
    if not existing:
        admin_user = User(
            username="choyt",
            password_hash=hash_password("RFIDGuy1!"),
            email="admin@privastream.cinema",
            is_admin=True
        )
        await db.users.insert_one(admin_user.dict())
        logger.info("Created default admin user: choyt")
    else:
        if not existing.get('is_admin'):
            await db.users.update_one(
                {"username": "choyt"},
                {"$set": {"is_admin": True}}
            )
            logger.info("Updated choyt to admin status")
    
    # V656: periodic torrent cleanup is not scheduled because
    # no server-side torrent runtime is permitted.

# ==================== FILE VIEWER ROUTES ====================
from fastapi.responses import HTMLResponse
import html as html_module

FILE_MAP = {
    "1": ("ContentCard.tsx", "/app/frontend/src/components/ContentCard.tsx", "frontend/src/components/ContentCard.tsx"),
    "2": ("details [id].tsx", "/app/frontend/app/details/[type]/[id].tsx", "frontend/app/details/[type]/[id].tsx"),
    "3": ("search.tsx", "/app/frontend/app/search.tsx", "frontend/app/search.tsx"),
    "4": ("category [type].tsx", "/app/frontend/app/category/[service]/[type].tsx", "frontend/app/category/[service]/[type].tsx"),
    "5": ("library.tsx", "/app/frontend/app/(tabs)/library.tsx", "frontend/app/(tabs)/library.tsx"),
    "6": ("discover.tsx", "/app/frontend/app/(tabs)/discover.tsx", "frontend/app/(tabs)/discover.tsx"),
}

@api_router.get("/file/{file_id}")
async def serve_single_file(file_id: str):
    if file_id not in FILE_MAP:
        raise HTTPException(status_code=404, detail="File not found")
    name, filepath, dest = FILE_MAP[file_id]
    try:
        with open(filepath, 'r') as f:
            content = f.read()
    except Exception:
        raise HTTPException(status_code=500, detail="Could not read file")
    escaped = html_module.escape(content)
    html_content = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{name}</title>
<style>
body {{ background:#1a1a2e; color:#e0e0e0; font-family:monospace; padding:20px; margin:0; }}
h1 {{ color:#e6c47a; }}
.path {{ color:#aaa; font-size:14px; margin:8px 0 16px; }}
.btn {{ background:#e6c47a; color:#000; border:none; padding:12px 24px; cursor:pointer;
  font-weight:bold; border-radius:6px; font-size:16px; margin-bottom:16px; }}
.btn:hover {{ background:#f0d88a; }}
pre {{ background:#0d1117; border:1px solid #333; padding:16px; overflow:auto;
  font-size:12px; line-height:1.4; white-space:pre; }}
.nav {{ margin:20px 0; }}
.nav a {{ color:#4ea8de; margin-right:16px; text-decoration:none; font-size:14px; }}
.nav a:hover {{ text-decoration:underline; }}
</style>
<script>
function copyAll() {{
  var el = document.getElementById('code');
  navigator.clipboard.writeText(el.textContent).then(function() {{
    document.getElementById('btn').textContent = 'COPIED!';
    setTimeout(function() {{ document.getElementById('btn').textContent = 'Copy All Code'; }}, 2000);
  }});
}}
</script></head><body>
<h1>File {file_id}/6: {name}</h1>
<div class="path">Paste into: <strong>{dest}</strong></div>
<div class="nav">
  <a href="/api/file/1">1. ContentCard</a>
  <a href="/api/file/2">2. details [id]</a>
  <a href="/api/file/3">3. search</a>
  <a href="/api/file/4">4. category [type]</a>
  <a href="/api/file/5">5. library</a>
  <a href="/api/file/6">6. discover</a>
</div>
<button class="btn" id="btn" onclick="copyAll()">Copy All Code</button>
<pre id="code">{escaped}</pre>
</body></html>"""
    return HTMLResponse(content=html_content)


# ==================== AUTH ROUTES ====================

@api_router.post("/auth/login", response_model=AuthResponse)
async def login(credentials: UserLogin):
    user_data = await db.users.find_one({"username": credentials.username})
    if not user_data:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    user = User(**user_data)
    if not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    token = create_token(user.id)
    return AuthResponse(
        user=UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            is_admin=user.is_admin,
            created_at=user.created_at
        ),
        token=token
    )

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        is_admin=current_user.is_admin,
        created_at=current_user.created_at
    )


# ==================== V739B1 PRIVASTREAM TUNNEL PROVISIONING ====================
# V739B1_TUNNEL_PROVISIONING
#
# Security boundary:
# - Requires the normal Privastream JWT.
# - Device generates and retains its own WireGuard private key.
# - This server receives only the device public key.
# - Peer creation belongs to the separate Privastream VPN control plane.
# - Missing/unreachable provisioning service FAILS CLOSED.
# - Existing playback/Premiumize/addon paths are not used as a fallback.


def _v739b_validate_wireguard_public_key(value: str) -> str:
    key = (value or "").strip()

    if not key:
        raise HTTPException(
            status_code=400,
            detail="Tunnel public key is required",
        )

    try:
        decoded = base64.b64decode(
            key.encode("ascii"),
            validate=True,
        )
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid tunnel public key",
        )

    if len(decoded) != 32:
        raise HTTPException(
            status_code=400,
            detail="Invalid tunnel public key",
        )

    return key


def _v739b_validate_device_id(value: str) -> str:
    raw = (value or "").strip()

    try:
        parsed = uuid.UUID(raw)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid tunnel device id",
        )

    canonical = str(parsed)

    if raw.lower() != canonical:
        raise HTTPException(
            status_code=400,
            detail="Invalid tunnel device id",
        )

    return canonical


# V739B1A_FULL_TUNNEL_VALIDATION
def _v739b_validate_full_tunnel_allowed_ips(value: str) -> str:
    raw = (value or "").strip()

    if not raw:
        logger.error("V739B control plane returned empty allowed_ips")
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    parts = [
        part.strip()
        for part in raw.split(",")
        if part.strip()
    ]

    # Exactly two routes are permitted:
    # all IPv4 + all IPv6.
    if len(parts) != 2:
        logger.error(
            "V739B control plane did not return exactly two default routes"
        )
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    try:
        networks = {
            str(
                ipaddress.ip_network(
                    part,
                    strict=True,
                )
            )
            for part in parts
        }
    except ValueError:
        logger.error(
            "V739B control plane returned invalid allowed_ips"
        )
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    required = {
        "0.0.0.0/0",
        "::/0",
    }

    if networks != required:
        logger.error(
            "V739B control plane rejected: full tunnel routes missing"
        )
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    # Return one deterministic representation to Android.
    return "0.0.0.0/0, ::/0"


@api_router.post(
    "/tunnel/provision",
    response_model=TunnelProvisionResponse,
)
async def v739b_tunnel_provision(
    request: TunnelProvisionRequest,
    current_user: User = Depends(get_current_user),
):
    device_id = _v739b_validate_device_id(
        request.device_id
    )

    public_key = _v739b_validate_wireguard_public_key(
        request.public_key
    )

    control_url = os.environ.get(
        "PRIVASTREAM_TUNNEL_PROVISION_URL",
        "",
    ).strip().rstrip("/")

    control_token = os.environ.get(
        "PRIVASTREAM_TUNNEL_PROVISION_TOKEN",
        "",
    ).strip()

    # V739B fail-closed:
    # Never manufacture a tunnel config locally and never fall back.
    if not control_url or not control_token:
        logger.error(
            "V739B tunnel provisioning unavailable: "
            "control plane is not configured"
        )
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    try:
        parsed_control = urlsplit(control_url)
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    if (
        parsed_control.scheme.lower() != "https"
        or not parsed_control.hostname
        or parsed_control.username is not None
        or parsed_control.password is not None
    ):
        logger.error(
            "V739B tunnel provisioning control URL is invalid"
        )
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    # A device id may never silently cross account ownership.
    existing = await db.tunnel_devices.find_one(
        {"device_id": device_id},
        {
            "_id": 0,
            "user_id": 1,
        },
    )

    if (
        existing
        and existing.get("user_id") != current_user.id
    ):
        raise HTTPException(
            status_code=409,
            detail="Tunnel device is already registered",
        )

    control_payload = {
        "user_id": current_user.id,
        "device_id": device_id,
        "public_key": public_key,
        "platform": (request.platform or "").strip() or None,
        "app_version": (request.app_version or "").strip() or None,
    }

    try:
        async with httpx.AsyncClient(
            timeout=12.0,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            response = await client.post(
                f"{control_url}/v1/peers/provision",
                headers={
                    "Authorization": f"Bearer {control_token}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                json=control_payload,
            )

        if response.status_code != 200:
            logger.warning(
                "V739B tunnel control plane rejected provisioning "
                "for user %s device %s with HTTP %s",
                current_user.id,
                device_id,
                response.status_code,
            )
            raise HTTPException(
                status_code=503,
                detail="Privastream tunnel is unavailable",
            )

        data = response.json()

    except HTTPException:
        raise

    except Exception as exc:
        logger.warning(
            "V739B tunnel provisioning failed for user %s "
            "device %s: %s",
            current_user.id,
            device_id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    required = (
        "address",
        "dns",
        "server_public_key",
        "endpoint",
        "allowed_ips",
    )

    for field in required:
        if not str(data.get(field) or "").strip():
            logger.error(
                "V739B control plane response missing field %s",
                field,
            )
            raise HTTPException(
                status_code=503,
                detail="Privastream tunnel is unavailable",
            )

    allowed_ips = _v739b_validate_full_tunnel_allowed_ips(
        str(data["allowed_ips"])
    )

    server_public_key = _v739b_validate_wireguard_public_key(
        str(data["server_public_key"])
    )

    try:
        keepalive = int(
            data.get("persistent_keepalive", 25)
        )
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    if keepalive < 0 or keepalive > 65535:
        raise HTTPException(
            status_code=503,
            detail="Privastream tunnel is unavailable",
        )

    now = datetime.utcnow()

    await db.tunnel_devices.update_one(
        {
            "user_id": current_user.id,
            "device_id": device_id,
        },
        {
            "$set": {
                "public_key": public_key,
                "platform": (
                    request.platform or ""
                ).strip() or None,
                "app_version": (
                    request.app_version or ""
                ).strip() or None,
                "address": str(data["address"]).strip(),
                "updated_at": now,
                "active": True,
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
    )

    return TunnelProvisionResponse(
        device_id=device_id,
        address=str(data["address"]).strip(),
        dns=str(data["dns"]).strip(),
        server_public_key=server_public_key,
        endpoint=str(data["endpoint"]).strip(),
        allowed_ips=allowed_ips,
        persistent_keepalive=keepalive,
        app_only_package="com.privastream.cinema",
    )

# ==================== V654 TOS SERVER RESTORE ====================
# V654_TOS_SERVER_RESTORE
#
# Restores the server-side contract already used by ToSGate.tsx:
#
#   GET  /api/legal/tos-status?username=<username>
#   POST /api/legal/tos-accept
#
# Existing historical records live in MongoDB collection:
#   tos_acceptances
#
# Acceptance is persisted BEFORE the Resend notification is attempted.
# A mail failure must never force the user to accept the ToS again.


class ToSAcceptRequest(BaseModel):
    username: str
    app_version: Optional[str] = None
    tos_version: Optional[str] = None
    device_info: Optional[str] = None


def _v654_tos_iso(value: Any) -> Optional[str]:
    """Return an existing ToS timestamp as a JSON-safe ISO string."""
    if value is None:
        return None

    if isinstance(value, datetime):
        text = value.isoformat()
        if not text.endswith("Z"):
            text += "Z"
        return text

    return str(value)


@api_router.get("/legal/tos-status")
async def v654_tos_status(username: str):
    """
    Return server-side ToS acceptance for one username.

    This preserves historical records in db.tos_acceptances and is the
    cross-device source of truth used by the Addons ToS gate.
    """
    username = (username or "").strip()

    if not username:
        return {
            "accepted": False,
            "accepted_at": None,
        }

    record = await db.tos_acceptances.find_one(
        {"username": username},
        {"_id": 0},
    )

    if not record:
        return {
            "accepted": False,
            "accepted_at": None,
        }

    return {
        "accepted": True,
        "accepted_at": _v654_tos_iso(record.get("accepted_at")),
        "tos_version": record.get("tos_version"),
    }


@api_router.post("/legal/tos-accept")
async def v654_tos_accept(payload: ToSAcceptRequest, request: Request):
    """
    Record ToS acceptance once per username.

    Existing acceptance is authoritative and is never overwritten.
    Resend notification is attempted only for a NEW acceptance.
    """
    username = (payload.username or "").strip()

    if not username:
        raise HTTPException(
            status_code=400,
            detail="Username is required",
        )

    # Confirm this is an actual Privastream account.
    user = await db.users.find_one(
        {"username": username},
        {"_id": 0},
    )

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Idempotent: an existing historical acceptance wins.
    existing = await db.tos_acceptances.find_one(
        {"username": username},
        {"_id": 0},
    )

    if existing:
        recorded_at = _v654_tos_iso(existing.get("accepted_at"))

        logger.info(
            "V654 ToS already accepted username=%s accepted_at=%s",
            username,
            recorded_at,
        )

        return {
            "ok": True,
            "recorded_at": recorded_at,
            "email_status": "already_recorded",
        }

    accepted_at = datetime.utcnow().isoformat() + "Z"

    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
    elif request.client:
        client_ip = request.client.host
    else:
        client_ip = None

    user_agent = request.headers.get("user-agent")

    record = {
        "username": username,
        "email": user.get("email"),
        "accepted_at": accepted_at,
        "tos_version": payload.tos_version,
        "app_version": payload.app_version,
        "device_info": payload.device_info,
        "ip": client_ip,
        "user_agent": user_agent,
    }

    # CRITICAL ORDER:
    # Persist acceptance before attempting email.
    try:
        await db.tos_acceptances.insert_one(record)
    except Exception:
        logger.exception(
            "V654 failed recording ToS acceptance username=%s",
            username,
        )
        raise HTTPException(
            status_code=500,
            detail="Could not record acceptance",
        )

    logger.info(
        "V654 ToS acceptance recorded username=%s accepted_at=%s",
        username,
        accepted_at,
    )

    email_status = "not_configured"

    resend_api_key = os.environ.get("RESEND_API_KEY", "").strip()

    if resend_api_key:
        sender = os.environ.get(
            "TOS_EMAIL_FROM",
            "onboarding@resend.dev",
        ).strip()

        recipient = os.environ.get(
            "TOS_EMAIL_TO",
            "privastreamsolutions@gmail.com",
        ).strip()

        subject = (
            f"[Privastream ToS] {username} accepted at {accepted_at}"
        )

        email_text = "\n".join([
            "Privastream Cinema Terms of Service acceptance",
            "",
            f"Username: {username}",
            f"Account email: {user.get('email') or 'Not set'}",
            f"Accepted: {accepted_at}",
            f"ToS Version: {payload.tos_version or 'unknown'}",
            f"App Version: {payload.app_version or 'unknown'}",
            f"Device: {payload.device_info or 'unknown'}",
            f"IP: {client_ip or 'unknown'}",
            f"User Agent: {user_agent or 'unknown'}",
        ])

        try:
            http_client = await get_shared_http_client()

            response = await http_client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {resend_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": sender,
                    "to": [recipient],
                    "subject": subject,
                    "text": email_text,
                },
                timeout=15.0,
            )

            if 200 <= response.status_code < 300:
                email_status = "sent"

                logger.info(
                    "V654 ToS email sent username=%s status=%s",
                    username,
                    response.status_code,
                )
            else:
                email_status = f"failed_http_{response.status_code}"

                logger.warning(
                    "V654 ToS email failed username=%s status=%s body=%s",
                    username,
                    response.status_code,
                    response.text[:500],
                )

        except Exception as exc:
            email_status = "failed_exception"

            logger.warning(
                "V654 ToS email exception username=%s error=%s",
                username,
                type(exc).__name__,
            )

    else:
        logger.warning(
            "V654 RESEND_API_KEY missing; acceptance retained username=%s",
            username,
        )

    # Acceptance succeeds even if the notification email did not.
    return {
        "ok": True,
        "recorded_at": accepted_at,
        "email_status": email_status,
    }

# ==================== ADMIN USER MANAGEMENT ====================

@api_router.get("/admin/users", response_model=List[UserResponse])
async def get_all_users(admin: User = Depends(get_admin_user)):
    users = await db.users.find().to_list(1000)
    return [UserResponse(
        id=u["id"],
        username=u["username"],
        email=u.get("email"),
        is_admin=u.get("is_admin", False),
        created_at=u.get("created_at", datetime.utcnow())
    ) for u in users]

@api_router.post("/admin/users", response_model=UserResponse)
async def create_user(user_data: UserCreate, admin: User = Depends(get_admin_user)):
    existing = await db.users.find_one({"username": user_data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    new_user = User(
        username=user_data.username,
        password_hash=hash_password(user_data.password),
        email=user_data.email,
        is_admin=user_data.is_admin,
        premiumize_api_key_encrypted=(encrypt_premiumize_key(user_data.premiumize_api_key) if user_data.premiumize_api_key and user_data.premiumize_api_key.strip() else None)
    )
    await db.users.insert_one(new_user.dict())
    
    return UserResponse(
        id=new_user.id,
        username=new_user.username,
        email=new_user.email,
        is_admin=new_user.is_admin,
        created_at=new_user.created_at
    )

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin: User = Depends(get_admin_user)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    # Protect the master admin account 'choyt' from deletion
    target_user = await db.users.find_one({"id": user_id})
    if target_user and target_user.get("username") == "choyt":
        raise HTTPException(status_code=400, detail="Cannot delete the master admin account")
    
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": "User deleted successfully"}

@api_router.put("/admin/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, user_data: UserUpdate, admin: User = Depends(get_admin_user)):
    existing = await db.users.find_one({"id": user_id})
    if not existing:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Protect the master admin account 'choyt' from being modified by other admins
    if existing.get("username") == "choyt" and admin.username != "choyt":
        raise HTTPException(status_code=400, detail="Cannot modify the master admin account")
    
    update_fields = {}
    if user_data.email is not None:
        update_fields["email"] = user_data.email
    if user_data.password is not None:
        update_fields["password_hash"] = hash_password(user_data.password)
    if user_data.is_admin is not None:
        update_fields["is_admin"] = user_data.is_admin
    if user_data.premiumize_api_key is not None:
        premiumize_key = user_data.premiumize_api_key.strip()
        update_fields["premiumize_api_key_encrypted"] = encrypt_premiumize_key(premiumize_key) if premiumize_key else None
    if user_data.username is not None:
        # Check username not taken by another user
        name_check = await db.users.find_one({"username": user_data.username, "id": {"$ne": user_id}})
        if name_check:
            raise HTTPException(status_code=400, detail="Username already taken")
        update_fields["username"] = user_data.username
    
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    await db.users.update_one({"id": user_id}, {"$set": update_fields})
    updated = await db.users.find_one({"id": user_id})
    
    return UserResponse(
        id=updated["id"],
        username=updated["username"],
        email=updated.get("email"),
        is_admin=updated.get("is_admin", False),
        created_at=updated.get("created_at", datetime.utcnow())
    )


# ==================== V509 PREMIUMIZE SERVER PROXY ====================

@api_router.put("/premiumize/configure")
async def premiumize_configure(request: PremiumizeConfigureRequest, current_user: User = Depends(get_current_user)):
    api_key = (request.api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Premiumize API key is required")
    try:
        client = await get_shared_http_client()
        response = await client.get(
            "https://www.premiumize.me/api/account/info",
            params={"apikey": api_key},
            timeout=10.0,
        )
        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Premiumize rejected this API key")
        data = response.json()
        if data.get("status") != "success":
            raise HTTPException(status_code=400, detail="Premiumize rejected this API key")
        encrypted = encrypt_premiumize_key(api_key)
        await db.users.update_one(
            {"id": current_user.id},
            {"$set": {"premiumize_api_key_encrypted": encrypted}},
        )
        return {
            "configured": True,
            "username": data.get("customer_id") or data.get("email"),
            "premium_until": data.get("premium_until"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Premiumize configure error for user %s: %s", current_user.id, type(exc).__name__)
        raise HTTPException(status_code=502, detail="Unable to configure Premiumize")

@api_router.delete("/premiumize/configure")
async def premiumize_disconnect(current_user: User = Depends(get_current_user)):
    await db.users.update_one(
        {"id": current_user.id},
        {"$unset": {"premiumize_api_key_encrypted": ""}},
    )
    return {"configured": False}

@api_router.get("/premiumize/status")
async def premiumize_status(current_user: User = Depends(get_current_user)):
    return {"configured": bool((current_user.premiumize_api_key_encrypted or "").strip())}

@api_router.post("/premiumize/cache-check")
async def premiumize_cache_check(request: PremiumizeCacheCheckRequest, current_user: User = Depends(get_current_user)):
    items = [str(item).strip().lower() for item in request.items if str(item).strip()][:50]
    if not items:
        raise HTTPException(status_code=400, detail="No cache-check items supplied")
    premiumize_key = get_premiumize_key_for_user(current_user)
    form = {"apikey": premiumize_key, "items[]": items}
    try:
        client = await get_shared_http_client()
        response = await client.post("https://www.premiumize.me/api/cache/check", data=form, timeout=10.0)
        if response.status_code != 200:
            logger.warning("Premiumize cache-check HTTP %s for user %s", response.status_code, current_user.id)
            raise HTTPException(status_code=502, detail="Premiumize cache check failed")
        data = response.json()
        return {
            "status": data.get("status"),
            "response": data.get("response"),
            "message": data.get("message"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Premiumize cache-check error for user %s: %s", current_user.id, type(exc).__name__)
        raise HTTPException(status_code=502, detail="Premiumize cache check failed")

@api_router.post("/premiumize/directdl")
async def premiumize_directdl(request: PremiumizeDirectDLRequest, current_user: User = Depends(get_current_user)):
    src = (request.src or "").strip()
    if not src.lower().startswith("magnet:?xt=urn:btih:"):
        raise HTTPException(status_code=400, detail="Invalid magnet source")
    if len(src) > 8192:
        raise HTTPException(status_code=400, detail="Magnet source is too long")
    premiumize_key = get_premiumize_key_for_user(current_user)
    try:
        client = await get_shared_http_client()
        response = await client.post(
            "https://www.premiumize.me/api/transfer/directdl",
            data={"apikey": premiumize_key, "src": src},
            timeout=20.0,
        )
        if response.status_code != 200:
            logger.warning("Premiumize directdl HTTP %s for user %s", response.status_code, current_user.id)
            raise HTTPException(status_code=502, detail="Premiumize direct resolve failed")
        data = response.json()
        return {
            "status": data.get("status"),
            "content": data.get("content"),
            "message": data.get("message"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Premiumize directdl error for user %s: %s", current_user.id, type(exc).__name__)
        raise HTTPException(status_code=502, detail="Premiumize direct resolve failed")

# ==================== V751_PREMIUMIZE_QUEUE_FALLBACK ====================
# If Premiumize cannot instant-directdl a magnet, place it into the
# Premiumize cloud transfer queue. This backend exchanges HTTPS API data
# only; it does not join the torrent swarm and does not relay video bytes.

@api_router.post("/premiumize/transfer/create")
async def premiumize_transfer_create(
    request: PremiumizeDirectDLRequest,
    current_user: User = Depends(get_current_user),
):
    src = (request.src or "").strip()

    if not src.lower().startswith("magnet:?xt=urn:btih:"):
        raise HTTPException(status_code=400, detail="Invalid magnet source")

    if len(src) > 8192:
        raise HTTPException(status_code=400, detail="Magnet source is too long")

    premiumize_key = get_premiumize_key_for_user(current_user)

    headers = {
        "Authorization": f"Bearer {premiumize_key}",
        "Accept": "application/json",
    }

    try:
        client = await get_shared_http_client()

        response = await client.post(
            "https://www.premiumize.me/api/transfer/create",
            headers=headers,
            data={"src": src},
            timeout=20.0,
        )

        if response.status_code != 200:
            logger.warning(
                "Premiumize transfer create HTTP %s for user %s",
                response.status_code,
                current_user.id,
            )
            raise HTTPException(
                status_code=502,
                detail="Premiumize transfer create failed",
            )

        data = response.json()

        return {
            "status": data.get("status"),
            "id": data.get("id"),
            "name": data.get("name"),
            "message": data.get("message"),
            "code": data.get("code"),
        }

    except HTTPException:
        raise

    except Exception as exc:
        logger.warning(
            "Premiumize transfer create error for user %s: %s",
            current_user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail="Premiumize transfer create failed",
        )


@api_router.get("/premiumize/transfer/status/{transfer_id}")
async def premiumize_transfer_status(
    transfer_id: str,
    current_user: User = Depends(get_current_user),
):
    transfer_id = str(transfer_id or "").strip()

    if not transfer_id or len(transfer_id) > 256:
        raise HTTPException(status_code=400, detail="Invalid transfer id")

    premiumize_key = get_premiumize_key_for_user(current_user)

    headers = {
        "Authorization": f"Bearer {premiumize_key}",
        "Accept": "application/json",
    }

    try:
        client = await get_shared_http_client()

        response = await client.get(
            "https://www.premiumize.me/api/transfer/list",
            headers=headers,
            timeout=15.0,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail="Premiumize transfer status failed",
            )

        data = response.json()

        if data.get("status") != "success":
            return {
                "status": "error",
                "message": data.get("message") or "Premiumize transfer list failed",
                "code": data.get("code"),
            }

        transfers = data.get("transfers") or []

        transfer = next(
            (
                item
                for item in transfers
                if str(item.get("id") or "") == transfer_id
            ),
            None,
        )

        if transfer is None:
            raise HTTPException(
                status_code=404,
                detail="Premiumize transfer not found",
            )

        transfer_status = str(transfer.get("status") or "")
        progress = transfer.get("progress")
        file_id = transfer.get("file_id")
        folder_id = transfer.get("folder_id")
        transfer_name = str(transfer.get("name") or "")

        content = []

        if transfer_status in {"finished", "seeding"}:

            if file_id:
                item_response = await client.get(
                    "https://www.premiumize.me/api/item/details",
                    headers=headers,
                    params={"id": file_id},
                    timeout=15.0,
                )

                if item_response.status_code == 200:
                    item = item_response.json()

                    if (
                        item.get("status") == "success"
                        and item.get("link")
                    ):
                        content.append(
                            {
                                "path": item.get("name") or transfer_name,
                                "size": item.get("size") or 0,
                                "link": item.get("link"),
                            }
                        )

            elif folder_id:
                pending = [(str(folder_id), "")]
                seen = set()

                while (
                    pending
                    and len(seen) < 64
                    and len(content) < 500
                ):
                    current_folder_id, prefix = pending.pop(0)

                    if current_folder_id in seen:
                        continue

                    seen.add(current_folder_id)

                    folder_response = await client.get(
                        "https://www.premiumize.me/api/folder/list",
                        headers=headers,
                        params={"id": current_folder_id},
                        timeout=15.0,
                    )

                    if folder_response.status_code != 200:
                        continue

                    folder_data = folder_response.json()

                    if folder_data.get("status") != "success":
                        continue

                    for entry in folder_data.get("content") or []:
                        entry_type = str(entry.get("type") or "")
                        entry_name = str(entry.get("name") or "")

                        entry_path = (
                            (prefix + "/" + entry_name).strip("/")
                            if entry_name
                            else prefix
                        )

                        if entry_type == "file" and entry.get("link"):
                            content.append(
                                {
                                    "path": entry_path or entry_name,
                                    "size": entry.get("size") or 0,
                                    "link": entry.get("link"),
                                }
                            )

                            if len(content) >= 500:
                                break

                        elif entry_type == "folder" and entry.get("id"):
                            pending.append(
                                (
                                    str(entry.get("id")),
                                    entry_path,
                                )
                            )

        return {
            "status": "success",
            "transfer_status": transfer_status,
            "progress": progress,
            "message": transfer.get("message") or "",
            "name": transfer_name,
            "folder_id": folder_id,
            "file_id": file_id,
            "content": content,
        }

    except HTTPException:
        raise

    except Exception as exc:
        logger.warning(
            "Premiumize transfer status error for user %s: %s",
            current_user.id,
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=502,
            detail="Premiumize transfer status failed",
        )


# ==================== ADDON ROUTES ====================

@api_router.get("/addons")
async def get_addons(current_user: User = Depends(get_current_user)):
    """Get all user's installed addons"""
    addons = await db.addons.find({"userId": current_user.id}).to_list(100)
    for addon in addons:
        addon.pop('_id', None)
    return addons


@api_router.get("/addons/resolve-code/{code}")
async def resolve_shortener_code(code: str, current_user: User = Depends(get_current_user)):
    """Resolve an AFTVnews short code to the actual URL"""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0, headers=headers) as client:
            resp = await client.get(f"https://go.aftvnews.com/{code}")
            if resp.status_code == 200:
                import re
                html = resp.text
                match = re.search(r'Redirecting.*?to:.*?<a href="([^"]+)"', html, re.DOTALL)
                if match:
                    resolved_url = match.group(1)
                    return {"url": resolved_url, "code": code}
            
            raise HTTPException(status_code=400, detail="Could not resolve code. Make sure the code is valid.")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Failed to resolve code {code}: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to resolve code: {str(e)}")


@api_router.post("/addons/install")
async def install_addon(addon_data: AddonInstall, current_user: User = Depends(get_current_user)):
    """Install an addon from manifest URL"""
    manifest_url = addon_data.manifestUrl.strip()
    manifest_data = None

    try:
        manifest_url = await _v726_validate_addon_url(manifest_url)
    except ValueError as exc:
        logger.warning(
            "V726_ADDON_INSTALL_BLOCK user=%s reason=%s",
            current_user.id,
            str(exc),
        )
        raise HTTPException(
            status_code=400,
            detail="Addon URL is not permitted",
        )
    
    # Try to fetch manifest from URL
    try:
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=15.0,
            trust_env=False,
        ) as client:
            response = await _v726_safe_addon_get(
                client,
                manifest_url,
                timeout=15.0,
            )
            if response.status_code == 200:
                content_type = response.headers.get('content-type', '')
                if 'json' in content_type or response.text.strip().startswith('{'):
                    manifest_data = response.json()
    except ValueError as exc:
        logger.warning(
            "V726_ADDON_REDIRECT_BLOCK user=%s reason=%s",
            current_user.id,
            str(exc),
        )
        raise HTTPException(
            status_code=400,
            detail="Addon redirect destination is not permitted",
        )
    except Exception as exc:
        logger.warning(
            "Failed to fetch addon manifest for user %s: %s",
            current_user.id,
            type(exc).__name__,
        )
    
    # If fetch failed, try fallback manifest
    if not manifest_data:
        manifest_data = get_fallback_manifest(manifest_url)
        if manifest_data:
            logger.info(f"Using fallback manifest for {manifest_url}")
    
    # If still no manifest, error
    if not manifest_data:
        raise HTTPException(status_code=400, detail="Failed to fetch manifest. The addon may be protected by Cloudflare.")
    
    # Validate manifest
    if 'id' not in manifest_data or 'name' not in manifest_data:
        raise HTTPException(status_code=400, detail="Invalid manifest format")
    
    # Check if already installed
    existing = await db.addons.find_one({
        "userId": current_user.id,
        "manifest.id": manifest_data.get('id')
    })
    if existing:
        raise HTTPException(status_code=400, detail=f"Addon '{manifest_data.get('name')}' is already installed")
    
    # Create addon
    addon = {
        "id": str(uuid.uuid4()),
        "userId": current_user.id,
        "manifestUrl": manifest_url,
        "manifest": {
            "id": manifest_data.get('id'),
            "name": manifest_data.get('name'),
            "version": manifest_data.get('version', '1.0.0'),
            "description": manifest_data.get('description', ''),
            "logo": manifest_data.get('logo'),
            "types": manifest_data.get('types', []),
            "resources": manifest_data.get('resources', []),
            "catalogs": manifest_data.get('catalogs', []),
            "idPrefixes": manifest_data.get('idPrefixes', []),
            "behaviorHints": manifest_data.get('behaviorHints', {})
        },
        "installed": True,
        "installedAt": datetime.utcnow().isoformat()
    }
    
    await db.addons.insert_one(addon)

    # V704G_DISCOVER_CACHE_INVALIDATION
    # An addon change invalidates both parental-policy variants.
    for discover_key in (
        current_user.id,
        f"{current_user.id}:adult:0",
        f"{current_user.id}:adult:1",
    ):
        _discover_cache.pop(discover_key, None)

    addon.pop('_id', None)
    return addon

@api_router.post("/addons/install-multiple")
async def install_multiple_addons(addon_urls: List[str], current_user: User = Depends(get_current_user)):
    """Install multiple addons from a list of URLs"""
    results = {"installed": [], "failed": []}
    
    for url in addon_urls:
        url = url.strip()
        if not url:
            continue
        try:
            addon_data = AddonInstall(manifestUrl=url)
            result = await install_addon(addon_data, current_user)
            results["installed"].append(result["manifest"]["name"])
        except HTTPException as e:
            results["failed"].append({"url": url, "error": e.detail})
        except Exception as e:
            results["failed"].append({"url": url, "error": str(e)})
    
    return results

@api_router.delete("/addons/{addon_id}")
async def uninstall_addon(addon_id: str, current_user: User = Depends(get_current_user)):
    """Uninstall an addon"""
    result = await db.addons.delete_one({"id": addon_id, "userId": current_user.id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Addon not found")

    # V704G_DISCOVER_CACHE_INVALIDATION
    # Never leave either Adult OFF/ON Discover response stale.
    for discover_key in (
        current_user.id,
        f"{current_user.id}:adult:0",
        f"{current_user.id}:adult:1",
    ):
        _discover_cache.pop(discover_key, None)

    return {"success": True}

@api_router.get("/addons/{addon_id}/stream/{content_type}/{content_id}")
async def get_addon_streams(
    addon_id: str,
    content_type: str,
    content_id: str,
    current_user: User = Depends(get_current_user)
):
    """Fetch streams from addon"""
    addon = await db.addons.find_one({
        "userId": current_user.id,
        "$or": [{"id": addon_id}, {"manifest.id": addon_id}]
    })
    
    if not addon:
        raise HTTPException(status_code=404, detail="Addon not found")
    
    base_url = get_base_url(addon['manifestUrl'])
    stream_url = f"{base_url}/stream/{content_type}/{content_id}.json"
    
    try:
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=12.0,
            trust_env=False,
        ) as client:
            response = await _v726_safe_addon_get(
                client,
                stream_url,
                timeout=12.0,
            )
            if response.status_code == 200:
                return response.json()
            else:
                return {"streams": []}
    except Exception as e:
        logger.error(f"Error fetching streams: {str(e)}")
        return {"streams": []}

# ================= V727B2C REDTUBE EGRESS HARDENING =================
# Exact RedTube hosts only; HTTPS/443 only; no credentials; all DNS
# answers must be globally routable; redirects are manually revalidated.
_V727B2C_REDTUBE_PAGE_HOSTS = frozenset({
    "www.redtube.com",
})

_V727B2C_REDTUBE_MEDIA_HOSTS = frozenset({
    "ev.phncdn.com",
})

_V727B2C_REDIRECT_CODES = {301, 302, 303, 307, 308}
_V727B2C_MAX_REDIRECTS = 3


async def _v727b2c_validate_redtube_https_url(
    url: str,
    allowed_hosts,
) -> str:
    value = str(url or "").strip()

    if not value or len(value) > 8192:
        raise ValueError("RedTube URL is empty or too long")

    if "\\" in value:
        raise ValueError("RedTube URL contains a backslash")

    if any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError("RedTube URL contains control characters")

    if any(ch.isspace() for ch in value):
        raise ValueError("RedTube URL contains whitespace")

    try:
        parsed = urlsplit(value)
        host = str(parsed.hostname or "").strip().rstrip(".").lower()
        port = parsed.port
    except ValueError as exc:
        raise ValueError("RedTube URL could not be parsed") from exc

    if parsed.scheme.lower() != "https":
        raise ValueError("RedTube URL must use HTTPS")

    if not parsed.netloc or not host:
        raise ValueError("RedTube URL has no hostname")

    if parsed.username is not None or parsed.password is not None:
        raise ValueError("RedTube URL credentials are not allowed")

    if port not in (None, 443):
        raise ValueError("RedTube URL must use HTTPS port 443")

    if host not in allowed_hosts:
        raise ValueError("RedTube hostname is not approved")

    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            host,
            443,
            0,
            socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        raise ValueError(
            "RedTube hostname could not be resolved"
        ) from exc

    resolved_ips = {
        str(entry[4][0]).split("%", 1)[0]
        for entry in addresses
        if entry and len(entry) >= 5 and entry[4]
    }

    if not resolved_ips:
        raise ValueError(
            "RedTube hostname resolved to no addresses"
        )

    for raw_ip in resolved_ips:
        try:
            address = ipaddress.ip_address(raw_ip)
        except ValueError as exc:
            raise ValueError(
                "RedTube hostname returned an invalid address"
            ) from exc

        if not address.is_global:
            raise ValueError(
                "RedTube hostname resolved to a non-public address"
            )

    return value


async def _v727b2c_safe_redtube_get(
    client: httpx.AsyncClient,
    url: str,
    *,
    headers: Dict[str, str],
    timeout: float,
    allowed_hosts,
) -> httpx.Response:
    current_url = str(url or "").strip()

    for redirect_count in range(
        _V727B2C_MAX_REDIRECTS + 1
    ):
        current_url = (
            await _v727b2c_validate_redtube_https_url(
                current_url,
                allowed_hosts,
            )
        )

        response = await client.get(
            current_url,
            headers=headers,
            timeout=timeout,
            follow_redirects=False,
        )

        if response.status_code not in _V727B2C_REDIRECT_CODES:
            return response

        location = response.headers.get("location")

        if not location:
            return response

        if redirect_count >= _V727B2C_MAX_REDIRECTS:
            raise ValueError(
                "RedTube URL exceeded redirect limit"
            )

        current_url = urljoin(
            current_url,
            location,
        )

    raise ValueError(
        "RedTube redirect handling failed"
    )


async def _v727b2c_validate_redtube_media_url(
    url: str,
) -> str:
    value = await _v727b2c_validate_redtube_https_url(
        url,
        _V727B2C_REDTUBE_MEDIA_HOSTS,
    )

    parsed = urlsplit(value)

    if not parsed.path.lower().endswith(".mp4"):
        raise ValueError(
            "RedTube media URL is not an MP4"
        )

    if not parsed.query:
        raise ValueError(
            "RedTube media URL has no signed query"
        )

    return value


async def extract_redtube_video(video_id: str) -> List[Dict]:
    """Extract actual video URLs from RedTube."""
    import re
    import json

    video_id = str(video_id or "").strip()

    # V727B2C_REDTUBE_EGRESS_HARDENING
    if not re.fullmatch(r"[0-9]{1,20}", video_id):
        logger.warning(
            "V727B2C RedTube video id rejected"
        )
        return []

    try:
        url = f"https://www.redtube.com/{video_id}"

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": (
                "text/html,application/xhtml+xml,"
                "application/xml;q=0.9,*/*;q=0.8"
            ),
        }

        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=15.0,
            trust_env=False,
        ) as client:
            response = await _v727b2c_safe_redtube_get(
                client,
                url,
                headers=headers,
                timeout=15.0,
                allowed_hosts=_V727B2C_REDTUBE_PAGE_HOSTS,
            )

            if response.status_code == 200:
                html = response.text
                streams = []

                media_match = re.search(
                    r'"mediaDefinitions"\s*:\s*\[(.*?)\]',
                    html,
                    re.DOTALL,
                )

                if media_match:
                    try:
                        media_json = (
                            "[" +
                            media_match.group(1) +
                            "]"
                        )

                        media_data = json.loads(
                            media_json
                        )

                        for item in media_data:
                            if (
                                not isinstance(item, dict)
                                or not item.get("videoUrl")
                            ):
                                continue

                            format_type = item.get(
                                "format",
                                "Unknown",
                            )

                            media_url = str(
                                item.get(
                                    "videoUrl",
                                    "",
                                )
                            )

                            if media_url.startswith("/"):
                                media_url = urljoin(
                                    url,
                                    media_url,
                                )

                            media_url = media_url.replace(
                                "\\/",
                                "/",
                            )

                            try:
                                media_url = await (
                                    _v727b2c_validate_redtube_https_url(
                                        media_url,
                                        _V727B2C_REDTUBE_PAGE_HOSTS,
                                    )
                                )

                                media_resp = await (
                                    _v727b2c_safe_redtube_get(
                                        client,
                                        media_url,
                                        headers=headers,
                                        timeout=10.0,
                                        allowed_hosts=(
                                            _V727B2C_REDTUBE_PAGE_HOSTS
                                        ),
                                    )
                                )

                                if media_resp.status_code != 200:
                                    continue

                                video_list = media_resp.json()

                                if not isinstance(
                                    video_list,
                                    list,
                                ):
                                    continue

                                for video_item in video_list:
                                    if (
                                        not isinstance(
                                            video_item,
                                            dict,
                                        )
                                        or not video_item.get(
                                            "videoUrl"
                                        )
                                    ):
                                        continue

                                    quality = video_item.get(
                                        "quality",
                                        "Unknown",
                                    )

                                    fmt = video_item.get(
                                        "format",
                                        format_type,
                                    )

                                    try:
                                        actual_url = await (
                                            _v727b2c_validate_redtube_media_url(
                                                str(
                                                    video_item.get(
                                                        "videoUrl",
                                                        "",
                                                    )
                                                )
                                            )
                                        )
                                    except Exception as media_exc:
                                        logger.warning(
                                            "V727B2C legacy RedTube "
                                            "media URL rejected: %s",
                                            type(media_exc).__name__,
                                        )
                                        continue

                                    streams.append({
                                        "name": (
                                            f"RedTube {quality}p"
                                        ),
                                        "title": (
                                            f"RedTube {quality}p "
                                            f"{str(fmt).upper()}"
                                        ),
                                        "url": actual_url,
                                        "externalUrl": actual_url,
                                        "headers": {
                                            "Referer": url,
                                        },
                                        "addon": "RedTube",
                                    })

                            except Exception as endpoint_exc:
                                logger.warning(
                                    "V727B2C RedTube media endpoint "
                                    "rejected/failed: %s",
                                    type(endpoint_exc).__name__,
                                )

                    except Exception as parse_exc:
                        logger.warning(
                            "Error parsing mediaDefinitions: %s",
                            type(parse_exc).__name__,
                        )

                # V727B2A_REDTUBE_VIDEO_SRC_FALLBACK
                if not streams:
                    video_match = re.search(
                        r"""<video\b[^>]*\bsrc=["']([^"']+)["']""",
                        html,
                        re.IGNORECASE,
                    )

                    if video_match:
                        try:
                            from html import (
                                unescape as _v727b2a_html_unescape,
                            )

                            media_url = (
                                _v727b2a_html_unescape(
                                    video_match.group(1)
                                )
                                .replace(
                                    "\\/",
                                    "/",
                                )
                            )

                            if media_url.startswith("//"):
                                media_url = (
                                    "https:" +
                                    media_url
                                )

                            media_url = await (
                                _v727b2c_validate_redtube_media_url(
                                    media_url
                                )
                            )

                            streams.append({
                                "name": "RedTube Direct",
                                "title": "RedTube Direct MP4",
                                "url": media_url,
                                "externalUrl": media_url,
                                "headers": {
                                    "Referer": url,
                                },
                                "addon": "RedTube",
                            })

                            logger.info(
                                "V727B2A RedTube direct MP4 "
                                "discovered for video %s",
                                video_id,
                            )

                        except Exception as media_exc:
                            logger.warning(
                                "V727B2C RedTube video src "
                                "rejected/failed: %s",
                                type(media_exc).__name__,
                            )

                seen_urls = set()
                unique_streams = []

                for stream in streams:
                    stream_url = stream.get("url")

                    if (
                        stream_url
                        and stream_url not in seen_urls
                    ):
                        seen_urls.add(
                            stream_url
                        )
                        unique_streams.append(
                            stream
                        )

                if unique_streams:
                    logger.info(
                        "Extracted %s streams from RedTube "
                        "for video %s",
                        len(unique_streams),
                        video_id,
                    )
                    return unique_streams

                logger.warning(
                    "No streams found in RedTube page for %s",
                    video_id,
                )

    except Exception as exc:
        logger.warning(
            "Error extracting RedTube video %s: %s",
            video_id,
            type(exc).__name__,
        )

    return []

async def extract_xhamster_video(video_url: str) -> list:
    """Extract direct video streams from xHamster video page"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        }
        
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            response = await client.get(video_url, headers=headers)
            if response.status_code == 200:
                html = response.text
                streams = []
                
                # Look for video sources in JSON format embedded in the page
                import re
                import json
                
                # Pattern to find "sources" JSON object in the page - use a more specific pattern
                # Look for the h264 sources array directly
                h264_match = re.search(r'"h264"\s*:\s*\[(.*?)\]', html, re.DOTALL)
                if h264_match:
                    try:
                        h264_json = "[" + h264_match.group(1) + "]"
                        # Clean up escaped slashes
                        h264_json = h264_json.replace('\\/', '/')
                        sources_data = {"standard": {"h264": json.loads(h264_json)}}
                        
                        # Extract h264 streams from standard sources
                        if 'standard' in sources_data and 'h264' in sources_data['standard']:
                            for stream in sources_data['standard']['h264']:
                                url = stream.get('url', '')
                                quality = stream.get('quality', 'Unknown')
                                label = stream.get('label', quality)
                                
                                if url and quality != 'auto':  # Skip auto quality, prefer direct
                                    # Clean URL
                                    url = url.replace('\\/', '/')
                                    streams.append({
                                        "name": f"xHamster {label}",
                                        "title": f"xHamster • {label}",
                                        "url": url,
                                        "addon": "xHamster"
                                    })
                                elif quality == 'auto' and url:
                                    # Add HLS auto quality stream
                                    url = url.replace('\\/', '/')
                                    streams.append({
                                        "name": "xHamster HLS Auto",
                                        "title": "xHamster • HLS Auto Quality",
                                        "url": url,
                                        "addon": "xHamster"
                                    })
                    except json.JSONDecodeError as e:
                        logger.warning(f"Failed to parse xHamster sources JSON: {e}")
                
                # Also try to extract from mp4 URLs directly in page as fallback
                if not streams:
                    mp4_urls = re.findall(r'https?://[^"\'<>\s]+\.mp4[^"\'<>\s]*', html)
                    seen = set()
                    for url in mp4_urls:
                        clean_url = url.replace('\\/', '/')
                        if clean_url not in seen and 'xhcdn.com' in clean_url:
                            seen.add(clean_url)
                            # Try to extract quality from URL
                            quality_match = re.search(r'(\d{3,4}p)', clean_url)
                            quality = quality_match.group(1) if quality_match else 'Unknown'
                            streams.append({
                                "name": f"xHamster {quality}",
                                "title": f"xHamster • {quality}",
                                "url": clean_url,
                                "addon": "xHamster"
                            })
                
                # Sort streams by quality (highest first)
                def quality_sort_key(s):
                    name = s.get('name', '')
                    # Extract resolution number
                    match = re.search(r'(\d+)p', name)
                    if match:
                        return -int(match.group(1))  # Negative for descending order
                    if 'HLS' in name or 'Auto' in name:
                        return 0  # HLS auto goes after highest quality direct streams
                    return 1  # Unknown goes last
                
                streams.sort(key=quality_sort_key)
                
                # Remove duplicates
                seen_qualities = set()
                unique_streams = []
                for s in streams:
                    quality_key = s.get('name', '')
                    if quality_key not in seen_qualities:
                        seen_qualities.add(quality_key)
                        unique_streams.append(s)
                
                streams = unique_streams
                
                if streams:
                    logger.info(f"Extracted {len(streams)} streams from xHamster")
                    return streams
                else:
                    logger.warning("No streams found in xHamster page")
                    
    except Exception as e:
        logger.warning(f"Error extracting xHamster video: {e}")
    
    return []


# Proxy endpoint for client-side addon fetching (bypasses CORS for web)
@api_router.get("/addon-proxy/{addon}/{content_type}/{content_id:path}")
async def proxy_addon_streams(
    addon: str,
    content_type: str,
    content_id: str,
    current_user: User = Depends(get_current_user)
):
    """Proxy requests to Stremio addons to bypass CORS on web - uses allorigins.win for Cloudflare"""
    logger.info(f"Addon proxy: {addon}/{content_type}/{content_id}")
    
    addon_urls = {
        "torrentio": f"https://torrentio.strem.fun/sort=seeders|qualityfilter=480p,scr,cam/stream/{content_type}/{content_id}.json",
        "tpb": f"https://thepiratebay-plus.strem.fun/stream/{content_type}/{content_id}.json",
    }
    
    if addon not in addon_urls:
        return {"streams": []}
    
    url = addon_urls[addon]
    
    # Try allorigins.win proxy first (bypasses Cloudflare via proxy IP)
    try:
        import urllib.parse
        encoded_url = urllib.parse.quote(url, safe='')
        proxy_url = f"https://api.allorigins.win/raw?url={encoded_url}"
        
        client = await get_shared_http_client()
        response = await client.get(proxy_url, timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f"Addon proxy {addon} success via allorigins: {len(data.get('streams', []))} streams")
            return data
        else:
            logger.warning(f"Addon proxy {addon} allorigins status {response.status_code}")
    except Exception as e:
        logger.warning(f"Addon proxy {addon} allorigins error: {e}")
    
    # Fallback to cloudscraper (may work if Cloudflare protection changes)
    try:
        import cloudscraper
        scraper = cloudscraper.create_scraper(
            browser={'browser': 'chrome', 'platform': 'android', 'mobile': True}
        )
        response = scraper.get(url, timeout=15)
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f"Addon proxy {addon} success via cloudscraper: {len(data.get('streams', []))} streams")
            return data
        else:
            logger.warning(f"Addon proxy {addon} cloudscraper status {response.status_code}")
    except Exception as e:
        logger.warning(f"Addon proxy {addon} cloudscraper error: {e}")
    
    return {"streams": []}


# ================= V737_PORNTUBE_NATIVE_ROUTING =================
# PornTube owns its pt:* and porndb:* identifiers.  Do not send
# these IDs to Cinemeta or fan them out to unrelated addons.
#
# Outbound access remains behind the existing V726 HTTPS/DNS/
# exact-host validation.  No media bytes are proxied here.
async def _v737_fetch_porntube_native(
    resource: str,
    content_type: str,
    content_id: str,
):
    if resource not in ("meta", "stream"):
        return None

    if content_type != "movie":
        return None

    if not (
        content_id.startswith("pt:")
        or content_id.startswith("porndb:")
    ):
        return None

    import urllib.parse

    encoded_id = urllib.parse.quote(
        content_id,
        safe="",
    )

    url = (
        "https://ptube.ers.pw/"
        f"{resource}/movie/{encoded_id}.json"
    )

    async with httpx.AsyncClient(
        follow_redirects=False,
        timeout=15.0,
        trust_env=False,
    ) as client:
        return await _v726_safe_addon_get(
            client,
            url,
            timeout=15.0,
        )

@api_router.get("/streams/{content_type}/{content_id:path}")
async def get_all_streams(
    content_type: str,
    content_id: str,
    current_user: User = Depends(get_current_user)
):
    """Fetch streams from ALL installed addons + built-in Torrentio-style aggregation"""
    # V737_PORNTUBE_NATIVE_ROUTING
    # A pt:* / porndb:* ID belongs to PornTube.  Query that addon
    # directly instead of waiting on unrelated Torrentio/TPB/addons.
    if (
        content_type == "movie"
        and (
            content_id.startswith("pt:")
            or content_id.startswith("porndb:")
        )
    ):
        try:
            response = await _v737_fetch_porntube_native(
                "stream",
                content_type,
                content_id,
            )

            if response is not None and response.status_code == 200:
                data = response.json()
                streams = data.get("streams", []) or []

                for stream in streams:
                    if isinstance(stream, dict):
                        stream.setdefault(
                            "addon",
                            "Porn Tube",
                        )

                logger.info(
                    "V737_PORNTUBE_STREAM id=%s count=%s",
                    content_id[:80],
                    len(streams),
                )

                return {
                    "streams": streams,
                }

            status = (
                response.status_code
                if response is not None
                else 0
            )

            logger.info(
                "V737_PORNTUBE_STREAM_EMPTY id=%s status=%s",
                content_id[:80],
                status,
            )

            return {
                "streams": [],
            }

        except Exception as e:
            logger.warning(
                "V737_PORNTUBE_STREAM_ERROR id=%s error=%s",
                content_id[:80],
                type(e).__name__,
            )

            return {
                "streams": [],
            }

    
    # Check stream cache first (2 minute TTL)
    stream_cache_key = f"streams:{content_type}:{content_id}:{current_user.id}"
    cached_streams = _discover_cache.get(stream_cache_key)
    if cached_streams and cached_streams["expires"] > datetime.utcnow():
        logger.info(f"Stream cache HIT for {content_type}/{content_id}")
        return cached_streams["data"]
    
    # Handle Porn+ / RedTube content IDs - extract video directly
    if 'RedTube-movie-' in content_id or 'porn_id:RedTube' in content_id:
        # Extract video ID from content ID (e.g., porn_id:RedTube-movie-196897861)
        video_id = content_id.split('-')[-1]
        logger.info(f"Extracting RedTube video: {video_id}")
        
        redtube_streams = await extract_redtube_video(video_id)
        if redtube_streams:
            return {"streams": redtube_streams}
    
    # Handle URL-based content IDs (like from OnlyPorn addon)
    # These need to be fetched from the jaxxx addon which resolves the actual stream URL
    if content_id.startswith('http://') or content_id.startswith('https://'):
        # V727B1_ONLYPORN_SAFE_URL_STREAMS
        # Never fetch the content URL itself. Treat it as opaque addon input
        # and send it only as one encoded path component to the user's
        # installed, exact approved OnlyPorn/Jaxxx addon.
        if content_type != 'movie':
            logger.warning(
                "V727B1_ONLYPORN_BLOCK reason=content-type user=%s",
                current_user.id,
            )
            return {"streams": []}

        try:
            import urllib.parse

            parsed_content = urllib.parse.urlparse(content_id)
            source_host = (
                parsed_content.hostname or ''
            ).lower().rstrip('.')

            allowed_source_hosts = (
                'eporner.com',
                'xhamster.com',
                'porntrex.com',
            )

            source_allowed = any(
                source_host == allowed_host
                or source_host.endswith('.' + allowed_host)
                for allowed_host in allowed_source_hosts
            )

            if (
                parsed_content.scheme not in ('http', 'https')
                or not source_allowed
            ):
                logger.warning(
                    "V727B1_ONLYPORN_BLOCK reason=source-host user=%s",
                    current_user.id,
                )
                return {"streams": []}

            jaxxx_addon = await db.addons.find_one({
                "userId": current_user.id,
                "manifest.id": "org.masterchief.onlyporn",
            })

            if not jaxxx_addon:
                logger.warning(
                    "V727B1_ONLYPORN_BLOCK reason=addon-not-installed user=%s",
                    current_user.id,
                )
                return {"streams": []}

            manifest_url = str(
                jaxxx_addon.get('manifestUrl') or ''
            ).strip()

            parsed_manifest = urllib.parse.urlparse(
                manifest_url
            )

            manifest_host = (
                parsed_manifest.hostname or ''
            ).lower().rstrip('.')

            approved_jaxxx_host = (
                '07b88951aaab-jaxxx-v2.baby-beamup.club'
            )

            if (
                parsed_manifest.scheme != 'https'
                or manifest_host != approved_jaxxx_host
            ):
                logger.warning(
                    "V727B1_ONLYPORN_BLOCK reason=addon-host user=%s",
                    current_user.id,
                )
                return {"streams": []}

            base_url = get_base_url(
                manifest_url
            )

            encoded_id = urllib.parse.quote(
                content_id,
                safe='',
            )

            stream_url = (
                f"{base_url}/stream/"
                f"{content_type}/{encoded_id}.json"
            )

            stream_url = await _v726_validate_addon_url(
                stream_url
            )

            async with httpx.AsyncClient(
                follow_redirects=False,
                timeout=20.0,
                trust_env=False,
            ) as client:
                response = await _v726_safe_addon_get(
                    client,
                    stream_url,
                    timeout=20.0,
                )

            if response.status_code != 200:
                logger.warning(
                    "V727B1_ONLYPORN_STREAM status=%s user=%s",
                    response.status_code,
                    current_user.id,
                )
                return {"streams": []}

            data = response.json()

            raw_streams = (
                data.get('streams', [])
                if isinstance(data, dict)
                else []
            )

            if not isinstance(raw_streams, list):
                raw_streams = []

            streams = []

            for stream in raw_streams:
                if not isinstance(stream, dict):
                    continue

                normalized_stream = dict(stream)
                normalized_stream['addon'] = 'OnlyPorn'
                streams.append(normalized_stream)

            payload = {
                "streams": streams,
            }

            # Preserve V668's rule: never cache a zero-stream result.
            if streams:
                _discover_cache[stream_cache_key] = {
                    "data": payload,
                    "expires": datetime.utcnow() + timedelta(seconds=120),
                }

            logger.info(
                "V727B1_ONLYPORN_STREAM streams=%s user=%s",
                len(streams),
                current_user.id,
            )

            return payload

        except Exception as e:
            logger.warning(
                "V727B1_ONLYPORN_STREAM_ERROR type=%s user=%s",
                type(e).__name__,
                current_user.id,
            )
            return {"streams": []}
        # Legacy URL extraction remains below but is unreachable.
        logger.info(f"URL-based content ID detected: {content_id[:60]}...")
        
        # Determine site name for labeling
        site_name = "Video"
        if 'xhamster.com' in content_id:
            site_name = "xHamster"
        elif 'eporner.com' in content_id:
            site_name = "Eporner"
        elif 'porntrex.com' in content_id:
            site_name = "PornTrex"
        
        # Try yt-dlp first for supported sites - this gets REAL working URLs
        if site_name in ["xHamster", "Eporner", "PornTrex"]:
            try:
                import subprocess
                logger.info(f"Using yt-dlp to extract {site_name} streams...")
                
                # Get multiple formats
                result = subprocess.run(
                    ['/root/.venv/bin/yt-dlp', '-j', content_id],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                
                if result.returncode == 0 and result.stdout:
                    import json
                    video_info = json.loads(result.stdout)
                    formats = video_info.get('formats', [])
                    
                    # Filter and sort formats
                    formatted = []
                    seen_resolutions = set()
                    
                    # Sort by quality (height) descending
                    formats_sorted = sorted(
                        [f for f in formats if f.get('url') and f.get('height')],
                        key=lambda x: x.get('height', 0),
                        reverse=True
                    )
                    
                    for fmt in formats_sorted:
                        height = fmt.get('height', 0)
                        url = fmt.get('url', '')
                        
                        # Skip duplicates and very low quality
                        if height in seen_resolutions or height < 144:
                            continue
                        seen_resolutions.add(height)
                        
                        quality_label = f"{height}p"
                        
                        # Use proxy URL to bypass CORS/IP issues
                        import base64
                        encoded_url = base64.b64encode(url.encode()).decode()
                        proxy_url = f"/api/proxy/video?url={encoded_url}"
                        
                        formatted.append({
                            "name": f"{site_name} {quality_label}",
                            "title": f"{site_name} • {quality_label}",
                            "url": proxy_url,
                            "addon": site_name,
                            "isProxy": True
                        })
                        
                        # Limit to 4 quality options
                        if len(formatted) >= 4:
                            break
                    
                    if formatted:
                        # Add browser fallback
                        formatted.append({
                            "name": "Open in Browser",
                            "title": f"{site_name} • Open in Browser",
                            "externalUrl": content_id,
                            "addon": site_name,
                            "requiresWebView": True
                        })
                        logger.info(f"{site_name}: yt-dlp found {len(formatted)-1} working streams!")
                        return {"streams": formatted}
                        
            except subprocess.TimeoutExpired:
                logger.warning(f"yt-dlp timeout for {site_name}")
            except Exception as e:
                logger.warning(f"yt-dlp error for {site_name}: {e}")
        
        # Fallback to Jaxxx addon for other sites
        try:
            import urllib.parse
            encoded_id = urllib.parse.quote(content_id, safe='')
            stream_url = f"https://07b88951aaab-jaxxx-v2.baby-beamup.club/stream/{content_type}/{encoded_id}.json"
            
            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                response = await client.get(stream_url)
                if response.status_code == 200:
                    data = response.json()
                    streams = data.get('streams', [])
                    
                    formatted = []
                    for s in streams:
                        stream_url_value = s.get('url', '')
                        stream_name = s.get('name', 'Stream')
                        if stream_url_value:
                            formatted.append({
                                "name": f"{site_name} {stream_name}",
                                "title": f"{site_name} • {stream_name}",
                                "url": stream_url_value,
                                "addon": site_name
                            })
                    
                    # Add browser fallback
                    formatted.append({
                        "name": "Open in Browser",
                        "title": f"{site_name} • Open in Browser (if streams don't work)",
                        "externalUrl": content_id,
                        "addon": site_name,
                        "requiresWebView": True
                    })
                    
                    logger.info(f"{site_name}: Jaxxx found {len(formatted)-1} streams + browser fallback")
                    return {"streams": formatted}
        except Exception as e:
            logger.warning(f"{site_name} Jaxxx error: {e}")
        
        # Final fallback - browser only
        logger.info(f"{site_name}: All extraction failed, returning browser-only")
        return {"streams": [
            {
                "name": "Open in Browser",
                "title": f"{site_name} • Open in Browser",
                "externalUrl": content_id,
                "addon": site_name,
                "requiresWebView": True
            }
        ]}
        
        # Fallback - return empty if addon fails
        return {"streams": []}
    
    # For TV channels (USA TV), fetch directly from the addon
    if content_type == 'tv' and content_id.startswith('ustv'):
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                stream_url = f"https://848b3516657c-usatv.baby-beamup.club/stream/tv/{content_id}.json"
                response = await client.get(stream_url)
                if response.status_code == 200:
                    data = response.json()
                    streams = data.get('streams', [])
                    
                    # Format streams to match Stremio's display style
                    # Stremio shows: quality (HD/SD) + provider abbreviation (AX, CV, MJ, TP, etc.)
                    # We pass through the raw format so the frontend can display it like Stremio
                    formatted_streams = []
                    
                    for stream in streams:
                        url = stream.get('url', '')
                        desc = stream.get('description', '')  # Provider abbreviation: AX, CV, MJ, TP, etc.
                        quality = stream.get('name', 'HD')    # HD or SD
                        
                        if not url:
                            continue
                        
                        # Use Stremio-style display: "HD" or "SD" as name, provider code as title
                        # The frontend will render these as stream cards matching Stremio's format
                        formatted_streams.append({
                            "name": f"{quality}\n{desc}",    # "HD\nAX" - quality + provider on two lines
                            "title": desc,                    # Provider abbreviation for display
                            "url": url,
                            "addon": "USA TV",
                            "quality": quality,
                            "provider": desc,                 # Raw provider code
                            "isLive": True,
                        })
                    
                    # Health check: Test each stream URL in parallel
                    # Only return streams that respond (filters out dead/broken providers)
                    # Uses module-level cache to speed up repeated loads
                    import asyncio as _asyncio
                    import time as _time
                    
                    # Module-level cache (survives across requests)
                    global _stream_health_cache
                    if '_stream_health_cache' not in globals():
                        _stream_health_cache = {}
                    
                    async def check_stream_health(stream_data: dict) -> bool:
                        """Quick HEAD request to verify stream is accessible"""
                        url = stream_data.get('url', '')
                        provider = stream_data.get('provider', '')
                        cache_key = f"{provider}:{url[:50]}"
                        
                        # Check cache (5 minute TTL)
                        if cache_key in _stream_health_cache:
                            cached_ok, cached_time = _stream_health_cache[cache_key]
                            if _time.time() - cached_time < 300:  # 5 min cache
                                return cached_ok
                        
                        try:
                            async with httpx.AsyncClient(follow_redirects=True, timeout=3.0) as check_client:
                                resp = await check_client.head(url, headers={
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                })
                                is_ok = resp.status_code < 400
                                _stream_health_cache[cache_key] = (is_ok, _time.time())
                                if not is_ok:
                                    logger.info(f"Stream health FAIL ({resp.status_code}): {provider} {url[:50]}")
                                return is_ok
                        except Exception:
                            _stream_health_cache[cache_key] = (False, _time.time())
                            logger.info(f"Stream health FAIL (timeout): {provider} {url[:50]}")
                            return False
                    
                    # Check all streams in parallel (fast - all at once)
                    health_results = await _asyncio.gather(
                        *[check_stream_health(s) for s in formatted_streams]
                    )
                    
                    # Filter to only working streams
                    working_streams = [s for s, ok in zip(formatted_streams, health_results) if ok]
                    
                    logger.info(f"USA TV streams for {content_id}: {len(working_streams)}/{len(formatted_streams)} passed health check")
                    
                    # If no streams passed health check, return all (let client try)
                    if not working_streams:
                        logger.warning(f"No USA TV streams passed health check for {content_id}, returning all")
                        return {"streams": formatted_streams}
                    
                    return {"streams": working_streams}
        except Exception as e:
            logger.error(f"USA TV streams error: {e}")
        return {"streams": []}
    
    addons = await db.addons.find({"userId": current_user.id}).to_list(100)
    
    all_streams = []
    
    # Get content title for torrent search
    content_title = ""
    content_year = ""
    try:
        client = await get_shared_http_client()
        base_id = content_id.split(':')[0]
        
        # Try primary Cinemeta endpoint
        meta_url = f"https://v3-cinemeta.strem.io/meta/{content_type}/{base_id}.json"
        meta_resp = await client.get(meta_url, follow_redirects=True)
        if meta_resp.status_code == 200:
            meta = meta_resp.json().get('meta', {})
            content_title = meta.get('name', '')
            content_year = str(meta.get('year', ''))
            if '–' in content_year:
                content_year = content_year.split('–')[0]
        
        # Fallback: try live Cinemeta if no title
        if not content_title:
            logger.info(f"Cinemeta v3 had no title for {base_id}, trying live endpoint")
            live_url = f"https://cinemeta-live.strem.io/meta/{content_type}/{base_id}.json"
            live_resp = await client.get(live_url)
            if live_resp.status_code == 200:
                live_meta = live_resp.json().get('meta', {})
                content_title = live_meta.get('name', '')
                content_year = str(live_meta.get('releaseInfo', live_meta.get('year', '')))
                if '–' in content_year:
                    content_year = content_year.split('–')[0]
        
        # Fallback 2: try OMDB if still no title
        if not content_title and base_id.startswith('tt'):
            logger.info(f"No title from Cinemeta for {base_id}, trying OMDB")
            omdb_url = f"https://www.omdbapi.com/?i={base_id}&apikey=aa53a1e5"
            try:
                omdb_resp = await client.get(omdb_url)
                if omdb_resp.status_code == 200:
                    omdb_data = omdb_resp.json()
                    if omdb_data.get('Response') == 'True':
                        content_title = omdb_data.get('Title', '')
                        content_year = omdb_data.get('Year', '')
                        if '–' in content_year:
                            content_year = content_year.split('–')[0]
                        logger.info(f"OMDB fallback: '{content_title}' ({content_year})")
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"Failed to fetch meta for streams: {e}")
    
    async def fetch_addon_streams(addon):
        """Fetch streams from a single addon - with Cloudflare bypass for protected addons"""
        try:
            manifest = addon.get('manifest', {})
            resources = manifest.get('resources', [])
            
            # Check if addon supports streams
            has_stream = any(
                r == 'stream' or (isinstance(r, dict) and r.get('name') == 'stream')
                for r in resources
            )
            
            if not has_stream:
                return []
            
            base_url = get_base_url(addon['manifestUrl'])
            stream_url = f"{base_url}/stream/{content_type}/{content_id}.json"
            stream_url = await _v726_validate_addon_url(stream_url)

            # Check if this is a Cloudflare-protected domain
            cf_protected_domains = ['torrentio.strem.fun', 'strem.fun']
            needs_bypass = any(domain in base_url for domain in cf_protected_domains)
            
            if needs_bypass:
                # Use allorigins.win proxy for Cloudflare bypass (server IP is blocked)
                try:
                    import urllib.parse
                    encoded_url = urllib.parse.quote(stream_url, safe='')
                    proxy_url = f"https://api.allorigins.win/raw?url={encoded_url}"
                    
                    client = await get_shared_http_client()
                    response = await client.get(proxy_url, timeout=20)
                    if response.status_code == 200:
                        data = response.json()
                        streams = data.get('streams', [])
                        for stream in streams:
                            stream['addon'] = manifest.get('name', 'Torrentio')
                            # Parse seeders from Torrentio title format (👤 123)
                            title = stream.get('title', '')
                            if '👤' in title and not stream.get('seeders'):
                                import re
                                m = re.search(r'👤\s*(\d+)', title)
                                if m:
                                    stream['seeders'] = int(m.group(1))
                        logger.info(f"Got {len(streams)} streams from {manifest.get('name')} via allorigins proxy")
                        return streams
                    else:
                        logger.warning(f"Allorigins proxy got status {response.status_code} for {stream_url}")
                except Exception as e:
                    logger.warning(f"Allorigins proxy failed for {manifest.get('name')}: {e}")
                
                # Fallback to cloudscraper
                try:
                    import cloudscraper
                    scraper = cloudscraper.create_scraper(
                        browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
                    )
                    response = await asyncio.to_thread(
                        lambda: scraper.get(
                            stream_url,
                            timeout=15,
                            allow_redirects=False,
                        )
                    )
                    if response.status_code == 200:
                        data = response.json()
                        streams = data.get('streams', [])
                        for stream in streams:
                            stream['addon'] = manifest.get('name', 'Torrentio')
                        logger.info(f"Got {len(streams)} streams from {manifest.get('name')} via cloudscraper fallback")
                        return streams
                    else:
                        logger.warning(f"Cloudscraper got status {response.status_code} for {stream_url}")
                except Exception as e:
                    logger.warning(f"Cloudscraper failed for {manifest.get('name')}: {e}")
                return []
            else:
                # Standard fetch for non-protected addons
                async with httpx.AsyncClient(
                    follow_redirects=False,
                    timeout=20.0,
                    trust_env=False,
                ) as client:
                    response = await _v726_safe_addon_get(
                        client,
                        stream_url,
                        timeout=20.0,
                    )
                    if response.status_code == 200:
                        data = response.json()
                        streams = data.get('streams', [])
                        for stream in streams:
                            stream['addon'] = manifest.get('name', 'Unknown')
                        return streams
        except Exception as e:
            logger.warning(f"Error fetching streams from {addon.get('manifest', {}).get('name')}: {str(e)}")
        return []
    
    async def search_yts(query: str):
        """Search YTS/YIFY for movies"""
        # Simplify query - just first few words for better matching
        simple_query = ' '.join(query.split()[:3])
        params = {"query_term": simple_query, "limit": 20}
        
        urls = ["https://yts.mx/api/v2/list_movies.json"]
        
        for url in urls:
            try:
                async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                    response = await client.get(url, params=params)
                    if response.status_code == 200:
                        data = response.json()
                        movies = data.get('data', {}).get('movies', [])
                        if movies:
                            streams = []
                            for movie in movies:
                                for torrent in movie.get('torrents', []):
                                    streams.append({
                                        "name": f"🎬 YTS {torrent['quality']}",
                                        "title": f"YTS • {movie['title']} ({movie.get('year', '')})\n💾 {torrent['size']} | 🌱 {torrent['seeds']} | ⚡ {torrent['quality']}",
                                        "infoHash": torrent['hash'].lower(),
                                        "sources": ["tracker:http://tracker.opentrackr.org:1337/announce"],
                                        "addon": "YTS",
                                        "seeders": torrent['seeds']
                                    })
                            logger.info(f"YTS found {len(streams)} streams for '{simple_query}'")
                            return streams
            except Exception as e:
                logger.warning(f"YTS search error for {url}: {e}")
                continue
        return []
    
    async def search_eztv(imdb_id: str, season: str = None, episode: str = None):
        """Search EZTV for TV series - optionally filter by season/episode"""
        try:
            imdb_num = imdb_id.replace('tt', '') if imdb_id.startswith('tt') else imdb_id
            url = "https://eztv.re/api/get-torrents"
            params = {"imdb_id": imdb_num, "limit": 100}
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    data = response.json()
                    torrents = data.get('torrents', [])
                    streams = []
                    
                    # Build episode pattern to filter (e.g., S01E05, S1E5, 1x05)
                    episode_patterns = []
                    if season and episode:
                        s_padded = season.zfill(2)
                        e_padded = episode.zfill(2)
                        s_int = str(int(season))
                        e_int = str(int(episode))
                        episode_patterns = [
                            f"S{s_padded}E{e_padded}",  # S01E05
                            f"S{s_int}E{e_int}",        # S1E5
                            f"S{s_int}E{e_padded}",     # S1E05
                            f"S{s_padded}E{e_int}",     # S01E5
                            f"{s_int}x{e_padded}",       # 1x05
                        ]
                    
                    for torrent in torrents:
                        title = torrent.get('title', '')
                        
                        # If we have episode patterns, filter to only matching episodes
                        if episode_patterns:
                            title_upper = title.upper()
                            if not any(pat.upper() in title_upper for pat in episode_patterns):
                                continue
                        
                        quality = '4K' if '2160p' in title or '4K' in title else ('HD' if '1080p' in title or '720p' in title else 'SD')
                        size_bytes = int(torrent.get('size_bytes', 0))
                        size_str = f"{size_bytes / (1024*1024*1024):.2f} GB" if size_bytes > 1024*1024*1024 else f"{size_bytes / (1024*1024):.0f} MB"
                        seeds = torrent.get('seeds', 0)
                        info_hash = torrent.get('hash', '').lower()
                        if info_hash:
                            streams.append({
                                "name": f"📺 EZTV {quality}",
                                "title": f"EZTV • {title}\n💾 {size_str} | 🌱 {seeds} | ⚡ {quality}",
                                "infoHash": info_hash,
                                "sources": ["tracker:http://tracker.opentrackr.org:1337/announce"],
                                "addon": "EZTV",
                                "seeders": seeds
                            })
                    return streams
        except Exception as e:
            logger.warning(f"EZTV search error: {e}")
        return []
    
    async def search_apibay(query: str, content_type: str):
        """Search PirateBay via apibay.org"""
        import re
        
        async def do_search(search_query: str) -> list:
            try:
                url = f"https://apibay.org/q.php?q={search_query}"
                # Use cloudscraper to bypass ApiBay's bot detection
                response = None
                try:
                    import cloudscraper
                    scraper = cloudscraper.create_scraper(
                        browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
                    )
                    response = await asyncio.to_thread(
                        lambda: scraper.get(url, timeout=15)
                    )
                except Exception as cs_err:
                    logger.warning(f"ApiBay cloudscraper failed: {cs_err}, trying httpx")
                    # Fallback to httpx with browser UA
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                        "Accept": "application/json, text/javascript, */*; q=0.01",
                        "Referer": "https://thepiratebay.org/"
                    }
                    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True, headers=headers) as hclient:
                        response = await hclient.get(url)
                
                if response and response.status_code == 200:
                    torrents = response.json()
                    logger.info(f"ApiBay got {len(torrents)} items, first id: {torrents[0].get('id', '?') if isinstance(torrents, list) and len(torrents) > 0 else 'empty'}")
                    if isinstance(torrents, list) and len(torrents) > 0 and torrents[0].get('id') != '0':
                            streams = []
                            
                            # Adult content keywords to filter out
                            adult_keywords = [
                                'xxx', 'porn', 'adult', 'herlimit', 'blacked', 'vixen', 'tushy',
                                'brazzers', 'bangbros', 'naughty', 'milf', 'stepmom', 'stepsister',
                                'onlyfans', 'leaked', 'nude', 'naked', 'sex tape', 'hardcore',
                                'deepthroat', 'blowjob', 'handjob', 'anal', 'creampie', 'gangbang',
                                'threesome', 'orgy', 'escort', 'hooker', 'slut', 'whore',
                                'hentai', 'rule34', 'sfm', 'pornfidelity', 'realitykings',
                                'wwe', 'wrestling', 'aew', 'raw', 'smackdown'
                            ]
                            
                            for torrent in torrents[:20]:
                                name = torrent.get('name', '')
                                name_lower = name.lower()
                                
                                # Skip adult content
                                if any(kw in name_lower for kw in adult_keywords):
                                    logger.debug(f"Filtered adult/unrelated content: {name[:50]}")
                                    continue
                                
                                # VALIDATE: Check that the torrent name actually matches our search query
                                # Split the search query into key words and check at least 2 match
                                query_words = [w.lower() for w in search_query.split() if len(w) > 2 and not w.isdigit()]
                                if query_words:
                                    matching_words = sum(1 for w in query_words if w in name_lower)
                                    # Need at least half the query words to match, minimum 1
                                    min_matches = max(1, len(query_words) // 2)
                                    if matching_words < min_matches:
                                        logger.debug(f"Filtered non-matching torrent: '{name[:50]}' (matched {matching_words}/{len(query_words)} words of '{search_query}')")
                                        continue
                                
                                size_bytes = int(torrent.get('size', 0))
                                size_str = f"{size_bytes / (1024*1024*1024):.2f} GB" if size_bytes > 1024*1024*1024 else f"{size_bytes / (1024*1024):.0f} MB"
                                seeds = int(torrent.get('seeders', 0))
                                info_hash = torrent.get('info_hash', '').lower()
                                quality = '4K' if '2160p' in name or '4K' in name else ('HD' if '1080p' in name or '720p' in name else 'SD')
                                if info_hash and seeds > 0:
                                    streams.append({
                                        "name": f"🏴‍☠️ TPB {quality}",
                                        "title": f"ThePirateBay • {name[:60]}\n💾 {size_str} | 🌱 {seeds} | ⚡ {quality}",
                                        "infoHash": info_hash,
                                        "sources": ["tracker:http://tracker.opentrackr.org:1337/announce"],
                                        "addon": "ThePirateBay",
                                        "seeders": seeds
                                    })
                            return streams
            except Exception as e:
                logger.warning(f"ApiBay search error for '{search_query}': {e}")
            return []
        
        # Clean up query - remove special characters
        clean_query = re.sub(r'[^\w\s]', '', query)
        words = clean_query.split()
        
        # Try with full query first (up to 5 words)
        full_query = ' '.join(words[:5])
        logger.info(f"ApiBay searching: '{full_query}'")
        streams = await do_search(full_query)
        
        # If no results and query has year, try without year
        if not streams and len(words) > 2:
            # Check if last word is a year
            if words[-1].isdigit() and len(words[-1]) == 4:
                short_query = ' '.join(words[:-1][:4])
                logger.info(f"ApiBay retry without year: '{short_query}'")
                streams = await do_search(short_query)
        
        # If still no results, try with just first 3 words
        if not streams and len(words) > 3:
            shorter_query = ' '.join(words[:3])
            logger.info(f"ApiBay retry shorter: '{shorter_query}'")
            streams = await do_search(shorter_query)
        
        if streams:
            logger.info(f"ApiBay found {len(streams)} streams")
        return streams
    
    async def search_torrentio(content_type: str, content_id: str):
        """Search Torrentio addon for streams - aggregates YTS, RARBG, 1337x, etc."""
        try:
            # Torrentio URL with optimized settings
            # sort=seeders - sort by most seeders
            # qualityfilter=480p,scr,cam - filter out low quality
            torrentio_config = "sort=seeders|qualityfilter=480p,scr,cam"
            base_url = f"https://torrentio.strem.fun/{torrentio_config}"
            target_url = f"{base_url}/stream/{content_type}/{content_id}.json"
            
            # Use allorigins.win proxy to bypass Cloudflare (server IP is blocked)
            import urllib.parse
            encoded_url = urllib.parse.quote(target_url, safe='')
            proxy_url = f"https://api.allorigins.win/raw?url={encoded_url}"
            
            try:
                client = await get_shared_http_client()
                response = await client.get(proxy_url, timeout=20)
                
                if response.status_code == 200:
                    data = response.json()
                    raw_streams = data.get('streams', [])
                    streams = []
                    
                    for stream in raw_streams:
                        # Parse Torrentio stream format
                        name = stream.get('name', '')
                        title = stream.get('title', '')
                        
                        # Extract infoHash from various formats
                        info_hash = None
                        behavior_hints = stream.get('behaviorHints', {})
                        
                        if 'infoHash' in stream:
                            info_hash = stream['infoHash'].lower()
                        elif behavior_hints.get('bingeGroup'):
                            binge = behavior_hints.get('bingeGroup', '')
                            if len(binge) == 40:
                                info_hash = binge.lower()
                        
                        # Also check URL for magnet
                        stream_url = stream.get('url', '')
                        if not info_hash and 'magnet:' in stream_url:
                            import re
                            hash_match = re.search(r'btih:([a-fA-F0-9]{40})', stream_url)
                            if hash_match:
                                info_hash = hash_match.group(1).lower()
                        
                        # Parse seeders from title (Torrentio format: "👤 123")
                        seeders = 0
                        if '👤' in title:
                            import re
                            seeder_match = re.search(r'👤\s*(\d+)', title)
                            if seeder_match:
                                seeders = int(seeder_match.group(1))
                        
                        if info_hash:
                            # Determine quality from name
                            quality = '4K' if any(q in name.upper() for q in ['2160P', '4K', 'UHD']) else \
                                     '1080p' if '1080P' in name.upper() else \
                                     '720p' if '720P' in name.upper() else 'SD'
                            
                            streams.append({
                                "name": f"⚡ {name}",
                                "title": title,
                                "infoHash": info_hash,
                                "sources": ["tracker:http://tracker.opentrackr.org:1337/announce"],
                                "addon": "Torrentio",
                                "seeders": seeders,
                                "quality": quality
                            })
                    
                    logger.info(f"Torrentio found {len(streams)} streams for {content_type}/{content_id}")
                    return streams
                else:
                    logger.warning(f"Torrentio proxy returned status {response.status_code}")
            except Exception as e:
                logger.warning(f"Torrentio proxy error: {e}")
            
            # Fallback: try cloudscraper directly (in case proxy is down)
            try:
                import cloudscraper
                scraper = cloudscraper.create_scraper(
                    browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
                )
                response = await asyncio.to_thread(
                    lambda: scraper.get(target_url, timeout=15)
                )
                if response.status_code == 200:
                    data = response.json()
                    raw_streams = data.get('streams', [])
                    streams = []
                    for stream in raw_streams:
                        name = stream.get('name', '')
                        title = stream.get('title', '')
                        info_hash = stream.get('infoHash', '').lower() if stream.get('infoHash') else None
                        if not info_hash:
                            behavior_hints = stream.get('behaviorHints', {})
                            if behavior_hints.get('bingeGroup') and len(behavior_hints['bingeGroup']) == 40:
                                info_hash = behavior_hints['bingeGroup'].lower()
                        seeders = 0
                        if '👤' in title:
                            import re
                            m = re.search(r'👤\s*(\d+)', title)
                            if m: seeders = int(m.group(1))
                        if info_hash:
                            quality = '4K' if any(q in name.upper() for q in ['2160P', '4K', 'UHD']) else \
                                     '1080p' if '1080P' in name.upper() else \
                                     '720p' if '720P' in name.upper() else 'SD'
                            streams.append({
                                "name": f"⚡ {name}", "title": title, "infoHash": info_hash,
                                "sources": ["tracker:http://tracker.opentrackr.org:1337/announce"],
                                "addon": "Torrentio", "seeders": seeders, "quality": quality
                            })
                    logger.info(f"Torrentio (cloudscraper fallback) found {len(streams)} streams")
                    return streams
                else:
                    logger.warning(f"Torrentio cloudscraper returned status {response.status_code}")
            except Exception as e:
                logger.warning(f"Torrentio cloudscraper fallback error: {e}")
        except Exception as e:
            logger.warning(f"Torrentio search error: {e}")
        return []
    
    async def search_mediafusion(content_type: str, content_id: str):
        """Search MediaFusion for streams - works when Torrentio is blocked"""
        try:
            # MediaFusion public config for P2P torrents
            config = "D-4C4xWmNTkZh5t3IFgCpKntBlt_LgQMQ2VCAsNiaiTXduH23xKZmif4pvOIpYtRe9AadLhw5GfD6T6NaBWkZndxjLMS4LYpupSq8A_V-Isgk"
            url = f"https://mediafusion.elfhosted.com/{config}/stream/{content_type}/{content_id}.json"
            
            async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    streams = data.get('streams', [])
                    for stream in streams:
                        stream['addon'] = 'MediaFusion'
                    logger.info(f"MediaFusion found {len(streams)} streams")
                    return streams
        except Exception as e:
            logger.warning(f"MediaFusion error: {e}")
        return []
    
    async def search_comet(content_type: str, content_id: str):
        """Search Comet for streams - excellent Torrentio alternative"""
        try:
            # Comet public P2P config
            config = "eyJtYXhSZXN1bHRzUGVyUmVzb2x1dGlvbiI6MCwibWF4U2l6ZSI6MCwiY2FjaGVkT25seSI6ZmFsc2UsInJlbW92ZVRyYXNoIjp0cnVlLCJyZXN1bHRGb3JtYXQiOlsiYWxsIl0sImRlYnJpZFNlcnZpY2UiOiJ0b3JyZW50IiwiZGVicmlkQXBpS2V5IjoiIiwiZGVicmlkU3RyZWFtUHJveHlQYXNzd29yZCI6IiIsImxhbmd1YWdlcyI6eyJyZXF1aXJlZCI6WyJlbiJdLCJleGNsdWRlIjpbXSwicHJlZmVycmVkIjpbImVuIl19LCJyZXNvbHV0aW9ucyI6e30sIm9wdGlvbnMiOnsicmVtb3ZlX3JhbmtzX3VuZGVyIjotMTAwMDAwMDAwMDAsImFsbG93X2VuZ2xpc2hfaW5fbGFuZ3VhZ2VzIjpmYWxzZSwicmVtb3ZlX3Vua25vd25fbGFuZ3VhZ2VzIjpmYWxzZX19"
            url = f"https://comet.elfhosted.com/{config}/stream/{content_type}/{content_id}.json"
            
            async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    streams = data.get('streams', [])
                    for stream in streams:
                        stream['addon'] = 'Comet'
                    logger.info(f"Comet found {len(streams)} streams")
                    return streams
        except Exception as e:
            logger.warning(f"Comet error: {e}")
        return []
    
    # Build tasks
    tasks = []
    
    # Add addon stream fetches
    for addon in addons:
        tasks.append(fetch_addon_streams(addon))
    
    # Add built-in stream aggregators as fallbacks
    # These are essential because Torrentio/TPB are frequently blocked by Cloudflare (403)
    tasks.append(search_mediafusion(content_type, content_id))
    tasks.append(search_comet(content_type, content_id))
    
    # Try Torrentio but it may be blocked by Cloudflare
    tasks.append(search_torrentio(content_type, content_id))
    
    # Add built-in torrent searches if we have content info
    if content_title:
        # Build search query
        base_id = content_id.split(':')[0]
        
        if content_type == 'movie':
            search_query = f"{content_title} {content_year}" if content_year else content_title
            tasks.append(search_yts(search_query))
            tasks.append(search_apibay(search_query, content_type))
        elif content_type == 'series':
            # For series, check if we have season/episode
            ep_season = None
            ep_episode = None
            if ':' in content_id:
                parts = content_id.split(':')
                if len(parts) >= 3:
                    ep_season = parts[1]
                    ep_episode = parts[2]
                    season = parts[1].zfill(2)
                    episode = parts[2].zfill(2)
                    search_query = f"{content_title} S{season}E{episode}"
                else:
                    search_query = content_title
            else:
                search_query = content_title
            
            tasks.append(search_eztv(base_id, ep_season, ep_episode))
            tasks.append(search_apibay(search_query, content_type))
    
    # Execute all tasks concurrently
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for result in results:
        if isinstance(result, list):
            all_streams.extend(result)
    
    # For series with episode ID, filter streams to only include matching episode
    if content_type == 'series' and ':' in content_id:
        parts = content_id.split(':')
        if len(parts) >= 3:
            target_season = parts[1].zfill(2)
            target_episode = parts[2].zfill(2)
            s_int = str(int(parts[1]))
            e_int = str(int(parts[2]))
            
            # Create patterns that match this specific episode
            episode_patterns = [
                f"S{target_season}E{target_episode}",  # S01E05
                f"S{s_int}E{e_int}",                    # S1E5
                f"S{s_int}E{target_episode}",           # S1E05
                f"S{target_season}E{e_int}",            # S01E5
                f"{s_int}x{target_episode}",            # 1x05
                f"SEASON {s_int} EPISODE {e_int}",      # Season 1 Episode 5
            ]
            
            # Also create patterns for wrong episodes to explicitly reject
            # This catches streams that are clearly for a different episode
            def is_wrong_episode(title_upper):
                import re
                # Look for SxxEyy patterns
                matches = re.findall(r'S(\d{1,2})E(\d{1,2})', title_upper)
                for m in matches:
                    found_s, found_e = m
                    if found_s.zfill(2) != target_season or found_e.zfill(2) != target_episode:
                        return True
                # Look for 1x05 patterns
                matches = re.findall(r'(\d{1,2})X(\d{1,2})', title_upper)
                for m in matches:
                    found_s, found_e = m
                    if found_s.zfill(2) != target_season or found_e.zfill(2) != target_episode:
                        return True
                return False
            
            filtered_streams = []
            for stream in all_streams:
                title = stream.get('title', '').upper()
                name = stream.get('name', '').upper()
                combined = title + ' ' + name
                
                # First check if it's explicitly wrong episode
                if is_wrong_episode(combined):
                    continue
                
                # Then check if it matches the target (or has no episode info)
                has_episode_info = any(pat.upper() in combined for pat in ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', '1X', '2X', '3X', '4X', '5X'])
                matches_target = any(pat.upper() in combined for pat in episode_patterns)
                
                if matches_target or not has_episode_info:
                    filtered_streams.append(stream)
            
            logger.info(f"Episode filter: {len(all_streams)} -> {len(filtered_streams)} streams for S{target_season}E{target_episode}")
            all_streams = filtered_streams
    
    # Remove duplicates based on infoHash
    seen_hashes = set()
    unique_streams = []
    for stream in all_streams:
        hash_val = stream.get('infoHash', '').lower()
        if hash_val:
            if hash_val not in seen_hashes:
                seen_hashes.add(hash_val)
                unique_streams.append(stream)
        else:
            # Streams without hash (direct URLs)
            unique_streams.append(stream)
    
    # Sort by: 1) Language (English first), 2) Quality tier, 3) Seeders
    # Non-English language indicators to detect foreign streams
    FOREIGN_INDICATORS = [
        # Language flags
        '\U0001F1E7\U0001F1F7',  # 🇧🇷 Brazil
        '\U0001F1F2\U0001F1FD',  # 🇲🇽 Mexico
        '\U0001F1EB\U0001F1F7',  # 🇫🇷 France
        '\U0001F1EA\U0001F1F8',  # 🇪🇸 Spain
        '\U0001F1EE\U0001F1F9',  # 🇮🇹 Italy
        '\U0001F1E9\U0001F1EA',  # 🇩🇪 Germany
        '\U0001F1F7\U0001F1FA',  # 🇷🇺 Russia
        '\U0001F1F5\U0001F1F9',  # 🇵🇹 Portugal
        '\U0001F1F5\U0001F1F1',  # 🇵🇱 Poland
        '\U0001F1F3\U0001F1F1',  # 🇳🇱 Netherlands
        '\U0001F1E8\U0001F1F3',  # 🇨🇳 China
        '\U0001F1EF\U0001F1F5',  # 🇯🇵 Japan
        '\U0001F1F0\U0001F1F7',  # 🇰🇷 Korea
        '\U0001F1EE\U0001F1F3',  # 🇮🇳 India
        '\U0001F1F9\U0001F1F7',  # 🇹🇷 Turkey
    ]
    FOREIGN_KEYWORDS = [
        'FRENCH', 'TRUEFRENCH', 'VF2', 'VFF', 'VOSTFR', 'VFQ', 'SUBFRENCH',
        'SPANISH', 'LATINO', 'CASTELLANO', 'LAT.DUB', 'LATIN',
        'GERMAN', 'DEUTSCH',
        'ITALIAN', 'ITALIANO',
        'RUSSIAN', 'DUBBED', 'DUB.', 'DUBLADO',
        'PORTUGUESE', 'HINDI', 'TAMIL', 'TELUGU',
        'KOREAN', 'JAPANESE', 'CHINESE', 'MANDARIN', 'CANTONESE',
        'TURKISH', 'ARABIC', 'POLISH', 'DUTCH', 'CZECH', 'ROMANIAN',
        'THAI', 'INDONESIAN', 'MALAY', 'VIETNAMESE', 'SWEDISH', 'DANISH',
        'NORWEGIAN', 'FINNISH', 'GREEK', 'HUNGARIAN', 'SERBIAN', 'CROATIAN',
        'MULTI.AUDIO', 'DUAL.AUDIO', 'MULTI',
        'Cinecalidad', 'Comando',  # Known Spanish release groups
    ]
    
    def get_sort_score(stream):
        # Extract seeders
        seeders = 0
        if 'seeders' in stream:
            try:
                seeders = int(stream['seeders']) if stream['seeders'] else 0
            except:
                seeders = 0
        title = stream.get('title', '')
        name = stream.get('name', '')
        try:
            if '👤' in title:
                import re
                match = re.search(r'👤\s*(\d+)', title)
                if match:
                    seeders = int(match.group(1))
            elif '🌱' in title:
                seeds_part = title.split('🌱')[1].split('|')[0].strip()
                seeders = int(seeds_part)
        except:
            pass
        
        combined_text = name + ' ' + title
        combined_upper = combined_text.upper()
        
        # Language score: 100 = English/Unknown, 0 = Foreign
        is_foreign = False
        for flag in FOREIGN_INDICATORS:
            if flag in combined_text:
                is_foreign = True
                break
        if not is_foreign:
            for kw in FOREIGN_KEYWORDS:
                if kw.upper() in combined_upper:
                    is_foreign = True
                    break
        
        # Check for English indicator (🇬🇧 flag, ENG keyword, or EN/ language tag)
        has_english = '\U0001F1EC\U0001F1E7' in combined_text or 'ENGLISH' in combined_upper or \
            'EN/' in combined_upper or '/EN' in combined_upper or \
            '\U0001F1FA\U0001F1F8' in combined_text  # 🇺🇸 US flag
        
        lang_score = 0 if is_foreign else 100
        if has_english:
            lang_score = 100  # Force English even if also tagged with another language
        
        # Quality tier (higher is better)
        quality_score = 0
        if '2160P' in combined_upper or '4K' in combined_upper or 'UHD' in combined_upper:
            quality_score = 4
        elif '1080P' in combined_upper:
            quality_score = 3
        elif '720P' in combined_upper:
            quality_score = 2
        elif 'SD' in combined_upper or '480P' in combined_upper:
            quality_score = 1
        elif 'CAM' in combined_upper or 'TELESYNC' in combined_upper or 'TS' in combined_upper:
            quality_score = 0  # Lowest quality
        else:
            quality_score = 2  # Default to 720p tier
        
        # Combined score: language first, then seeders, then quality as tiebreaker
        # English streams always on top, then sorted by most seeds
        return (lang_score * 10000000) + (min(seeders, 99999) * 100) + quality_score
    
    unique_streams.sort(key=get_sort_score, reverse=True)
    
    logger.info(f"Found {len(unique_streams)} total streams for {content_type}/{content_id}")
    
    # Cache the result (30 second TTL for streams - short to reflect sorting changes)
    result_data = {"streams": unique_streams}
    _discover_cache[stream_cache_key] = {
        "data": result_data,
        "expires": datetime.utcnow() + timedelta(seconds=30)
    }
    
    return result_data


# ==================== SUBTITLES ====================

@api_router.get("/subtitles/{content_type}/{content_id:path}")
async def get_subtitles(content_type: str, content_id: str, current_user: User = Depends(get_current_user)):
    """Get subtitles from OpenSubtitles addon"""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            url = f"https://opensubtitles-v3.strem.io/subtitles/{content_type}/{content_id}.json"
            response = await client.get(url)
            
            if response.status_code == 200:
                data = response.json()
                subtitles = data.get('subtitles', [])
                
                # Language code to name mapping
                lang_names = {
                    'eng': 'English', 'spa': 'Spanish', 'fre': 'French', 'ger': 'German',
                    'ita': 'Italian', 'por': 'Portuguese', 'rus': 'Russian', 'jpn': 'Japanese',
                    'chi': 'Chinese', 'kor': 'Korean', 'ara': 'Arabic', 'hin': 'Hindi',
                    'dut': 'Dutch', 'pol': 'Polish', 'tur': 'Turkish', 'vie': 'Vietnamese',
                    'tha': 'Thai', 'swe': 'Swedish', 'nor': 'Norwegian', 'dan': 'Danish',
                    'fin': 'Finnish', 'heb': 'Hebrew', 'cze': 'Czech', 'hun': 'Hungarian',
                    'rum': 'Romanian', 'gre': 'Greek', 'bul': 'Bulgarian', 'ukr': 'Ukrainian',
                    'ind': 'Indonesian', 'may': 'Malay', 'hrv': 'Croatian', 'srp': 'Serbian'
                }
                
                # Process and organize by language
                processed = []
                seen_langs = set()
                
                for sub in subtitles:
                    lang = sub.get('lang', 'unknown')
                    lang_name = lang_names.get(lang, lang.upper())
                    
                    # Only include first subtitle per language (best rated)
                    if lang not in seen_langs:
                        processed.append({
                            'id': sub.get('id'),
                            'url': sub.get('url'),
                            'lang': lang,
                            'langName': lang_name
                        })
                        seen_langs.add(lang)
                
                # Sort with English first, then alphabetically
                processed.sort(key=lambda x: (0 if x['lang'] == 'eng' else 1, x['langName']))
                
                logger.info(f"Found {len(processed)} subtitle languages for {content_type}/{content_id}")
                return {"subtitles": processed}
            else:
                logger.warning(f"OpenSubtitles returned {response.status_code}")
                return {"subtitles": []}
    except Exception as e:
        logger.error(f"Subtitles error: {str(e)}")
        return {"subtitles": []}


# ==================== V704 PARENTAL CONTROLS ====================
def _v704_is_adult_addon(manifest: dict, manifest_url: str = "") -> bool:
    """Classify explicitly adult addon catalogs without guessing from movie ratings."""
    manifest = manifest or {}

    hints = manifest.get("behaviorHints") or {}
    if isinstance(hints, dict):
        adult_hint = hints.get("adult")
        if adult_hint is True or str(adult_hint).strip().lower() == "true":
            return True

    addon_id = str(manifest.get("id") or "").strip().lower()

    known_adult_ids = {
        "org.stremio.porn",
        "pw.ers.porntube",
        "stremio_porn_plus",
    }

    if addon_id in known_adult_ids:
        return True

    for prefix in manifest.get("idPrefixes") or []:
        p = str(prefix or "").strip().lower()
        if p.startswith("porn_") or p.startswith("porn_id"):
            return True

    for catalog in manifest.get("catalogs") or []:
        if not isinstance(catalog, dict):
            continue
        cid = str(catalog.get("id") or "").strip().lower()
        if cid.startswith("porn_") or cid.startswith("porn_id"):
            return True

    url = str(manifest_url or "").lower()
    known_adult_hosts = (
        "stremio-porn-jrm3.onrender.com",
        "dirty-pink.ers.pw",
        "1fe84bc728af-stremio-porn.baby-beamup.club",
        "07b88951aaab-jaxxx-v2.baby-beamup.club",
        "ptube.ers.pw",
    )

    return any(host in url for host in known_adult_hosts)


# ==================== CONTENT ROUTES ====================

@api_router.get("/content/discover-organized")
async def get_discover(adult: int = 0, current_user: User = Depends(get_current_user)):
    """Get discover page content from installed addons - organized by service.
    Uses parallel fetching and in-memory caching for speed."""
    
    # Check cache first
    # V704: Adult OFF is the safe/default request policy.
    adult_enabled = bool(adult == 1)
    cache_key = f"{current_user.id}:adult:{1 if adult_enabled else 0}"
    cached = _discover_cache.get(cache_key)
    if cached and cached["expires"] > datetime.utcnow():
        logger.info(f"Discover cache HIT for user {current_user.username}")
        return cached["data"]
    
    logger.info(f"Discover cache MISS - fetching fresh data for {current_user.username}")
    
    addons = await db.addons.find({"userId": current_user.id}).sort("installedAt", 1).to_list(100)
    
    result = {
        "continueWatching": [],
        "services": {}
    }
    
    if not addons:
        logger.info("No addons installed for user - returning empty discover")
        return result
    
    logger.info(f"Processing {len(addons)} installed addons for discover")
    
    # Service ID to display name mapping for Streaming Catalogs addon
    service_names = {
        'nfx': 'Netflix', 'dnp': 'Disney+', 'amp': 'Prime Video', 'hbm': 'HBO Max',
        'hlu': 'Hulu', 'pmp': 'Paramount+', 'atp': 'Apple TV+', 'pcp': 'Peacock', 'dpe': 'Discovery+'
    }
    
    # V608_CINEMETA_FEATURED_ROWS
    cinemeta_fetch = [
        ('movie', 'top', 'Popular Movies'),
        ('series', 'top', 'Popular Series'),
        ('movie', 'imdbRating', 'Featured Movies'),
        ('series', 'imdbRating', 'Featured Series'),
    ]
    
    # Build list of ALL fetch tasks to run in parallel
    fetch_tasks = []
    task_metadata = []  # Track what each task is for
    
    http_client = await get_shared_http_client()
    
    async def fetch_catalog(url: str) -> list:
        """Fetch a single catalog URL and return metas"""
        try:
            response = await _v726_safe_addon_get(
                http_client,
                url,
                timeout=15.0,
            )
            if response.status_code == 200:
                return response.json().get('metas', [])
        except Exception as e:
            logger.warning(f"Fetch failed for {url}: {e}")
        return []
    
    # V727A1_ADULT_CATALOG_RETRY
    # Some adult addon providers intermittently return an empty
    # catalog response. Retry an empty adult catalog once only.
    async def fetch_adult_catalog(url: str) -> list:
        metas = await fetch_catalog(url)
        if metas:
            return metas

        # V727A3_REDTUBE_FRESH_CLIENT_RETRY
        # Porn+ currently has an unhealthy origin behind Cloudflare.
        # The shared keep-alive connection repeatedly receives HTTP 500,
        # while fresh connections can receive Cloudflare's stale cached
        # 100-item catalog. Restrict this fallback to the exact approved
        # Porn+ addon host; other adult providers keep the cheap one-retry
        # behavior.
        porn_plus_host = "1fe84bc728af-stremio-porn.baby-beamup.club"

        if porn_plus_host not in url.lower():
            await asyncio.sleep(0.20)
            return await fetch_catalog(url)

        retry_delays = (
            0.0,
            0.20,
            0.40,
            0.75,
            1.25,
            2.0,
            3.0,
            4.0,
        )

        for attempt, delay in enumerate(retry_delays, start=1):
            if delay:
                await asyncio.sleep(delay)

            try:
                async with httpx.AsyncClient(
                    follow_redirects=False,
                    timeout=15.0,
                    trust_env=False,
                    headers={
                        "Accept": "application/json,text/plain,*/*",
                        "User-Agent": "PrivastreamCinema/1.0",
                    },
                ) as fresh_client:
                    response = await _v726_safe_addon_get(
                        fresh_client,
                        url,
                        timeout=15.0,
                    )

                if response.status_code == 200:
                    data = response.json()
                    fresh_metas = data.get('metas', [])

                    if fresh_metas:
                        logger.info(
                            "V727A3 RedTube catalog recovered on fresh attempt %s",
                            attempt,
                        )
                        return fresh_metas

                logger.warning(
                    "V727A3 RedTube fresh attempt %s returned status=%s",
                    attempt,
                    response.status_code,
                )

            except Exception as e:
                logger.warning(
                    "V727A3 RedTube fresh attempt %s failed: %s",
                    attempt,
                    type(e).__name__,
                )

        logger.warning(
            "V727A3 RedTube catalog unavailable after fresh-client retries"
        )
        return []

    # V727A2_GENERIC_CATALOG_ROWS
    # De-duplicate identical installed catalog sources while preserving
    # distinct catalogs as distinct Discover rows.
    seen_generic_catalogs = set()
    used_generic_section_names = set()

    for addon in addons:
        manifest = addon.get('manifest', {})

        # V704_PARENTAL_CONTROLS
        # Do not create catalog fetch tasks for explicitly adult
        # addons unless Adult Content is enabled for this request.
        if (
            not adult_enabled
            and _v704_is_adult_addon(
                manifest,
                addon.get('manifestUrl', '')
            )
        ):
            logger.info(
                f"[V704] Adult addon suppressed for {current_user.username}: "
                f"{manifest.get('id', 'unknown')}"
            )
            continue

        addon_id = manifest.get('id', '').lower()
        addon_name = manifest.get('name', 'Unknown')
        base_url = get_base_url(addon['manifestUrl'])
        catalogs = manifest.get('catalogs', [])
        
        # Handle Cinemeta addon
        if 'cinemeta' in addon_id:
            for fetch_config in cinemeta_fetch:
                catalog_type = fetch_config[0]
                catalog_id = fetch_config[1]
                section_name = fetch_config[2]
                extra_param = fetch_config[3] if len(fetch_config) > 3 else None
                
                if extra_param:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}/{extra_param}.json"
                else:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                
                fetch_tasks.append(fetch_catalog(url))
                task_metadata.append({
                    "section": section_name,
                    "type": catalog_type,
                    "source": "cinemeta"
                })
        
        # Handle Streaming Catalogs addon
        elif 'netflix-catalog' in addon['manifestUrl'].lower() or 'streaming-catalogs' in addon_id:
            for catalog in catalogs:
                catalog_type = catalog.get('type', '')
                catalog_id = catalog.get('id', '')
                service_name = service_names.get(catalog_id)
                
                if not service_name or catalog_type not in ['movie', 'series']:
                    continue
                
                url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                type_label = 'Movies' if catalog_type == 'movie' else 'Series'
                section_name = f"{service_name} {type_label}"
                
                fetch_tasks.append(fetch_catalog(url))
                task_metadata.append({
                    "section": section_name,
                    "type": catalog_type,
                    "source": "streaming"
                })
        
        # Handle USA TV addon
        elif 'usatv' in addon['manifestUrl'].lower() or 'usatv' in addon_id:
            for catalog in catalogs:
                if catalog.get('type') == 'tv':
                    catalog_id = catalog.get('id', 'usatv')
                    url = f"{base_url}/catalog/tv/{catalog_id}.json"
                    
                    fetch_tasks.append(fetch_catalog(url))
                    task_metadata.append({
                        "section": "USA TV Channels",
                        "type": "tv",
                        "source": "usatv"
                    })
                    break
        
        # Generic addon handling
        else:
            for catalog in catalogs:
                catalog_type = catalog.get('type', '')
                catalog_id = catalog.get('id', '')
                catalog_name = catalog.get('name', addon_name)

                if not catalog_type or not catalog_id:
                    continue

                # V727A2_GENERIC_CATALOG_IDENTITY
                # Two install codes resolving to the same addon/catalog
                # must not duplicate the row.
                generic_identity = (
                    addon_id or base_url.lower(),
                    catalog_type,
                    catalog_id,
                )

                if generic_identity in seen_generic_catalogs:
                    logger.info(
                        "V727A2 duplicate generic catalog skipped: %s/%s/%s",
                        addon_id,
                        catalog_type,
                        catalog_id,
                    )
                    continue

                seen_generic_catalogs.add(generic_identity)

                section_name = str(
                    catalog_name or addon_name or catalog_id
                ).strip()

                if not section_name:
                    section_name = f"{addon_name} {catalog_id}"

                # Preserve separate rows if unrelated catalogs happen to
                # advertise the same human-readable display name.
                if section_name in used_generic_section_names:
                    candidate = f"{section_name} ({addon_name})"
                    if candidate in used_generic_section_names:
                        candidate = f"{section_name} [{catalog_id}]"
                    section_name = candidate

                used_generic_section_names.add(section_name)

                url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"

                is_adult_catalog = _v704_is_adult_addon(
                    manifest,
                    addon.get('manifestUrl', '')
                )

                if is_adult_catalog:
                    fetch_tasks.append(fetch_adult_catalog(url))
                else:
                    fetch_tasks.append(fetch_catalog(url))

                task_metadata.append({
                    "section": section_name,
                    "type": catalog_type,
                    "source": "generic",
                    "catalog_id": catalog_id,
                    "base_url": base_url,
                    "addon_id": addon_id,
                    "adult": is_adult_catalog,
                })

    # FIRE ALL FETCHES IN PARALLEL
    start_time = time.time()
    logger.info(f"Firing {len(fetch_tasks)} catalog fetches in parallel...")
    all_results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
    elapsed = time.time() - start_time
    logger.info(f"All {len(fetch_tasks)} fetches completed in {elapsed:.2f}s")
    
    # Process results
    for i, metas_result in enumerate(all_results):
        if isinstance(metas_result, Exception):
            logger.warning(f"Task {i} failed: {metas_result}")
            continue
        
        metas = metas_result
        meta = task_metadata[i]
        section_name = meta["section"]
        catalog_type = meta["type"]
        
        # V727A2_GENERIC_ROWS_100
        # Remove unusable provider shell records, then expose up to the
        # same 100-item row size already supported by Discover.
        if meta["source"] == "generic":
            metas = [
                m for m in metas
                if isinstance(m, dict)
                and m.get('name')
                and m.get('id')
            ]
            metas = metas[:100]
        
        if not metas:
            continue
        
        if section_name not in result['services']:
            result['services'][section_name] = {'movies': [], 'series': [], 'channels': []}
            if meta["source"] == "generic":
                result['services'][section_name]['_catalog_id'] = meta.get('catalog_id', '')
                result['services'][section_name]['_base_url'] = meta.get('base_url', '')
        
        if catalog_type == 'movie':
            result['services'][section_name]['movies'].extend(metas)
        elif catalog_type == 'series':
            result['services'][section_name]['series'].extend(metas)
        elif catalog_type == 'tv':
            result['services'][section_name]['channels'].extend(metas)
        
        logger.info(f"{meta['source']}: {len(metas)} items for {section_name}")
    
    # Cache the result
    _discover_cache[cache_key] = {
        "data": result,
        "expires": datetime.utcnow() + timedelta(seconds=DISCOVER_CACHE_TTL)
    }
    
    return result

@api_router.get("/content/category/{service_name}/{content_type}")
async def get_category_content(
    service_name: str,
    content_type: str,  # movies, series, channels
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user)
):
    """Fetch full category content from an addon with pagination"""
    # Get user's addons
    addons = await db.addons.find({"userId": current_user.id}).to_list(100)
    
    # First try to match by catalog name (for separate sections)
    # Handle naming patterns: "Netflix Movies" -> catalog "Netflix" with type "movie"
    # Strip " Movies", " Series", " Channels" suffix if present
    base_service_name = service_name
    if service_name.endswith(' Movies'):
        base_service_name = service_name[:-7]  # Remove " Movies"
    elif service_name.endswith(' Series'):
        base_service_name = service_name[:-7]  # Remove " Series"
    elif service_name.endswith(' Channels'):
        base_service_name = service_name[:-9]  # Remove " Channels"
    
    for addon in addons:
        manifest = addon.get('manifest', {})
        base_url = addon.get('manifestUrl', '').replace('/manifest.json', '')
        catalogs = manifest.get('catalogs', [])
        
        for catalog in catalogs:
            catalog_name = catalog.get('name', '')
            catalog_type = catalog.get('type', '')
            catalog_id = catalog.get('id', '')
            
            # Check if this catalog matches the service name (exact or base name)
            if catalog_name != service_name and catalog_name != base_service_name:
                continue
            
            # Match content type
            if content_type == 'movies' and catalog_type != 'movie':
                continue
            if content_type == 'series' and catalog_type != 'series':
                continue
            if content_type == 'channels' and catalog_type != 'tv':
                continue
            
            try:
                # Build URL with skip parameter for pagination
                if skip > 0:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}/skip={skip}.json"
                else:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                
                logger.info(f"Fetching category: {url}")
                
                async with httpx.AsyncClient(
                    follow_redirects=False,
                    timeout=30.0,
                    trust_env=False,
                ) as client:
                    response = await _v726_safe_addon_get(
                        client,
                        url,
                        timeout=30.0,
                    )
                    if response.status_code == 200:
                        metas = response.json().get('metas', [])
                        # Filter out items with empty names or IDs
                        metas = [m for m in metas if m.get('name') and m.get('id')]
                        
                        # Detect addons that don't support pagination
                        # If skip>0 and the first item matches what page 1 starts with,
                        # this addon returns the same data regardless of skip
                        if skip > 0 and len(metas) > 0:
                            # Quick check: fetch page 1 to compare
                            first_page_url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                            try:
                                first_resp = await _v726_safe_addon_get(
                                    client,
                                    first_page_url,
                                    timeout=30.0,
                                )
                                if first_resp.status_code == 200:
                                    first_metas = first_resp.json().get('metas', [])
                                    if first_metas and metas[0].get('id') == first_metas[0].get('id'):
                                        # Same first item = addon doesn't support skip
                                        logger.info(f"Addon {catalog_name} does not support pagination (duplicate results)")
                                        return {
                                            "items": [],
                                            "total": len(first_metas),
                                            "hasMore": False,
                                            "catalogId": catalog_id,
                                            "baseUrl": base_url
                                        }
                            except Exception:
                                pass
                        
                        total_available = len(metas)
                        page_items = metas[:limit]
                        
                        # hasMore = we got a full page of results (likely more available)
                        has_more = len(page_items) >= 20
                        
                        return {
                            "items": page_items, 
                            "total": skip + total_available, 
                            "hasMore": has_more,
                            "catalogId": catalog_id,
                            "baseUrl": base_url
                        }
            except Exception as e:
                logger.warning(f"Error fetching category {catalog_id}: {e}")
    
    # Fallback: match by addon name (old behavior)
    for addon in addons:
        manifest = addon.get('manifest', {})
        addon_name = manifest.get('name', 'Unknown')
        
        if addon_name != service_name:
            continue
            
        base_url = addon.get('manifestUrl', '').replace('/manifest.json', '')
        catalogs = manifest.get('catalogs', [])
        
        items = []
        for catalog in catalogs:
            catalog_type = catalog.get('type', '')
            catalog_id = catalog.get('id', '')
            
            # Match content type
            if content_type == 'movies' and catalog_type != 'movie':
                continue
            if content_type == 'series' and catalog_type != 'series':
                continue
            if content_type == 'channels' and catalog_type != 'tv':
                continue
                
            try:
                if skip > 0:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}/skip={skip}.json"
                else:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                
                async with httpx.AsyncClient(
                    follow_redirects=False,
                    timeout=30.0,
                    trust_env=False,
                ) as client:
                    response = await _v726_safe_addon_get(
                        client,
                        url,
                        timeout=30.0,
                    )
                    if response.status_code == 200:
                        metas = response.json().get('metas', [])
                        metas = [m for m in metas if m.get('name') and m.get('id')]
                        items.extend(metas)
            except Exception as e:
                logger.warning(f"Error fetching category {catalog_id}: {e}")
                
        return {
            "items": items[skip:skip+limit], 
            "total": len(items), 
            "hasMore": (skip + limit) < len(items)
        }
    
    return {"items": [], "total": 0, "hasMore": False}

@api_router.get("/content/search")
async def search_content(
    q: str,
    skip: int = 0,
    limit: int = 30,
    content_type: str = None,
    mode: str = "auto",
    current_user: User = Depends(get_current_user)
):
    """
    V711D_STREMIO_SEARCH

    Modes:
      auto      - genre -> exact title -> person -> regular title
      title     - Cinemeta title search only
      person    - TMDB person credits (cast + directing)
      cast      - TMDB cast credits only
      director  - TMDB directing credits only
      genre     - Cinemeta genre catalog

    Person searching is case-insensitive and no longer depends on whether
    the user capitalized a name.
    """
    import urllib.parse

    q = str(q or "").strip()

    if len(q) < 2:
        return {
            "movies": [],
            "series": [],
            "hasMore": False,
            "total": 0,
        }

    try:
        skip = max(0, int(skip or 0))
    except Exception:
        skip = 0

    try:
        limit = min(max(1, int(limit or 30)), 50)
    except Exception:
        limit = 30

    requested_mode = str(mode or "auto").strip().lower()

    valid_modes = {
        "auto",
        "title",
        "person",
        "cast",
        "director",
        "genre",
    }

    if requested_mode not in valid_modes:
        requested_mode = "auto"

    if content_type not in (None, "movie", "series"):
        content_type = None

    query_lower = q.lower().strip()

    STOP_WORDS = {
        "the", "a", "an", "and", "or", "of", "in",
        "on", "at", "to", "for", "is", "it",
    }

    GENRE_MAP = {
        "action": "Action",
        "comedy": "Comedy",
        "drama": "Drama",
        "horror": "Horror",
        "thriller": "Thriller",
        "romance": "Romance",
        "sci-fi": "Sci-Fi",
        "science fiction": "Sci-Fi",
        "fantasy": "Fantasy",
        "adventure": "Adventure",
        "animation": "Animation",
        "animated": "Animation",
        "documentary": "Documentary",
        "crime": "Crime",
        "mystery": "Mystery",
        "western": "Western",
        "musical": "Musical",
        "war": "War",
        "history": "History",
        "historical": "History",
        "biography": "Biography",
        "family": "Family",
        "sport": "Sport",
        "sports": "Sport",
        "music": "Music",
    }

    logger.info(
        f"[V711D] Search q='{q}' mode={requested_mode} "
        f"skip={skip} limit={limit} type={content_type}"
    )

    def _compact(value):
        return "".join(
            ch
            for ch in str(value or "").lower()
            if ch.isalnum()
        )

    def _score_title(item):
        name = str(item.get("name") or "").lower()
        compact_name = _compact(name)
        compact_query = _compact(q)

        if (
            compact_name
            and compact_query
            and compact_name == compact_query
        ):
            return 100

        words = query_lower.split()

        significant = [
            word
            for word in words
            if word not in STOP_WORDS and len(word) > 1
        ]

        if not significant:
            significant = words

        if name == query_lower:
            return 100

        if name.startswith(query_lower):
            return 95

        if query_lower in name:
            return 90

        if significant and all(word in name for word in significant):
            length_bonus = max(0, 20 - len(name.split()))
            return 80 + length_bonus

        return 0

    # ------------------------------------------------------------
    # Cinemeta title search
    # ------------------------------------------------------------

    async def _title_search():
        encoded = urllib.parse.quote(q, safe="")

        movie_url = (
            "https://v3-cinemeta.strem.io/"
            f"catalog/movie/top/search={encoded}.json"
        )

        series_url = (
            "https://v3-cinemeta.strem.io/"
            f"catalog/series/top/search={encoded}.json"
        )

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=15.0
        ) as client:

            movie_resp, series_resp = await asyncio.gather(
                client.get(movie_url),
                client.get(series_url),
                return_exceptions=True,
            )

        movies_raw = []
        series_raw = []

        if (
            not isinstance(movie_resp, Exception)
            and movie_resp.status_code == 200
        ):
            movies_raw = (
                movie_resp.json().get("metas", []) or []
            )

        if (
            not isinstance(series_resp, Exception)
            and series_resp.status_code == 200
        ):
            series_raw = (
                series_resp.json().get("metas", []) or []
            )

        exact_title = any(
            _compact(item.get("name")) == _compact(q)
            for item in (movies_raw + series_raw)
        )

        movie_scored = sorted(
            [
                (item, _score_title(item))
                for item in movies_raw
            ],
            key=lambda pair: -pair[1],
        )

        series_scored = sorted(
            [
                (item, _score_title(item))
                for item in series_raw
            ],
            key=lambda pair: -pair[1],
        )

        movies_all = [
            item
            for item, score in movie_scored
            if score > 0
        ]

        series_all = [
            item
            for item, score in series_scored
            if score > 0
        ]

        if content_type == "series":
            movies_all = []

        if content_type == "movie":
            series_all = []

        movies_page = movies_all[skip:skip + limit]
        series_page = series_all[skip:skip + limit]

        has_more = (
            skip + limit < len(movies_all)
            or skip + limit < len(series_all)
        )

        return {
            "movies": movies_page,
            "series": series_page,
            "hasMore": has_more,
            "total": len(movies_all) + len(series_all),
        }, exact_title

    # ------------------------------------------------------------
    # Cinemeta genre search
    # ------------------------------------------------------------

    async def _genre_search(genre_name):
        encoded_genre = urllib.parse.quote(
            str(genre_name),
            safe="-"
        )

        if skip > 0:
            movie_url = (
                "https://v3-cinemeta.strem.io/catalog/movie/top/"
                f"genre={encoded_genre}/skip={skip}.json"
            )

            series_url = (
                "https://v3-cinemeta.strem.io/catalog/series/top/"
                f"genre={encoded_genre}/skip={skip}.json"
            )
        else:
            movie_url = (
                "https://v3-cinemeta.strem.io/catalog/movie/top/"
                f"genre={encoded_genre}.json"
            )

            series_url = (
                "https://v3-cinemeta.strem.io/catalog/series/top/"
                f"genre={encoded_genre}.json"
            )

        movies = []
        series = []

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=20.0
        ) as client:

            tasks = []

            if content_type != "series":
                tasks.append(("movie", client.get(movie_url)))

            if content_type != "movie":
                tasks.append(("series", client.get(series_url)))

            responses = await asyncio.gather(
                *[task for _, task in tasks],
                return_exceptions=True,
            )

            for (kind, _), response in zip(tasks, responses):
                if (
                    isinstance(response, Exception)
                    or response.status_code != 200
                ):
                    continue

                metas = response.json().get("metas", []) or []

                if kind == "movie":
                    movies = metas[:limit]
                else:
                    series = metas[:limit]

        has_more = (
            len(movies) >= limit
            or len(series) >= limit
        )

        logger.info(
            f"[V711D] Genre '{genre_name}' -> "
            f"{len(movies)} movies / {len(series)} series"
        )

        return {
            "movies": movies,
            "series": series,
            "hasMore": has_more,
            "total": len(movies) + len(series),
        }

    # ------------------------------------------------------------
    # TMDB support
    # ------------------------------------------------------------

    tmdb_api_key = os.environ.get(
        "TMDB_API_KEY",
        ""
    ).strip()

    async def _tmdb_json(client, path, params=None):
        if not tmdb_api_key:
            return {}

        payload = dict(params or {})
        payload["api_key"] = tmdb_api_key

        response = await client.get(
            f"https://api.themoviedb.org/3{path}",
            params=payload,
        )

        response.raise_for_status()

        return response.json()

    async def _resolve_person(client, allow_partial=False):
        try:
            data = await _tmdb_json(
                client,
                "/search/person",
                {
                    "query": q,
                    "language": "en-US",
                    "page": 1,
                    "include_adult": "false",
                },
            )
        except Exception as exc:
            logger.warning(
                f"[V711D] TMDB person lookup failed for '{q}': {exc}"
            )
            return None, False

        results = data.get("results", []) or []

        exact = [
            person
            for person in results
            if str(person.get("name") or "").strip().lower()
            == query_lower
        ]

        if exact:
            return exact[0], True

        if allow_partial and results:
            return results[0], False

        return None, False

    # ------------------------------------------------------------
    # Stable in-process caches
    # ------------------------------------------------------------

    person_credit_cache = globals().setdefault(
        "_V711_PERSON_CREDIT_CACHE",
        {}
    )

    external_id_cache = globals().setdefault(
        "_V711_EXTERNAL_ID_CACHE",
        {}
    )

    async def _person_credits(client, person_id):
        now = time.time()

        cached = person_credit_cache.get(str(person_id))

        if cached:
            cached_at, payload = cached

            if now - cached_at < 3600:
                return payload

        payload = await _tmdb_json(
            client,
            f"/person/{person_id}/combined_credits",
            {"language": "en-US"},
        )

        person_credit_cache[str(person_id)] = (
            now,
            payload,
        )

        return payload

    async def _external_imdb_id(client, item):
        media_type = item.get("media_type")
        tmdb_id = item.get("id")

        if media_type not in ("movie", "tv") or not tmdb_id:
            return None

        cache_key = f"{media_type}:{tmdb_id}"

        if cache_key in external_id_cache:
            return external_id_cache[cache_key]

        try:
            path = (
                f"/movie/{tmdb_id}/external_ids"
                if media_type == "movie"
                else f"/tv/{tmdb_id}/external_ids"
            )

            data = await _tmdb_json(
                client,
                path,
            )

            imdb_id = str(
                data.get("imdb_id") or ""
            ).strip()

            if not imdb_id.startswith("tt"):
                imdb_id = None

        except Exception as exc:
            logger.debug(
                f"[V711D] external-id lookup failed "
                f"{media_type}/{tmdb_id}: {exc}"
            )

            imdb_id = None

        external_id_cache[cache_key] = imdb_id

        return imdb_id

    # ------------------------------------------------------------
    # Person ranking
    # ------------------------------------------------------------

    def _int_value(value, default=0):
        try:
            return int(value)
        except Exception:
            return default

    def _float_value(value, default=0.0):
        try:
            return float(value)
        except Exception:
            return default

    def _year_value(item):
        raw = (
            item.get("release_date")
            or item.get("first_air_date")
            or ""
        )

        try:
            return int(str(raw)[:4])
        except Exception:
            return 0

    def _is_self_credit(item):
        character = str(
            item.get("character") or ""
        ).strip().lower()

        if not character:
            return False

        return (
            character.startswith("self")
            or "himself" in character
            or "herself" in character
            or "archive footage" in character
            or "archive audio" in character
        )

    def _dedupe(items, role):
        deduped = {}

        for original in items:
            if original.get("media_type") not in ("movie", "tv"):
                continue

            tmdb_id = original.get("id")

            if not tmdb_id:
                continue

            item = dict(original)
            item["_v711_role"] = role

            key = (
                item.get("media_type"),
                tmdb_id,
            )

            previous = deduped.get(key)

            if previous is None:
                deduped[key] = item
                continue

            if item.get("media_type") == "tv":
                if _int_value(item.get("episode_count")) > _int_value(
                    previous.get("episode_count")
                ):
                    deduped[key] = item
            else:
                new_order = _int_value(
                    item.get("order"),
                    999
                )

                old_order = _int_value(
                    previous.get("order"),
                    999
                )

                if new_order < old_order:
                    deduped[key] = item

        return list(deduped.values())

    def _role_priority(item, preferred_role):
        role = item.get("_v711_role")

        return 0 if role == preferred_role else 1

    def _movie_rank(item, preferred_role):
        role = item.get("_v711_role")

        self_penalty = (
            3
            if role == "cast" and _is_self_credit(item)
            else 0
        )

        character = str(
            item.get("character") or ""
        ).strip()

        empty_character_penalty = (
            1
            if role == "cast" and not character
            else 0
        )

        if role == "director":
            role_bucket = 0
        else:
            order = _int_value(
                item.get("order"),
                999
            )

            if order <= 2:
                role_bucket = 0
            elif order <= 5:
                role_bucket = 1
            elif order < 999:
                role_bucket = 2
            else:
                role_bucket = 3

        return (
            _role_priority(item, preferred_role),
            self_penalty,
            empty_character_penalty,
            role_bucket,
            -_int_value(item.get("vote_count")),
            -_float_value(item.get("popularity")),
            -_year_value(item),
            str(
                item.get("title")
                or item.get("name")
                or ""
            ).lower(),
        )

    def _series_rank(item, preferred_role):
        role = item.get("_v711_role")

        self_penalty = (
            3
            if role == "cast" and _is_self_credit(item)
            else 0
        )

        character = str(
            item.get("character") or ""
        ).strip()

        empty_character_penalty = (
            1
            if role == "cast" and not character
            else 0
        )

        episodes = _int_value(
            item.get("episode_count")
        )

        return (
            _role_priority(item, preferred_role),
            self_penalty,
            empty_character_penalty,
            -episodes,
            -_int_value(item.get("vote_count")),
            -_float_value(item.get("popularity")),
            -_year_value(item),
            str(
                item.get("name")
                or item.get("title")
                or ""
            ).lower(),
        )

    async def _person_search(person, person_mode):
        person_id = person.get("id")
        person_name = str(
            person.get("name") or q
        )

        known_department = str(
            person.get("known_for_department") or ""
        ).strip().lower()

        if not person_id:
            return {
                "movies": [],
                "series": [],
                "hasMore": False,
                "total": 0,
            }

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=15.0
        ) as client:

            credits = await _person_credits(
                client,
                person_id,
            )

            cast_all = _dedupe(
                credits.get("cast", []) or [],
                "cast",
            )

            directors_raw = [
                credit
                for credit in (credits.get("crew", []) or [])
                if str(
                    credit.get("job") or ""
                ).strip().lower() == "director"
            ]

            director_all = _dedupe(
                directors_raw,
                "director",
            )

            if person_mode == "cast":
                combined = cast_all
                preferred_role = "cast"

            elif person_mode == "director":
                combined = director_all
                preferred_role = "director"

            else:
                preferred_role = (
                    "director"
                    if known_department == "directing"
                    else "cast"
                )

                combined_map = {}

                primary = (
                    director_all
                    if preferred_role == "director"
                    else cast_all
                )

                secondary = (
                    cast_all
                    if preferred_role == "director"
                    else director_all
                )

                for item in primary + secondary:
                    key = (
                        item.get("media_type"),
                        item.get("id"),
                    )

                    if key not in combined_map:
                        combined_map[key] = item

                combined = list(
                    combined_map.values()
                )

            movies_all = [
                item
                for item in combined
                if item.get("media_type") == "movie"
            ]

            series_all = [
                item
                for item in combined
                if item.get("media_type") == "tv"
            ]

            movies_all.sort(
                key=lambda item: _movie_rank(
                    item,
                    preferred_role,
                )
            )

            series_all.sort(
                key=lambda item: _series_rank(
                    item,
                    preferred_role,
                )
            )

            if content_type == "series":
                movies_all = []

            if content_type == "movie":
                series_all = []

            movie_slice = movies_all[
                skip:skip + limit
            ]

            series_slice = series_all[
                skip:skip + limit
            ]

            semaphore = asyncio.Semaphore(12)

            async def convert(item):
                async with semaphore:
                    imdb_id = await _external_imdb_id(
                        client,
                        item,
                    )

                if not imdb_id:
                    return None

                media_type = item.get("media_type")

                name = str(
                    item.get("title")
                    or item.get("name")
                    or item.get("original_title")
                    or item.get("original_name")
                    or ""
                ).strip()

                poster_path = str(
                    item.get("poster_path") or ""
                ).strip()

                poster = (
                    "https://image.tmdb.org/t/p/w500"
                    + poster_path
                    if poster_path
                    else ""
                )

                raw_date = str(
                    item.get("release_date")
                    or item.get("first_air_date")
                    or ""
                )

                year = (
                    raw_date[:4]
                    if len(raw_date) >= 4
                    else ""
                )

                return {
                    "id": imdb_id,
                    "imdb_id": imdb_id,
                    "name": name,
                    "poster": poster,
                    "type": (
                        "movie"
                        if media_type == "movie"
                        else "series"
                    ),
                    "year": year,
                }

            movie_results, series_results = await asyncio.gather(
                asyncio.gather(
                    *[
                        convert(item)
                        for item in movie_slice
                    ]
                ),
                asyncio.gather(
                    *[
                        convert(item)
                        for item in series_slice
                    ]
                ),
            )

        movies = [
            item
            for item in movie_results
            if item is not None
        ]

        series = [
            item
            for item in series_results
            if item is not None
        ]

        total = (
            len(movies_all)
            + len(series_all)
        )

        has_more = (
            skip + limit < len(movies_all)
            or skip + limit < len(series_all)
        )

        logger.info(
            f"[V711D] Person '{person_name}' "
            f"mode={person_mode} -> "
            f"{len(movies)} movies / "
            f"{len(series)} series "
            f"(total credits={total}, hasMore={has_more})"
        )

        return {
            "movies": movies,
            "series": series,
            "hasMore": has_more,
            "total": total,
        }

    # ============================================================
    # ROUTING
    # ============================================================

    # Explicit genre intent from Details.
    if requested_mode == "genre":
        return await _genre_search(
            GENRE_MAP.get(query_lower) or q
        )

    # Typed exact genre names.
    if (
        requested_mode == "auto"
        and query_lower in GENRE_MAP
    ):
        return await _genre_search(
            GENRE_MAP[query_lower]
        )

    # Explicit person intent bypasses Cinemeta completely.
    if requested_mode in (
        "person",
        "cast",
        "director",
    ):
        if not tmdb_api_key:
            logger.error(
                "[V711D] TMDB_API_KEY missing for person search"
            )

            return {
                "movies": [],
                "series": [],
                "hasMore": False,
                "total": 0,
            }

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=15.0
        ) as client:

            person, _ = await _resolve_person(
                client,
                allow_partial=True,
            )

        if person:
            return await _person_search(
                person,
                requested_mode,
            )

        return {
            "movies": [],
            "series": [],
            "hasMore": False,
            "total": 0,
        }

    # Title-only intent.
    if requested_mode == "title":
        result, _ = await _title_search()

        return result

    # AUTO:
    # 1. Search titles.
    # 2. Exact title wins.
    # 3. Otherwise an exact TMDB person wins.
    # 4. If title search found nothing, allow TMDB's best person match.
    # 5. Otherwise keep title results.
    title_result, exact_title = await _title_search()

    # V711E_PERSON_TITLE_COLLISION
    #
    # A real person may share their name with obscure metadata titles
    # (for example "Will Smith"). AUTO must not return a tiny literal-title
    # set before checking whether TMDB identifies the query as an exact
    # person name.
    #
    # Explicit mode=title still preserves literal-title searching.

    person = None
    exact_person = False

    if tmdb_api_key:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=15.0
        ) as client:

            person, exact_person = await _resolve_person(
                client,
                allow_partial=(
                    not exact_title
                    and title_result.get("total", 0) == 0
                ),
            )

    if person and exact_person:
        logger.info(
            f"[V711E] Exact person wins AUTO collision for "
            f"'{q}' -> {person.get('name')}"
        )

        return await _person_search(
            person,
            "person",
        )

    if exact_title:
        logger.info(
            f"[V711E] Exact title selected for '{q}'"
        )

        return title_result

    if (
        person
        and title_result.get("total", 0) == 0
    ):
        logger.info(
            f"[V711E] Person fallback selected for "
            f"'{q}' -> {person.get('name')}"
        )

        return await _person_search(
            person,
            "person",
        )

    return title_result
@api_router.get("/content/meta/{content_type}/{content_id}")
async def get_meta(content_type: str, content_id: str, current_user: User = Depends(get_current_user)):
    """Get metadata for content including episodes for series"""
    # V737_PORNTUBE_NATIVE_ROUTING
    # PornTube metadata is authoritative for its native IDs and carries
    # the poster/background that Cinemeta cannot provide for these IDs.
    if (
        content_type == "movie"
        and (
            content_id.startswith("pt:")
            or content_id.startswith("porndb:")
        )
    ):
        try:
            response = await _v737_fetch_porntube_native(
                "meta",
                content_type,
                content_id,
            )

            if response is not None and response.status_code == 200:
                data = response.json()
                meta = data.get("meta", {}) or {}

                if meta:
                    logger.info(
                        "V737_PORNTUBE_META id=%s poster=%s",
                        content_id[:80],
                        bool(meta.get("poster")),
                    )

                    _discover_cache[
                        f"meta:{content_type}:{content_id}"
                    ] = {
                        "data": meta,
                        "expires": (
                            datetime.utcnow()
                            + timedelta(seconds=600)
                        ),
                    }

                    return meta

            status = (
                response.status_code
                if response is not None
                else 0
            )

            logger.info(
                "V737_PORNTUBE_META_MISS id=%s status=%s",
                content_id[:80],
                status,
            )

            raise HTTPException(
                status_code=404,
                detail="PornTube metadata not found",
            )

        except HTTPException:
            raise

        except Exception as e:
            logger.warning(
                "V737_PORNTUBE_META_ERROR id=%s error=%s",
                content_id[:80],
                type(e).__name__,
            )

            raise HTTPException(
                status_code=404,
                detail="PornTube metadata not found",
            )

    
    # Check meta cache (10 minute TTL)
    meta_cache_key = f"meta:{content_type}:{content_id}"
    cached_meta = _discover_cache.get(meta_cache_key)
    if cached_meta and cached_meta["expires"] > datetime.utcnow():
        logger.info(f"Meta cache HIT for {content_type}/{content_id}")
        return cached_meta["data"]
    
    try:
        client = await get_shared_http_client()
        
        # For TV channels, try USA TV addon first
        if content_type == 'tv' and content_id.startswith('ustv'):
            try:
                url = f"https://848b3516657c-usatv.baby-beamup.club/meta/{content_type}/{content_id}.json"
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    meta = data.get('meta', {})
                    if meta:
                        logger.info(f"Got TV channel meta for {meta.get('name', content_id)}")
                        _discover_cache[meta_cache_key] = {"data": meta, "expires": datetime.utcnow() + timedelta(seconds=600)}
                        return meta
            except Exception as e:
                logger.warning(f"USA TV meta error: {e}")
        
        # For movies/series, use Cinemeta
        url = f"https://v3-cinemeta.strem.io/meta/{content_type}/{content_id}.json"
        response = await client.get(url)
        if response.status_code == 200:
            data = response.json()
            meta = data.get('meta', {})
            
            # For series, ensure videos (episodes) are included and properly formatted
            if content_type == 'series' and 'videos' in meta:
                episodes = []
                for video in meta.get('videos', []):
                    episodes.append({
                        'id': video.get('id', ''),
                        'season': video.get('season', 0),
                        'episode': video.get('episode', 0),
                        'name': video.get('name') or video.get('title', f"Episode {video.get('episode', 0)}"),
                        'thumbnail': video.get('thumbnail'),
                        'overview': video.get('overview'),
                        'released': video.get('released'),
                    })
                meta['videos'] = episodes
                logger.info(f"Returning {len(episodes)} episodes for {meta.get('name', 'Unknown')}")
            
            # Cache the result
            _discover_cache[meta_cache_key] = {"data": meta, "expires": datetime.utcnow() + timedelta(seconds=600)}
            return meta
    except Exception as e:
        logger.error(f"Error fetching meta: {str(e)}")
    
    raise HTTPException(status_code=404, detail="Meta not found")


# ==================== LIBRARY ROUTES ====================

@api_router.get("/library")
async def get_library(current_user: User = Depends(get_current_user)):
    library_items = await db.library.find({"user_id": current_user.id}).to_list(1000)
    movies = [item for item in library_items if item.get("type") == "movie"]
    series = [item for item in library_items if item.get("type") == "series"]
    channels = [item for item in library_items if item.get("type") == "tv"]
    for item in movies + series + channels:
        item.pop('_id', None)
    return {"movies": movies, "series": series, "channels": channels}

@api_router.post("/library")
async def add_to_library(item: LibraryItem, current_user: User = Depends(get_current_user)):
    item_dict = item.dict()
    item_dict["user_id"] = current_user.id
    
    existing = await db.library.find_one({
        "user_id": current_user.id,
        "$or": [{"id": item.id}, {"imdb_id": item.imdb_id}]
    })
    if existing:
        return {"message": "Already in library"}
    
    await db.library.insert_one(item_dict)
    return {"message": "Added to library"}

@api_router.delete("/library/{item_type}/{item_id}")
async def remove_from_library(item_type: str, item_id: str, current_user: User = Depends(get_current_user)):
    result = await db.library.delete_one({
        "user_id": current_user.id,
        "$or": [{"id": item_id}, {"imdb_id": item_id}]
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Item not found in library")
    return {"message": "Removed from library"}


# ==================== WATCH PROGRESS / CONTINUE WATCHING ====================

@api_router.get("/watch-progress")
async def get_watch_progress(current_user: User = Depends(get_current_user)):
    """Get all watch progress for current user (Continue Watching list)
    
    Matches Stremio's behavior:
    - Shows items with ANY watch progress (time_offset > 0)
    - Filters out items that are nearly complete (>95%)
    - Sorted by most recently watched
    """
    progress_items = await db.watch_progress.find(
        {"user_id": current_user.id},
        {"_id": 0}
    ).sort("updated_at", -1).to_list(50)
    
    # Stremio shows items with ANY progress (time_offset > 0)
    # We filter out items that are mostly watched (>95%) 
    # but show everything else regardless of how little was watched
    # V716_SERIES_CONTINUE_WATCHING
    # progress_items is already newest-first. Keep only the newest
    # progress record for each series BEFORE completion filtering.
    # This prevents an older episode from resurfacing after the
    # newest watched episode is completed.
    latest_progress_items = []
    seen_series = set()

    for item in progress_items:
        content_type = str(item.get("content_type") or "").strip().lower()
        series_key = str(item.get("series_id") or "").strip()

        # Legacy series records may identify the parent through
        # content_id formatted as parentId:season:episode.
        if content_type == "series" and not series_key:
            content_id = str(item.get("content_id") or "").strip()
            if ":" in content_id:
                series_key = content_id.split(":", 1)[0]

        if content_type == "series" and series_key:
            normalized_series_key = series_key.lower()
            if normalized_series_key in seen_series:
                continue
            seen_series.add(normalized_series_key)

        # Movies remain independent. Series keep newest record only.
        latest_progress_items.append(item)

    continue_watching = [
        item for item in latest_progress_items
        if item.get("progress", 0) > 0 and item.get("percent_watched", 0) <= 95
    ]
    
    return {"continueWatching": continue_watching}

@api_router.get("/watch-progress/{content_id:path}")
async def get_content_progress(content_id: str, current_user: User = Depends(get_current_user)):
    """Get watch progress for a specific content"""
    progress = await db.watch_progress.find_one(
        {"user_id": current_user.id, "content_id": content_id},
        {"_id": 0}
    )
    return {"progress": progress}

@api_router.post("/watch-progress")
async def save_watch_progress(progress: WatchProgress, current_user: User = Depends(get_current_user)):
    """Save or update watch progress for content"""
    progress_dict = progress.dict()
    progress_dict["user_id"] = current_user.id
    progress_dict["updated_at"] = datetime.utcnow()
    
    # Calculate percent watched
    if progress.duration > 0:
        progress_dict["percent_watched"] = min((progress.progress / progress.duration) * 100, 100)
    else:
        progress_dict["percent_watched"] = 0
    
    # Upsert - update if exists, insert if not
    await db.watch_progress.update_one(
        {"user_id": current_user.id, "content_id": progress.content_id},
        {"$set": progress_dict},
        upsert=True
    )
    
    return {"message": "Progress saved", "percent_watched": progress_dict["percent_watched"]}

@api_router.delete("/watch-progress/{content_id:path}")
async def delete_watch_progress(content_id: str, current_user: User = Depends(get_current_user)):
    """Delete watch progress for content (clear from continue watching)"""
    result = await db.watch_progress.delete_one({
        "user_id": current_user.id,
        "content_id": content_id
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Progress not found")
    return {"message": "Progress deleted"}


# ==================== TORRENT STREAMING ENDPOINTS (WebTorrent Proxy) ====================

TORRENT_SERVER_URL = "http://localhost:8002"

# Track torrent start times for auto-restart logic
_torrent_start_times = {}

@api_router.post("/stream/start/{info_hash}")
async def start_stream(
    info_hash: str, 
    request: Request,
    fileIdx: Optional[int] = None,
    filename: Optional[str] = None,
):
    """Start downloading a torrent via BOTH libtorrent and WebTorrent for maximum peer connectivity"""
    try:
        # Parse request body for trackers (from Torrentio stream sources)
        extra_trackers = []
        try:
            body = await request.json()
            sources = body.get("sources", [])
            for source in sources:
                if isinstance(source, str) and source.startswith("tracker:"):
                    tracker_url = source[len("tracker:"):]
                    # Accept HTTP, HTTPS, and UDP trackers (DHT+uTP enabled)
                    if tracker_url.startswith("http") or tracker_url.startswith("udp"):
                        extra_trackers.append(tracker_url)
            if extra_trackers:
                logger.info(f"Got {len(extra_trackers)} trackers from Torrentio for {info_hash}")
        except Exception:
            pass  # No body or invalid JSON - that's fine
        
        logger.info(f"Starting torrent download for {info_hash}, fileIdx={fileIdx}, filename={filename}, extra_trackers={len(extra_trackers)}")
        
        # Start on libtorrent with ALL trackers (ours + Torrentio's)
        try:
            torrent_streamer.get_session(info_hash, extra_trackers=extra_trackers)
        except Exception as e:
            logger.warning(f"libtorrent start failed (non-critical): {e}")
        
        # ALSO start on torrent-stream server (Stremio-style, native BitTorrent)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                wt_url = f"http://localhost:8002/create/{info_hash}"
                # Pass tracker sources in Stremio format
                wt_body = {"sources": []}
                for t in extra_trackers:
                    wt_body["sources"].append(f"tracker:{t}")
                # Also add default DHT source
                wt_body["sources"].append(f"dht:{info_hash}")
                if fileIdx is not None:
                    wt_body["fileIdx"] = fileIdx
                await client.post(wt_url, json=wt_body)
                logger.info(f"torrent-stream engine created for {info_hash} with {len(extra_trackers)} extra trackers")
        except Exception as e:
            logger.warning(f"torrent-stream start failed (non-critical): {e}")
        
        return {"status": "started", "info_hash": info_hash}
    except Exception as e:
        logger.error(f"Error starting stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/stream/prewarm/{info_hash}")
async def prewarm_stream(info_hash: str, request: Request):
    """Pre-warm a torrent on BOTH libtorrent AND torrent-stream for fastest startup.
    Returns immediately - no waiting for metadata or pieces."""
    try:
        # Parse optional sources from body
        extra_trackers = []
        try:
            body = await request.json()
            sources = body.get("sources", [])
            for source in sources:
                if isinstance(source, str) and source.startswith("tracker:"):
                    tracker_url = source[len("tracker:"):]
                    if tracker_url.startswith("http") or tracker_url.startswith("udp"):
                        extra_trackers.append(tracker_url)
        except Exception:
            pass
        
        # Pre-warm on libtorrent
        existing = torrent_streamer.sessions.get(info_hash.lower())
        lt_status = "unknown"
        if existing:
            status = torrent_streamer.get_status(info_hash)
            lt_status = status.get("status", "unknown")
        else:
            try:
                torrent_streamer.get_session(info_hash, extra_trackers=extra_trackers)
                lt_status = "warming"
            except Exception as e:
                logger.warning(f"libtorrent prewarm failed: {e}")
                lt_status = "failed"
        
        # Pre-warm on torrent-stream server (Stremio-style) with tracker sources
        wt_status = "unknown"
        try:
            ts_body = {"sources": [f"dht:{info_hash}"]}
            for t in extra_trackers:
                ts_body["sources"].append(f"tracker:{t}")
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(f"http://localhost:8002/create/{info_hash}", json=ts_body)
                if resp.status_code == 200:
                    wt_data = resp.json()
                    wt_status = "ready" if wt_data.get("ready") else "warming"
                    logger.info(f"torrent-stream prewarm: {info_hash} - status={wt_status}, trackers={len(extra_trackers)}")
        except Exception as e:
            logger.warning(f"torrent-stream prewarm failed (non-critical): {e}")
            wt_status = "failed"
        
        logger.info(f"Pre-warming torrent {info_hash} (lt={lt_status}, ts={wt_status}, trackers={len(extra_trackers)})")
        return {"status": "warming", "info_hash": info_hash, "lt_status": lt_status, "ts_status": wt_status}
    except Exception as e:
        logger.warning(f"Prewarm failed for {info_hash}: {e}")
        return {"status": "prewarm_failed", "error": str(e)}

@api_router.get("/stream/status/{info_hash}")
async def stream_status(info_hash: str):
    """Get the status of a torrent download - checks BOTH libtorrent AND WebTorrent,
    returns the BEST status (whichever engine has more peers/progress)"""
    try:
        # Check libtorrent status
        lt_data = torrent_streamer.get_status(info_hash)
        lt_status = lt_data.get("status", "not_found")
        lt_peers = lt_data.get("peers", 0)
        lt_dl_rate = lt_data.get("download_rate", 0)
        lt_downloaded = lt_data.get("downloaded", 0)
        
        if lt_status == "not_found":
            # Auto-restart on libtorrent
            try:
                torrent_streamer.get_session(info_hash)
            except Exception:
                pass
        
        # Check torrent-stream status (Stremio-style engine)
        wt_peers = 0
        wt_dl_rate = 0
        wt_ready = False
        wt_progress = 0
        wt_name = ""
        wt_video_size = 0
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                wt_resp = await client.get(f"http://localhost:8002/status/{info_hash}")
                if wt_resp.status_code == 200:
                    wt_data = wt_resp.json()
                    wt_peers = wt_data.get("peers", 0)
                    wt_dl_rate = wt_data.get("downloadSpeed", 0)
                    wt_ready = wt_data.get("ready", False)
                    wt_progress = wt_data.get("progress", 0)
                    wt_name = wt_data.get("videoFile", "") or wt_data.get("name", "")
                    wt_video_size = wt_data.get("videoSize", 0)
                    logger.info(f"torrent-stream status for {info_hash}: ready={wt_ready}, peers={wt_peers}, progress={wt_progress:.2%}")
        except Exception:
            pass
        
        # Use the BEST engine's data
        total_peers = lt_peers + wt_peers
        best_dl_rate = max(lt_dl_rate, wt_dl_rate)
        best_downloaded = max(lt_downloaded, 0)
        
        # Determine overall status - if EITHER engine is ready, we're ready
        if wt_ready:
            overall_status = "ready"
        elif lt_status == "ready":
            overall_status = "ready"
        elif lt_status == "downloading_metadata" and not wt_ready:
            overall_status = "downloading_metadata"
        else:
            overall_status = "buffering"
        
        # Calculate ready_progress
        ready_progress = lt_data.get("ready_progress", 0)
        if wt_ready:
            ready_progress = 100
        elif wt_progress > 0:
            ready_progress = max(ready_progress, wt_progress)
        
        return {
            "status": overall_status,
            "progress": max(lt_data.get("progress", 0), wt_progress),
            "ready_progress": ready_progress,
            "peers": total_peers,
            "download_rate": best_dl_rate,
            "downloaded": best_downloaded,
            "name": lt_data.get("video_file", "") or wt_name or "",
            "video_filename": lt_data.get("video_file", "") or wt_name or "",
            "video_file": lt_data.get("video_file", "") or wt_name or "",
            "video_size": max(lt_data.get("video_size", 0), wt_video_size),
            "first_pieces_ready": lt_data.get("first_pieces_ready", False) or wt_ready,
            "last_pieces_ready": lt_data.get("last_pieces_ready", False),
            "file_ready": lt_data.get("file_ready", False) or wt_ready,
            "ready_threshold_mb": lt_data.get("ready_threshold_mb", 2),
            "engine": "webtorrent" if (wt_ready or wt_peers > lt_peers) else "libtorrent",
            "lt_peers": lt_peers,
            "wt_peers": wt_peers,
        }
    except Exception as e:
        logger.error(f"Error getting stream status: {e}")
        return {"status": "buffering", "progress": 0, "peers": 0, "error": str(e)}

@api_router.post("/stream/seek/{info_hash}")
async def seek_stream(info_hash: str, request: Request):
    """Tell the backend to reprioritize pieces for a seek target position.
    This is called when the user seeks in the video player so we can
    download the pieces at the new position ASAP."""
    try:
        body = await request.json()
        position_bytes = body.get("position_bytes", 0)
        
        session_data = torrent_streamer.sessions.get(info_hash.lower())
        if not session_data:
            return {"status": "error", "message": "Session not found"}
        
        handle = session_data.get('handle')
        if not handle or not handle.is_valid() or not handle.has_metadata():
            return {"status": "error", "message": "Torrent not ready"}
        
        ti = handle.get_torrent_info()
        piece_length = ti.piece_length()
        
        # Get video file offset
        video_file_info = session_data.get('video_file', {})
        file_index = video_file_info.get('index', 0)
        file_offset = ti.files().file_offset(file_index)
        
        # Calculate which pieces correspond to the seek position
        absolute_offset = file_offset + position_bytes
        target_piece = absolute_offset // piece_length
        
        # Prioritize a large window around the seek target (20MB = ~20 pieces at 1MB/piece)
        buffer_pieces = max(40, 20 * 1024 * 1024 // piece_length)
        
        # Reset all priorities to normal first
        num_pieces = ti.num_pieces()
        priorities = [1] * num_pieces
        
        # Keep header pieces (first 5MB) at high priority
        header_pieces = max(10, 5 * 1024 * 1024 // piece_length)
        for p in range(min(header_pieces, num_pieces)):
            piece_abs = (file_offset // piece_length) + p
            if piece_abs < num_pieces:
                priorities[piece_abs] = 7
        
        # Keep tail pieces (last 2MB) at high priority  
        tail_pieces = max(5, 2 * 1024 * 1024 // piece_length)
        video_size = video_file_info.get('size', 0)
        if video_size > 0:
            tail_start_abs = (file_offset + video_size - tail_pieces * piece_length) // piece_length
            for p in range(tail_start_abs, min(tail_start_abs + tail_pieces, num_pieces)):
                if 0 <= p < num_pieces:
                    priorities[p] = 7
        
        # Set HIGH priority for seek target + buffer
        seek_start = max(0, target_piece - 2)  # A few pieces before for safety
        seek_end = min(num_pieces, target_piece + buffer_pieces)
        for p in range(seek_start, seek_end):
            priorities[p] = 7
        
        handle.prioritize_pieces(priorities)
        
        # Also use set_piece_deadline for the most urgent pieces (tight deadline)
        try:
            for i, p in enumerate(range(target_piece, min(target_piece + 10, num_pieces))):
                handle.set_piece_deadline(p, i * 100)  # 100ms increments = "download these NOW"
        except Exception as e:
            logger.warning(f"set_piece_deadline not supported: {e}")
        
        # Force reannounce to find more peers for faster download
        handle.force_reannounce(0)
        
        logger.info(f"Seek request for {info_hash}: position={position_bytes}, piece={target_piece}, buffer={buffer_pieces} pieces")
        
        return {
            "status": "ok",
            "target_piece": target_piece,
            "buffer_pieces": buffer_pieces,
            "message": f"Reprioritized {buffer_pieces} pieces from piece {target_piece}"
        }
    except Exception as e:
        logger.error(f"Seek error: {e}")
        return {"status": "error", "message": str(e)}

# Old WebTorrent-specific video proxy removed - now using unified stream_video endpoint

@api_router.post("/stream/prefetch/{info_hash}")
async def prefetch_stream(info_hash: str, request: Request):
    """Pre-fetch pieces at a byte position before seeking.
    
    This is how we achieve Stremio-like seeking:
    1. Frontend calls this endpoint with the target byte position
    2. We tell torrent-stream to prioritize and download those pieces
    3. We wait until the pieces are available (or timeout)
    4. Return 'ready' so the frontend can safely tell the player to seek
    """
    try:
        body = await request.json()
        position_bytes = body.get("position_bytes", 0)
        
        # Call torrent-stream prefetch endpoint
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=35.0, write=5.0, pool=5.0)) as client:
            resp = await client.post(
                f"http://localhost:8002/prefetch/{info_hash}",
                json={"position_bytes": position_bytes}
            )
            
            if resp.status_code == 200:
                result = resp.json()
                logger.info(f"Prefetch result for {info_hash[:8]} at byte {position_bytes}: {result.get('status')}, wait={result.get('wait_ms', 0)}ms")
                return result
            else:
                logger.warning(f"Prefetch failed: {resp.status_code}")
                return {"status": "error", "message": "Prefetch failed"}
    except httpx.ReadTimeout:
        logger.warning(f"Prefetch timeout for {info_hash[:8]} at byte {position_bytes}")
        return {"status": "timeout", "message": "Pieces not yet available, try seeking anyway"}
    except Exception as e:
        logger.error(f"Prefetch error: {e}")
        return {"status": "error", "message": str(e)}

@api_router.get("/stream/video/{info_hash}")
@api_router.head("/stream/video/{info_hash}")
async def stream_video(
    info_hash: str,
    request: Request,
    fileIdx: Optional[int] = None
):
    """Stream video - tries torrent-stream server first, falls back to direct file serving.
    
    Primary: Proxy to torrent-stream server on localhost:8002
    Fallback: Serve the video file directly from libtorrent's download directory
    """
    info_hash = info_hash.lower()
    range_header = request.headers.get("range")
    
    # === TRY TORRENT-STREAM SERVER FIRST ===
    try:
        ts_url = f"http://localhost:8002/stream/{info_hash}"
        if fileIdx is not None:
            ts_url += f"/{fileIdx}"
        
        headers = {}
        if range_header:
            headers["Range"] = range_header
        
        logger.info(f"Streaming {info_hash[:8]} via torrent-stream, range={range_header or 'none'}")
        
        # Handle HEAD requests
        if request.method == "HEAD":
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.head(ts_url, headers=headers)
                response_headers = {}
                for key in ["Content-Range", "Content-Length", "Content-Type", "Accept-Ranges"]:
                    val = resp.headers.get(key.lower())
                    if val:
                        response_headers[key] = val
                response_headers["Access-Control-Allow-Origin"] = "*"
                response_headers["X-Accel-Buffering"] = "no"
                return Response(
                    content=b"",
                    status_code=resp.status_code,
                    headers=response_headers,
                )
        
        # GET: Stream the response
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=600.0, write=30.0, pool=30.0)
        )
        
        try:
            req = client.build_request("GET", ts_url, headers=headers)
            resp = await client.send(req, stream=True)
            
            response_headers = {
                "Access-Control-Allow-Origin": "*",
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "X-Accel-Buffering": "no",
                "X-Content-Type-Options": "nosniff",
                "transferMode.dlna.org": "Streaming",
                "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
            }
            
            for key in ["Content-Range", "Content-Length", "Content-Type"]:
                val = resp.headers.get(key.lower())
                if val:
                    response_headers[key] = val
            
            async def streaming_proxy():
                try:
                    async for chunk in resp.aiter_bytes(chunk_size=256 * 1024):
                        yield chunk
                except Exception as e:
                    logger.error(f"Stream proxy error for {info_hash[:8]}: {e}")
                finally:
                    await resp.aclose()
                    await client.aclose()
            
            return StreamingResponse(
                streaming_proxy(),
                status_code=resp.status_code,
                headers=response_headers,
            )
        except Exception as e:
            await client.aclose()
            raise e
            
    except (httpx.ConnectError, httpx.ConnectTimeout):
        logger.warning(f"torrent-stream server not reachable, trying direct file serve for {info_hash[:8]}")
        # Fall through to direct file serving
    except httpx.ReadTimeout:
        logger.error(f"torrent-stream timeout for {info_hash[:8]}")
        # Fall through to direct file serving
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"torrent-stream error for {info_hash[:8]}: {e}, trying direct file serve")
        # Fall through to direct file serving
    
    # === FALLBACK: DIRECT FILE SERVING FROM LIBTORRENT DOWNLOAD ===
    logger.info(f"Direct file serve fallback for {info_hash[:8]}")
    
    status = torrent_streamer.get_status(info_hash)
    video_path = status.get("video_path")
    
    if not video_path or not os.path.isfile(video_path):
        # Try to find the file in the download directory
        save_path = torrent_streamer.sessions.get(info_hash, {}).get('save_path', torrent_streamer.download_dir)
        video_file = None
        video_extensions = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts'}
        
        for root, dirs, files in os.walk(save_path):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext in video_extensions:
                    candidate = os.path.join(root, f)
                    if video_file is None or os.path.getsize(candidate) > os.path.getsize(video_file):
                        video_file = candidate
        
        if video_file:
            video_path = video_file
        else:
            raise HTTPException(status_code=404, detail="Video file not found. Stream may still be downloading.")
    
    file_size = os.path.getsize(video_path)
    
    # Determine content type
    ext = os.path.splitext(video_path)[1].lower()
    content_type_map = {
        '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv',
        '.webm': 'video/webm', '.m4v': 'video/mp4', '.ts': 'video/mp2t',
    }
    content_type = content_type_map.get(ext, 'video/mp4')
    
    # Parse range header for byte-range serving
    start = 0
    end = file_size - 1
    status_code = 200
    
    if range_header:
        try:
            range_spec = range_header.replace("bytes=", "").strip()
            if range_spec.startswith("-"):
                # Last N bytes
                suffix_length = int(range_spec[1:])
                start = max(0, file_size - suffix_length)
                end = file_size - 1
            elif range_spec.endswith("-"):
                # From byte N to end
                start = int(range_spec[:-1])
                end = file_size - 1
            else:
                parts = range_spec.split("-")
                start = int(parts[0])
                end = int(parts[1]) if parts[1] else file_size - 1
            
            end = min(end, file_size - 1)
            status_code = 206
        except (ValueError, IndexError):
            start = 0
            end = file_size - 1
            status_code = 200
    
    content_length = end - start + 1
    
    response_headers = {
        "Content-Type": content_type,
        "Content-Length": str(content_length),
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
        "transferMode.dlna.org": "Streaming",
        "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
    }
    
    if status_code == 206:
        response_headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    
    async def file_stream_generator():
        """Stream the video file in chunks with proper range support"""
        chunk_size = 256 * 1024  # 256KB chunks
        bytes_remaining = content_length
        try:
            with open(video_path, "rb") as f:
                f.seek(start)
                while bytes_remaining > 0:
                    read_size = min(chunk_size, bytes_remaining)
                    data = f.read(read_size)
                    if not data:
                        break
                    bytes_remaining -= len(data)
                    yield data
        except Exception as e:
            logger.error(f"Direct file stream error for {info_hash[:8]}: {e}")
    
    logger.info(f"Direct serving {info_hash[:8]}: {video_path}, range={start}-{end}/{file_size}, type={content_type}")
    
    return StreamingResponse(
        file_stream_generator(),
        status_code=status_code,
        headers=response_headers,
    )

# ============================================================
# V759_ADULT_TRANSCODE
#
# Adult/VR compatibility fallback only.
# Normal movie/series playback never calls these endpoints.
# ============================================================

import asyncio as _v759_asyncio
import shutil as _v759_shutil
import time as _v759_time
from urllib.parse import urlparse as _v759_urlparse


_V759_ADULT_TRANSCODE_SESSIONS: Dict[str, Dict[str, Any]] = {}
_V759_ADULT_TRANSCODE_TTL_SECONDS = 6 * 60 * 60

# Production currently has eight CPU cores and no GPU device
# exposed inside the application container.  Limit the expensive
# compatibility transcode to one active stream for now.
_V759_ADULT_TRANSCODE_SEMAPHORE = _v759_asyncio.Semaphore(1)


def _v759_cleanup_adult_transcode_sessions() -> None:
    now = _v759_time.time()

    expired = [
        sid
        for sid, item
        in _V759_ADULT_TRANSCODE_SESSIONS.items()
        if float(item.get("expires_at") or 0) <= now
    ]

    for sid in expired:
        _V759_ADULT_TRANSCODE_SESSIONS.pop(
            sid,
            None,
        )


def _v759_allowed_adult_transcode_source(
    value: str,
) -> bool:
    try:
        parsed = _v759_urlparse(
            str(value or "").strip()
        )

        if parsed.scheme.lower() != "https":
            return False

        host = str(
            parsed.hostname or ""
        ).strip().lower()

        return (
            host == "energycdn.com"
            or host.endswith(".energycdn.com")
        )

    except Exception:
        return False


@api_router.post("/adult/transcode/session")
async def v759_create_adult_transcode_session(
    request: AdultTranscodeSessionRequest,
    current_user: User = Depends(get_current_user),
):
    content_id = str(
        request.content_id or ""
    ).strip()

    content_key = content_id.lower()

    if not (
        content_key.startswith("pt:")
        or content_key.startswith("porndb:")
    ):
        logger.warning(
            "V759_ADULT_TRANSCODE_BLOCK "
            "reason=content-id user=%s",
            current_user.id,
        )

        raise HTTPException(
            status_code=403,
            detail="Adult transcode content is not authorized",
        )

    source_url = str(
        request.source_url or ""
    ).strip()

    if (
        not source_url
        or len(source_url) > 8192
        or not _v759_allowed_adult_transcode_source(
            source_url
        )
    ):
        logger.warning(
            "V759_ADULT_TRANSCODE_BLOCK "
            "reason=source-host user=%s",
            current_user.id,
        )

        raise HTTPException(
            status_code=403,
            detail="Adult transcode source is not authorized",
        )

    if not _v759_shutil.which("ffmpeg"):
        logger.error(
            "V759_ADULT_TRANSCODE "
            "ffmpeg unavailable"
        )

        raise HTTPException(
            status_code=503,
            detail="Adult compatibility service unavailable",
        )

    _v759_cleanup_adult_transcode_sessions()

    session_id = uuid.uuid4().hex

    _V759_ADULT_TRANSCODE_SESSIONS[
        session_id
    ] = {
        "user_id": current_user.id,
        "content_id": content_id,
        "source_url": source_url,
        "created_at": _v759_time.time(),
        "expires_at":
            _v759_time.time()
            + _V759_ADULT_TRANSCODE_TTL_SECONDS,
    }

    logger.info(
        "V759_ADULT_TRANSCODE_SESSION "
        "created=%s content=%s user=%s",
        session_id[:8],
        content_id[:80],
        current_user.id,
    )

    return {
        "status": "success",
        "session_id": session_id,
        "path":
            "/api/adult/transcode/"
            + session_id,
        "video_codec": "h264",
        "audio_codec": "aac",
        "max_width": 1920,
    }


@api_router.get("/adult/transcode/{session_id}")
async def v759_stream_adult_transcode(
    session_id: str,
):
    _v759_cleanup_adult_transcode_sessions()

    item = _V759_ADULT_TRANSCODE_SESSIONS.get(
        str(session_id or "").strip()
    )

    if not item:
        raise HTTPException(
            status_code=404,
            detail="Adult transcode session expired",
        )

    source_url = str(
        item.get("source_url") or ""
    ).strip()

    if not _v759_allowed_adult_transcode_source(
        source_url
    ):
        _V759_ADULT_TRANSCODE_SESSIONS.pop(
            session_id,
            None,
        )

        raise HTTPException(
            status_code=403,
            detail="Adult transcode source rejected",
        )

    async def v759_output():
        async with _V759_ADULT_TRANSCODE_SEMAPHORE:

            logger.info(
                "V759_ADULT_TRANSCODE_START "
                "session=%s content=%s",
                session_id[:8],
                str(
                    item.get("content_id") or ""
                )[:80],
            )

            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",

                "-rw_timeout",
                "15000000",

                "-reconnect",
                "1",

                "-reconnect_streamed",
                "1",

                "-reconnect_delay_max",
                "2",

                "-i",
                source_url,

                "-map",
                "0:v:0",

                "-map",
                "0:a:0?",

                "-vf",
                r"scale=min(1920\,iw):-2:flags=fast_bilinear",

                "-c:v",
                "libx264",

                "-preset",
                "ultrafast",

                "-tune",
                "zerolatency",

                "-pix_fmt",
                "yuv420p",

                "-crf",
                "23",

                "-maxrate",
                "16M",

                "-bufsize",
                "32M",

                "-g",
                "100",

                "-keyint_min",
                "50",

                "-sc_threshold",
                "0",

                "-c:a",
                "aac",

                "-b:a",
                "160k",

                "-ac",
                "2",

                "-movflags",
                "frag_keyframe+empty_moov+default_base_moof",

                "-f",
                "mp4",

                "pipe:1",
            ]

            process = await _v759_asyncio.create_subprocess_exec(
                *cmd,
                stdout=_v759_asyncio.subprocess.PIPE,
                stderr=_v759_asyncio.subprocess.PIPE,
            )

            stderr_lines = []

            async def drain_stderr():
                try:
                    while True:
                        line = await process.stderr.readline()

                        if not line:
                            break

                        text = line.decode(
                            "utf-8",
                            "replace",
                        ).strip()

                        if text:
                            stderr_lines.append(text)

                            if len(stderr_lines) > 20:
                                del stderr_lines[:-20]

                except Exception:
                    pass

            stderr_task = _v759_asyncio.create_task(
                drain_stderr()
            )

            bytes_sent = 0

            try:
                while True:
                    chunk = await process.stdout.read(
                        256 * 1024
                    )

                    if not chunk:
                        break

                    bytes_sent += len(chunk)

                    yield chunk

            except _v759_asyncio.CancelledError:
                raise

            except Exception as exc:
                logger.warning(
                    "V759_ADULT_TRANSCODE_STREAM_ERROR "
                    "session=%s type=%s",
                    session_id[:8],
                    type(exc).__name__,
                )

            finally:
                if process.returncode is None:
                    try:
                        process.terminate()

                        await _v759_asyncio.wait_for(
                            process.wait(),
                            timeout=3.0,
                        )

                    except Exception:
                        try:
                            process.kill()
                            await process.wait()
                        except Exception:
                            pass

                try:
                    await _v759_asyncio.wait_for(
                        stderr_task,
                        timeout=1.0,
                    )

                except Exception:
                    stderr_task.cancel()

                rc = process.returncode

                if (
                    rc not in (0, None)
                    and stderr_lines
                ):
                    logger.warning(
                        "V759_ADULT_TRANSCODE_FFMPEG "
                        "session=%s rc=%s err=%s",
                        session_id[:8],
                        rc,
                        stderr_lines[-1][:500],
                    )

                logger.info(
                    "V759_ADULT_TRANSCODE_END "
                    "session=%s rc=%s bytes=%s",
                    session_id[:8],
                    rc,
                    bytes_sent,
                )

    return StreamingResponse(
        v759_output(),
        media_type="video/mp4",
        headers={
            "Cache-Control":
                "no-store, no-cache, must-revalidate",
            "Pragma":
                "no-cache",
            "X-Accel-Buffering":
                "no",
        },
    )


# ==================== STREAM PROXY ====================

@api_router.api_route("/proxy/video", methods=["GET", "HEAD"])
async def proxy_video(
    request: Request,
    url: str,
    token: Optional[str] = None,
    current_user: Optional[User] = None
):
    """Proxy a video stream through our server - handles base64 encoded URLs"""
    import base64
    
    # Allow authentication via query param token
    if not current_user and token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get("user_id")
            if user_id:
                user = await db.users.find_one({"id": user_id})
                if user:
                    current_user = User(**user)
        except:
            pass
    
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    # Decode URL if it's base64 encoded
    try:
        if not url.startswith('http'):
            url = base64.b64decode(url).decode('utf-8')
    except Exception as e:
        logger.warning(f"URL decode error: {e}")
    
    logger.info(f"Proxying video: {url[:80]}...")
    
    # Determine referer based on URL
    referer = None
    if 'xhamster' in url or 'xhcdn' in url:
        referer = 'https://xhamster.com/'
    elif 'eporner' in url:
        referer = 'https://www.eporner.com/'
    elif 'porntrex' in url:
        referer = 'https://www.porntrex.com/'
    else:
        # Extract domain for referer
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            referer = f"{parsed.scheme}://{parsed.netloc}/"
        except:
            pass
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    if referer:
        headers['Referer'] = referer
        headers['Origin'] = referer.rstrip('/')
    
    try:
        # For HEAD requests, just get headers from upstream
        is_head = request.method == "HEAD"
        
        client = httpx.AsyncClient(follow_redirects=True, timeout=60.0)
        
        if is_head:
            response = await client.head(url, headers=headers)
        else:
            response = await client.get(url, headers=headers)
        
        if response.status_code != 200:
            await client.aclose()
            logger.warning(f"Video proxy error: {response.status_code}")
            raise HTTPException(status_code=response.status_code, detail="Video unavailable")
        
        content_type = response.headers.get('content-type', 'video/mp4')
        content_length = response.headers.get('content-length')
        
        logger.info(f"Video proxy: method={request.method}, status={response.status_code}, type={content_type}, length={content_length}")
        
        response_headers = {
            'Content-Type': content_type,
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Cache-Control': 'no-cache',
        }
        if content_length:
            response_headers['Content-Length'] = content_length
        
        # For HEAD requests, return just headers
        if is_head:
            await client.aclose()
            return Response(content=b"", headers=response_headers, media_type=content_type)
        
        async def stream_video():
            try:
                async for chunk in response.aiter_bytes(chunk_size=512 * 1024):  # 512KB chunks
                    yield chunk
            except Exception as e:
                logger.error(f"Video proxy stream error: {e}")
            finally:
                await response.aclose()
                await client.aclose()
        
        return StreamingResponse(
            stream_video(),
            media_type=content_type,
            headers=response_headers
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Video proxy error: {e}")
        raise HTTPException(status_code=503, detail=str(e))


@api_router.get("/proxy/stream")
async def proxy_stream(
    url: str,
    referer: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Proxy a video stream through our server to bypass IP restrictions"""
    import base64
    
    # Decode URL if it's base64 encoded
    try:
        if not url.startswith('http'):
            url = base64.b64decode(url).decode('utf-8')
    except:
        pass
    
    logger.info(f"Proxying stream: {url[:80]}...")
    
    # Determine referer based on URL
    if not referer:
        if 'xhamster' in url:
            referer = 'https://xhamster.com/'
        elif 'xhcdn' in url:
            referer = 'https://xhamster.com/'
        elif 'eporner' in url:
            referer = 'https://www.eporner.com/'
        elif 'porntrex' in url:
            referer = 'https://www.porntrex.com/'
        elif 'redtube' in url:
            referer = 'https://www.redtube.com/'
        else:
            referer = url.split('/')[0] + '//' + url.split('/')[2] + '/'
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': referer,
        'Origin': referer.rstrip('/'),
    }
    
    async def stream_video():
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                async with client.stream('GET', url, headers=headers) as response:
                    if response.status_code != 200:
                        logger.warning(f"Proxy stream error: {response.status_code}")
                        return
                    async for chunk in response.aiter_bytes(chunk_size=1024 * 256):  # 256KB chunks
                        yield chunk
        except Exception as e:
            logger.error(f"Proxy stream error: {e}")
    
    # Determine content type
    content_type = 'video/mp4'
    if '.m3u8' in url:
        content_type = 'application/vnd.apple.mpegurl'
    elif '.ts' in url:
        content_type = 'video/mp2t'
    
    return StreamingResponse(
        stream_video(),
        media_type=content_type,
        headers={
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
        }
    )



@api_router.get("/proxy/hls")
async def proxy_hls(
    request: Request,
    url: str,
    token: Optional[str] = None,
    current_user: Optional[User] = None
):
    """Proxy HLS streams - rewrites m3u8 manifest URLs to go through our proxy"""
    import base64
    from urllib.parse import urljoin, urlparse, quote
    
    # Allow authentication via query param token
    if not current_user and token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get("user_id")
            if user_id:
                user = await db.users.find_one({"id": user_id})
                if user:
                    current_user = User(**user)
        except:
            pass
    
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    # Decode URL if base64 encoded
    try:
        if not url.startswith('http'):
            url = base64.b64decode(url).decode('utf-8')
    except:
        pass
    
    logger.info(f"HLS proxy: {url[:80]}...")
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    
    # Extract domain for referer
    try:
        parsed = urlparse(url)
        referer = f"{parsed.scheme}://{parsed.netloc}/"
        headers['Referer'] = referer
        headers['Origin'] = referer.rstrip('/')
    except:
        pass
    
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            
            if response.status_code != 200:
                logger.warning(f"HLS proxy error: {response.status_code} for {url[:80]}")
                raise HTTPException(status_code=response.status_code, detail="Stream unavailable")
            
            content = response.text
            content_type = response.headers.get('content-type', '')
            
            # If this is an m3u8 manifest, rewrite URLs to go through our proxy
            if '.m3u8' in url or 'mpegurl' in content_type.lower() or content.strip().startswith('#EXTM3U'):
                lines = content.split('\n')
                rewritten_lines = []
                
                # Get the auth token for sub-requests
                auth_token = token
                if not auth_token:
                    # Extract from Authorization header
                    auth_header = request.headers.get('authorization', '')
                    if auth_header.startswith('Bearer '):
                        auth_token = auth_header[7:]
                
                for line in lines:
                    stripped = line.strip()
                    # Skip empty lines and comments (except EXT tags)
                    if not stripped or stripped.startswith('#'):
                        rewritten_lines.append(line)
                        continue
                    
                    # This is a URL line - make it absolute and proxy it
                    if stripped.startswith('http://') or stripped.startswith('https://'):
                        absolute_url = stripped
                    else:
                        # Relative URL - resolve against base
                        absolute_url = urljoin(url, stripped)
                    
                    # Encode and create proxy URL
                    encoded = base64.b64encode(absolute_url.encode()).decode()
                    
                    # Use hls proxy for .m3u8, video proxy for .ts segments
                    if '.m3u8' in stripped:
                        proxy_path = f"/api/proxy/hls?url={quote(encoded)}"
                    else:
                        proxy_path = f"/api/proxy/hls?url={quote(encoded)}"
                    
                    if auth_token:
                        proxy_path += f"&token={quote(auth_token)}"
                    
                    rewritten_lines.append(proxy_path)
                
                rewritten_content = '\n'.join(rewritten_lines)
                
                return Response(
                    content=rewritten_content,
                    media_type='application/vnd.apple.mpegurl',
                    headers={
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                        'Access-Control-Allow-Headers': '*',
                        'Cache-Control': 'no-cache',
                    }
                )
            else:
                # Not a manifest - stream as-is (e.g., .ts segments)
                # Determine content type
                ct = 'video/mp2t'
                if '.ts' in url:
                    ct = 'video/mp2t'
                elif '.mp4' in url:
                    ct = 'video/mp4'
                elif '.aac' in url:
                    ct = 'audio/aac'
                
                return Response(
                    content=response.content,
                    media_type=ct,
                    headers={
                        'Access-Control-Allow-Origin': '*',
                        'Cache-Control': 'no-cache',
                    }
                )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"HLS proxy error: {e}")
        raise HTTPException(status_code=503, detail=str(e))



@api_router.get("/proxy/xhamster/{video_id:path}")
async def proxy_xhamster_stream(
    video_id: str,
    quality: str = "720p",
    token: Optional[str] = None,
    current_user: Optional[User] = None
):
    # Allow authentication via query param token for video player
    if not current_user and token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            user_id = payload.get("user_id")
            logger.info(f"Proxy auth: Looking up user_id = {user_id}")
            if user_id:
                # Use same lookup as get_current_user - by "id" field, not "_id"
                user = await db.users.find_one({"id": user_id})
                if user:
                    current_user = User(**user)
                    logger.info(f"Proxy auth successful for user: {user.get('username')}")
                else:
                    logger.warning(f"Proxy auth: user not found for id = {user_id}")
        except Exception as e:
            logger.warning(f"Proxy auth failed: {e}")
    
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    """Generate fresh xHamster stream URL and proxy it"""
    import urllib.parse
    
    # Decode the video URL
    video_url = urllib.parse.unquote(video_id)
    
    # Fix URL protocol - FastAPI path params can strip double slashes
    if video_url.startswith('https:/') and not video_url.startswith('https://'):
        video_url = 'https://' + video_url[7:]
    elif video_url.startswith('http:/') and not video_url.startswith('http://'):
        video_url = 'http://' + video_url[6:]
    elif not video_url.startswith('http'):
        video_url = f"https://xhamster.com/videos/{video_id}"
    
    logger.info(f"Proxying xHamster video: {video_url[:80]}... quality={quality}")
    
    # Fetch fresh stream URLs from xHamster
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://xhamster.com/',
    }
    
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            response = await client.get(video_url, headers=headers)
            if response.status_code != 200:
                raise HTTPException(status_code=404, detail="Video not found")
            
            html = response.text
            import re
            import json
            
            # Extract h264 sources
            h264_match = re.search(r'"h264"\s*:\s*\[(.*?)\]', html, re.DOTALL)
            if not h264_match:
                raise HTTPException(status_code=404, detail="No streams found")
            
            h264_json = "[" + h264_match.group(1) + "]"
            h264_json = h264_json.replace('\\/', '/')
            sources = json.loads(h264_json)
            
            # Find the requested quality
            stream_url = None
            for s in sources:
                if s.get('quality') == quality:
                    stream_url = s.get('url', '').replace('\\/', '/')
                    break
            
            # Fallback to any available quality
            if not stream_url:
                for s in sources:
                    if s.get('url'):
                        stream_url = s.get('url', '').replace('\\/', '/')
                        break
            
            if not stream_url:
                raise HTTPException(status_code=404, detail="No playable stream found")
            
            logger.info(f"Found stream URL: {stream_url[:80]}...")
            
            # Stream the video through our server
            async def stream_video():
                try:
                    stream_headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': '*/*',
                        'Referer': 'https://xhamster.com/',
                        'Origin': 'https://xhamster.com',
                    }
                    async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as stream_client:
                        async with stream_client.stream('GET', stream_url, headers=stream_headers) as stream_response:
                            if stream_response.status_code != 200:
                                logger.warning(f"xHamster stream error: {stream_response.status_code}")
                                return
                            async for chunk in stream_response.aiter_bytes(chunk_size=1024 * 512):  # 512KB chunks
                                yield chunk
                except Exception as e:
                    logger.error(f"xHamster proxy error: {e}")
            
            # Determine content type
            content_type = 'video/mp4'
            if '.m3u8' in stream_url:
                content_type = 'application/vnd.apple.mpegurl'
            
            return StreamingResponse(
                stream_video(),
                media_type=content_type,
                headers={
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'no-cache',
                }
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"xHamster proxy error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== V609_THEATER_ONLY_BADGES ====================
# Badge rule:
#   1. Movie must currently appear in TMDB US Now Playing.
#   2. Movie must have NO US watch-provider availability.
#      Any streaming/free/ads/rent/buy provider suppresses the badge.
#
# IMDb -> TMDB mapping uses TMDB /find.
# Provider data is supplied by TMDB/JustWatch.
# Never embed the TMDB credential here; read TMDB_API_KEY from .env.

_V609_RELEASE_STATUS_CACHE: Dict[str, Dict[str, Any]] = {}
_V609_RELEASE_STATUS_TTL_SECONDS = 1800

_v609_now_playing_ids = set()
_v609_now_playing_expires = 0.0
# ==================== V611_RELIABLE_CINEMA_STATUS ====================
# IMPORTANT:
# An upstream/TMDB failure means UNKNOWN, never "none".
# Only a positively verified non-theatrical/home-available result may
# become "none".

async def _v611_tmdb_json(
    tmdb_client,
    url,
    params
):
    last_exc = None

    for attempt in range(1, 4):
        try:
            resp = await tmdb_client.get(
                url,
                params=params,
            )

            resp.raise_for_status()
            return resp.json()

        except Exception as exc:
            last_exc = exc

            logger.warning(
                f"[V611] TMDB attempt {attempt}/3 failed "
                f"url={url}: {exc}"
            )

            if attempt < 3:
                await asyncio.sleep(0.30 * attempt)

    raise last_exc or RuntimeError("TMDB request failed")




async def _v609_get_now_playing_ids(
    tmdb_client: httpx.AsyncClient,
    tmdb_api_key: str
):
    global _v609_now_playing_ids, _v609_now_playing_expires

    now_ts = time.time()

    if (
        _v609_now_playing_ids
        and now_ts < _v609_now_playing_expires
    ):
        return _v609_now_playing_ids

    base_url = "https://api.themoviedb.org/3/movie/now_playing"

    first_data = await _v611_tmdb_json(
        tmdb_client,
        base_url,
        {
            "api_key": tmdb_api_key,
            "language": "en-US",
            "region": "US",
            "page": 1,
        },
    )

    ids = {
        int(movie["id"])
        for movie in first_data.get("results", [])
        if movie.get("id") is not None
    }

    # Conservative ceiling. Current/popular theatrical titles will be
    # contained here; anything not positively confirmed receives no badge.
    try:
        total_pages = int(first_data.get("total_pages") or 1)
    except Exception:
        total_pages = 1

    total_pages = max(1, min(total_pages, 10))

    page_semaphore = asyncio.Semaphore(3)

    async def fetch_page(page: int):
        async with page_semaphore:
            data = await _v611_tmdb_json(
                tmdb_client,
                base_url,
                {
                    "api_key": tmdb_api_key,
                    "language": "en-US",
                    "region": "US",
                    "page": page,
                },
            )

            return data.get("results", [])

    if total_pages > 1:
        # V611: if even ONE requested page cannot be verified after
        # retries, abort the roster load. Never cache a partial list.
        page_results = await asyncio.gather(
            *(fetch_page(page) for page in range(2, total_pages + 1))
        )

        for result in page_results:
            for movie in result:
                if movie.get("id") is not None:
                    try:
                        ids.add(int(movie["id"]))
                    except Exception:
                        pass

    _v609_now_playing_ids = ids

    # Refresh the theatrical roster every 15 minutes.
    _v609_now_playing_expires = now_ts + 900

    logger.info(
        f"[V609] Loaded {len(ids)} US Now Playing TMDB movie ids"
    )

    return ids


async def _v609_classify_movie(
    imdb_id: str,
    tmdb_client: httpx.AsyncClient,
    tmdb_api_key: str,
    now_playing_ids
):
    imdb_id = str(imdb_id or "").strip()

    if not imdb_id.startswith("tt"):
        return "none"

    now_ts = time.time()

    cached = _V609_RELEASE_STATUS_CACHE.get(imdb_id)

    if cached:
        checked = float(cached.get("checked", 0) or 0)

        if now_ts - checked < _V609_RELEASE_STATUS_TTL_SECONDS:
            return cached.get("status", "none")

    # ------------------------------------------------------------
    # IMDb ID -> TMDB movie ID
    # ------------------------------------------------------------

    find_data = await _v611_tmdb_json(
        tmdb_client,
        f"https://api.themoviedb.org/3/find/{imdb_id}",
        {
            "api_key": tmdb_api_key,
            "external_source": "imdb_id",
            "language": "en-US",
        },
    )

    movie_results = find_data.get("movie_results", [])

    if not movie_results:
        status = "none"
        _V609_RELEASE_STATUS_CACHE[imdb_id] = {
            "status": status,
            "checked": now_ts,
        }
        return status

    tmdb_id = movie_results[0].get("id")

    if tmdb_id is None:
        return "none"

    try:
        tmdb_id = int(tmdb_id)
    except Exception:
        return "none"

    # ------------------------------------------------------------
    # Must actually be in TMDB's CURRENT US theatrical roster.
    # ------------------------------------------------------------

    if tmdb_id not in now_playing_ids:
        status = "none"

        _V609_RELEASE_STATUS_CACHE[imdb_id] = {
            "status": status,
            "checked": now_ts,
        }

        return status

    # ------------------------------------------------------------
    # Check US home availability.
    #
    # We deliberately reject ANY provider list, not only flatrate.
    # This catches:
    #   flatrate
    #   free
    #   ads
    #   rent
    #   buy
    # and any future provider category TMDB adds.
    # ------------------------------------------------------------

    providers_data = await _v611_tmdb_json(
        tmdb_client,
        f"https://api.themoviedb.org/3/movie/{tmdb_id}/watch/providers",
        {"api_key": tmdb_api_key},
    )

    us = (
        providers_data
        .get("results", {})
        .get("US", {})
    )

    has_home_provider = False

    if isinstance(us, dict):
        for provider_type, providers in us.items():
            if provider_type == "link":
                continue

            if isinstance(providers, list) and len(providers) > 0:
                has_home_provider = True
                break

    status = (
        "none"
        if has_home_provider
        else "in_cinemas"
    )

    _V609_RELEASE_STATUS_CACHE[imdb_id] = {
        "status": status,
        "checked": now_ts,
    }

    logger.info(
        f"[V609] {imdb_id} tmdb={tmdb_id} "
        f"now_playing=True home_provider={has_home_provider} "
        f"status={status}"
    )

    return status



# ==================== V706 CERTIFICATION METADATA ====================
#
# Additive metadata service only.
# Existing Discover/Search/Details/playback behavior is NOT changed here.
#
# Source:
#   TMDB /find               -> IMDb ID to TMDB ID
#   movie release_dates      -> US movie certification
#   TV content_ratings       -> US television rating
#
# Results are batched and cached server-side so the frontend never needs
# one HTTP request per poster.
# =====================================================================

_V706_CERTIFICATION_CACHE = {}

_V706_CERTIFICATION_KNOWN_TTL_SECONDS = 7 * 24 * 60 * 60
_V706_CERTIFICATION_UNKNOWN_TTL_SECONDS = 60 * 60


def _v706_normalize_certification(value):
    raw = str(value or "").strip().upper()

    if not raw:
        return None

    aliases = {
        "PG13": "PG-13",
        "NC17": "NC-17",
        "NOT RATED": "NR",
        "NOT-RATED": "NR",
        "UNRATED": "NR",
        "TVY": "TV-Y",
        "TVY7": "TV-Y7",
        "TVY7-FV": "TV-Y7-FV",
        "TVG": "TV-G",
        "TVPG": "TV-PG",
        "TV14": "TV-14",
        "TVMA": "TV-MA",
    }

    return aliases.get(raw, raw)


def _v706_unique(values):
    seen = set()
    output = []

    for value in values:
        normalized = _v706_normalize_certification(value)

        if not normalized or normalized in seen:
            continue

        seen.add(normalized)
        output.append(normalized)

    return output


async def _v706_get_us_certification(
    content_type,
    imdb_id,
    tmdb_client,
    tmdb_api_key,
):
    kind = str(content_type or "").strip().lower()

    if kind == "tv":
        kind = "series"

    imdb_id = str(imdb_id or "").strip()

    cache_key = f"{kind}:{imdb_id}"
    now_ts = time.time()

    cached = _V706_CERTIFICATION_CACHE.get(cache_key)

    if cached:
        checked = float(cached.get("checked") or 0)
        ttl = int(cached.get("ttl") or 0)

        if ttl > 0 and now_ts - checked < ttl:
            return cached["data"]

    base = {
        "id": imdb_id,
        "type": kind,
        "tmdb_id": None,
        "certification": None,
        "certifications": [],
        "status": "unknown",
        "source": "tmdb",
    }

    if kind not in ("movie", "series"):
        return base

    if not imdb_id.startswith("tt"):
        return base

    find_data = await _v611_tmdb_json(
        tmdb_client,
        f"https://api.themoviedb.org/3/find/{imdb_id}",
        {
            "api_key": tmdb_api_key,
            "external_source": "imdb_id",
            "language": "en-US",
        },
    )

    result_key = "movie_results" if kind == "movie" else "tv_results"
    matches = find_data.get(result_key, [])

    if not matches:
        cached_data = dict(base)

        _V706_CERTIFICATION_CACHE[cache_key] = {
            "checked": now_ts,
            "ttl": _V706_CERTIFICATION_UNKNOWN_TTL_SECONDS,
            "data": cached_data,
        }

        return cached_data

    tmdb_id = matches[0].get("id")

    if tmdb_id is None:
        return base

    try:
        tmdb_id = int(tmdb_id)
    except Exception:
        return base

    certifications = []

    if kind == "movie":
        rating_data = await _v611_tmdb_json(
            tmdb_client,
            f"https://api.themoviedb.org/3/movie/{tmdb_id}/release_dates",
            {
                "api_key": tmdb_api_key,
            },
        )

        #
        # Prefer the certification associated with the normal US theatrical
        # release for DISPLAY purposes, then limited/premiere/home releases.
        # We still return every unique US certification so the parental
        # policy can make its own conservative decision later.
        #
        type_priority = {
            3: 0,  # theatrical
            2: 1,  # theatrical limited
            1: 2,  # premiere
            4: 3,  # digital
            5: 4,  # physical
            6: 5,  # TV
        }

        ranked = []
        sequence = 0

        for country in rating_data.get("results", []):
            if str(country.get("iso_3166_1") or "").upper() != "US":
                continue

            for release in country.get("release_dates", []):
                certification = _v706_normalize_certification(
                    release.get("certification")
                )

                if not certification:
                    continue

                release_type = release.get("type")

                try:
                    release_type = int(release_type)
                except Exception:
                    release_type = 999

                ranked.append(
                    (
                        type_priority.get(release_type, 999),
                        sequence,
                        certification,
                    )
                )

                sequence += 1

        ranked.sort(key=lambda row: (row[0], row[1]))
        certifications = _v706_unique(row[2] for row in ranked)

    else:
        rating_data = await _v611_tmdb_json(
            tmdb_client,
            f"https://api.themoviedb.org/3/tv/{tmdb_id}/content_ratings",
            {
                "api_key": tmdb_api_key,
            },
        )

        us_ratings = []

        for entry in rating_data.get("results", []):
            if str(entry.get("iso_3166_1") or "").upper() != "US":
                continue

            rating = _v706_normalize_certification(entry.get("rating"))

            if rating:
                us_ratings.append(rating)

        certifications = _v706_unique(us_ratings)

    certification = certifications[0] if certifications else None

    data = {
        "id": imdb_id,
        "type": kind,
        "tmdb_id": tmdb_id,
        "certification": certification,
        "certifications": certifications,
        "status": "known" if certification else "unknown",
        "source": "tmdb",
    }

    _V706_CERTIFICATION_CACHE[cache_key] = {
        "checked": now_ts,
        "ttl": (
            _V706_CERTIFICATION_KNOWN_TTL_SECONDS
            if certification
            else _V706_CERTIFICATION_UNKNOWN_TTL_SECONDS
        ),
        "data": data,
    }

    return data


@api_router.post("/content/certifications")
async def get_content_certifications(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    body = await request.json()
    raw_items = body.get("items", [])

    if not isinstance(raw_items, list):
        raise HTTPException(
            status_code=400,
            detail="items must be an array",
        )

    #
    # One batch is intentionally capped. Discover/Search can deduplicate
    # their IMDb IDs and make another batch later if ever necessary.
    #
    raw_items = raw_items[:200]

    requests_by_key = {}

    for raw in raw_items:
        if not isinstance(raw, dict):
            continue

        content_id = str(
            raw.get("id")
            or raw.get("imdb_id")
            or ""
        ).strip()

        content_type = str(
            raw.get("type")
            or ""
        ).strip().lower()

        if content_type == "tv":
            content_type = "series"

        if not content_id:
            continue

        key = f"{content_type}:{content_id}"

        if key not in requests_by_key:
            requests_by_key[key] = {
                "id": content_id,
                "type": content_type,
            }

    if not requests_by_key:
        return {"certifications": {}}

    tmdb_api_key = os.environ.get("TMDB_API_KEY", "").strip()

    if not tmdb_api_key:
        logger.error("[V706] TMDB_API_KEY is not configured")

        raise HTTPException(
            status_code=503,
            detail="Content certification unavailable",
        )

    tmdb_client = await get_shared_http_client()
    semaphore = asyncio.Semaphore(8)

    async def resolve(key, item):
        async with semaphore:
            try:
                data = await _v706_get_us_certification(
                    item["type"],
                    item["id"],
                    tmdb_client,
                    tmdb_api_key,
                )

                return key, data

            except Exception as exc:
                logger.warning(
                    f"[V706] certification UNKNOWN "
                    f"type={item['type']} id={item['id']}: {exc}"
                )

                return key, {
                    "id": item["id"],
                    "type": item["type"],
                    "tmdb_id": None,
                    "certification": None,
                    "certifications": [],
                    "status": "unknown",
                    "source": "tmdb",
                }

    resolved = await asyncio.gather(
        *(
            resolve(key, item)
            for key, item in requests_by_key.items()
        )
    )

    return {
        "certifications": {
            key: data
            for key, data in resolved
        }
    }


@api_router.post("/movie/release_status")
async def movie_release_status(request: Request):
    body = await request.json()

    raw_ids = body.get("imdb_ids", [])

    if not isinstance(raw_ids, list):
        raise HTTPException(
            status_code=400,
            detail="imdb_ids must be an array",
        )

    ids = []

    for raw in raw_ids[:50]:
        imdb_id = str(raw or "").strip()

        if imdb_id.startswith("tt") and imdb_id not in ids:
            ids.append(imdb_id)

    if not ids:
        return {}

    tmdb_api_key = os.environ.get("TMDB_API_KEY", "").strip()

    if not tmdb_api_key:
        logger.error("[V609] TMDB_API_KEY is not configured")

        raise HTTPException(
            status_code=503,
            detail="Cinema classification unavailable",
        )

    tmdb_client = await get_shared_http_client()

    try:
        now_playing_ids = await _v609_get_now_playing_ids(
            tmdb_client,
            tmdb_api_key,
        )
    except Exception as exc:
        logger.error(
            f"[V609] Unable to load TMDB Now Playing: {exc}"
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to verify theatrical status",
        )

    semaphore = asyncio.Semaphore(8)

    async def classify(imdb_id: str):
        async with semaphore:
            try:
                return await _v609_classify_movie(
                    imdb_id,
                    tmdb_client,
                    tmdb_api_key,
                    now_playing_ids,
                )
            except Exception as exc:
                logger.warning(
                    f"[V611] classification UNKNOWN for {imdb_id}: {exc}"
                )
                return "unknown"

    statuses = await asyncio.gather(
        *(classify(imdb_id) for imdb_id in ids)
    )

    return dict(zip(ids, statuses))


# ==================== V682 DYNAMIC PLAYBACK SEGMENTS ====================
# Release-aware intro/credits analysis. The client never supplies a media URL:
# the authenticated user's saved watch_progress URL is used transiently.
from segment_analyzer import extract_signature as _v682_extract_signature
from segment_analyzer import compare_signatures as _v682_compare_signatures

_V682_SEGMENT_SCHEMA = 1

class PlaybackSegmentsAnalyzeRequest(BaseModel):
    content_id: str
    duration_ms: Optional[int] = None
    info_hash: Optional[str] = None
    file_idx: Optional[int] = None
    filename: Optional[str] = None


def _v682_episode_identity(content_id: str, progress: Dict[str, Any]):
    cid = str(content_id or "").strip()
    parts = cid.split(":")
    series_id = str(progress.get("series_id") or (parts[0] if parts else "") or "").strip()

    season = progress.get("season")
    episode = progress.get("episode")

    try:
        if season is None and len(parts) >= 3:
            season = int(parts[-2])
        elif season is not None:
            season = int(season)
    except (TypeError, ValueError):
        season = None

    try:
        if episode is None and len(parts) >= 3:
            episode = int(parts[-1])
        elif episode is not None:
            episode = int(episode)
    except (TypeError, ValueError):
        episode = None

    return series_id, season, episode


def _v682_release_key(
    progress: Dict[str, Any],
    request: PlaybackSegmentsAnalyzeRequest,
    media_url: str,
    duration_ms: int,
) -> str:
    info_hash = str(
        request.info_hash
        or progress.get("stream_info_hash")
        or ""
    ).strip().lower()

    file_idx = (
        request.file_idx
        if request.file_idx is not None
        else progress.get("stream_file_idx")
    )

    filename = str(
        request.filename
        or progress.get("stream_filename")
        or ""
    ).strip()

    if info_hash:
        material = f"hash:{info_hash}|file:{file_idx}|duration:{duration_ms}"
    else:
        # Signed query parameters are intentionally excluded. The path is used
        # only to derive a one-way release identity and is never persisted.
        from urllib.parse import urlparse
        parsed = urlparse(str(media_url))
        path_digest = hashlib.sha256(
            str(parsed.path or "").encode("utf-8")
        ).hexdigest()
        material = (
            f"path:{path_digest}|filename:{filename}|duration:{duration_ms}"
        )

    return hashlib.sha256(material.encode("utf-8")).hexdigest()


async def _v682_signature_for_release(
    *,
    release_key: str,
    content_id: str,
    series_id: str,
    season: int,
    episode: int,
    duration_sec: float,
    media_url: str,
):
    cached = await db.playback_segment_signatures.find_one(
        {
            "release_key": release_key,
            "schema_version": _V682_SEGMENT_SCHEMA,
        },
        {"_id": 0, "signature": 1},
    )

    if cached and isinstance(cached.get("signature"), dict):
        return cached["signature"], True

    signature = await asyncio.to_thread(
        _v682_extract_signature,
        media_url,
        duration_sec,
    )

    # No signed CDN URL is stored in this collection.
    await db.playback_segment_signatures.update_one(
        {"release_key": release_key},
        {
            "$set": {
                "release_key": release_key,
                "schema_version": _V682_SEGMENT_SCHEMA,
                "content_id": content_id,
                "series_id": series_id,
                "season": season,
                "episode": episode,
                "duration_sec": duration_sec,
                "signature": signature,
                "updated_at": datetime.utcnow(),
            }
        },
        upsert=True,
    )

    return signature, False


def _v682_marker_payload(
    *,
    release_key: str,
    content_id: str,
    series_id: str,
    season: int,
    episode: int,
    duration_ms: int,
    intro: Optional[Dict[str, Any]],
    credits: Optional[Dict[str, Any]],
    reference_release_key: Optional[str],
):
    return {
        "status": "ready" if (intro or credits) else "learning",
        "schema_version": _V682_SEGMENT_SCHEMA,
        "release_key": release_key,
        "content_id": content_id,
        "series_id": series_id,
        "season": season,
        "episode": episode,
        "duration_ms": duration_ms,
        "intro": intro,
        "credits": credits,
        "reference_release_key": reference_release_key,
    }


@api_router.post("/playback/segments/analyze")
async def analyze_playback_segments(
    request: PlaybackSegmentsAnalyzeRequest,
    current_user: User = Depends(get_current_user),
):
    content_id = str(request.content_id or "").strip()

    if not content_id:
        raise HTTPException(status_code=400, detail="content_id is required")

    progress = await db.watch_progress.find_one(
        {
            "user_id": current_user.id,
            "content_id": content_id,
        },
        {"_id": 0},
    )

    if not progress:
        raise HTTPException(
            status_code=404,
            detail="Watch progress not found for this content",
        )

    series_id, season, episode = _v682_episode_identity(content_id, progress)

    if not series_id or season is None or episode is None:
        raise HTTPException(
            status_code=400,
            detail="Dynamic segment analysis requires a series episode",
        )

    media_url = str(progress.get("stream_url") or "").strip()

    if not media_url:
        raise HTTPException(
            status_code=409,
            detail="No active saved stream URL is available for this episode",
        )

    try:
        duration_sec = float(progress.get("duration") or 0)
    except (TypeError, ValueError):
        duration_sec = 0.0

    if duration_sec <= 0:
        raise HTTPException(
            status_code=409,
            detail="No valid playback duration is available for this episode",
        )

    duration_ms = int(round(duration_sec * 1000.0))
    release_key = _v682_release_key(
        progress,
        request,
        media_url,
        duration_ms,
    )

    cached_marker = await db.playback_segment_markers.find_one(
        {
            "release_key": release_key,
            "schema_version": _V682_SEGMENT_SCHEMA,
        },
        {"_id": 0},
    )

    if cached_marker and cached_marker.get("status") == "ready":
        cached_marker["cache_hit"] = True
        return cached_marker

    try:
        current_signature, signature_cache_hit = await _v682_signature_for_release(
            release_key=release_key,
            content_id=content_id,
            series_id=series_id,
            season=season,
            episode=episode,
            duration_sec=duration_sec,
            media_url=media_url,
        )
    except ValueError as exc:
        logger.warning(
            "[V682_SEGMENTS] media rejected user=%s content=%s error=%s",
            current_user.id,
            content_id,
            str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.warning(
            "[V682_SEGMENTS] current signature failed user=%s content=%s error=%s",
            current_user.id,
            content_id,
            str(exc),
        )
        raise HTTPException(
            status_code=503,
            detail="Unable to analyze the current playback release",
        )

    reference_docs = await db.playback_segment_signatures.find(
        {
            "schema_version": _V682_SEGMENT_SCHEMA,
            "series_id": series_id,
            "season": season,
            "episode": {"$ne": episode},
            "release_key": {"$ne": release_key},
        },
        {"_id": 0},
    ).sort("updated_at", -1).to_list(length=8)

    # Cold-start: if this season has no cached reference signature yet, try
    # recent saved episodes for this same authenticated user. Expired signed
    # URLs are skipped rather than weakening the confidence gate.
    if not reference_docs:
        candidate_progress = await db.watch_progress.find(
            {
                "user_id": current_user.id,
                "content_id": {
                    "$regex": f"^{series_id}:{season}:",
                    "$ne": content_id,
                },
                "stream_url": {"$nin": [None, ""]},
                "duration": {"$gt": 0},
            },
            {"_id": 0},
        ).sort("updated_at", -1).to_list(length=4)

        for ref_progress in candidate_progress:
            ref_content_id = str(ref_progress.get("content_id") or "").strip()
            ref_url = str(ref_progress.get("stream_url") or "").strip()

            if not ref_content_id or not ref_url:
                continue

            ref_series_id, ref_season, ref_episode = _v682_episode_identity(
                ref_content_id,
                ref_progress,
            )

            if (
                ref_series_id != series_id
                or ref_season != season
                or ref_episode is None
                or ref_episode == episode
            ):
                continue

            try:
                ref_duration_sec = float(ref_progress.get("duration") or 0)
            except (TypeError, ValueError):
                ref_duration_sec = 0.0

            if ref_duration_sec <= 0:
                continue

            ref_duration_ms = int(round(ref_duration_sec * 1000.0))
            ref_request = PlaybackSegmentsAnalyzeRequest(
                content_id=ref_content_id,
            )
            ref_release_key = _v682_release_key(
                ref_progress,
                ref_request,
                ref_url,
                ref_duration_ms,
            )

            try:
                ref_signature, _ = await _v682_signature_for_release(
                    release_key=ref_release_key,
                    content_id=ref_content_id,
                    series_id=series_id,
                    season=season,
                    episode=int(ref_episode),
                    duration_sec=ref_duration_sec,
                    media_url=ref_url,
                )
            except Exception as exc:
                logger.info(
                    "[V682_SEGMENTS] reference skipped content=%s error=%s",
                    ref_content_id,
                    str(exc),
                )
                continue

            reference_docs.append(
                {
                    "release_key": ref_release_key,
                    "content_id": ref_content_id,
                    "series_id": series_id,
                    "season": season,
                    "episode": int(ref_episode),
                    "duration_sec": ref_duration_sec,
                    "signature": ref_signature,
                }
            )
            break

    best_intro = None
    best_intro_score = -1.0
    best_intro_reference = None

    best_credits = None
    best_credits_score = -1.0
    best_credits_reference = None

    for ref_doc in reference_docs:
        ref_signature = ref_doc.get("signature")
        ref_release_key = str(ref_doc.get("release_key") or "")

        if not isinstance(ref_signature, dict):
            continue

        try:
            comparison = await asyncio.to_thread(
                _v682_compare_signatures,
                ref_signature,
                current_signature,
            )
        except Exception as exc:
            logger.info(
                "[V682_SEGMENTS] comparison skipped ref=%s content=%s error=%s",
                ref_release_key[:12],
                content_id,
                str(exc),
            )
            continue

        intro_cmp = comparison.get("intro")

        if isinstance(intro_cmp, dict):
            intro_score = float(intro_cmp.get("confidence") or 0.0)

            if (
                intro_score >= 0.90
                and float(intro_cmp.get("core_score") or 0.0) >= 0.85
                and intro_score > best_intro_score
            ):
                best_intro_score = intro_score
                best_intro_reference = ref_release_key
                best_intro = {
                    "start_ms": int(round(float(intro_cmp["b_start_sec"]) * 1000.0)),
                    "end_ms": int(round(float(intro_cmp["b_end_sec"]) * 1000.0)),
                    "confidence": round(intro_score, 6),
                    "core_score": round(
                        float(intro_cmp.get("core_score") or 0.0),
                        6,
                    ),
                    "source": "audio_fingerprint",
                }

        credits_cmp = comparison.get("credits")

        if isinstance(credits_cmp, dict):
            credits_conf = float(credits_cmp.get("audio_confidence") or 0.0)
            credits_core = float(credits_cmp.get("audio_core_score") or 0.0)
            remaining_delta = float(
                credits_cmp.get("remaining_delta_sec") or 999.0
            )
            credits_length = float(
                credits_cmp.get("audio_length_sec") or 0.0
            )
            credits_pair_score = float(
                credits_cmp.get("pair_score") or 0.0
            )

            # V723_CORROBORATED_CREDITS
            # Preserve the original strong-audio acceptance rule.
            # A near-threshold recurring-audio match is accepted only when
            # the independent visual credits boundary corroborates it tightly.
            strong_credits = (
                credits_conf >= 0.90
                and credits_core >= 0.85
                and remaining_delta <= 6.0
            )

            corroborated_credits = (
                credits_conf >= 0.87
                and credits_core >= 0.80
                and credits_length >= 18.0
                and remaining_delta <= 2.5
                and credits_pair_score >= 12.0
            )

            if strong_credits or corroborated_credits:
                credits_score = (
                    credits_conf
                    + credits_core
                    + max(0.0, 6.0 - remaining_delta) / 6.0
                )

                if credits_score > best_credits_score:
                    best_credits_score = credits_score
                    best_credits_reference = ref_release_key
                    best_credits = {
                        "start_ms": int(
                            round(float(credits_cmp["b_start_sec"]) * 1000.0)
                        ),
                        "end_ms": duration_ms,
                        "confidence": round(credits_conf, 6),
                        "core_score": round(credits_core, 6),
                        "audio_length_sec": round(credits_length, 3),
                        "remaining_delta_sec": round(remaining_delta, 3),
                        "pair_score": round(credits_pair_score, 6),
                        "gate": (
                            "strong"
                            if strong_credits
                            else "corroborated"
                        ),
                        "source": "audio_visual_fingerprint",
                    }

    reference_release_key = (
        best_credits_reference
        or best_intro_reference
        or (
            str(reference_docs[0].get("release_key") or "")
            if reference_docs
            else None
        )
    )

    payload = _v682_marker_payload(
        release_key=release_key,
        content_id=content_id,
        series_id=series_id,
        season=int(season),
        episode=int(episode),
        duration_ms=duration_ms,
        intro=best_intro,
        credits=best_credits,
        reference_release_key=reference_release_key,
    )
    payload["cache_hit"] = False
    payload["signature_cache_hit"] = signature_cache_hit

    # Persist only successful marker results. A "learning" response must be
    # retried later after another same-season reference becomes available.
    # media_url is never included.
    if payload["status"] == "ready":
        await db.playback_segment_markers.update_one(
            {"release_key": release_key},
            {
                "$set": {
                    **payload,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

    logger.info(
        "[V682_SEGMENTS] user=%s content=%s status=%s intro=%s credits=%s refs=%s",
        current_user.id,
        content_id,
        payload["status"],
        bool(best_intro),
        bool(best_credits),
        len(reference_docs),
    )

    return payload
# ================== /V682 DYNAMIC PLAYBACK SEGMENTS ====================

# ==================== ROOT ====================

@api_router.get("/")
async def root():
    return {"message": "PrivastreamCinema API", "version": "1.0.0"}

@api_router.get("/health")
async def health():
    """Health check endpoint for monitoring"""
    return {"status": "ok", "service": "PrivastreamCinema"}

@api_router.get("/download/{filename}")
async def download_file(filename: str):
    """Serve files from the static directory for download"""
    import os
    file_path = os.path.join("/app/backend/static", filename)
    if os.path.exists(file_path):
        # Detect media type from extension
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        media_types = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'html': 'text/html', 'tsx': 'text/plain', 'ts': 'text/plain'}
        media_type = media_types.get(ext, 'application/octet-stream')
        
        # For non-HTML files, add Content-Disposition to force download
        if ext != 'html':
            # Map download filenames to target names
            download_names = {
                'new_icon.png': 'icon.png',
                'new_adaptive_foreground.png': 'adaptive-icon-foreground.png',
                'new_adaptive_monochrome.png': 'adaptive-icon-monochrome.png',
                'player_v2.tsx': 'player.tsx',
            }
            download_name = download_names.get(filename, filename)
            return FileResponse(
                file_path, 
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{download_name}"'}
            )
        return FileResponse(file_path, media_type=media_type)
    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


# Include the router in the main app

# V707_DETAILS_RATINGS_START
import asyncio as _v708_asyncio
#
# Details-page metadata enrichment only.
#
# Rotten Tomatoes:
#   primary  = MDBList ratings[] source "tomatoes"
#   fallback = OMDb Ratings[] Source "Rotten Tomatoes"
#
# Certification:
#   existing V706 TMDB US certification helper.
#
# This route is deliberately separate from normal /content/meta,
# Discover, Search, streams, playback, and parental filtering.
#

import os as _v707_os
import re as _v707_re
import time as _v707_time
import httpx as _v707_httpx
from fastapi import Depends as _v707_Depends
from fastapi import HTTPException as _v707_HTTPException


_V707_RT_CACHE = {}

_V707_RT_KNOWN_TTL = 7 * 24 * 60 * 60
_V707_RT_UNKNOWN_TTL = 60 * 60


def _v707_normalize_percent(value):
    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        number = float(value)

        if 0 <= number <= 100:
            return int(round(number))

        return None

    if isinstance(value, str):
        match = _v707_re.fullmatch(
            r"\s*(\d{1,3})(?:\.\d+)?%\s*",
            value,
        )

        if not match:
            return None

        number = int(match.group(1))

        if 0 <= number <= 100:
            return number

    return None


def _v707_base_rating(status="unknown"):
    return {
        "score": None,
        "provider": None,
        "status": status,
        "votes": None,
        "url": None,
    }


def _v708_normalize_imdb(value):
    if value is None:
        return None

    text = str(value).strip()

    if not text or text.upper() == "N/A":
        return None

    try:
        score = float(text)
    except (TypeError, ValueError):
        return None

    if score < 0.0 or score > 10.0:
        return None

    return round(score, 1)


async def _v707_try_mdblist(
    client,
    content_type,
    imdb_id,
):
    api_key = str(
        _v707_os.getenv("MDBLIST_API_KEY") or ""
    ).strip()

    if not api_key:
        return {
            **_v707_base_rating("unconfigured"),
            "imdb_score": None,
            "attempt_ok": False,
        }

    provider_type = (
        "movie"
        if content_type == "movie"
        else "show"
    )

    try:
        response = await client.get(
            (
                "https://api.mdblist.com/imdb/"
                f"{provider_type}/{imdb_id}"
            ),
            params={"apikey": api_key},
            timeout=8.0,
        )
    except Exception as exc:
        print(
            "[V708] MDBList request error",
            content_type,
            imdb_id,
            type(exc).__name__,
        )

        return {
            **_v707_base_rating("provider_error"),
            "imdb_score": None,
            "attempt_ok": False,
        }

    if response.status_code != 200:
        print(
            "[V708] MDBList HTTP",
            response.status_code,
            content_type,
            imdb_id,
        )

        return {
            **_v707_base_rating(
                f"http_{response.status_code}"
            ),
            "imdb_score": None,
            "attempt_ok": False,
        }

    try:
        payload = response.json()
    except Exception:
        return {
            **_v707_base_rating("invalid_json"),
            "imdb_score": None,
            "attempt_ok": False,
        }

    ratings = payload.get("ratings") or []

    tomatoes = None
    imdb_score = None

    if isinstance(ratings, list):
        for row in ratings:
            if not isinstance(row, dict):
                continue

            source = str(
                row.get("source") or ""
            ).strip().lower()

            if (
                source == "imdb"
                and imdb_score is None
            ):
                imdb_score = _v708_normalize_imdb(
                    row.get("value")
                )

            if (
                source == "tomatoes"
                and tomatoes is None
            ):
                tomatoes = row

    if tomatoes is None:
        return {
            **_v707_base_rating("missing"),
            "imdb_score": imdb_score,
            "attempt_ok": True,
        }

    score = _v707_normalize_percent(
        tomatoes.get("score")
    )

    if score is None:
        score = _v707_normalize_percent(
            tomatoes.get("value")
        )

    if score is None:
        return {
            **_v707_base_rating("missing"),
            "imdb_score": imdb_score,
            "attempt_ok": True,
        }

    return {
        "score": score,
        "provider": "mdblist",
        "status": "known",
        "votes": tomatoes.get("votes"),
        "url": tomatoes.get("url"),
        "imdb_score": imdb_score,
        "attempt_ok": True,
    }


async def _v707_try_omdb(
    client,
    imdb_id,
):
    api_key = str(
        _v707_os.getenv("OMDB_API_KEY") or ""
    ).strip()

    if not api_key:
        return {
            **_v707_base_rating("unconfigured"),
            "imdb_score": None,
            "attempt_ok": False,
        }

    try:
        response = await client.get(
            "https://www.omdbapi.com/",
            params={
                "apikey": api_key,
                "i": imdb_id,
                "r": "json",
            },
            timeout=8.0,
        )
    except Exception as exc:
        print(
            "[V708] OMDb request error",
            imdb_id,
            type(exc).__name__,
        )

        return {
            **_v707_base_rating("provider_error"),
            "imdb_score": None,
            "attempt_ok": False,
        }

    if response.status_code != 200:
        print(
            "[V708] OMDb HTTP",
            response.status_code,
            imdb_id,
        )

        return {
            **_v707_base_rating(
                f"http_{response.status_code}"
            ),
            "imdb_score": None,
            "attempt_ok": False,
        }

    try:
        payload = response.json()
    except Exception:
        return {
            **_v707_base_rating("invalid_json"),
            "imdb_score": None,
            "attempt_ok": False,
        }

    if str(
        payload.get("Response") or ""
    ).strip().lower() != "true":
        print(
            "[V708] OMDb response false",
            imdb_id,
            str(payload.get("Error") or "")[:120],
        )

        return {
            **_v707_base_rating("provider_error"),
            "imdb_score": None,
            "attempt_ok": False,
        }

    imdb_score = _v708_normalize_imdb(
        payload.get("imdbRating")
    )

    ratings = payload.get("Ratings") or []

    rotten = None

    if isinstance(ratings, list):
        for row in ratings:
            if not isinstance(row, dict):
                continue

            source = str(
                row.get("Source") or ""
            ).strip().lower()

            if source == "rotten tomatoes":
                rotten = row
                break

    if rotten is None:
        return {
            **_v707_base_rating("missing"),
            "imdb_score": imdb_score,
            "attempt_ok": True,
        }

    score = _v707_normalize_percent(
        rotten.get("Value")
    )

    if score is None:
        return {
            **_v707_base_rating("missing"),
            "imdb_score": imdb_score,
            "attempt_ok": True,
        }

    return {
        "score": score,
        "provider": "omdb",
        "status": "known",
        "votes": None,
        "url": None,
        "imdb_score": imdb_score,
        "attempt_ok": True,
    }


async def _v707_get_rotten_tomatoes(
    client,
    content_type,
    imdb_id,
):
    cache_key = f"{content_type}:{imdb_id}"
    now = _v707_time.time()

    cached = _V707_RT_CACHE.get(cache_key)

    if cached:
        age = now - float(
            cached.get("checked_at") or 0
        )

        ttl = int(
            cached.get("ttl") or 0
        )

        if ttl > 0 and age < ttl:
            return cached["data"]

    mdblist = await _v707_try_mdblist(
        client,
        content_type,
        imdb_id,
    )

    #
    # MDBList remains primary.
    # If it has both values, there is no reason
    # to spend another OMDb request.
    #
    if (
        mdblist.get("score") is not None
        and mdblist.get("imdb_score") is not None
    ):
        result = {
            key: value
            for key, value in mdblist.items()
            if key != "attempt_ok"
        }

        _V707_RT_CACHE[cache_key] = {
            "checked_at": now,
            "ttl": _V707_RT_KNOWN_TTL,
            "data": result,
        }

        return result

    #
    # OMDb is fallback only when MDBList is missing
    # Rotten Tomatoes, IMDb, or both.
    #
    omdb = await _v707_try_omdb(
        client,
        imdb_id,
    )

    imdb_score = mdblist.get(
        "imdb_score"
    )

    if imdb_score is None:
        imdb_score = omdb.get(
            "imdb_score"
        )

    if mdblist.get("score") is not None:
        selected = mdblist
    elif omdb.get("score") is not None:
        selected = omdb
    else:
        selected = None

    if selected is not None:
        result = {
            key: value
            for key, value in selected.items()
            if key != "attempt_ok"
        }

        result["imdb_score"] = imdb_score

        cache_safe = bool(
            imdb_score is not None
            or omdb.get("attempt_ok")
        )

        if cache_safe:
            _V707_RT_CACHE[cache_key] = {
                "checked_at": now,
                "ttl": _V707_RT_KNOWN_TTL,
                "data": result,
            }

        return result

    both_answered = bool(
        mdblist.get("attempt_ok")
        and omdb.get("attempt_ok")
    )

    result = _v707_base_rating(
        "unknown"
        if both_answered
        else "provider_error"
    )

    result["imdb_score"] = imdb_score

    if both_answered:
        _V707_RT_CACHE[cache_key] = {
            "checked_at": now,
            "ttl": _V707_RT_UNKNOWN_TTL,
            "data": result,
        }

    return result


@api_router.get(
    "/content/ratings/{content_type}/{content_id}"
)
async def _v707_content_ratings(
    content_type: str,
    content_id: str,
    current_user=_v707_Depends(get_current_user),
):
    kind = str(
        content_type or ""
    ).strip().lower()

    if kind not in ("movie", "series"):
        raise _v707_HTTPException(
            status_code=400,
            detail="Ratings support movie or series only",
        )

    imdb_id = str(
        content_id or ""
    ).strip()

    if ":" in imdb_id:
        imdb_id = imdb_id.split(":", 1)[0]

    if not _v707_re.fullmatch(
        r"tt\d+",
        imdb_id,
    ):
        raise _v707_HTTPException(
            status_code=400,
            detail="Ratings require an IMDb ID",
        )

    certification = None
    certifications = []
    certification_status = "unknown"

    tmdb_api_key = str(
        _v707_os.getenv("TMDB_API_KEY") or ""
    ).strip()

    async with _v707_httpx.AsyncClient(
        follow_redirects=True,
    ) as client:

        #
        # V708: independent external requests start together.
        #
        rotten_task = _v708_asyncio.create_task(
            _v707_get_rotten_tomatoes(
                client,
                kind,
                imdb_id,
            )
        )

        cert_task = None

        if tmdb_api_key:
            cert_task = _v708_asyncio.create_task(
                _v706_get_us_certification(
                    kind,
                    imdb_id,
                    client,
                    tmdb_api_key,
                )
            )

        if cert_task is not None:
            try:
                cert = await cert_task

                certification = cert.get(
                    "certification"
                )

                certifications = cert.get(
                    "certifications"
                ) or []

                certification_status = str(
                    cert.get("status")
                    or "unknown"
                )

            except Exception as exc:
                print(
                    "[V708] certification lookup error",
                    kind,
                    imdb_id,
                    type(exc).__name__,
                )

        rotten = await rotten_task

    return {
        "id": imdb_id,
        "type": kind,

        "certification": certification,
        "certifications": certifications,
        "certification_status": certification_status,
        "certification_source": "tmdb",

        "imdb_score": rotten.get("imdb_score"),

        "tomatoes_score": rotten.get("score"),
        "tomatoes_provider": rotten.get("provider"),
        "tomatoes_status": rotten.get("status"),
        "tomatoes_votes": rotten.get("votes"),
        "tomatoes_url": rotten.get("url"),
    }


# V707_DETAILS_RATINGS_END


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    stop_torrent_server()
    client.close()
