"""
Real-Debrid Integration Module for Privastream Cinema
=====================================================

Provides instant HTTPS streaming for cached torrents via Real-Debrid API.
No BitTorrent traffic — ISP sees only HTTPS to real-debrid.com.

Flow:
1. User clicks play → resolve(info_hash) called
2. Check if hash already resolved in cache → return URL instantly
3. If not: addMagnet → selectFiles → poll until downloaded → unrestrict link
4. Return direct HTTPS download URL for video player
5. For uncached content: fall back to torrent-stream engine

API Docs: https://api.real-debrid.com
Rate limit: 250 requests/minute
"""

import httpx
import asyncio
import logging
import time
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Video file extensions for auto-selection
VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v', '.wmv', '.flv', '.ts', '.m2ts'}

@dataclass
class DebridResult:
    """Resolved Real-Debrid stream result"""
    status: str  # "resolving", "ready", "error", "not_cached"
    download_url: Optional[str] = None
    filename: Optional[str] = None
    filesize: int = 0
    mime_type: str = "video/mp4"
    error: Optional[str] = None
    torrent_id: Optional[str] = None
    progress: float = 0.0
    resolved_at: float = 0.0  # timestamp when URL was resolved

class RealDebridClient:
    """
    Real-Debrid API client with in-memory caching.
    
    Resolves torrent info hashes to direct HTTPS download URLs.
    Cached torrents resolve in <2 seconds. Uncached torrents download
    on RD's servers first (progress tracked via polling).
    """
    
    API_BASE = "https://api.real-debrid.com/rest/1.0"
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.enabled = bool(api_key and len(api_key) > 10)
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json"
        }
        # Cache: info_hash -> DebridResult (avoids re-resolving same content)
        self._cache: Dict[str, DebridResult] = {}
        self._latest_cache_key: Dict[str, str] = {}  # hash → latest cache_key
        # Active resolution tasks: info_hash -> asyncio.Task
        self._active_tasks: Dict[str, asyncio.Task] = {}
        # HTTP client (reused connections)
        self._client: Optional[httpx.AsyncClient] = None
        
        if self.enabled:
            logger.info("[DEBRID] Real-Debrid integration ENABLED")
        else:
            logger.info("[DEBRID] Real-Debrid integration DISABLED (no API key)")
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create shared HTTP client"""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=self._headers,
                timeout=20.0,
                follow_redirects=True,
                limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
            )
        return self._client
    
    async def _api_get(self, endpoint: str) -> Dict:
        """Make GET request to RD API"""
        client = await self._get_client()
        url = f"{self.API_BASE}{endpoint}"
        response = await client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def _api_post(self, endpoint: str, data: Dict = None) -> Dict:
        """Make POST request to RD API"""
        client = await self._get_client()
        url = f"{self.API_BASE}{endpoint}"
        response = await client.post(url, data=data or {})
        if response.status_code == 204:
            return {}
        response.raise_for_status()
        try:
            return response.json()
        except Exception:
            return {}
    
    async def _api_delete(self, endpoint: str) -> None:
        """Make DELETE request to RD API"""
        client = await self._get_client()
        url = f"{self.API_BASE}{endpoint}"
        await client.delete(url)
    
    async def check_instant_availability(self, hashes: List[str]) -> List[str]:
        """Check which hashes are instantly available (cached) on RD.
        Returns list of hashes that are cached."""
        if not self.enabled or not hashes:
            return []
        try:
            # RD accepts up to 100 hashes per request
            hash_str = "/".join(h.lower() for h in hashes[:100])
            result = await self._api_get(f"/torrents/instantAvailability/{hash_str}")
            cached = []
            for h in hashes:
                h_lower = h.lower()
                if h_lower in result and result[h_lower]:
                    # Has at least one cached variant
                    variants = result[h_lower]
                    if isinstance(variants, dict) and any(variants.values()):
                        cached.append(h_lower)
                    elif isinstance(variants, list) and len(variants) > 0:
                        cached.append(h_lower)
            logger.warning(f"[DEBRID] Instant availability: {len(cached)}/{len(hashes)} cached")
            return cached
        except Exception as e:
            logger.error(f"[DEBRID] Instant availability check failed: {e}")
            return []
    
    def get_status(self, info_hash: str) -> DebridResult:
        """
        Get current resolution status for an info hash.
        Returns the LATEST resolved result (most recent episode request).
        """
        hash_lower = info_hash.lower()
        
        # Use the latest cache key for this hash (tracks most recent episode request)
        if hash_lower in self._latest_cache_key:
            latest_key = self._latest_cache_key[hash_lower]
            if latest_key in self._cache:
                return self._cache[latest_key]
            # Latest key not in cache yet — check if task is running
            if latest_key in self._active_tasks:
                task = self._active_tasks[latest_key]
                if not task.done():
                    return DebridResult(status="resolving", progress=20.0)
                try:
                    return task.result()
                except Exception:
                    pass
        
        # Check any active task matching this hash
        for key, task in self._active_tasks.items():
            if key.startswith(hash_lower):
                if not task.done():
                    return DebridResult(status="resolving", progress=20.0)
                try:
                    result = task.result()
                    if result and result.status == "ready":
                        return result
                except Exception:
                    pass
        
        # Only use generic hash cache if no specific episode was requested
        if hash_lower not in self._latest_cache_key and hash_lower in self._cache:
            return self._cache[hash_lower]
        
        return DebridResult(status="not_started")
    
    async def resolve(self, info_hash: str, file_idx: Optional[int] = None, filename: Optional[str] = None, season: Optional[int] = None, episode: Optional[int] = None) -> DebridResult:
        """
        Start resolving an info hash via Real-Debrid.
        
        If already cached/resolved, returns immediately.
        Otherwise starts background resolution and returns "resolving" status.
        
        Args:
            info_hash: Torrent info hash (40-char hex)
            file_idx: Optional file index to select (for season packs)
        
        Returns:
            DebridResult with status and download_url when ready
        """
        if not self.enabled:
            return DebridResult(status="disabled", error="Real-Debrid not configured")
        
        hash_lower = info_hash.lower()
        
        # Cache key includes file_idx so different episodes of same torrent hash are resolved separately
        cache_key = f"{hash_lower}:{file_idx}" if file_idx is not None else hash_lower
        
        # CRITICAL: When a new episode is requested, invalidate any stale/stuck state
        # This prevents "streams too slow" on re-entry after backing out
        old_cache_key = self._latest_cache_key.get(hash_lower)
        if old_cache_key and old_cache_key != cache_key:
            # Different episode of same torrent — clean up old state
            if old_cache_key in self._active_tasks:
                old_task = self._active_tasks[old_cache_key]
                if not old_task.done():
                    old_task.cancel()
                del self._active_tasks[old_cache_key]
            logger.warning(f"[DEBRID] Switching from {old_cache_key} → {cache_key}")
        
        # Also clean up ANY stuck tasks for this hash
        stale_keys = [k for k in self._active_tasks if k.startswith(hash_lower) and k != cache_key]
        for k in stale_keys:
            task = self._active_tasks[k]
            if task.done():
                del self._active_tasks[k]
        
        # Return cached result if ready and not expired (RD URLs expire)
        import time as _time
        CACHE_TTL = 300  # 5 minutes
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            if cached.status == "ready" and cached.download_url:
                if cached.resolved_at > 0 and (_time.time() - cached.resolved_at) < CACHE_TTL:
                    logger.warning(f"[DEBRID] Cache hit for {hash_lower[:8]} fileIdx={file_idx} → instant URL")
                    return cached
                else:
                    # URL expired, re-resolve
                    logger.warning(f"[DEBRID] Cache expired for {hash_lower[:8]}, re-resolving")
                    del self._cache[cache_key]
            # If previous attempt errored, allow retry
            if cache_key in self._cache and self._cache[cache_key].status == "error":
                del self._cache[cache_key]
        
        # If already resolving, return current status
        if cache_key in self._active_tasks:
            task = self._active_tasks[cache_key]
            if not task.done():
                return DebridResult(status="resolving", progress=20.0)
            # Task finished - check result
            try:
                result = task.result()
                return result
            except Exception as e:
                logger.error(f"[DEBRID] Resolution task failed for {hash_lower[:8]}: {e}")
                del self._active_tasks[cache_key]
                return DebridResult(status="error", error=str(e))
        
        # Start new resolution in background
        logger.warning(f"[DEBRID] Starting resolution for {hash_lower[:8]} fileIdx={file_idx} filename={filename}")
        self._latest_cache_key[hash_lower] = cache_key  # Track latest episode request
        task = asyncio.create_task(self._resolve_hash(hash_lower, file_idx, filename, cache_key, season, episode))
        self._active_tasks[cache_key] = task
        
        # Wait for resolution — cached torrents resolve in <5s, give plenty of time
        try:
            result = await asyncio.wait_for(asyncio.shield(task), timeout=10.0)
            return result
        except asyncio.TimeoutError:
            # Still resolving - return progress status
            return DebridResult(status="resolving", progress=15.0)
    
    async def _resolve_hash(self, info_hash: str, file_idx: Optional[int] = None, filename: Optional[str] = None, cache_key: Optional[str] = None, season: Optional[int] = None, episode: Optional[int] = None) -> DebridResult:
        """
        Internal: Full resolution flow for an info hash.
        
        1. Add magnet to RD
        2. Select video file(s)
        3. Poll until downloaded (instant for cached)
        4. Unrestrict download link
        5. Cache and return result
        """
        torrent_id = None
        try:
            # Step 1: Add magnet
            magnet = f"magnet:?xt=urn:btih:{info_hash}"
            logger.warning(f"[DEBRID] Adding magnet for {info_hash[:8]}")
            
            result = await self._api_post("/torrents/addMagnet", {"magnet": magnet})
            torrent_id = result.get("id")
            
            if not torrent_id:
                error_msg = result.get("error", "Unknown error adding magnet")
                logger.warning(f"[DEBRID] addMagnet failed for {info_hash[:8]}: {error_msg}")
                err_result = DebridResult(status="error", error=error_msg)
                self._cache[cache_key or info_hash] = err_result
                return err_result
            
            logger.warning(f"[DEBRID] Torrent created: {torrent_id} for {info_hash[:8]}")
            
            # Step 2: Get torrent info and select files
            info = await self._api_get(f"/torrents/info/{torrent_id}")
            status = info.get("status", "")
            
            # If torrent is already downloaded (from a previous episode), we need to
            # check if the CORRECT file is available. If not, delete and re-add.
            if status == "downloaded" and (file_idx is not None or filename):
                # Check if our target file is in the available links
                files = info.get("files", [])
                target_ids = self._select_video_files(files, file_idx, filename, season, episode)
                selected_files = [f for f in files if f.get("selected") == 1]
                selected_ids = [f["id"] for f in selected_files]
                
                target_in_selected = target_ids and any(tid in selected_ids for tid in target_ids)
                
                if not target_in_selected:
                    # Wrong file is selected — delete torrent and re-add with correct file
                    logger.warning(f"[DEBRID] Wrong file selected for {info_hash[:8]}. Target={target_ids}, Selected={selected_ids}. Re-adding...")
                    await self._safe_delete_torrent(torrent_id)
                    await asyncio.sleep(0.5)
                    
                    # Re-add magnet
                    result = await self._api_post("/torrents/addMagnet", {"magnet": magnet})
                    torrent_id = result.get("id")
                    if not torrent_id:
                        err_result = DebridResult(status="error", error="Failed to re-add magnet")
                        self._cache[cache_key or info_hash] = err_result
                        return err_result
                    
                    info = await self._api_get(f"/torrents/info/{torrent_id}")
                    status = info.get("status", "")
                    logger.warning(f"[DEBRID] Re-added torrent {torrent_id}, status={status}")
                else:
                    # Correct file IS selected — find its link index
                    links = info.get("links", [])
                    if links and target_ids:
                        # Map selected file IDs to link indices
                        link_idx = 0
                        for sf in sorted(selected_files, key=lambda f: f["id"]):
                            if sf["id"] in target_ids:
                                if link_idx < len(links):
                                    download_url = await self._unrestrict_link(links[link_idx])
                                    if download_url:
                                        sel_filename = sf.get("path", "").split("/")[-1] or info.get("filename", "video.mp4")
                                        ready_result = DebridResult(
                                            status="ready",
                                            download_url=download_url["url"],
                                            filename=download_url.get("filename", sel_filename),
                                            filesize=download_url.get("filesize", 0),
                                            mime_type=download_url.get("mimeType", "video/mp4"),
                                            torrent_id=torrent_id,
                                            progress=100.0,
                                            resolved_at=__import__("time").time()
                                        )
                                        self._cache[cache_key or info_hash] = ready_result
                                        logger.info(f"[DEBRID] ✅ {info_hash[:8]} file {target_ids[0]} READY (reused)! URL: {download_url['url'][:60]}...")
                                        return ready_result
                                break
                            link_idx += 1
                    
                    # Fallback — just unrestrict first link
                    if links:
                        download_url = await self._unrestrict_link(links[0])
                        if download_url:
                            ready_result = DebridResult(
                                status="ready",
                                download_url=download_url["url"],
                                filename=download_url.get("filename", "video.mp4"),
                                filesize=download_url.get("filesize", 0),
                                mime_type=download_url.get("mimeType", "video/mp4"),
                                torrent_id=torrent_id,
                                progress=100.0,
                                resolved_at=__import__("time").time()
                            )
                            self._cache[cache_key or info_hash] = ready_result
                            return ready_result
            
            if status == "waiting_files_selection":
                # Select the right video file
                files = info.get("files", [])
                file_ids = self._select_video_files(files, file_idx, filename, season, episode)
                
                if not file_ids:
                    logger.warning(f"[DEBRID] No video files found for {info_hash[:8]}")
                    err_result = DebridResult(status="error", error="No video files in torrent")
                    self._cache[cache_key or info_hash] = err_result
                    # Cleanup
                    await self._safe_delete_torrent(torrent_id)
                    return err_result
                
                logger.warning(f"[DEBRID] Selecting files: {file_ids} for {info_hash[:8]}")
                await self._api_post(f"/torrents/selectFiles/{torrent_id}", {"files": ",".join(str(f) for f in file_ids)})
            
            # Step 3: Poll until downloaded (cached = instant, uncached = wait)
            max_polls = 120  # 2 minutes max
            poll_interval = 1.0  # Start with 1s polls
            
            for poll_num in range(max_polls):
                info = await self._api_get(f"/torrents/info/{torrent_id}")
                status = info.get("status", "")
                progress = info.get("progress", 0)
                
                logger.info(f"[DEBRID] {info_hash[:8]} status={status} progress={progress}%")
                
                # Update cache with progress
                self._cache[cache_key or info_hash] = DebridResult(
                    status="resolving",
                    progress=progress,
                    torrent_id=torrent_id,
                    filename=info.get("filename", "")
                )
                
                if status == "downloaded":
                    # Step 4: Get links and unrestrict
                    links = info.get("links", [])
                    if not links:
                        err_result = DebridResult(status="error", error="No download links available")
                        self._cache[cache_key or info_hash] = err_result
                        return err_result
                    
                    # For season packs: match the correct link to our target episode
                    # RD links correspond 1:1 with selected files (sorted by file ID)
                    selected_files = sorted(
                        [f for f in info.get("files", []) if f.get("selected") == 1],
                        key=lambda x: x.get("id", 0)
                    )
                    
                    target_link_idx = 0  # Default to first link
                    
                    if len(selected_files) > 1 and (file_idx is not None or (season is not None and episode is not None) or filename):
                        # Multiple files selected — find the right one
                        target_ids = self._select_video_files(info.get("files", []), file_idx, filename, season, episode)
                        if target_ids:
                            for idx, sf in enumerate(selected_files):
                                if sf["id"] in target_ids:
                                    target_link_idx = idx
                                    logger.warning(f"[DEBRID] Season pack: matched file {sf['id']} ({sf.get('path','')}) → link[{idx}]")
                                    break
                    
                    if target_link_idx >= len(links):
                        target_link_idx = 0  # Safety fallback
                    
                    logger.warning(f"[DEBRID] Unrestricting link[{target_link_idx}] of {len(links)} for {info_hash[:8]} (fileIdx={file_idx}, S{season}E{episode})")
                    download_url = await self._unrestrict_link(links[target_link_idx])
                    
                    if download_url:
                        sel_filename = info.get("filename", "video.mp4")
                        if target_link_idx < len(selected_files):
                            sel_filename = selected_files[target_link_idx].get("path", "").split("/")[-1] or sel_filename
                        
                        ready_result = DebridResult(
                            status="ready",
                            download_url=download_url["url"],
                            filename=download_url.get("filename", sel_filename),
                            filesize=download_url.get("filesize", 0),
                            mime_type=download_url.get("mimeType", "video/mp4"),
                            torrent_id=torrent_id,
                            progress=100.0,
                            resolved_at=__import__("time").time()
                        )
                        self._cache[cache_key or info_hash] = ready_result
                        logger.info(f"[DEBRID] ✅ {info_hash[:8]} READY (link[{target_link_idx}])! URL: {download_url['url'][:60]}...")
                        return ready_result
                    else:
                        err_result = DebridResult(status="error", error="Failed to unrestrict link")
                        self._cache[cache_key or info_hash] = err_result
                        return err_result
                
                elif status in ("magnet_error", "error", "virus", "dead"):
                    error_msg = f"RD error: {status}"
                    logger.warning(f"[DEBRID] {info_hash[:8]} failed: {error_msg}")
                    err_result = DebridResult(status="error", error=error_msg)
                    self._cache[cache_key or info_hash] = err_result
                    await self._safe_delete_torrent(torrent_id)
                    return err_result
                
                # Wait before next poll (faster at start, slower later)
                await asyncio.sleep(poll_interval)
                if poll_num > 5:
                    poll_interval = 2.0
                if poll_num > 20:
                    poll_interval = 5.0
            
            # Timed out
            logger.warning(f"[DEBRID] {info_hash[:8]} timed out after {max_polls} polls")
            timeout_result = DebridResult(status="error", error="Resolution timed out - content may not be cached")
            self._cache[cache_key or info_hash] = timeout_result
            return timeout_result
            
        except httpx.HTTPStatusError as e:
            error_body = ""
            try:
                error_body = e.response.json().get("error", "")
            except Exception:
                error_body = str(e.response.status_code)
            
            logger.error(f"[DEBRID] HTTP error for {info_hash[:8]}: {e.response.status_code} - {error_body}")
            err_result = DebridResult(status="error", error=f"RD API error: {error_body}")
            self._cache[cache_key or info_hash] = err_result
            return err_result
            
        except Exception as e:
            logger.error(f"[DEBRID] Unexpected error for {info_hash[:8]}: {e}")
            err_result = DebridResult(status="error", error=str(e))
            self._cache[cache_key or info_hash] = err_result
            return err_result
        
        finally:
            # Clean up active task reference (use cache_key, not just info_hash)
            if cache_key:
                self._active_tasks.pop(cache_key, None)
            self._active_tasks.pop(info_hash, None)
    
    def _select_video_files(self, files: List[Dict], file_idx: Optional[int] = None, filename: Optional[str] = None, season: Optional[int] = None, episode: Optional[int] = None) -> List[int]:
        """
        Select the best video file(s) from a torrent's file list.
        
        Priority:
        1. Match by filename (most reliable for season packs)
        2. Match by file_idx (Torrentio provides this)
        3. Fallback to largest video file
        """
        if not files:
            return []
        
        import re
        
        # Strategy 0: Match by season/episode numbers (always available from frontend)
        if season is not None and episode is not None:
            import re as _re
            target_patterns = [
                _re.compile(rf'[Ss]0?{season}[Ee]0?{episode}\b'),
                _re.compile(rf'season.?0?{season}.*episode.?0?{episode}', _re.IGNORECASE),
                _re.compile(rf'[._ -]0?{season}x0?{episode:02d}[._ -]', _re.IGNORECASE),
            ]
            for f in files:
                rd_path = (f.get("path") or "").lower()
                ext = self._get_extension(rd_path)
                if ext not in VIDEO_EXTENSIONS:
                    continue
                for pat in target_patterns:
                    if pat.search(rd_path):
                        logger.warning(f"[DEBRID] Season/episode match: S{season:02d}E{episode:02d} → file {f['id']} ({rd_path})")
                        return [f["id"]]
        
        # Strategy 1: Match by filename from Torrentio (most reliable)
        if filename:
            fname_lower = filename.lower().strip()
            for f in files:
                rd_path = (f.get("path") or "").lower()
                rd_name = rd_path.split("/")[-1] if "/" in rd_path else rd_path
                ext = self._get_extension(rd_path)
                if ext in VIDEO_EXTENSIONS and rd_name and fname_lower and (
                    fname_lower in rd_name or rd_name in fname_lower
                ):
                    logger.warning(f"[DEBRID] Filename match: '{rd_name}' matched '{fname_lower}' → file {f['id']}")
                    return [f["id"]]
            
            # Try episode pattern match from filename (e.g. S01E02)
            ep_match = re.search(r'[Ss](\d{1,2})[Ee](\d{1,2})', fname_lower)
            if ep_match:
                target_season = int(ep_match.group(1))
                target_episode = int(ep_match.group(2))
                for f in files:
                    rd_path = (f.get("path") or "").lower()
                    ext = self._get_extension(rd_path)
                    if ext not in VIDEO_EXTENSIONS:
                        continue
                    f_match = re.search(r'[Ss](\d{1,2})[Ee](\d{1,2})', rd_path)
                    if f_match and int(f_match.group(1)) == target_season and int(f_match.group(2)) == target_episode:
                        logger.warning(f"[DEBRID] Episode pattern match: S{target_season:02d}E{target_episode:02d} → file {f['id']} ({rd_path})")
                        return [f["id"]]
        
        # Strategy 2: Match by file_idx (0-based from Torrentio → try multiple mappings)
        if file_idx is not None:
            # Try direct 1-based mapping first
            rd_idx = file_idx + 1
            for f in files:
                if f.get("id") == rd_idx:
                    ext = self._get_extension(f.get("path", ""))
                    if ext in VIDEO_EXTENSIONS:
                        logger.warning(f"[DEBRID] fileIdx match: idx={file_idx} → RD file {rd_idx}")
                        return [rd_idx]
            
            # Try matching by position among video files only
            video_files = sorted(
                [f for f in files if self._get_extension(f.get("path", "")) in VIDEO_EXTENSIONS],
                key=lambda x: x.get("id", 0)
            )
            if 0 <= file_idx < len(video_files):
                matched = video_files[file_idx]
                logger.warning(f"[DEBRID] fileIdx positional match: video[{file_idx}] → RD file {matched['id']} ({matched.get('path','')})")
                return [matched["id"]]
        
        # Strategy 3: Fallback — largest video file
        video_files = [f for f in files if self._get_extension(f.get("path", "")) in VIDEO_EXTENSIONS]
        
        if not video_files:
            if files:
                largest = max(files, key=lambda x: x.get("bytes", 0))
                return [largest["id"]]
            return []
        
        if len(video_files) == 1:
            return [video_files[0]["id"]]
        
        largest_video = max(video_files, key=lambda x: x.get("bytes", 0))
        logger.warning(f"[DEBRID] No specific match — using largest video: file {largest_video['id']} ({largest_video.get('path','')})")
        return [largest_video["id"]]
    
    @staticmethod
    def _get_extension(path: str) -> str:
        """Get lowercase file extension from path"""
        if not path:
            return ""
        parts = path.rsplit(".", 1)
        if len(parts) == 2:
            return f".{parts[1].lower()}"
        return ""
    
    async def _unrestrict_link(self, link: str) -> Optional[Dict]:
        """
        Unrestrict a Real-Debrid link to get direct download URL.
        
        Returns dict with: url, filename, filesize, mimeType
        """
        try:
            result = await self._api_post("/unrestrict/link", {"link": link})
            download_url = result.get("download")
            if download_url:
                return {
                    "url": download_url,
                    "filename": result.get("filename", "video.mp4"),
                    "filesize": result.get("filesize", 0),
                    "mimeType": result.get("mimeType", "video/mp4"),
                    "streamable": result.get("streamable", 0)
                }
            logger.warning(f"[DEBRID] Unrestrict returned no download URL: {result}")
            return None
        except Exception as e:
            logger.error(f"[DEBRID] Unrestrict failed: {e}")
            return None

    async def unrestrict_url(self, url: str) -> Optional[Dict]:
        """
        Unrestrict ANY external URL through Real-Debrid.
        
        This routes the request through RD's servers so:
        - Your server never connects to the content site (redtube, etc.)
        - ISP only sees traffic to real-debrid.com
        - Returns an RD-hosted HTTPS download URL
        
        Supports: direct video links, file hosters, streaming sites.
        
        Args:
            url: Any direct video/content URL (e.g., https://redtube.com/video.mp4)
        
        Returns:
            Dict with: url, filename, filesize, mimeType
            None if unrestriction fails (unsupported host, etc.)
        """
        if not self.enabled:
            logger.warning("[DEBRID] Cannot unrestrict URL — RD not enabled")
            return None
        
        # Check cache (keyed by original URL)
        cache_key = f"unrestrict:{url}"
        if cache_key in self._cache:
            cached = self._cache[cache_key]
            if cached.status == "ready" and cached.download_url:
                logger.info(f"[DEBRID] Unrestrict cache hit for {url[:60]}")
                return {
                    "url": cached.download_url,
                    "filename": cached.filename or "video.mp4",
                    "filesize": cached.filesize,
                    "mimeType": cached.mime_type,
                }
        
        try:
            logger.info(f"[DEBRID] Unrestricting external URL: {url[:80]}")
            result = await self._api_post("/unrestrict/link", {"link": url})
            download_url = result.get("download")
            
            if download_url:
                data = {
                    "url": download_url,
                    "filename": result.get("filename", "video.mp4"),
                    "filesize": result.get("filesize", 0),
                    "mimeType": result.get("mimeType", "video/mp4"),
                    "streamable": result.get("streamable", 0),
                    "host": result.get("host", ""),
                }
                # Cache the result
                self._cache[cache_key] = DebridResult(
                    status="ready",
                    download_url=download_url,
                    filename=data["filename"],
                    filesize=data["filesize"],
                    mime_type=data["mimeType"],
                )
                logger.info(f"[DEBRID] ✅ Unrestricted: {url[:40]}... → {download_url[:60]}...")
                return data
            
            error = result.get("error", "No download URL returned")
            logger.warning(f"[DEBRID] Unrestrict failed for {url[:60]}: {error}")
            return None
            
        except httpx.HTTPStatusError as e:
            error_body = ""
            try:
                error_body = e.response.json().get("error", str(e.response.status_code))
            except Exception:
                error_body = str(e.response.status_code)
            logger.error(f"[DEBRID] Unrestrict HTTP error for {url[:60]}: {error_body}")
            return None
        except Exception as e:
            logger.error(f"[DEBRID] Unrestrict unexpected error: {e}")
            return None
    
    async def _safe_delete_torrent(self, torrent_id: str):
        """Delete a torrent from RD account (cleanup)"""
        try:
            await self._api_delete(f"/torrents/delete/{torrent_id}")
        except Exception:
            pass  # Don't fail on cleanup
    
    def clear_cache(self, info_hash: Optional[str] = None):
        """Clear resolution cache for a specific hash or all"""
        if info_hash:
            self._cache.pop(info_hash.lower(), None)
        else:
            self._cache.clear()
    
    async def get_streaming_url(self, info_hash: str) -> Optional[str]:
        """
        Quick helper: Get the streaming URL for an already-resolved hash.
        Returns None if not resolved yet.
        """
        result = self.get_status(info_hash.lower())
        if result.status == "ready" and result.download_url:
            return result.download_url
        return None
    
    async def proxy_stream(self, info_hash: str, range_header: Optional[str] = None):
        """
        Proxy the RD download through our server.
        
        This ensures:
        1. RD only sees our server's IP (multi-user safe)
        2. Download links always work (not IP-restricted to client)
        
        Returns: (async_generator, headers, status_code) or None
        """
        download_url = await self.get_streaming_url(info_hash)
        if not download_url:
            return None
        
        try:
            client = await self._get_client()
            headers = {}
            if range_header:
                headers["Range"] = range_header
            
            # Stream from RD with range support
            req = client.build_request("GET", download_url, headers=headers)
            response = await client.send(req, stream=True)
            
            # Build response headers
            resp_headers = {}
            for key in ["content-type", "content-length", "content-range", "accept-ranges"]:
                val = response.headers.get(key)
                if val:
                    resp_headers[key] = val
            
            if "accept-ranges" not in resp_headers:
                resp_headers["accept-ranges"] = "bytes"
            
            return {
                "stream": response,
                "headers": resp_headers,
                "status_code": response.status_code
            }
        except Exception as e:
            logger.error(f"[DEBRID] Proxy stream error for {info_hash[:8]}: {e}")
            return None
    
    async def close(self):
        """Close HTTP client"""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
