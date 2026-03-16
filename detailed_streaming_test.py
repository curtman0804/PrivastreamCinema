#!/usr/bin/env python3
"""
Detailed ExoPlayer-style streaming test for PrivastreamCinema
This simulates the exact pattern ExoPlayer uses for video playback
"""

import asyncio
import httpx
import json
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Test configuration
BACKEND_URL = "https://fire-stick-remote.preview.emergentagent.com"
PUBLIC_URL = "https://fire-stick-remote.preview.emergentagent.com"

TEST_USER = {
    "username": "choyt",
    "password": "RFIDGuy1!"
}

async def test_specific_review_request():
    """Test the exact scenarios from the review request"""
    
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        
        print("🎬 PRIVASTREAMCINEMA DETAILED STREAMING TEST")
        print("="*60)
        
        # 1. Authentication Test
        print("\n1️⃣ Testing Authentication...")
        try:
            login_response = await client.post(f"{BACKEND_URL}/api/auth/login", json=TEST_USER)
            if login_response.status_code == 200:
                auth_data = login_response.json()
                token = auth_data["token"]
                print(f"✅ Authentication successful - token obtained")
                headers = {"Authorization": f"Bearer {token}"}
            else:
                print(f"❌ Authentication failed: {login_response.status_code}")
                return
        except Exception as e:
            print(f"❌ Authentication error: {e}")
            return
        
        # 2. Health Check Test
        print("\n2️⃣ Testing Health Check...")
        try:
            health_response = await client.get(f"{BACKEND_URL}/api/health")
            if health_response.status_code == 200:
                health_data = health_response.json()
                print(f"✅ Health check passed: {health_data}")
            else:
                print(f"❌ Health check failed: {health_response.status_code}")
        except Exception as e:
            print(f"❌ Health check error: {e}")
        
        # 3. Stream Search Test (The Shawshank Redemption)
        print("\n3️⃣ Testing Stream Search for tt0111161 (The Shawshank Redemption)...")
        try:
            streams_response = await client.get(f"{BACKEND_URL}/api/streams/movie/tt0111161", headers=headers)
            if streams_response.status_code == 200:
                streams_data = streams_response.json()
                streams = streams_data.get("streams", [])
                streams_with_hash = [s for s in streams if s.get("infoHash")]
                
                print(f"✅ Found {len(streams)} streams, {len(streams_with_hash)} with infoHash")
                
                if streams_with_hash:
                    # Find the stream with the most seeders
                    best_stream = max(streams_with_hash, key=lambda x: x.get("seeders", 0))
                    best_info_hash = best_stream["infoHash"]
                    seeders = best_stream.get("seeders", 0)
                    print(f"🎯 Selected stream: {best_stream.get('title', 'Unknown')} with {seeders} seeders")
                    print(f"🔗 InfoHash: {best_info_hash}")
                    
                    # Test the full ExoPlayer streaming pattern
                    await test_exoplayer_simulation(client, headers, best_info_hash)
                else:
                    print("❌ No streams with infoHash found")
            else:
                print(f"❌ Stream search failed: {streams_response.status_code}")
                
        except Exception as e:
            print(f"❌ Stream search error: {e}")
        
        # 4. Content Discovery Test
        print("\n4️⃣ Testing Content Discovery...")
        try:
            discover_response = await client.get(f"{BACKEND_URL}/api/content/discover-organized", headers=headers)
            if discover_response.status_code == 200:
                discover_data = discover_response.json()
                services = discover_data.get("services", {})
                section_count = len(services)
                total_items = sum(len(items) for items in services.values())
                print(f"✅ Discover content working: {section_count} sections, {total_items} items")
            else:
                print(f"❌ Content discovery failed: {discover_response.status_code}")
        except Exception as e:
            print(f"❌ Content discovery error: {e}")
        
        # 5. Addon Management Test
        print("\n5️⃣ Testing Addon Management...")
        try:
            addons_response = await client.get(f"{BACKEND_URL}/api/addons", headers=headers)
            if addons_response.status_code == 200:
                addons = addons_response.json()
                addon_names = [addon.get("manifest", {}).get("name", "Unknown") for addon in addons]
                print(f"✅ Addon management working: {len(addons)} addons installed")
                print(f"   Addons: {', '.join(addon_names)}")
            else:
                print(f"❌ Addon management failed: {addons_response.status_code}")
        except Exception as e:
            print(f"❌ Addon management error: {e}")


async def test_exoplayer_simulation(client, headers, info_hash):
    """
    4. CRITICAL - Full Streaming Pipeline (simulate ExoPlayer)
    This tests the exact pattern described in the review request
    """
    
    print(f"\n🚀 CRITICAL STREAMING PIPELINE TEST (ExoPlayer Simulation)")
    print(f"Using infoHash: {info_hash}")
    print("-" * 50)
    
    try:
        # Step a: Start the torrent
        print("a) Starting torrent stream...")
        start_time = time.time()
        start_response = await client.post(f"{BACKEND_URL}/api/stream/start/{info_hash}", headers=headers)
        start_duration = time.time() - start_time
        
        if start_response.status_code == 200:
            start_data = start_response.json()
            print(f"✅ Stream start: {start_data.get('status')} (took {start_duration:.2f}s)")
        else:
            print(f"❌ Stream start failed: {start_response.status_code}")
            return
        
        # Step b: Wait 5 seconds
        print("b) Waiting 5 seconds...")
        await asyncio.sleep(5)
        
        # Step c: Check status until ready
        print("c) Checking stream status...")
        max_attempts = 15
        for attempt in range(max_attempts):
            status_time = time.time()
            status_response = await client.get(f"{BACKEND_URL}/api/stream/status/{info_hash}", headers=headers)
            status_duration = time.time() - status_time
            
            if status_response.status_code == 200:
                status_data = status_response.json()
                status = status_data.get("status", "")
                peers = status_data.get("peers", 0)
                progress = status_data.get("progress", 0)
                
                print(f"   Attempt {attempt+1}: status={status}, peers={peers}, progress={progress:.1f}% (took {status_duration:.2f}s)")
                
                if status == "ready" and peers > 0:
                    print(f"✅ Stream ready with {peers} peers")
                    break
            else:
                print(f"❌ Status check failed: {status_response.status_code}")
                return
            
            if attempt < max_attempts - 1:
                await asyncio.sleep(2)
        
        # Step d: Test range request for beginning of file (2MB)
        print("d) Testing ExoPlayer-style range request (first 2MB)...")
        range_start_time = time.time()
        video_headers = headers.copy()
        video_headers["Range"] = "bytes=0-2097151"  # First 2MB as specified
        
        video_response = await client.get(f"{BACKEND_URL}/api/stream/video/{info_hash}?fileIdx=0", 
                                        headers=video_headers, timeout=30.0)
        range_duration = time.time() - range_start_time
        
        if video_response.status_code == 206:  # Partial Content
            content_type = video_response.headers.get("content-type", "")
            content_length = len(video_response.content)
            print(f"✅ Range request (start): 206 Partial Content, {content_type}, {content_length} bytes (took {range_duration:.2f}s)")
            
            # Get total file size for end-of-file test
            content_range = video_response.headers.get("content-range", "")
            if content_range:
                # Parse "bytes 0-2097151/total_size" format
                try:
                    total_size = int(content_range.split("/")[1])
                    print(f"   Total file size: {total_size:,} bytes ({total_size/(1024*1024):.1f} MB)")
                    
                    # Step e: Test end-of-file request (ExoPlayer reads end for moov atom)
                    print("e) Testing end-of-file request (last 200KB)...")
                    end_start_time = time.time()
                    end_headers = headers.copy()
                    end_start = total_size - 200000  # Last 200KB
                    end_headers["Range"] = f"bytes={end_start}-{total_size-1}"
                    
                    end_response = await client.get(f"{BACKEND_URL}/api/stream/video/{info_hash}?fileIdx=0", 
                                                  headers=end_headers, timeout=30.0)
                    end_duration = time.time() - end_start_time
                    
                    if end_response.status_code == 206:
                        end_content_length = len(end_response.content)
                        print(f"✅ End-of-file request: 206 Partial Content, {end_content_length} bytes (took {end_duration:.2f}s)")
                        
                        if end_duration > 30:
                            print(f"⚠️  WARNING: End-of-file took {end_duration:.2f}s (should be under 30s)")
                    else:
                        print(f"❌ End-of-file request failed: {end_response.status_code}")
                        
                except ValueError:
                    print("⚠️  Could not parse content-range for file size")
                    
        elif video_response.status_code == 200:
            # Full content response
            content_length = len(video_response.content)
            print(f"✅ Range request: 200 OK (full content), {content_length} bytes (took {range_duration:.2f}s)")
        else:
            print(f"❌ Range request failed: {video_response.status_code}")
            return
        
        # Step f: Another small range request (512KB)
        print("f) Testing smaller range request (512KB)...")
        small_range_start_time = time.time()
        small_headers = headers.copy()
        small_headers["Range"] = "bytes=0-524287"  # 512KB as specified
        
        small_response = await client.get(f"{BACKEND_URL}/api/stream/video/{info_hash}?fileIdx=0", 
                                        headers=small_headers, timeout=30.0)
        small_range_duration = time.time() - small_range_start_time
        
        if small_response.status_code in [200, 206]:
            small_content_length = len(small_response.content)
            print(f"✅ Small range request: {small_response.status_code}, {small_content_length} bytes (took {small_range_duration:.2f}s)")
        else:
            print(f"❌ Small range request failed: {small_response.status_code}")
        
        # Step 5: Test public URL access
        print("\n🌐 Testing Public URL Access...")
        public_start_time = time.time()
        public_headers = {"Range": "bytes=0-524287"}  # Same small range
        
        public_response = await client.get(f"{PUBLIC_URL}/api/stream/video/{info_hash}?fileIdx=0", 
                                         headers=public_headers, timeout=30.0)
        public_duration = time.time() - public_start_time
        
        if public_response.status_code in [200, 206]:
            public_content_length = len(public_response.content)
            print(f"✅ Public URL access: {public_response.status_code}, {public_content_length} bytes (took {public_duration:.2f}s)")
        else:
            print(f"❌ Public URL access failed: {public_response.status_code}")
        
        print(f"\n🎉 ExoPlayer simulation completed!")
        print(f"Performance summary:")
        print(f"  • Stream start: {start_duration:.2f}s")
        print(f"  • First 2MB: {range_duration:.2f}s")
        print(f"  • End-of-file: {end_duration:.2f}s")
        print(f"  • Small range: {small_range_duration:.2f}s")
        print(f"  • Public access: {public_duration:.2f}s")
        
        # Performance validation
        fast_requests = sum(1 for t in [range_duration, small_range_duration, public_duration] if t < 5.0)
        print(f"  • Fast requests (< 5s): {fast_requests}/3")
        
        if fast_requests >= 2:
            print("✅ Streaming performance is good!")
        else:
            print("⚠️  Some requests were slow (> 5s)")
            
    except Exception as e:
        print(f"❌ ExoPlayer simulation failed: {e}")


if __name__ == "__main__":
    asyncio.run(test_specific_review_request())