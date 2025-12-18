from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse, Response
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

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
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
    
    def __init__(self):
        self.sessions = {}  # infoHash -> session data
        self.download_dir = tempfile.mkdtemp(prefix="privastream_")
        # Extensive tracker list for maximum peer discovery (critical for VPN users)
        self.trackers = [
            # Tier 1 - Fastest/Most reliable
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://open.stealth.si:80/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://tracker.openbittorrent.com:6969/announce",
            "udp://open.demonii.com:1337/announce",
            "udp://tracker.moeking.me:6969/announce",
            "udp://explodie.org:6969/announce",
            # Tier 2 - Good reliability
            "udp://tracker.coppersurfer.tk:6969/announce",
            "udp://tracker.leechers-paradise.org:6969/announce",
            "udp://p4p.arenabg.com:1337/announce",
            "udp://tracker.internetwarriors.net:1337/announce",
            "udp://9.rarbg.to:2710/announce",
            "udp://tracker.pirateparty.gr:6969/announce",
            "udp://tracker.cyberia.is:6969/announce",
            "udp://tracker.tiny-vps.com:6969/announce",
            "udp://tracker.sbsub.com:2710/announce",
            "udp://retracker.lanta-net.ru:2710/announce",
            # HTTP trackers (backup)
            "http://tracker.openbittorrent.com:80/announce",
            "http://tracker3.itzmx.com:6961/announce",
            "http://tracker2.itzmx.com:6961/announce",
            "http://tracker.bt4g.com:2095/announce",
        ]
        logger.info(f"TorrentStreamer initialized. Download dir: {self.download_dir}")
    
    def get_session(self, info_hash: str):
        """Get or create a libtorrent session for a torrent - OPTIMIZED FOR STREAMING"""
        info_hash = info_hash.lower()
        
        if info_hash in self.sessions:
            return self.sessions[info_hash]
        
        # Create new session with STREAMING-OPTIMIZED settings
        # Key optimizations: Fast peer connection, aggressive piece requests, high cache
        settings = {
            'listen_interfaces': '0.0.0.0:6881,[::]:6881',
            'enable_dht': True,
            'enable_lsd': True,
            'enable_upnp': True,
            'enable_natpmp': True,
            'announce_to_all_trackers': True,
            'announce_to_all_tiers': True,
            
            # ===== AGGRESSIVE CONNECTION SETTINGS (Critical for VPN) =====
            'connection_speed': 500,              # Connections per second to attempt
            'connections_limit': 800,             # Max total connections
            'download_rate_limit': 0,             # Unlimited download
            'upload_rate_limit': 500000,          # 500 KB/s upload (helps reciprocation)
            'unchoke_slots_limit': 20,            # More upload slots = more download reciprocity
            
            # ===== PEER DISCOVERY (Critical for fast startup) =====
            'max_peerlist_size': 8000,
            'max_paused_peerlist_size': 8000,
            'peer_connect_timeout': 7,            # Faster peer timeout (default 15)
            'handshake_timeout': 7,               # Faster handshake timeout
            'torrent_connect_boost': 50,          # Extra connections for new torrents
            'peer_timeout': 60,                   # Keep peers longer
            'inactivity_timeout': 60,
            
            # ===== DISK I/O OPTIMIZATION =====
            'cache_size': 8192,                   # 128MB cache (8192 * 16KB blocks)
            'disk_io_read_mode': 0,               # Enable OS cache
            'disk_io_write_mode': 0,              # Enable OS cache
            'aio_threads': 8,                     # More async IO threads
            
            # ===== STREAMING-SPECIFIC SETTINGS =====
            'request_queue_time': 1,              # Reduced - request only 1 sec ahead (faster starts)
            'max_out_request_queue': 1000,        # Large request queue
            'whole_pieces_threshold': 2,          # Smaller threshold for faster piece completion
            'max_allowed_in_request_queue': 2000, # Allow more incoming requests
            'send_buffer_watermark': 512 * 1024,  # 512KB send buffer
            'send_buffer_watermark_factor': 150,  # Aggressive sending
            
            # ===== PROTOCOL SETTINGS =====
            'mixed_mode_algorithm': 0,            # Prefer TCP (more reliable)
            'rate_limit_ip_overhead': False,      # Don't count protocol overhead in limits
            'allow_multiple_connections_per_ip': True,  # Important for some seedboxes
        }
        
        ses = lt.session(settings)
        
        # Build magnet link with all trackers for faster peer discovery
        magnet = f"magnet:?xt=urn:btih:{info_hash}"
        for tracker in self.trackers:
            magnet += f"&tr={tracker}"
        
        params = {
            'save_path': self.download_dir,
            'storage_mode': lt.storage_mode_t.storage_mode_sparse,
        }
        
        handle = lt.add_magnet_uri(ses, magnet, params)
        
        # CRITICAL: Enable sequential download for streaming
        handle.set_sequential_download(True)
        
        self.sessions[info_hash] = {
            'session': ses,
            'handle': handle,
            'created': time.time(),
            'video_file': None,
            'video_path': None,
        }
        
        logger.info(f"Started STREAMING-OPTIMIZED session for {info_hash}")
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
                # 3. Last 2MB: MEDIUM (priority 4) - for duration/seeking
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
                
                # MEDIUM: Last few pieces (for seeking/duration detection)
                last_piece_count = max(5, 2 * 1024 * 1024 // piece_length)  # ~2MB
                for i in range(max(start_piece, end_piece - last_piece_count), end_piece + 1):
                    priorities[i] = 4
                
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
    
    def cleanup_old_sessions(self, max_age_hours=2):
        """Remove old torrent sessions"""
        current_time = time.time()
        to_remove = []
        
        for info_hash, data in self.sessions.items():
            if current_time - data['created'] > max_age_hours * 3600:
                to_remove.append(info_hash)
        
        for info_hash in to_remove:
            try:
                data = self.sessions[info_hash]
                data['session'].remove_torrent(data['handle'])
                del self.sessions[info_hash]
                logger.info(f"Cleaned up session for {info_hash}")
            except Exception as e:
                logger.error(f"Error cleaning up session {info_hash}: {e}")

# Global torrent streamer instance
torrent_streamer = TorrentStreamer()


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
    
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": "User deleted successfully"}


# ==================== ADDON ROUTES ====================

@api_router.get("/addons")
async def get_addons(current_user: User = Depends(get_current_user)):
    """Get all user's installed addons"""
    addons = await db.addons.find({"userId": current_user.id}).to_list(100)
    for addon in addons:
        addon.pop('_id', None)
    return addons

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

@api_router.get("/streams/{content_type}/{content_id:path}")
async def get_all_streams(
    content_type: str,
    content_id: str,
    current_user: User = Depends(get_current_user)
):
    """Fetch streams from ALL installed addons + built-in Torrentio-style aggregation"""
    
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
        try:
            # Fetch from OnlyPorn/Jaxxx addon which can resolve these URLs to actual streams
            import urllib.parse
            encoded_id = urllib.parse.quote(content_id, safe='')
            stream_url = f"https://07b88951aaab-jaxxx-v2.baby-beamup.club/stream/{content_type}/{encoded_id}.json"
            
            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                response = await client.get(stream_url)
                if response.status_code == 200:
                    data = response.json()
                    streams = data.get('streams', [])
                    # Format streams for our app
                    formatted = []
                    for s in streams:
                        formatted.append({
                            "name": s.get('name', 'Stream'),
                            "title": f"OnlyPorn • {s.get('name', 'Stream')}",
                            "url": s.get('url'),
                            "addon": "OnlyPorn"
                        })
                    logger.info(f"OnlyPorn: Found {len(formatted)} streams")
                    return {"streams": formatted}
        except Exception as e:
            logger.warning(f"OnlyPorn stream fetch error: {e}")
        
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
                    
                    # Provider name mapping
                    provider_names = {
                        'AX': 'A1XS Network',
                        'CV': 'CValley TV',
                        'MJ': 'MoveOnJoy',
                        'MJI': 'MoveOnJoy Intl',
                        'TP': 'TVPass',
                        'PL': 'Pluto',
                        'ST': 'Stirr',
                    }
                    
                    # Format streams for display with location extraction
                    formatted_streams = []
                    for stream in streams:
                        url = stream.get('url', '')
                        desc = stream.get('description', '')
                        quality = stream.get('name', 'HD')
                        
                        # Try to extract location from URL
                        location = ''
                        import re
                        # Patterns like "FL_West_Palm_Beach_CBS" or "Los_Angeles"
                        loc_match = re.search(r'(?:FL_|CA_|TX_|NY_)?([A-Z][a-z]+(?:_[A-Z][a-z]+)*)', url)
                        if loc_match:
                            loc = loc_match.group(1).replace('_', ' ')
                            # Filter out generic words
                            if loc not in ['East', 'West', 'North', 'South', 'Index', 'Live', 'Hls']:
                                location = loc
                        
                        # Also check for call sign patterns like KSMO, KRCG (FCC call signs indicate region)
                        call_match = re.search(r'/([KW][A-Z]{2,4})(?:CBS|NBC|ABC|FOX|IND)?/', url)
                        call_sign = call_match.group(1) if call_match else ''
                        
                        # Get provider full name
                        provider = provider_names.get(desc, desc)
                        
                        # Build display name
                        if location:
                            display_name = f"📺 {quality} • {location}"
                        elif call_sign:
                            display_name = f"📺 {quality} • {call_sign}"
                        else:
                            display_name = f"📺 {quality}"
                        
                        # Build title with provider info
                        title_parts = [provider]
                        if location:
                            title_parts.append(location)
                        if call_sign and location:
                            title_parts.append(f"({call_sign})")
                        elif call_sign:
                            title_parts.append(call_sign)
                        
                        formatted_streams.append({
                            "name": display_name,
                            "title": ' • '.join(title_parts),
                            "url": url,
                            "addon": "USA TV",
                            "quality": quality,
                        })
                    
                    logger.info(f"Found {len(formatted_streams)} USA TV streams for {content_id}")
                    return {"streams": formatted_streams}
        except Exception as e:
            logger.error(f"USA TV streams error: {e}")
        return {"streams": []}
    
    addons = await db.addons.find({"userId": current_user.id}).to_list(100)
    
    all_streams = []
    
    # Get content title for torrent search
    content_title = ""
    content_year = ""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=5.0) as client:
            base_id = content_id.split(':')[0]
            meta_url = f"https://v3-cinemeta.strem.io/meta/{content_type}/{base_id}.json"
            meta_resp = await client.get(meta_url)
            if meta_resp.status_code == 200:
                meta = meta_resp.json().get('meta', {})
                content_title = meta.get('name', '')
                content_year = str(meta.get('year', ''))
                if '–' in content_year:
                    content_year = content_year.split('–')[0]
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
                # Use cloudscraper for Cloudflare bypass
                try:
                    import cloudscraper
                    scraper = cloudscraper.create_scraper(
                        browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
                    )
                    response = await asyncio.to_thread(
                        lambda: scraper.get(stream_url, timeout=30)
                    )
                    if response.status_code == 200:
                        data = response.json()
                        streams = data.get('streams', [])
                        for stream in streams:
                            stream['addon'] = manifest.get('name', 'Torrentio')
                        logger.info(f"Got {len(streams)} streams from {manifest.get('name')} via cloudscraper")
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
                                        "sources": ["tracker:udp://tracker.opentrackr.org:1337/announce"],
                                        "addon": "YTS",
                                        "seeders": torrent['seeds']
                                    })
                            logger.info(f"YTS found {len(streams)} streams for '{simple_query}'")
                            return streams
            except Exception as e:
                logger.warning(f"YTS search error for {url}: {e}")
                continue
        return []
    
    async def search_eztv(imdb_id: str):
        """Search EZTV for TV series"""
        try:
            imdb_num = imdb_id.replace('tt', '') if imdb_id.startswith('tt') else imdb_id
            url = "https://eztv.re/api/get-torrents"
            params = {"imdb_id": imdb_num, "limit": 50}
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    data = response.json()
                    torrents = data.get('torrents', [])
                    streams = []
                    for torrent in torrents:
                        title = torrent.get('title', '')
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
                                "sources": ["tracker:udp://tracker.opentrackr.org:1337/announce"],
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
                async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
                    response = await client.get(url)
                    if response.status_code == 200:
                        torrents = response.json()
                        if isinstance(torrents, list) and len(torrents) > 0 and torrents[0].get('id') != '0':
                            streams = []
                            for torrent in torrents[:20]:
                                name = torrent.get('name', '')
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
                                        "sources": ["tracker:udp://tracker.opentrackr.org:1337/announce"],
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
            url = f"{base_url}/stream/{content_type}/{content_id}.json"
            
            # Use cloudscraper for Cloudflare bypass
            try:
                import cloudscraper
                scraper = cloudscraper.create_scraper(
                    browser={'browser': 'chrome', 'platform': 'windows', 'desktop': True}
                )
                response = await asyncio.to_thread(
                    lambda: scraper.get(url, timeout=30)
                )
                
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
                            # Try to extract from bingeGroup
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
                                "sources": ["tracker:udp://tracker.opentrackr.org:1337/announce"],
                                "addon": "Torrentio",
                                "seeders": seeders,
                                "quality": quality
                            })
                    
                    logger.info(f"Torrentio found {len(streams)} streams for {content_type}/{content_id}")
                    return streams
                else:
                    logger.warning(f"Torrentio returned status {response.status_code}")
            except Exception as e:
                logger.warning(f"Torrentio cloudscraper error: {e}")
        except Exception as e:
            logger.warning(f"Torrentio search error: {e}")
        return []
    
    # Build tasks
    tasks = []
    
    # Add addon stream fetches
    for addon in addons:
        tasks.append(fetch_addon_streams(addon))
    
    # ALWAYS search Torrentio first - it's the best aggregator
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
            if ':' in content_id:
                parts = content_id.split(':')
                if len(parts) >= 3:
                    season = parts[1].zfill(2)
                    episode = parts[2].zfill(2)
                    search_query = f"{content_title} S{season}E{episode}"
                else:
                    search_query = content_title
            else:
                search_query = content_title
            
            tasks.append(search_eztv(base_id))
            tasks.append(search_apibay(search_query, content_type))
    
    # Execute all tasks concurrently
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for result in results:
        if isinstance(result, list):
            all_streams.extend(result)
    
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
    return {"streams": unique_streams}


# ==================== SUBTITLES ====================

@api_router.get("/subtitles/{content_type}/{content_id}")
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
    """Get discover page content from installed addons - organized by service"""
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
    
    # Cinemeta catalogs to fetch - only the ones that work without required params
    # 'top' = Popular, 'year' requires genre=year param, 'imdbRating' = Featured/Top Rated
    cinemeta_fetch = [
        ('movie', 'top', 'Popular Movies'),
        ('series', 'top', 'Popular Series'),
        ('movie', 'year', 'New Movies', 'genre=2025'),  # Fetch 2025 movies
        ('series', 'year', 'New Series', 'genre=2025'),  # Fetch 2025 series
    ]
    
    for addon in addons:
        manifest = addon.get('manifest', {})
        addon_id = manifest.get('id', '').lower()
        addon_name = manifest.get('name', 'Unknown')
        base_url = get_base_url(addon['manifestUrl'])
        catalogs = manifest.get('catalogs', [])
        
        # Handle Cinemeta addon specially - fetch specific catalogs
        if 'cinemeta' in addon_id:
            for fetch_config in cinemeta_fetch:
                catalog_type = fetch_config[0]
                catalog_id = fetch_config[1]
                section_name = fetch_config[2]
                extra_param = fetch_config[3] if len(fetch_config) > 3 else None
                
                try:
                    if extra_param:
                        url = f"{base_url}/catalog/{catalog_type}/{catalog_id}/{extra_param}.json"
                    else:
                        url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                    
                    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                        response = await client.get(url)
                        if response.status_code == 200:
                            metas = response.json().get('metas', [])  # Get all items
                            
                            if section_name not in result['services']:
                                result['services'][section_name] = {'movies': [], 'series': [], 'channels': []}
                            
                            if catalog_type == 'movie':
                                result['services'][section_name]['movies'].extend(metas)
                            else:
                                result['services'][section_name]['series'].extend(metas)
                            logger.info(f"Cinemeta: {len(metas)} items for {section_name}")
                except Exception as e:
                    logger.warning(f"Error fetching Cinemeta {section_name}: {e}")
        
        # Handle Streaming Catalogs addon - organize by streaming service
        elif 'netflix-catalog' in addon['manifestUrl'].lower() or 'streaming-catalogs' in addon_id:
            for catalog in catalogs:
                catalog_type = catalog.get('type', '')
                catalog_id = catalog.get('id', '')
                service_name = service_names.get(catalog_id)
                
                if not service_name or catalog_type not in ['movie', 'series']:
                    continue
                
                try:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                        response = await client.get(url)
                        if response.status_code == 200:
                            metas = response.json().get('metas', [])  # Get all items
                            type_label = 'Movies' if catalog_type == 'movie' else 'Series'
                            section_name = f"{service_name} {type_label}"
                            
                            if section_name not in result['services']:
                                result['services'][section_name] = {'movies': [], 'series': [], 'channels': []}
                            
                            if catalog_type == 'movie':
                                result['services'][section_name]['movies'].extend(metas)
                            else:
                                result['services'][section_name]['series'].extend(metas)
                            logger.info(f"Streaming: {len(metas)} items for {section_name}")
                except Exception as e:
                    logger.warning(f"Error fetching {service_name}: {e}")
        
        # Handle USA TV addon
        elif 'usatv' in addon['manifestUrl'].lower() or 'usatv' in addon_id:
            for catalog in catalogs:
                if catalog.get('type') == 'tv':
                    catalog_id = catalog.get('id', 'usatv')
                    try:
                        url = f"{base_url}/catalog/tv/{catalog_id}.json"
                        async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                            response = await client.get(url)
                            if response.status_code == 200:
                                metas = response.json().get('metas', [])  # Get all channels
                                result['services']['USA TV Channels'] = {'movies': [], 'series': [], 'channels': metas}
                                logger.info(f"USA TV: {len(metas)} channels")
                    except Exception as e:
                        logger.warning(f"Error fetching USA TV: {e}")
                    break
        
        # Generic addon handling - show each catalog as a separate section
        else:
            for catalog in catalogs:
                catalog_type = catalog.get('type', '')
                catalog_id = catalog.get('id', '')
                catalog_name = catalog.get('name', addon_name)
                
                if not catalog_type or not catalog_id:
                    continue
                try:
                    url = f"{base_url}/catalog/{catalog_type}/{catalog_id}.json"
                    async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                        response = await client.get(url)
                        if response.status_code == 200:
                            metas = response.json().get('metas', [])[:30]  # Get 30 items for discover
                            # Filter out items with empty names or IDs
                            metas = [m for m in metas if m.get('name') and m.get('id')]
                            
                            if metas:
                                # Use catalog name as section name
                                section_name = catalog_name
                                if section_name not in result['services']:
                                    result['services'][section_name] = {'movies': [], 'series': [], 'channels': [], '_catalog_id': catalog_id, '_base_url': base_url}
                                
                                if catalog_type == 'movie':
                                    result['services'][section_name]['movies'].extend(metas)
                                elif catalog_type == 'series':
                                    result['services'][section_name]['series'].extend(metas)
                                elif catalog_type == 'tv':
                                    result['services'][section_name]['channels'].extend(metas)
                except Exception as e:
                    logger.warning(f"Error fetching catalog {catalog_id}: {e}")
    
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
                        
                        return {
                            "items": metas[:limit], 
                            "total": len(metas), 
                            "hasMore": len(metas) >= 20,  # If we got 20+ items, there's likely more
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
                
        return {"items": items[:limit], "total": len(items), "hasMore": len(items) >= limit}
    
    return {"items": [], "total": 0, "hasMore": False}

@api_router.get("/content/search")
async def search_content(q: str, current_user: User = Depends(get_current_user)):
    """Search content via Cinemeta - supports title search and cast/director/genre searches"""
    if not q or len(q) < 2:
        return {"movies": [], "series": []}
    
    # Common words to ignore when matching
    STOP_WORDS = {'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'it'}
    
    # Detect if this looks like a person name search (cast/director)
    # Person names usually: 2-3 words, each capitalized, no common movie words
    query_words = q.split()
    MOVIE_WORDS = {'movie', 'film', 'show', 'series', 'season', 'episode', 'part', 'vol', 'volume', '2', '3', 'ii', 'iii'}
    is_likely_person_name = (
        len(query_words) >= 2 and 
        len(query_words) <= 4 and
        all(word[0].isupper() if word else False for word in query_words) and
        not any(word.lower() in MOVIE_WORDS for word in query_words)
    )
    
    # Also detect genre searches
    GENRE_WORDS = {'action', 'comedy', 'drama', 'horror', 'thriller', 'romance', 'sci-fi', 'fantasy', 
                   'adventure', 'animation', 'documentary', 'crime', 'mystery', 'western', 'musical'}
    is_genre_search = q.lower() in GENRE_WORDS
    
    logger.info(f"Search query: '{q}' - is_person_name={is_likely_person_name}, is_genre={is_genre_search}")
    
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
            # For person name or genre searches, trust Cinemeta results more
            trust_results = is_likely_person_name or is_genre_search
            
            movies_scored = [(m, score_result(m, q, trust_cinemeta=trust_results)) for m in movies]
            series_scored = [(s, score_result(s, q, trust_cinemeta=trust_results)) for s in series]
            
            # Only include results with score > 0
            # Increase limit for person/genre searches since we want all results
            result_limit = 50 if trust_results else 15
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
    try:
        # For TV channels, try USA TV addon first
        if content_type == 'tv' and content_id.startswith('ustv'):
            try:
                async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                    url = f"https://848b3516657c-usatv.baby-beamup.club/meta/{content_type}/{content_id}.json"
                    response = await client.get(url)
                    if response.status_code == 200:
                        data = response.json()
                        meta = data.get('meta', {})
                        if meta:
                            logger.info(f"Got TV channel meta for {meta.get('name', content_id)}")
                            return meta
            except Exception as e:
                logger.warning(f"USA TV meta error: {e}")
        
        # For movies/series, use Cinemeta
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
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


# ==================== TORRENT STREAMING ENDPOINTS (WebTorrent Proxy) ====================

TORRENT_SERVER_URL = "http://localhost:8002"

@api_router.post("/stream/start/{info_hash}")
async def start_stream(info_hash: str, current_user: User = Depends(get_current_user)):
    """Start downloading a torrent via WebTorrent server"""
    try:
        logger.info(f"Starting torrent download for {info_hash}")
        
        # Trigger the WebTorrent server to start downloading
        # We make a GET request to /stream which adds the torrent
        # Use a background task so we don't block the response
        async def trigger_torrent():
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                    # Make a request to trigger torrent addition
                    # The stream endpoint will add the torrent and start downloading
                    response = await client.get(
                        f"{TORRENT_SERVER_URL}/stream/{info_hash}",
                        headers={"Range": "bytes=0-1024"}  # Request just first 1KB to trigger start
                    )
                    logger.info(f"Torrent trigger response: {response.status_code}")
            except Exception as e:
                logger.info(f"Torrent {info_hash} triggered (exception: {type(e).__name__})")
        
        # Start in background
        asyncio.create_task(trigger_torrent())
        
        return {"status": "started", "info_hash": info_hash}
    except Exception as e:
        logger.error(f"Error starting stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/stream/status/{info_hash}")
async def stream_status(info_hash: str, current_user: User = Depends(get_current_user)):
    """Get the status of a torrent download from WebTorrent server"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{TORRENT_SERVER_URL}/status/{info_hash}")
            if response.status_code == 200:
                data = response.json()
                # Map WebTorrent response to our expected format
                return {
                    "status": "ready" if data.get("ready") else "buffering",
                    "progress": data.get("progress", 0),
                    "peers": data.get("peers", 0),
                    "download_rate": data.get("downloadSpeed", 0),
                    "downloaded": data.get("downloaded", 0),
                    "name": data.get("name", ""),
                }
            return {"status": "buffering", "progress": 0, "peers": 0}
    except Exception as e:
        logger.error(f"Error getting stream status: {e}")
        return {"status": "buffering", "progress": 0, "peers": 0, "error": str(e)}

@api_router.get("/stream/video/{info_hash}")
async def stream_video(
    info_hash: str,
    request: Request
):
    """Proxy video stream from WebTorrent server"""
    try:
        # Forward range headers for video seeking
        headers = {}
        if "range" in request.headers:
            headers["range"] = request.headers["range"]
        
        logger.info(f"Streaming request for {info_hash}, range: {headers.get('range', 'none')}")
        
        # Create persistent client for streaming
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(None, connect=30.0),  # No read timeout for streaming
            follow_redirects=True
        )
        
        try:
            # Request stream from WebTorrent server
            torrent_url = f"{TORRENT_SERVER_URL}/stream/{info_hash}"
            req = client.build_request("GET", torrent_url, headers=headers)
            response = await client.send(req, stream=True)
            
            if response.status_code not in [200, 206]:
                await response.aclose()
                await client.aclose()
                logger.error(f"WebTorrent server returned {response.status_code}")
                raise HTTPException(status_code=response.status_code, detail="Stream unavailable")
            
            logger.info(f"Stream response: status={response.status_code}, content-length={response.headers.get('content-length', 'unknown')}")
            
            # Forward headers from WebTorrent server
            response_headers = {
                k: v for k, v in response.headers.items()
                if k.lower() not in ['transfer-encoding', 'content-encoding', 'connection']
            }
            
            # Stream the response
            async def stream_generator():
                try:
                    chunk_count = 0
                    total_bytes = 0
                    async for chunk in response.aiter_bytes(chunk_size=2 * 1024 * 1024):  # 2MB chunks
                        chunk_count += 1
                        total_bytes += len(chunk)
                        if chunk_count == 1:
                            logger.info(f"First chunk: {len(chunk)} bytes")
                        yield chunk
                    logger.info(f"Stream complete: {total_bytes / (1024*1024):.1f} MB")
                except asyncio.CancelledError:
                    logger.info("Stream cancelled")
                except Exception as e:
                    logger.error(f"Stream error: {e}")
                finally:
                    try:
                        await response.aclose()
                        await client.aclose()
                    except:
                        pass
            
            return StreamingResponse(
                stream_generator(),
                status_code=response.status_code,
                headers=response_headers,
                media_type=response.headers.get("content-type", "video/mp4")
            )
        except HTTPException:
            await client.aclose()
            raise
        except Exception as e:
            await client.aclose()
            raise
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error streaming video: {e}")
        raise HTTPException(status_code=503, detail=f"Stream unavailable: {str(e)}")

# ==================== ROOT ====================

@api_router.get("/")
async def root():
    return {"message": "PrivastreamCinema API", "version": "1.0.0"}


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
