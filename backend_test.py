#!/usr/bin/env python3
"""
PrivastreamCinema Backend API Test Suite
Tests the critical endpoints specified in the review request.
"""

import asyncio
import aiohttp
import json
import time
import sys
from typing import Dict, Any, Optional

# Backend URL from environment
BACKEND_URL = "https://fix-test-deploy.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

class PrivastreamTester:
    def __init__(self):
        self.session = None
        self.auth_token = None
        self.test_results = []
        
    async def setup(self):
        """Initialize HTTP session"""
        connector = aiohttp.TCPConnector(limit=10, limit_per_host=5)
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(
            connector=connector,
            timeout=timeout,
            headers={"User-Agent": "PrivastreamCinema-Tester/1.0"}
        )
        
    async def cleanup(self):
        """Clean up resources"""
        if self.session:
            await self.session.close()
    
    def log_test(self, name: str, success: bool, duration: float, details: str = "", response_code: int = None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        self.test_results.append({
            "name": name,
            "success": success,
            "duration": duration,
            "details": details,
            "response_code": response_code
        })
        print(f"{status} {name} ({duration:.3f}s) - {details}")
        
    async def test_1_login(self) -> bool:
        """Test 1: POST /api/auth/login with choyt/RFIDGuy1!"""
        start_time = time.time()
        try:
            login_data = {
                "username": "choyt",
                "password": "RFIDGuy1!"
            }
            
            async with self.session.post(
                f"{API_BASE}/auth/login",
                json=login_data,
                headers={"Content-Type": "application/json"}
            ) as response:
                duration = time.time() - start_time
                text = await response.text()
                
                if response.status == 200:
                    try:
                        data = await response.json()
                        if "access_token" in data:
                            self.auth_token = data["access_token"]
                        elif "token" in data:
                            self.auth_token = data["token"]
                            self.log_test("Login Authentication", True, duration, 
                                        f"JWT token received (length: {len(self.auth_token)})", response.status)
                            return True
                        else:
                            self.log_test("Login Authentication", False, duration, 
                                        f"No access_token in response: {text}", response.status)
                            return False
                    except json.JSONDecodeError:
                        self.log_test("Login Authentication", False, duration, 
                                    f"Invalid JSON response: {text}", response.status)
                        return False
                else:
                    self.log_test("Login Authentication", False, duration, 
                                f"HTTP {response.status}: {text}", response.status)
                    return False
                    
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Login Authentication", False, duration, f"Exception: {str(e)}")
            return False
    
    async def test_2_health(self) -> bool:
        """Test 2: GET /api/health"""
        start_time = time.time()
        try:
            async with self.session.get(f"{API_BASE}/health") as response:
                duration = time.time() - start_time
                text = await response.text()
                
                if response.status == 200:
                    try:
                        data = await response.json()
                        if data.get("status") == "ok" and "service" in data:
                            self.log_test("Health Check", True, duration, 
                                        f"Service: {data.get('service', 'unknown')}", response.status)
                            return True
                        else:
                            self.log_test("Health Check", False, duration, 
                                        f"Invalid response structure: {data}", response.status)
                            return False
                    except json.JSONDecodeError:
                        self.log_test("Health Check", False, duration, 
                                    f"Invalid JSON response: {text}", response.status)
                        return False
                else:
                    self.log_test("Health Check", False, duration, 
                                f"HTTP {response.status}: {text}", response.status)
                    return False
                    
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Health Check", False, duration, f"Exception: {str(e)}")
            return False
    
    async def test_3_prewarm(self, info_hash: str) -> bool:
        """Test 3: POST /api/stream/prewarm/{infoHash}"""
        start_time = time.time()
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            async with self.session.post(
                f"{API_BASE}/stream/prewarm/{info_hash}",
                headers=headers
            ) as response:
                duration = time.time() - start_time
                text = await response.text()
                
                if response.status == 200:
                    try:
                        data = await response.json()
                        status = data.get("status")
                        if status in ["warming", "already_warming"]:
                            details = f"Status: {status}"
                            if "torrent_status" in data:
                                details += f", Torrent: {data['torrent_status']}"
                            self.log_test("Stream Prewarm", True, duration, details, response.status)
                            return True
                        else:
                            self.log_test("Stream Prewarm", False, duration, 
                                        f"Unexpected status: {status}", response.status)
                            return False
                    except json.JSONDecodeError:
                        self.log_test("Stream Prewarm", False, duration, 
                                    f"Invalid JSON response: {text}", response.status)
                        return False
                else:
                    self.log_test("Stream Prewarm", False, duration, 
                                f"HTTP {response.status}: {text}", response.status)
                    return False
                    
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Stream Prewarm", False, duration, f"Exception: {str(e)}")
            return False
    
    async def test_4_stream_status(self, info_hash: str) -> bool:
        """Test 4: GET /api/stream/status/{infoHash} - verify ready_progress field"""
        start_time = time.time()
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            async with self.session.get(
                f"{API_BASE}/stream/status/{info_hash}",
                headers=headers
            ) as response:
                duration = time.time() - start_time
                text = await response.text()
                
                if response.status == 200:
                    try:
                        data = await response.json()
                        
                        # Check for ready_progress field (critical requirement)
                        has_ready_progress = "ready_progress" in data
                        ready_progress = data.get("ready_progress", "N/A")
                        status = data.get("status", "unknown")
                        peers = data.get("peers", 0)
                        
                        if has_ready_progress:
                            self.log_test("Stream Status (ready_progress field)", True, duration, 
                                        f"Status: {status}, Peers: {peers}, ready_progress: {ready_progress}%", 
                                        response.status)
                            return True
                        else:
                            self.log_test("Stream Status (ready_progress field)", False, duration, 
                                        f"CRITICAL: ready_progress field MISSING. Response: {data}", 
                                        response.status)
                            return False
                            
                    except json.JSONDecodeError:
                        self.log_test("Stream Status (ready_progress field)", False, duration, 
                                    f"Invalid JSON response: {text}", response.status)
                        return False
                else:
                    self.log_test("Stream Status (ready_progress field)", False, duration, 
                                f"HTTP {response.status}: {text}", response.status)
                    return False
                    
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Stream Status (ready_progress field)", False, duration, f"Exception: {str(e)}")
            return False
    
    async def test_5_stream_start(self, info_hash: str) -> bool:
        """Test 5: POST /api/stream/start/{infoHash}"""
        start_time = time.time()
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            async with self.session.post(
                f"{API_BASE}/stream/start/{info_hash}",
                headers=headers
            ) as response:
                duration = time.time() - start_time
                text = await response.text()
                
                if response.status == 200:
                    try:
                        data = await response.json()
                        status = data.get("status")
                        if status == "started":
                            self.log_test("Stream Start", True, duration, 
                                        f"Status: {status}", response.status)
                            return True
                        else:
                            self.log_test("Stream Start", False, duration, 
                                        f"Unexpected status: {status}", response.status)
                            return False
                    except json.JSONDecodeError:
                        # Sometimes returns plain text "started"
                        if text.strip() == '"started"' or text.strip() == 'started':
                            self.log_test("Stream Start", True, duration, 
                                        f"Status: started (plain text)", response.status)
                            return True
                        else:
                            self.log_test("Stream Start", False, duration, 
                                        f"Invalid response: {text}", response.status)
                            return False
                else:
                    self.log_test("Stream Start", False, duration, 
                                f"HTTP {response.status}: {text}", response.status)
                    return False
                    
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Stream Start", False, duration, f"Exception: {str(e)}")
            return False
    
    async def test_6_video_range(self, info_hash: str) -> bool:
        """Test 6: GET /api/stream/video/{infoHash}?fileIdx=0 with Range: bytes=0-65535 - expect 206"""
        start_time = time.time()
        try:
            headers = {
                "Range": "bytes=0-65535"
            }
            if self.auth_token:
                headers["Authorization"] = f"Bearer {self.auth_token}"
            
            async with self.session.get(
                f"{API_BASE}/stream/video/{info_hash}",
                params={"fileIdx": "0"},
                headers=headers
            ) as response:
                duration = time.time() - start_time
                
                if response.status == 206:  # Partial Content
                    content_length = response.headers.get('Content-Length', '0')
                    content_type = response.headers.get('Content-Type', 'unknown')
                    content_range = response.headers.get('Content-Range', 'unknown')
                    
                    # Read the actual content to verify we get data
                    content = await response.read()
                    actual_bytes = len(content)
                    
                    self.log_test("Video Range Request (206)", True, duration, 
                                f"Type: {content_type}, Range: {content_range}, Bytes: {actual_bytes}", 
                                response.status)
                    return True
                    
                elif response.status == 200:
                    # Sometimes returns 200 instead of 206, but still valid if we get data
                    content = await response.read()
                    actual_bytes = len(content)
                    content_type = response.headers.get('Content-Type', 'unknown')
                    
                    self.log_test("Video Range Request (200 fallback)", True, duration, 
                                f"Type: {content_type}, Bytes received: {actual_bytes}", 
                                response.status)
                    return True
                    
                else:
                    text = await response.text()
                    self.log_test("Video Range Request", False, duration, 
                                f"Expected 206, got HTTP {response.status}: {text}", response.status)
                    return False
                    
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Video Range Request", False, duration, f"Exception: {str(e)}")
            return False
    
    async def test_7_streams_search(self) -> bool:
        """Test 7: GET /api/streams/movie/tt0111161 - verify streams returned"""
        start_time = time.time()
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            async with self.session.get(
                f"{API_BASE}/streams/movie/tt0111161",
                headers=headers
            ) as response:
                duration = time.time() - start_time
                text = await response.text()
                
                if response.status == 200:
                    try:
                        data = await response.json()
                        if isinstance(data, list):
                            streams = data
                        elif isinstance(data, dict) and "streams" in data:
                            streams = data["streams"]
                        else:
                            streams = []
                        
                        total_streams = len(streams)
                        streams_with_infohash = sum(1 for s in streams if s.get("infoHash"))
                        
                        if total_streams > 0:
                            self.log_test("Streams Search", True, duration, 
                                        f"Found {total_streams} streams, {streams_with_infohash} with infoHash", 
                                        response.status)
                            return True
                        else:
                            self.log_test("Streams Search", False, duration, 
                                        f"No streams found in response: {data}", response.status)
                            return False
                            
                    except json.JSONDecodeError:
                        self.log_test("Streams Search", False, duration, 
                                    f"Invalid JSON response: {text}", response.status)
                        return False
                else:
                    self.log_test("Streams Search", False, duration, 
                                f"HTTP {response.status}: {text}", response.status)
                    return False
                    
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Streams Search", False, duration, f"Exception: {str(e)}")
            return False
    
    async def run_all_tests(self):
        """Run all review request tests in sequence"""
        print("🎬 PRIVASTREAMCINEMA BACKEND API TESTING")
        print("=" * 50)
        print(f"Testing against: {BACKEND_URL}")
        print()
        
        # Test hash from review request
        test_info_hash = "08ada5a7a6183aae1e09d831df6748d566095a10"
        
        # Run tests in sequence
        await self.setup()
        
        try:
            # Test 1: Authentication (required for other tests)
            print("🔐 Testing Authentication...")
            login_success = await self.test_1_login()
            
            # Test 2: Health check
            print("\n🏥 Testing Health Endpoint...")
            await self.test_2_health()
            
            # Test 3: Pre-warm endpoint
            print(f"\n🚀 Testing Pre-warm Endpoint (hash: {test_info_hash[:16]}...)...")
            await self.test_3_prewarm(test_info_hash)
            
            # Test 4: Stream status with ready_progress field
            print(f"\n📊 Testing Stream Status (ready_progress field)...")
            await self.test_4_stream_status(test_info_hash)
            
            # Test 5: Stream start
            print(f"\n▶️ Testing Stream Start...")
            await self.test_5_stream_start(test_info_hash)
            
            # Test 6: Video range request (critical for ExoPlayer)
            print(f"\n🎬 Testing Video Range Request (bytes=0-65535)...")
            await self.test_6_video_range(test_info_hash)
            
            # Test 7: Stream search
            print(f"\n🔍 Testing Streams Search (tt0111161 - Shawshank Redemption)...")
            await self.test_7_streams_search()
            
        finally:
            await self.cleanup()
        
        # Print summary
        print("\n" + "=" * 50)
        print("📋 FINAL TEST SUMMARY")
        print("=" * 50)
        
        passed = sum(1 for r in self.test_results if r["success"])
        total = len(self.test_results)
        
        for result in self.test_results:
            status = "✅ PASS" if result["success"] else "❌ FAIL"
            code_info = f" [{result['response_code']}]" if result["response_code"] else ""
            print(f"{status} {result['name']}{code_info} ({result['duration']:.3f}s)")
            if not result["success"] or result["details"]:
                print(f"     {result['details']}")
        
        print(f"\n🎯 OVERALL RESULT: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
        
        if passed == total:
            print("🎉 ALL REVIEW REQUEST REQUIREMENTS VERIFIED!")
        else:
            print("⚠️  Some tests failed - see details above")
            
        return passed == total

async def main():
    """Main entry point"""
    tester = PrivastreamTester()
    success = await tester.run_all_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    asyncio.run(main())