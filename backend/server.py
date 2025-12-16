from fastapi import FastAPI, APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timedelta
import hashlib
import jwt
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# JWT Secret
JWT_SECRET = os.environ.get('JWT_SECRET', 'privastream-cinema-secret-key-2025')
JWT_ALGORITHM = "HS256"

# External API Base URL
EXTERNAL_API = "https://cinehub-app-1.preview.emergentagent.com"

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

class LibraryItem(BaseModel):
    id: str
    imdb_id: Optional[str] = None
    name: str
    type: str  # 'movie' or 'series'
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
        # Ensure choyt is admin
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
    # Check if username exists
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

@api_router.put("/admin/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: str, user_update: UserUpdate, admin: User = Depends(get_admin_user)):
    user_data = await db.users.find_one({"id": user_id})
    if not user_data:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_dict = {}
    if user_update.email is not None:
        update_dict["email"] = user_update.email
    if user_update.password is not None:
        update_dict["password_hash"] = hash_password(user_update.password)
    if user_update.is_admin is not None:
        update_dict["is_admin"] = user_update.is_admin
    
    if update_dict:
        await db.users.update_one({"id": user_id}, {"$set": update_dict})
    
    updated = await db.users.find_one({"id": user_id})
    return UserResponse(
        id=updated["id"],
        username=updated["username"],
        email=updated.get("email"),
        is_admin=updated.get("is_admin", False),
        created_at=updated.get("created_at", datetime.utcnow())
    )

@api_router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, admin: User = Depends(get_admin_user)):
    # Prevent deleting yourself
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": "User deleted successfully"}


# ==================== LIBRARY ROUTES ====================

@api_router.get("/library")
async def get_library(current_user: User = Depends(get_current_user)):
    library_items = await db.library.find({"user_id": current_user.id}).to_list(1000)
    movies = [item for item in library_items if item.get("type") == "movie"]
    series = [item for item in library_items if item.get("type") == "series"]
    return {"movies": movies, "series": series}

@api_router.post("/library")
async def add_to_library(item: LibraryItem, current_user: User = Depends(get_current_user)):
    item_dict = item.dict()
    item_dict["user_id"] = current_user.id
    
    # Check if already in library
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


# ==================== PROXY ROUTES TO EXTERNAL API ====================

@api_router.get("/content/discover-organized")
async def get_discover(current_user: User = Depends(get_current_user)):
    """Proxy to external API for discover content"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # First try external API
            response = await client.get(
                f"{EXTERNAL_API}/api/content/discover-organized",
                headers={"Authorization": f"Bearer dummy"}
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logger.warning(f"External API failed: {e}")
    
    # Return mock data if external API fails
    return {
        "continueWatching": [],
        "services": {
            "Netflix": {
                "movies": [
                    {"id": "tt14364480", "imdb_id": "tt14364480", "name": "Wake Up Dead Man: A Knives Out Mystery", "type": "movie", "poster": "https://images.justwatch.com/poster/319658825/s332/img", "year": "2025", "imdbRating": "7.9"},
                    {"id": "tt0314331", "imdb_id": "tt0314331", "name": "Love Actually", "type": "movie", "poster": "https://images.justwatch.com/poster/175588666/s332/img", "year": "2003", "imdbRating": "7.6"},
                ],
                "series": []
            },
            "HBO Max": {
                "movies": [
                    {"id": "tt1160419", "imdb_id": "tt1160419", "name": "Dune", "type": "movie", "poster": "https://images.justwatch.com/poster/246339267/s332/img", "year": "2021", "imdbRating": "8.0"},
                ],
                "series": []
            }
        }
    }

@api_router.get("/content/search")
async def search_content(q: str, current_user: User = Depends(get_current_user)):
    """Proxy to external API for search"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.get(
                f"{EXTERNAL_API}/api/content/search",
                params={"q": q},
                headers={"Authorization": f"Bearer dummy"}
            )
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logger.warning(f"External search API failed: {e}")
    
    # Return empty results if external API fails
    return {"movies": [], "series": []}

@api_router.get("/addons")
async def get_addons(current_user: User = Depends(get_current_user)):
    """Return user's addons"""
    addons = await db.addons.find({"user_id": current_user.id}).to_list(100)
    if not addons:
        # Return default addons
        return [
            {
                "id": str(uuid.uuid4()),
                "userId": current_user.id,
                "manifestUrl": "https://v3-cinemeta.strem.io/manifest.json",
                "manifest": {
                    "id": "com.linvo.cinemeta",
                    "name": "Cinemeta",
                    "version": "3.0.13",
                    "description": "The official addon for movie and series catalogs",
                    "logo": None,
                    "types": ["movie", "series"],
                    "resources": ["catalog", "meta"]
                },
                "installed": True,
                "installedAt": datetime.utcnow().isoformat()
            }
        ]
    return addons

@api_router.get("/addons/{addon_id}/stream/{content_type}/{content_id}")
async def get_streams(addon_id: str, content_type: str, content_id: str, current_user: User = Depends(get_current_user)):
    """Get streams for content"""
    return {"streams": []}


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
