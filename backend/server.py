from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
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
    }
}


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

@api_router.get("/streams/{content_type}/{content_id}")
async def get_all_streams(
    content_type: str,
    content_id: str,
    current_user: User = Depends(get_current_user)
):
    """Fetch streams from ALL installed addons that support streaming"""
    addons = await db.addons.find({"userId": current_user.id}).to_list(100)
    
    all_streams = []
    
    async def fetch_addon_streams(addon):
        """Fetch streams from a single addon"""
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
            
            async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                response = await client.get(stream_url)
                if response.status_code == 200:
                    data = response.json()
                    streams = data.get('streams', [])
                    # Add addon name to each stream
                    for stream in streams:
                        stream['addon'] = manifest.get('name', 'Unknown')
                    return streams
        except Exception as e:
            logger.warning(f"Error fetching streams from {addon.get('manifest', {}).get('name')}: {str(e)}")
        return []
    
    # Fetch from all addons concurrently
    tasks = [fetch_addon_streams(addon) for addon in addons]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for result in results:
        if isinstance(result, list):
            all_streams.extend(result)
    
    return {"streams": all_streams}


# ==================== CONTENT ROUTES ====================

@api_router.get("/content/discover-organized")
async def get_discover(current_user: User = Depends(get_current_user)):
    """Get discover page content from installed addons"""
    addons = await db.addons.find({"userId": current_user.id}).to_list(100)
    
    result = {
        "continueWatching": [],
        "services": {}
    }
    
    # Find streaming catalogs addon and cinemeta
    streaming_addon = None
    cinemeta_addon = None
    usatv_addon = None
    
    for addon in addons:
        manifest = addon.get('manifest', {})
        manifest_url = addon.get('manifestUrl', '').lower()
        addon_id = manifest.get('id', '').lower()
        
        if 'netflix-catalog' in manifest_url or 'streaming-catalogs' in addon_id:
            streaming_addon = addon
        elif 'cinemeta' in addon_id:
            cinemeta_addon = addon
        elif 'usatv' in manifest_url or 'usatv' in addon_id:
            usatv_addon = addon
    
    # Fetch catalog helper
    async def fetch_catalog(addon, catalog_type, catalog_id, extra_path=""):
        try:
            base_url = get_base_url(addon['manifestUrl'])
            url = f"{base_url}/catalog/{catalog_type}/{catalog_id}{extra_path}.json"
            async with httpx.AsyncClient(follow_redirects=True, timeout=20.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    return data.get('metas', [])
        except Exception as e:
            logger.warning(f"Error fetching catalog {catalog_id}: {str(e)}")
        return []
    
    # Streaming services catalog IDs (for the streaming catalogs addon)
    streaming_services = {
        'Netflix': 'nfx',
        'HBO Max': 'hbm',
        'Disney+': 'dnp',
        'Prime Video': 'amp',
        'Hulu': 'hlu',
        'Paramount+': 'pmp',
        'Apple TV+': 'atp',
        'Peacock': 'pcp',
        'Discovery+': 'dpe',
    }
    
    # If we have the streaming catalogs addon, fetch from it
    if streaming_addon:
        tasks = []
        task_info = []
        
        for service_name, service_id in streaming_services.items():
            # Movies
            tasks.append(fetch_catalog(streaming_addon, 'movie', service_id))
            task_info.append((service_name, 'movies'))
            # Series
            tasks.append(fetch_catalog(streaming_addon, 'series', service_id))
            task_info.append((service_name, 'series'))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, res in enumerate(results):
            if isinstance(res, list) and len(res) > 0:
                service_name, content_type = task_info[i]
                if service_name not in result['services']:
                    result['services'][service_name] = {'movies': [], 'series': []}
                result['services'][service_name][content_type] = res[:15]
    
    # Add USA TV if addon installed
    if usatv_addon:
        usa_channels = await fetch_catalog(usatv_addon, 'tv', 'usatv')
        if usa_channels:
            result['services']['USA TV'] = {'channels': usa_channels[:20], 'movies': [], 'series': []}
    
    # Add Popular content from Cinemeta
    if cinemeta_addon:
        popular_movies = await fetch_catalog(cinemeta_addon, 'movie', 'top')
        popular_series = await fetch_catalog(cinemeta_addon, 'series', 'top')
        featured_movies = await fetch_catalog(cinemeta_addon, 'movie', 'year', '/year=2024')
        featured_series = await fetch_catalog(cinemeta_addon, 'series', 'year', '/year=2024')
        
        if popular_movies or popular_series:
            result['services']['Popular'] = {
                'movies': popular_movies[:15],
                'series': popular_series[:15]
            }
        if featured_movies or featured_series:
            result['services']['Featured'] = {
                'movies': featured_movies[:15],
                'series': featured_series[:15]
            }
    
    # Fallback mock data if no addons/content
    if not result['services']:
        result['services'] = {
            "Popular": {
                "movies": [
                    {"id": "tt14364480", "imdb_id": "tt14364480", "name": "Wake Up Dead Man: A Knives Out Mystery", "type": "movie", "poster": "https://images.justwatch.com/poster/319658825/s332/img", "year": "2025", "imdbRating": "7.9"},
                    {"id": "tt0314331", "imdb_id": "tt0314331", "name": "Love Actually", "type": "movie", "poster": "https://images.justwatch.com/poster/175588666/s332/img", "year": "2003", "imdbRating": "7.6"},
                ],
                "series": []
            }
        }
    
    return result

@api_router.get("/content/search")
async def search_content(q: str, current_user: User = Depends(get_current_user)):
    """Search content via Cinemeta"""
    if not q or len(q) < 2:
        return {"movies": [], "series": []}
    
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
            movie_url = f"https://v3-cinemeta.strem.io/catalog/movie/top/search={q}.json"
            series_url = f"https://v3-cinemeta.strem.io/catalog/series/top/search={q}.json"
            
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
            
            return {"movies": movies[:30], "series": series[:30]}
    except Exception as e:
        logger.error(f"Search error: {str(e)}")
        return {"movies": [], "series": []}

@api_router.get("/content/meta/{content_type}/{content_id}")
async def get_meta(content_type: str, content_id: str, current_user: User = Depends(get_current_user)):
    """Get metadata for content"""
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10.0) as client:
            url = f"https://v3-cinemeta.strem.io/meta/{content_type}/{content_id}.json"
            response = await client.get(url)
            if response.status_code == 200:
                data = response.json()
                return data.get('meta', {})
    except Exception as e:
        logger.error(f"Error fetching meta: {str(e)}")
    
    raise HTTPException(status_code=404, detail="Meta not found")


# ==================== LIBRARY ROUTES ====================

@api_router.get("/library")
async def get_library(current_user: User = Depends(get_current_user)):
    library_items = await db.library.find({"user_id": current_user.id}).to_list(1000)
    movies = [item for item in library_items if item.get("type") == "movie"]
    series = [item for item in library_items if item.get("type") == "series"]
    for item in movies + series:
        item.pop('_id', None)
    return {"movies": movies, "series": series}

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
