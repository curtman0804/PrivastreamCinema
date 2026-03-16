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
import jwt
import httpx
import asyncio
import libtorrent as lt
import threading
import time
import tempfile
import shutil

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# JWT Secret
JWT_SECRET = os.environ.get('JWT_SECRET', 'privastream-cinema-secret-key-2025')
JWT_ALGORITHM = "HS256"

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
    """Handles torrent downloading and HTTP streaming like Stremio - OPTIMIZED FOR FAST STARTUP"""
    MAX_SESSIONS = 2  # Only keep 2 active torrents to prevent disk overflow
    
    def __init__(self):
        self.sessions = {}  # infoHash -> session data
        self.download_dir = tempfile.mkdtemp(prefix="privastream_")
        # Extensive tracker list for maximum peer discovery
        self.trackers = [
            "http://tracker.openbittorrent.com:80/announce",
            "http://tracker3.itzmx.com:6961/announce",
            "http://tracker.bt4g.com:2095/announce",
            "http://tracker.files.fm:6969/announce",
            "http://t.nyaatracker.com:80/announce",
            "http://tracker.gbitt.info:80/announce",
            "http://tracker.ccp.ovh:6969/announce",
            "http://open.acgnxtracker.com:80/announce",
            "http://tracker.dler.org:6969/announce",
            "http://opentracker.i2p.rocks:6969/announce",
            "http://tracker.opentrackr.org:1337/announce",
            "https://tracker.lilithraws.org:443/announce",
            "https://tr.burnabyhighstar.com:443/announce",
            "https://tracker.tamersunion.org:443/announce",
            "https://tracker.imgoingto.icu:443/announce",
        ]
        logger.info(f"TorrentStreamer initialized. Download dir: {self.download_dir}")
        
        # Create ONE shared libtorrent session - DHT stays warm across all torrents
        settings = {
            'listen_interfaces': '0.0.0.0:6881,[::]:6881',
            'enable_dht': True,
            'enable_lsd': True,
            'enable_upnp': False,
            'enable_natpmp': False,
            'announce_to_all_trackers': True,
            'announce_to_all_tiers': True,
            'connection_speed': 500,
            'connections_limit': 800,
            'download_rate_limit': 0,  # Unlimited - need fast initial buffering for ExoPlayer
            'upload_rate_limit': 1024 * 1024,  # 1MB/s upload
            'unchoke_slots_limit': 20,
            'max_peerlist_size': 8000,
            'peer_connect_timeout': 7,
            'handshake_timeout': 7,
            'torrent_connect_boost': 50,
            'peer_timeout': 60,
            'inactivity_timeout': 60,
            'cache_size': 2048,
            'disk_io_read_mode': 0,
            'disk_io_write_mode': 0,
            'aio_threads': 4,
            'request_queue_time': 1,
            'max_out_request_queue': 1000,
            'whole_pieces_threshold': 2,
            'max_allowed_in_request_queue': 2000,
            'send_buffer_watermark': 512 * 1024,
            'send_buffer_watermark_factor': 150,
            'mixed_mode_algorithm': 0,
            'rate_limit_ip_overhead': False,
            'allow_multiple_connections_per_ip': True,
        }
        self.lt_session = lt.session(settings)
        logger.info("Shared libtorrent session started")
    
    def _evict_oldest(self):
        """Remove the oldest session to make room for new ones"""
        if len(self.sessions) >= self.MAX_SESSIONS:
            oldest_hash = min(self.sessions.keys(), key=lambda k: self.sessions[k]['created'])
            logger.info(f"Evicting oldest torrent session: {oldest_hash}")
            self.cleanup_session(oldest_hash)
            # Also do a disk cleanup
            self._cleanup_disk()
    
    def get_session(self, info_hash: str):
        """Get or create a torrent handle using the shared session"""
        info_hash = info_hash.lower()
        
        if info_hash in self.sessions:
            return self.sessions[info_hash]
        
        # Evict oldest if at max capacity
        self._evict_oldest()
        
        # Build magnet URI with trackers
        magnet = f"magnet:?xt=urn:btih:{info_hash}"
        for tracker in self.trackers:
            magnet += f"&tr={tracker}"
        
        # Use the modern API (parse_magnet_uri + add_torrent)
        params = lt.parse_magnet_uri(magnet)
        params.save_path = self.download_dir
        
        handle = self.lt_session.add_torrent(params)
        # Sequential download for streaming
        handle.set_flags(lt.torrent_flags.sequential_download)
        
        self.sessions[info_hash] = {
            'session': self.lt_session,
            'handle': handle,
            'created': time.time(),
            'video_file': None,
            'video_path': None,
            'save_path': self.download_dir,
        }
        
        logger.info(f"Added torrent {info_hash} to shared session")
        return self.sessions[info_hash]
    
    def get_status(self, info_hash: str) -> dict:
        """Get download status for a torrent"""
        info_hash = info_hash.lower()
        
        if info_hash not in self.sessions:
            return {"status": "not_found"}
        
        data = self.sessions[info_hash]
        handle = data['handle']
        
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
            largest_video = None
            largest_size = 0
            
            for i in range(files.num_files()):
                file_path = files.file_path(i)
                file_size = files.file_size(i)
                
                # Check if it's a video file
                if any(file_path.lower().endswith(ext) for ext in ['.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.ts']):
                    if file_size > largest_size:
                        largest_size = file_size
                        largest_video = {
                            'index': i,
                            'path': file_path,
                            'size': file_size,
                        }
            
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
                
                handle.prioritize_pieces(priorities)
                
                # Also set file priority to only download the video file
                file_priorities = [0] * files.num_files()
                file_priorities[largest_video['index']] = 7
                handle.prioritize_files(file_priorities)
                
                logger.info(f"Found video: {largest_video['path']} ({largest_size / 1024 / 1024:.1f} MB)")
                logger.info(f"Piece info: {video_pieces} pieces @ {piece_length // 1024}KB each, prioritizing first {header_pieces} + {buffer_pieces} buffer")
        
        # Calculate progress and readiness
        video_file = data.get('video_file')
        if video_file:
            video_size = video_file['size']
            downloaded_bytes = int(s.progress * video_size) if s.progress > 0 else 0
            
            # FAST START: Need only ~3MB downloaded to start playback
            # This is enough for ffmpeg to parse headers and begin streaming
            min_bytes_for_playback = 3 * 1024 * 1024  # 3MB minimum
            
            # For very small files, use percentage instead
            min_for_small_files = int(video_size * 0.02)  # 2% for small files
            ready_threshold = max(min_bytes_for_playback, min_for_small_files)
            
            # Check if file exists and has content
            video_path = data.get('video_path')
            file_exists = video_path and os.path.exists(video_path)
            file_size_on_disk = os.path.getsize(video_path) if file_exists else 0
            
            # Ready when: enough data downloaded AND file exists on disk
            is_ready = file_size_on_disk >= min_bytes_for_playback or downloaded_bytes >= ready_threshold
            
            return {
                "status": "ready" if is_ready else "buffering",
                "progress": s.progress * 100,
                "peers": s.num_peers,
                "download_rate": s.download_rate,
                "upload_rate": s.upload_rate,
                "video_file": video_file['path'],
                "video_size": video_size,
                "downloaded": downloaded_bytes,
                "file_ready": file_exists,
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
torrent_streamer = TorrentStreamer()

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

class UserCreate(BaseModel):
    username: str
    password: str
    email: Optional[str] = None
    is_admin: bool = False

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

def get_base_url(manifest_url: str) -> str:
    """Extract base URL from manifest URL"""
    if manifest_url.endswith('/manifest.json'):
        return manifest_url[:-14]
    return manifest_url.rsplit('/', 1)[0]

def get_fallback_manifest(url: str) -> Optional[Dict]:
    """Check if we have a fallback manifest for this URL"""
    for key, manifest in FALLBACK_MANIFESTS.items():
        if key in url:
            return manifest
    return None


# ==================== INIT DEFAULT ADMIN ====================

@app.on_event("startup")
async def create_default_admin():
    """Create default admin user if not exists"""
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
    
    # Start periodic cleanup for torrent downloads
    asyncio.create_task(periodic_cleanup())



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
        is_admin=user_data.is_admin
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
    
    # Try to fetch manifest from URL
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            response = await client.get(manifest_url)
            if response.status_code == 200:
                content_type = response.headers.get('content-type', '')
                if 'json' in content_type or response.text.strip().startswith('{'):
                    manifest_data = response.json()
    except Exception as e:
        logger.warning(f"Failed to fetch manifest from {manifest_url}: {e}")
    
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
            "catalogs": manifest_data.get('catalogs', [])
        },
        "installed": True,
        "installedAt": datetime.utcnow().isoformat()
    }
    
    await db.addons.insert_one(addon)
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
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            response = await client.get(stream_url)
            if response.status_code == 200:
                return response.json()
            else:
                return {"streams": []}
    except Exception as e:
        logger.error(f"Error fetching streams: {str(e)}")
        return {"streams": []}

async def extract_redtube_video(video_id: str) -> List[Dict]:
    """Extract actual video URLs from RedTube"""
    import re
    import json
    
    try:
        url = f"https://www.redtube.com/{video_id}"
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
        
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            response = await client.get(url, headers=headers)
            if response.status_code == 200:
                html = response.text
                streams = []
                
                # Look for mediaDefinitions JSON
                media_match = re.search(r'"mediaDefinitions"\s*:\s*\[(.*?)\]', html, re.DOTALL)
                if media_match:
                    try:
                        media_json = '[' + media_match.group(1) + ']'
                        media_data = json.loads(media_json)
                        
                        for item in media_data:
                            if isinstance(item, dict) and item.get('videoUrl'):
                                format_type = item.get('format', 'Unknown')
                                media_url = item.get('videoUrl', '')
                                
                                # Convert relative URLs to absolute
                                if media_url.startswith('/'):
                                    media_url = f"https://www.redtube.com{media_url}"
                                media_url = media_url.replace('\\/', '/')
                                
                                # Fetch the actual video URLs from the media endpoint
                                try:
                                    media_resp = await client.get(media_url, headers=headers, timeout=10.0)
                                    if media_resp.status_code == 200:
                                        video_list = media_resp.json()
                                        for video_item in video_list:
                                            if isinstance(video_item, dict) and video_item.get('videoUrl'):
                                                quality = video_item.get('quality', 'Unknown')
                                                actual_url = video_item.get('videoUrl', '')
                                                fmt = video_item.get('format', format_type)
                                                
                                                streams.append({
                                                    "name": f"RedTube {quality}p",
                                                    "title": f"RedTube • {quality}p {fmt.upper()}",
                                                    "url": actual_url,
                                                    "addon": "RedTube"
                                                })
                                except Exception as e:
                                    logger.warning(f"Error fetching media endpoint: {e}")
                                    
                    except Exception as e:
                        logger.warning(f"Error parsing mediaDefinitions: {e}")
                
                # Remove duplicates based on URL
                seen_urls = set()
                unique_streams = []
                for s in streams:
                    if s['url'] not in seen_urls:
                        seen_urls.add(s['url'])
                        unique_streams.append(s)
                
                if unique_streams:
                    logger.info(f"Extracted {len(unique_streams)} streams from RedTube for video {video_id}")
                    return unique_streams
                else:
                    logger.warning(f"No streams found in RedTube page for {video_id}")
                    
    except Exception as e:
        logger.warning(f"Error extracting RedTube video {video_id}: {e}")
    
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


@api_router.get("/streams/{content_type}/{content_id:path}")
async def get_all_streams(
    content_type: str,
    content_id: str,
    current_user: User = Depends(get_current_user)
):
    """Fetch streams from ALL installed addons + built-in Torrentio-style aggregation"""
    
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
                        lambda: scraper.get(stream_url, timeout=15)
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
                async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                    response = await client.get(stream_url)
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
    
    # Sort by quality tier + seeders (best streams first)
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
            if '🌱' in title:
                seeds_part = title.split('🌱')[1].split('|')[0].strip()
                seeders = int(seeds_part)
            elif '👤' in title:
                # Torrentio format
                import re
                match = re.search(r'👤\s*(\d+)', title)
                if match:
                    seeders = int(match.group(1))
        except:
            pass
        
        # Quality tier (higher is better)
        quality_score = 0
        combined_text = (name + ' ' + title).upper()
        if '2160P' in combined_text or '4K' in combined_text or 'UHD' in combined_text:
            quality_score = 4
        elif '1080P' in combined_text:
            quality_score = 3
        elif '720P' in combined_text:
            quality_score = 2
        elif 'SD' in combined_text or '480P' in combined_text:
            quality_score = 1
        else:
            quality_score = 2  # Default to 720p tier
        
        # Combined score: quality tier * 10000 + seeders
        # This ensures higher quality streams come first, with seeder count as tiebreaker
        return (quality_score * 10000) + min(seeders, 9999)
    
    unique_streams.sort(key=get_sort_score, reverse=True)
    
    logger.info(f"Found {len(unique_streams)} total streams for {content_type}/{content_id}")
    
    # Cache the result (2 minute TTL for streams)
    result_data = {"streams": unique_streams}
    _discover_cache[stream_cache_key] = {
        "data": result_data,
        "expires": datetime.utcnow() + timedelta(seconds=120)
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


# ==================== CONTENT ROUTES ====================

@api_router.get("/content/discover-organized")
async def get_discover(current_user: User = Depends(get_current_user)):
    """Get discover page content from installed addons - organized by service.
    Uses parallel fetching and in-memory caching for speed."""
    
    # Check cache first
    cache_key = current_user.id
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
    
    cinemeta_fetch = [
        ('movie', 'top', 'Popular Movies'),
        ('series', 'top', 'Popular Series'),
        ('movie', 'year', 'New Movies', 'genre=2025'),
        ('series', 'year', 'New Series', 'genre=2025'),
    ]
    
    # Build list of ALL fetch tasks to run in parallel
    fetch_tasks = []
    task_metadata = []  # Track what each task is for
    
    http_client = await get_shared_http_client()
    
    async def fetch_catalog(url: str) -> list:
        """Fetch a single catalog URL and return metas"""
        try:
            response = await http_client.get(url)
            if response.status_code == 200:
                return response.json().get('metas', [])
        except Exception as e:
            logger.warning(f"Fetch failed for {url}: {e}")
        return []
    
    for addon in addons:
        manifest = addon.get('manifest', {})
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
                
                url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                
                fetch_tasks.append(fetch_catalog(url))
                task_metadata.append({
                    "section": catalog_name,
                    "type": catalog_type,
                    "source": "generic",
                    "catalog_id": catalog_id,
                    "base_url": base_url
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
        
        # For generic addons, limit to 30 items and filter
        if meta["source"] == "generic":
            metas = metas[:30]
            metas = [m for m in metas if m.get('name') and m.get('id')]
        
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
                
                async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                    response = await client.get(url)
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
                                first_resp = await client.get(first_page_url)
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
                
                async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                    response = await client.get(url)
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
    content_type: str = None,  # 'movie' or 'series' to filter
    current_user: User = Depends(get_current_user)
):
    """Search content via Cinemeta - supports title search and cast/director/genre searches with pagination"""
    if not q or len(q) < 2:
        return {"movies": [], "series": [], "hasMore": False, "total": 0}
    
    # Common words to ignore when matching
    STOP_WORDS = {'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'it'}
    
    # Detect if this looks like a person name search (cast/director)
    # Person names usually: 2-3 words, each capitalized, no common movie words
    query_words = q.split()
    MOVIE_WORDS = {'movie', 'film', 'show', 'series', 'season', 'episode', 'part', 'vol', 'volume', '2', '3', 'ii', 'iii', 'things', 'the', 'of', 'and', 'a', 'in', 'on', 'at', 'to'}
    # Also exclude common show/movie title patterns
    TITLE_PATTERNS = ['stranger things', 'breaking bad', 'game of thrones', 'the walking dead', 'stranger', 'squid']
    is_likely_person_name = (
        len(query_words) >= 2 and 
        len(query_words) <= 4 and
        all(word[0].isupper() if word else False for word in query_words) and
        not any(word.lower() in MOVIE_WORDS for word in query_words) and
        not any(pattern in q.lower() for pattern in TITLE_PATTERNS)
    )
    
    # Detect genre searches - map to Cinemeta genre IDs
    GENRE_MAP = {
        'action': 'Action',
        'comedy': 'Comedy', 
        'drama': 'Drama',
        'horror': 'Horror',
        'thriller': 'Thriller',
        'romance': 'Romance',
        'sci-fi': 'Sci-Fi',
        'science fiction': 'Sci-Fi',
        'fantasy': 'Fantasy',
        'adventure': 'Adventure',
        'animation': 'Animation',
        'animated': 'Animation',
        'documentary': 'Documentary',
        'crime': 'Crime',
        'mystery': 'Mystery',
        'western': 'Western',
        'musical': 'Musical',
        'war': 'War',
        'history': 'History',
        'historical': 'History',
        'biography': 'Biography',
        'family': 'Family',
        'sport': 'Sport',
        'sports': 'Sport',
        'music': 'Music',
    }
    
    query_lower = q.lower().strip()
    is_genre_search = query_lower in GENRE_MAP
    genre_name = GENRE_MAP.get(query_lower)
    
    logger.info(f"Search query: '{q}' - skip={skip}, limit={limit}, type={content_type}, is_genre={is_genre_search}")
    
    # If it's a genre search, fetch from genre catalog with pagination
    if is_genre_search and genre_name:
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                # Fetch genre-specific catalogs from Cinemeta with skip parameter
                # Format: /catalog/{type}/top/genre={genre}/skip={skip}.json
                if skip > 0:
                    movie_url = f"https://v3-cinemeta.strem.io/catalog/movie/top/genre={genre_name}/skip={skip}.json"
                    series_url = f"https://v3-cinemeta.strem.io/catalog/series/top/genre={genre_name}/skip={skip}.json"
                else:
                    movie_url = f"https://v3-cinemeta.strem.io/catalog/movie/top/genre={genre_name}.json"
                    series_url = f"https://v3-cinemeta.strem.io/catalog/series/top/genre={genre_name}.json"
                
                logger.info(f"Fetching genre catalog: {movie_url}")
                
                # Fetch based on content_type filter
                movies = []
                series = []
                
                if content_type != 'series':
                    movie_resp = await client.get(movie_url)
                    if movie_resp.status_code == 200:
                        movies = movie_resp.json().get('metas', [])
                        logger.info(f"Genre '{genre_name}' movies: {len(movies)}")
                
                if content_type != 'movie':
                    series_resp = await client.get(series_url)
                    if series_resp.status_code == 200:
                        series = series_resp.json().get('metas', [])
                        logger.info(f"Genre '{genre_name}' series: {len(series)}")
                
                # Apply limit
                movies = movies[:limit]
                series = series[:limit]
                
                # Determine if there's more content
                has_more = len(movies) >= limit or len(series) >= limit
                
                return {
                    "movies": movies,
                    "series": series,
                    "hasMore": has_more,
                    "total": len(movies) + len(series)
                }
        except Exception as e:
            logger.error(f"Genre search error: {str(e)}")
            # Fall back to regular search
    
    def score_result(item, query, trust_cinemeta=False):
        """Score search results by relevance"""
        name = (item.get('name') or '').lower()
        query_lower = query.lower()
        query_words_lower = query_lower.split()
        
        # Get significant words (non-stop words) from query
        significant_words = [w for w in query_words_lower if w not in STOP_WORDS and len(w) > 1]
        
        # If no significant words, use all words
        if not significant_words:
            significant_words = query_words_lower
        
        # Exact match gets highest score
        if name == query_lower:
            return 100
        
        # Title starts with query
        if name.startswith(query_lower):
            return 95
        
        # Full query appears in title
        if query_lower in name:
            return 90
        
        # All significant words must appear in title
        all_significant_present = all(word in name for word in significant_words)
        if all_significant_present:
            # Bonus for shorter titles (more specific match)
            length_bonus = max(0, 20 - len(name.split()))
            return 80 + length_bonus
        
        # For person name or genre searches, trust Cinemeta's results
        # Cinemeta searches across cast, director, and other metadata
        if trust_cinemeta:
            # Give a base score - Cinemeta returned this for a reason (cast match, etc)
            # Use release year as tiebreaker - prefer newer content
            year_str = item.get('releaseInfo') or item.get('year') or '0'
            try:
                year = int(str(year_str)[:4])
                year_bonus = (year - 1950) / 10  # Higher score for newer movies
            except:
                year_bonus = 0
            return 50 + min(year_bonus, 10)
        
        # If not matching and not trusting Cinemeta, reject
        return 0
    
    async def check_has_streams(content_type: str, content_id: str) -> bool:
        """Quick check if content has any streams available"""
        try:
            # Try multiple sources for stream availability
            async with httpx.AsyncClient(follow_redirects=True, timeout=6.0) as client:
                # Try ApiBay (The Pirate Bay) - fast and usually available
                if content_type == 'movie':
                    # For movies, we'll assume popular titles have streams
                    # Check via a quick ApiBay search using the IMDB ID
                    try:
                        url = f"https://apibay.org/q.php?q={content_id}"
                        response = await client.get(url, timeout=4.0)
                        if response.status_code == 200:
                            results = response.json()
                            if isinstance(results, list) and len(results) > 0:
                                # Check if we got real results (not "No results")
                                if results[0].get('id') != '0':
                                    return True
                    except:
                        pass
                
                # Try 1337x addon as backup
                try:
                    url = f"https://1337x-api.strem.fun/stream/{content_type}/{content_id}.json"
                    response = await client.get(url, timeout=4.0)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get('streams') and len(data.get('streams', [])) > 0:
                            return True
                except:
                    pass
                
                # For series, assume most popular series have streams
                if content_type == 'series':
                    return True  # Most series in Cinemeta have streams available
                    
        except:
            pass
        return False
    
    async def verify_actor_in_cast(client: httpx.AsyncClient, content_type: str, content_id: str, actor_name: str):
        """Verify that an actor appears in the cast of a specific content item"""
        try:
            url = f"https://v3-cinemeta.strem.io/meta/{content_type}/{content_id}.json"
            response = await client.get(url, timeout=8.0)
            if response.status_code == 200:
                data = response.json()
                meta = data.get('meta', {})
                cast = meta.get('cast', [])
                
                # Normalize actor name for comparison
                actor_lower = actor_name.lower().strip()
                actor_parts = actor_lower.split()
                
                # For person searches, require at least first and last name
                if len(actor_parts) < 2:
                    return False
                
                # Check each cast member
                for cast_member in cast:
                    if isinstance(cast_member, str):
                        cast_lower = cast_member.lower().strip()
                    elif isinstance(cast_member, dict):
                        cast_lower = cast_member.get('name', '').lower().strip()
                    else:
                        continue
                    
                    cast_parts = cast_lower.split()
                    
                    # Require exact match on full name
                    if actor_lower == cast_lower:
                        return True
                    
                    # Or match if first name AND last name both appear in cast member name
                    # This handles "David Harbour" matching "David K. Harbour" or similar
                    first_name = actor_parts[0]
                    last_name = actor_parts[-1]
                    
                    # Both first and last name must be in the cast member's name
                    # And the cast member name must be similar length (to avoid "David" matching "David Holmes")
                    first_match = first_name in cast_parts or any(p.startswith(first_name) for p in cast_parts)
                    last_match = last_name in cast_parts or any(p.startswith(last_name) for p in cast_parts)
                    
                    if first_match and last_match:
                        # Additional check: cast name shouldn't be much longer than search name
                        if len(cast_parts) <= len(actor_parts) + 1:
                            return True
                        
                return False
        except Exception as e:
            logger.debug(f"Error verifying actor for {content_id}: {e}")
            return False
    
    # Handle actor/person searches with verification
    if is_likely_person_name:
        logger.info(f"Actor search detected for: '{q}'")
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                encoded_q = q.replace(' ', '%20')
                movie_url = f"https://v3-cinemeta.strem.io/catalog/movie/top/search={encoded_q}.json"
                series_url = f"https://v3-cinemeta.strem.io/catalog/series/top/search={encoded_q}.json"
                
                movie_resp, series_resp = await asyncio.gather(
                    client.get(movie_url),
                    client.get(series_url),
                    return_exceptions=True
                )
                
                movies_raw = []
                series_raw = []
                
                if not isinstance(movie_resp, Exception) and movie_resp.status_code == 200:
                    movies_raw = movie_resp.json().get('metas', [])[:30]  # Limit for verification
                
                if not isinstance(series_resp, Exception) and series_resp.status_code == 200:
                    series_raw = series_resp.json().get('metas', [])[:30]
                
                logger.info(f"Actor search '{q}': Found {len(movies_raw)} movies, {len(series_raw)} series to verify")
                
                # Verify actor is in cast for each result
                async def verify_and_return_movie(m):
                    content_id = m.get('imdb_id') or m.get('id')
                    if content_id and await verify_actor_in_cast(client, 'movie', content_id, q):
                        # Skip stream check for actor search - too slow and unreliable
                        return m
                    return None
                
                async def verify_and_return_series(s):
                    content_id = s.get('imdb_id') or s.get('id')
                    if content_id and await verify_actor_in_cast(client, 'series', content_id, q):
                        return s
                    return None
                
                # Run verifications in parallel
                movie_checks = await asyncio.gather(*[verify_and_return_movie(m) for m in movies_raw])
                series_checks = await asyncio.gather(*[verify_and_return_series(s) for s in series_raw])
                
                verified_movies = [m for m in movie_checks if m is not None]
                verified_series = [s for s in series_checks if s is not None]
                
                logger.info(f"Actor search '{q}': Verified {len(verified_movies)} movies, {len(verified_series)} series")
                
                # Apply pagination
                total_count = len(verified_movies) + len(verified_series)
                has_more = False  # Actor search doesn't support pagination currently
                
                return {
                    "movies": verified_movies[:limit],
                    "series": verified_series[:limit],
                    "hasMore": has_more,
                    "total": total_count
                }
        except Exception as e:
            logger.error(f"Actor search error: {str(e)}")
            # Fall through to regular search
    
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            # URL encode the query properly
            encoded_q = q.replace(' ', '%20')
            movie_url = f"https://v3-cinemeta.strem.io/catalog/movie/top/search={encoded_q}.json"
            series_url = f"https://v3-cinemeta.strem.io/catalog/series/top/search={encoded_q}.json"
            
            movie_resp, series_resp = await asyncio.gather(
                client.get(movie_url),
                client.get(series_url),
                return_exceptions=True
            )
            
            movies = []
            series = []
            
            if not isinstance(movie_resp, Exception) and movie_resp.status_code == 200:
                movies = movie_resp.json().get('metas', [])
            
            if not isinstance(series_resp, Exception) and series_resp.status_code == 200:
                series = series_resp.json().get('metas', [])
            
            # Score and sort results by relevance
            movies_scored = [(m, score_result(m, q, trust_cinemeta=False)) for m in movies]
            series_scored = [(s, score_result(s, q, trust_cinemeta=False)) for s in series]
            
            # Only include results with score > 0
            result_limit = 15
            movies_filtered = [m for m, score in sorted(movies_scored, key=lambda x: -x[1]) if score > 0][:result_limit]
            series_filtered = [s for s, score in sorted(series_scored, key=lambda x: -x[1]) if score > 0][:result_limit]
            
            logger.info(f"Search '{q}': checking streams for {len(movies_filtered)} movies, {len(series_filtered)} series")
            
            # Check stream availability in parallel (limit to top results for speed)
            async def check_movie(m):
                content_id = m.get('imdb_id') or m.get('id')
                if content_id and await check_has_streams('movie', content_id):
                    return m
                return None
            
            async def check_series(s):
                content_id = s.get('imdb_id') or s.get('id')
                # For series, check first episode of first season
                if content_id and await check_has_streams('series', f"{content_id}:1:1"):
                    return s
                return None
            
            # Run stream checks in parallel
            movie_checks = await asyncio.gather(*[check_movie(m) for m in movies_filtered])
            series_checks = await asyncio.gather(*[check_series(s) for s in series_filtered])
            
            movies_with_streams = [m for m in movie_checks if m is not None]
            series_with_streams = [s for s in series_checks if s is not None]
            
            logger.info(f"Search '{q}': {len(movies_with_streams)} movies, {len(series_with_streams)} series with streams")
            
            return {"movies": movies_with_streams, "series": series_with_streams}
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        return {"movies": [], "series": []}

@api_router.get("/content/meta/{content_type}/{content_id}")
async def get_meta(content_type: str, content_id: str, current_user: User = Depends(get_current_user)):
    """Get metadata for content including episodes for series"""
    
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
    continue_watching = [
        item for item in progress_items 
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
    fileIdx: Optional[int] = None,
    filename: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Start downloading a torrent via libtorrent (native peer discovery)"""
    try:
        logger.info(f"Starting torrent download for {info_hash}, fileIdx={fileIdx}, filename={filename}")
        
        # Use libtorrent-based TorrentStreamer (much better peer discovery than WebTorrent)
        session_data = torrent_streamer.get_session(info_hash)
        
        return {"status": "started", "info_hash": info_hash}
    except Exception as e:
        logger.error(f"Error starting stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/stream/status/{info_hash}")
async def stream_status(info_hash: str, current_user: User = Depends(get_current_user)):
    """Get the status of a torrent download from libtorrent"""
    try:
        status = torrent_streamer.get_status(info_hash)
        
        lt_status = status.get("status", "not_found")
        
        if lt_status == "not_found":
            # Auto-restart: create a new session
            logger.info(f"Torrent {info_hash} not found, auto-starting...")
            torrent_streamer.get_session(info_hash)
            return {
                "status": "buffering",
                "progress": 0,
                "peers": 0,
                "download_rate": 0,
                "downloaded": 0,
                "name": "Starting torrent...",
            }
        
        # Map libtorrent status to our format
        peers = status.get("peers", 0)
        download_rate = status.get("download_rate", 0)
        downloaded = status.get("downloaded", 0)
        video_file = status.get("video_file", "")
        video_size = status.get("video_size", 0)
        
        return {
            "status": lt_status,  # "ready", "buffering", "downloading_metadata"
            "progress": status.get("progress", 0),
            "peers": peers,
            "download_rate": download_rate,
            "downloaded": downloaded,
            "name": video_file or "",
            "video_filename": video_file or "",
            "video_size": video_size,
            "ready_threshold_mb": status.get("ready_threshold_mb", 3),
        }
    except Exception as e:
        logger.error(f"Error getting stream status: {e}")
        return {"status": "buffering", "progress": 0, "peers": 0, "error": str(e)}

@api_router.get("/stream/video/{info_hash}")
@api_router.head("/stream/video/{info_hash}")
async def stream_video(
    info_hash: str,
    request: Request,
    fileIdx: Optional[int] = None
):
    """Stream video file from libtorrent download"""
    try:
        # Make sure the torrent session exists
        session_data = torrent_streamer.get_session(info_hash)
        handle = session_data['handle']
        
        # Wait for metadata and video file discovery (up to 30 seconds)
        max_wait = 30
        waited = 0
        while waited < max_wait:
            status = torrent_streamer.get_status(info_hash)
            if status.get("status") in ["ready", "buffering"] and status.get("video_file"):
                break
            await asyncio.sleep(1)
            waited += 1
        
        video_path = torrent_streamer.get_video_path(info_hash)
        if not video_path:
            raise HTTPException(status_code=404, detail="Video file not found in torrent")
        
        # Wait for the file to exist on disk (libtorrent might still be writing)
        waited = 0
        while waited < 30 and (not os.path.exists(video_path) or os.path.getsize(video_path) < 1024 * 1024):
            await asyncio.sleep(1)
            waited += 1
            s = handle.status()
            logger.info(f"Waiting for file: exists={os.path.exists(video_path)}, peers={s.num_peers}, progress={s.progress*100:.1f}%")
        
        if not os.path.exists(video_path):
            raise HTTPException(status_code=404, detail="Video file not yet available")
        
        file_size = session_data['video_file']['size']  # Use torrent's reported size, not disk size (might be partial)
        
        # Determine content type from file extension
        ext = os.path.splitext(video_path)[1].lower()
        content_types = {
            '.mp4': 'video/mp4',
            '.mkv': 'video/x-matroska',
            '.avi': 'video/x-msvideo',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.m4v': 'video/mp4',
            '.ts': 'video/mp2t',
        }
        content_type = content_types.get(ext, 'video/mp4')
        
        # Handle range requests for video seeking
        # ALWAYS use range-based streaming - ExoPlayer needs this for proper playback
        range_header = request.headers.get("range")
        
        if not range_header:
            # No Range header = first request from player. Return first 2MB chunk as 206
            # This tells ExoPlayer to use Range requests for all subsequent calls
            range_header = "bytes=0-"
        
        parts = range_header.replace("bytes=", "").split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else min(start + 2 * 1024 * 1024, file_size - 1)  # 2MB chunks max
        
        # Clamp to file size
        end = min(end, file_size - 1)
        chunk_size = end - start + 1
        
        logger.info(f"Streaming range {start}-{end}/{file_size} from {os.path.basename(video_path)}")
        
        # ON-DEMAND PIECE PRIORITIZATION: When player requests a specific range,
        # bump those pieces to highest priority so libtorrent downloads them ASAP
        try:
            session_data = torrent_streamer.sessions.get(info_hash.lower())
            if session_data and session_data.get('video_file'):
                handle = session_data['handle']
                ti = handle.get_torrent_info()
                piece_length = ti.piece_length()
                file_offset = ti.files().file_offset(session_data['video_file']['index'])
                
                # Calculate which pieces cover the requested range
                range_start_piece = (file_offset + start) // piece_length
                range_end_piece = (file_offset + end) // piece_length
                
                # Set those pieces to highest priority
                priorities = handle.get_piece_priorities()
                changed = False
                for p in range(range_start_piece, min(range_end_piece + 1, len(priorities))):
                    if priorities[p] < 7:
                        priorities[p] = 7
                        changed = True
                if changed:
                    handle.prioritize_pieces(priorities)
                    logger.info(f"Boosted pieces {range_start_piece}-{range_end_piece} to priority 7 for range request")
        except Exception as e:
            logger.warning(f"Could not boost piece priority: {e}")
        
        async def range_generator():
            try:
                # CRITICAL: Wait for the actual PIECES to be downloaded, not just file size
                # Sparse files return zeros for undownloaded regions which breaks video players
                session_data = torrent_streamer.sessions.get(info_hash.lower())
                if session_data:
                    handle = session_data['handle']
                    ti = handle.get_torrent_info()
                    piece_length = ti.piece_length()
                    vf = session_data.get('video_file', {})
                    file_offset = ti.files().file_offset(vf.get('index', 0)) if vf else 0
                    
                    # Calculate which pieces we need for this range
                    need_start_piece = (file_offset + start) // piece_length
                    need_end_piece = (file_offset + end) // piece_length
                    
                    disk_wait = 0
                    while disk_wait < 120:  # Wait up to 2 minutes for pieces
                        all_ready = True
                        for p in range(need_start_piece, need_end_piece + 1):
                            if not handle.have_piece(p):
                                all_ready = False
                                break
                        
                        if all_ready:
                            break
                        
                        # Log progress periodically
                        if disk_wait % 10 == 0:
                            s = handle.status()
                            logger.info(f"Waiting for pieces {need_start_piece}-{need_end_piece}: peers={s.num_peers}, progress={s.progress*100:.1f}%")
                        
                        await asyncio.sleep(0.5)
                        disk_wait += 1
                    
                    if disk_wait >= 120:
                        logger.error(f"Timeout waiting for pieces {need_start_piece}-{need_end_piece}")
                        return
                
                with open(video_path, 'rb') as f:
                    f.seek(start)
                    remaining = chunk_size
                    while remaining > 0:
                        read_size = min(remaining, 64 * 1024)
                        data = f.read(read_size)
                        if not data:
                            break
                        remaining -= len(data)
                        yield data
            except Exception as e:
                logger.error(f"Range stream error: {e}")
        
        return StreamingResponse(
            range_generator(),
            status_code=206,
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": content_type,
                "Access-Control-Allow-Origin": "*",
            },
            media_type=content_type,
        )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error streaming video: {e}")
        raise HTTPException(status_code=503, detail=f"Stream unavailable: {str(e)}")

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
    client.close()
