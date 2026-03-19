#!/usr/bin/env python3
"""
Enhanced Backend API Testing for PrivastreamCinema - Review Request Specific Tests
Tests the exact scenarios mentioned in the review request with specific focus on:
1. ready_progress field in status response
2. Range request patterns (0-2097151, end-of-file)
3. Health endpoint performance
4. All APIs under 5s performance target
"""

import asyncio
import httpx
import json
import time
import logging
from typing import Dict, Any, Optional

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Test configuration
BACKEND_URL = "https://fix-test-deploy.preview.emergentagent.com"

# Test credentials as specified in review request
TEST_USER = {
    "username": "choyt",
    "password": "RFIDGuy1!"
}

class EnhancedBackendTester:
    def __init__(self):
        self.token = None
        self.client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)
        self.test_results = []
        
    async def __aenter__(self):
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()
    
    def add_result(self, test_name: str, passed: bool, details: str = "", error: str = "", performance_ms: Optional[int] = None):
        """Add test result to the collection"""
        perf_info = f" ({performance_ms}ms)" if performance_ms else ""
        self.test_results.append({
            "test": test_name,
            "passed": passed,
            "details": details,
            "error": error,
            "performance_ms": performance_ms
        })
        status = "✅ PASS" if passed else "❌ FAIL"
        logger.info(f"{status}: {test_name}{perf_info} - {details}")
        if error:
            logger.error(f"ERROR: {error}")
    
    async def test_authentication(self):
        """Test 1: Authentication - POST /api/auth/login with exact credentials from review"""
        try:
            start_time = time.time()
            login_data = {
                "username": TEST_USER["username"],
                "password": TEST_USER["password"]
            }
            
            response = await self.client.post(f"{BACKEND_URL}/api/auth/login", json=login_data)
            duration_ms = int((time.time() - start_time) * 1000)
            
            if response.status_code == 200:
                data = response.json()
                if "token" in data and "user" in data:
                    self.token = data["token"]
                    user = data["user"]
                    self.add_result(
                        "Authentication", 
                        True, 
                        f"Login successful for user {user['username']}, JWT token obtained",
                        performance_ms=duration_ms
                    )
                    return True
                else:
                    self.add_result("Authentication", False, "", "Response missing token or user data", duration_ms)
                    return False
            else:
                self.add_result("Authentication", False, "", f"Login failed with status {response.status_code}: {response.text}", duration_ms)
                return False
                
        except Exception as e:
            self.add_result("Authentication", False, "", f"Exception during login: {str(e)}")
            return False
    
    async def test_health_endpoint(self):
        """Test 2: Health Check - GET /api/health"""
        try:
            start_time = time.time()
            response = await self.client.get(f"{BACKEND_URL}/api/health")
            duration_ms = int((time.time() - start_time) * 1000)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    self.add_result(
                        "Health Check",
                        True,
                        f"Health endpoint responding correctly: {data}",
                        performance_ms=duration_ms
                    )
                    return True
                else:
                    self.add_result("Health Check", False, "", f"Unexpected health response: {data}", duration_ms)
                    return False
            else:
                self.add_result("Health Check", False, "", f"Health check failed: {response.status_code} - {response.text}", duration_ms)
                return False
                
        except Exception as e:
            self.add_result("Health Check", False, "", f"Exception: {str(e)}")
            return False
    
    async def test_streams_endpoint(self):
        """Test 3: Stream Fetching - GET /api/streams/movie/tt0111161 (should return 20+ streams with infoHash)"""
        try:
            start_time = time.time()
            headers = {"Authorization": f"Bearer {self.token}"}
            # Test with The Shawshank Redemption as specified in review
            movie_id = "tt0111161"
            response = await self.client.get(f"{BACKEND_URL}/api/streams/movie/{movie_id}", headers=headers)
            duration_ms = int((time.time() - start_time) * 1000)
            
            if response.status_code == 200:
                data = response.json()
                streams = data.get("streams", [])
                
                # Check that we have streams with infoHash
                streams_with_hash = [s for s in streams if s.get("infoHash")]
                has_20_plus = len(streams_with_hash) >= 20
                
                self.add_result(
                    "Stream Fetching",
                    has_20_plus,
                    f"Found {len(streams)} total streams, {len(streams_with_hash)} with infoHash for {movie_id}",
                    "" if has_20_plus else f"Expected 20+ streams with infoHash, got {len(streams_with_hash)}",
                    duration_ms
                )
                return streams_with_hash[0]["infoHash"] if streams_with_hash else None
                
            else:
                self.add_result("Stream Fetching", False, "", f"Failed with status {response.status_code}", duration_ms)
                return None
                
        except Exception as e:
            self.add_result("Stream Fetching", False, "", f"Exception: {str(e)}")
            return None
    
    async def test_full_streaming_pipeline(self, info_hash: str):
        """Test 4: CRITICAL - Full Streaming Pipeline as specified in review request"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            
            # Step 1: Start the stream
            start_time = time.time()
            start_response = await self.client.post(f"{BACKEND_URL}/api/stream/start/{info_hash}", headers=headers)
            start_duration_ms = int((time.time() - start_time) * 1000)
            
            if start_response.status_code != 200:
                self.add_result("Stream Start", False, "", f"Start failed with status {start_response.status_code}", start_duration_ms)
                return False
            
            start_data = start_response.json()
            if start_data.get("status") != "started":
                self.add_result("Stream Start", False, "", f"Expected status 'started', got {start_data.get('status')}", start_duration_ms)
                return False
            
            self.add_result("Stream Start", True, f"Stream started successfully", performance_ms=start_duration_ms)
            
            # Step 2: Wait 5 seconds as specified in review
            logger.info("Waiting 5 seconds as specified in review...")
            await asyncio.sleep(5)
            
            # Step 3: Check status and verify ready_progress field exists
            start_time = time.time()
            status_response = await self.client.get(f"{BACKEND_URL}/api/stream/status/{info_hash}", headers=headers)
            status_duration_ms = int((time.time() - start_time) * 1000)
            
            if status_response.status_code == 200:
                status_data = status_response.json()
                status = status_data.get("status", "")
                peers = status_data.get("peers", 0)
                
                # CRITICAL CHECK: ready_progress field must exist (new field mentioned in review)
                has_ready_progress = "ready_progress" in status_data
                ready_progress_value = status_data.get("ready_progress", "NOT_FOUND")
                
                if has_ready_progress:
                    self.add_result(
                        "Stream Status (ready_progress field)",
                        True,
                        f"Status: {status}, peers: {peers}, ready_progress: {ready_progress_value}%",
                        performance_ms=status_duration_ms
                    )
                else:
                    self.add_result(
                        "Stream Status (ready_progress field)",
                        False,
                        f"Status: {status}, peers: {peers}",
                        f"ready_progress field MISSING from response. Available fields: {list(status_data.keys())}",
                        status_duration_ms
                    )
                    return False
            else:
                self.add_result("Stream Status", False, "", f"Status check failed: {status_response.status_code}", status_duration_ms)
                return False
            
            # Step 4: Test video streaming with Range requests as specified in review
            return await self.test_range_requests(info_hash, headers)
            
        except Exception as e:
            self.add_result("Full Streaming Pipeline", False, "", f"Exception: {str(e)}")
            return False
    
    async def test_range_requests(self, info_hash: str, headers: Dict[str, str]):
        """Test Range requests as specified in review request"""
        try:
            # Test 1: Range: bytes=0-2097151 (exactly as specified in review)
            start_time = time.time()
            video_headers = headers.copy()
            video_headers["Range"] = "bytes=0-2097151"
            
            video_response = await self.client.get(
                f"{BACKEND_URL}/api/stream/video/{info_hash}?fileIdx=0", 
                headers=video_headers
            )
            range1_duration_ms = int((time.time() - start_time) * 1000)
            
            if video_response.status_code == 206:  # Expect 206 Partial Content
                content_length = len(video_response.content)
                content_type = video_response.headers.get("content-type", "")
                
                self.add_result(
                    "Range Request (0-2097151)",
                    True,
                    f"206 Partial Content, {content_length} bytes, {content_type}",
                    performance_ms=range1_duration_ms
                )
            else:
                self.add_result(
                    "Range Request (0-2097151)",
                    False,
                    "",
                    f"Expected 206, got {video_response.status_code}",
                    range1_duration_ms
                )
                return False
            
            # Test 2: End-of-file range request (simulate getting file size first)
            # Get the status to find file size
            status_response = await self.client.get(f"{BACKEND_URL}/api/stream/status/{info_hash}", headers=headers)
            if status_response.status_code == 200:
                status_data = status_response.json()
                video_size = status_data.get("video_size")
                
                if video_size:
                    # Request last 200KB of file
                    start_byte = max(0, video_size - 200000)
                    end_byte = video_size - 1
                    
                    start_time = time.time()
                    end_headers = headers.copy()
                    end_headers["Range"] = f"bytes={start_byte}-{end_byte}"
                    
                    end_response = await self.client.get(
                        f"{BACKEND_URL}/api/stream/video/{info_hash}?fileIdx=0",
                        headers=end_headers
                    )
                    end_duration_ms = int((time.time() - start_time) * 1000)
                    
                    if end_response.status_code == 206:
                        self.add_result(
                            "Range Request (end-of-file)",
                            True,
                            f"206 Partial Content, end range {start_byte}-{end_byte}",
                            performance_ms=end_duration_ms
                        )
                    else:
                        self.add_result(
                            "Range Request (end-of-file)",
                            False,
                            "",
                            f"Expected 206, got {end_response.status_code}",
                            end_duration_ms
                        )
                        return False
                else:
                    self.add_result(
                        "Range Request (end-of-file)",
                        False,
                        "",
                        "Could not determine video_size from status response"
                    )
            
            # Test 3: Public URL access as specified in review
            start_time = time.time()
            public_headers = {"Range": "bytes=0-524287"}  # Different range for variety
            public_response = await self.client.get(
                f"{BACKEND_URL}/api/stream/video/{info_hash}?fileIdx=0",
                headers=public_headers
            )
            public_duration_ms = int((time.time() - start_time) * 1000)
            
            if public_response.status_code == 206:
                self.add_result(
                    "Public URL Range Request",
                    True,
                    f"206 Partial Content from public URL",
                    performance_ms=public_duration_ms
                )
            else:
                self.add_result(
                    "Public URL Range Request",
                    False,
                    "",
                    f"Expected 206, got {public_response.status_code}",
                    public_duration_ms
                )
                return False
            
            return True
            
        except Exception as e:
            self.add_result("Range Requests", False, "", f"Exception: {str(e)}")
            return False
    
    async def test_discover_endpoint(self):
        """Test 5: Discover Content - GET /api/content/discover-organized"""
        try:
            start_time = time.time()
            headers = {"Authorization": f"Bearer {self.token}"}
            response = await self.client.get(f"{BACKEND_URL}/api/content/discover-organized", headers=headers)
            duration_ms = int((time.time() - start_time) * 1000)
            
            if response.status_code == 200:
                data = response.json()
                services = data.get("services", {})
                total_items = sum(len(items) for items in services.values())
                
                self.add_result(
                    "Discover Content",
                    True,
                    f"{len(services)} sections, {total_items} total items",
                    performance_ms=duration_ms
                )
                return True
                
            else:
                self.add_result("Discover Content", False, "", f"Failed with status {response.status_code}", duration_ms)
                return False
                
        except Exception as e:
            self.add_result("Discover Content", False, "", f"Exception: {str(e)}")
            return False
    
    async def test_addons_endpoint(self):
        """Test 6: Addons - GET /api/addons"""
        try:
            start_time = time.time()
            headers = {"Authorization": f"Bearer {self.token}"}
            response = await self.client.get(f"{BACKEND_URL}/api/addons", headers=headers)
            duration_ms = int((time.time() - start_time) * 1000)
            
            if response.status_code == 200:
                addons = response.json()
                if isinstance(addons, list):
                    addon_names = [addon.get("manifest", {}).get("name", "Unknown") for addon in addons]
                    self.add_result(
                        "Addons Management",
                        True,
                        f"Found {len(addons)} addons: {', '.join(addon_names)}",
                        performance_ms=duration_ms
                    )
                    return True
                else:
                    self.add_result("Addons Management", False, "", "Response is not a list", duration_ms)
                    return False
            else:
                self.add_result("Addons Management", False, "", f"Failed with status {response.status_code}", duration_ms)
                return False
                
        except Exception as e:
            self.add_result("Addons Management", False, "", f"Exception: {str(e)}")
            return False
    
    def print_summary(self):
        """Print comprehensive test summary with performance analysis"""
        passed = [r for r in self.test_results if r["passed"]]
        failed = [r for r in self.test_results if not r["passed"]]
        
        print("\n" + "="*80)
        print("🎯 ENHANCED PRIVASTREAMCINEMA BACKEND TEST RESULTS - REVIEW REQUEST FOCUS")
        print("="*80)
        
        if failed:
            print(f"\n❌ FAILED TESTS ({len(failed)}):")
            for test in failed:
                perf_info = f" ({test['performance_ms']}ms)" if test.get('performance_ms') else ""
                print(f"   • {test['test']}{perf_info}: {test['error']}")
        
        if passed:
            print(f"\n✅ PASSED TESTS ({len(passed)}):")
            for test in passed:
                perf_info = f" ({test['performance_ms']}ms)" if test.get('performance_ms') else ""
                print(f"   • {test['test']}{perf_info}: {test['details']}")
        
        # Performance analysis
        print(f"\n⚡ PERFORMANCE ANALYSIS (Target: <5000ms per API):")
        perf_tests = [r for r in self.test_results if r.get('performance_ms')]
        for test in perf_tests:
            duration = test['performance_ms']
            status = "✅" if duration < 5000 else "⚠️" if duration < 10000 else "❌"
            print(f"   {status} {test['test']}: {duration}ms")
        
        print(f"\n📊 SUMMARY: {len(passed)}/{len(self.test_results)} tests passed")
        
        if len(passed) == len(self.test_results):
            print("🎉 ALL REVIEW REQUEST TESTS PASSED - Backend meets all requirements!")
        else:
            print("⚠️  Some tests failed - see details above")
        
        return len(failed) == 0


async def run_enhanced_test():
    """Run enhanced backend tests focused on review request requirements"""
    async with EnhancedBackendTester() as tester:
        print("🚀 Starting Enhanced PrivastreamCinema Backend Testing (Review Request Focus)...")
        print("🎯 Testing specific requirements:")
        print("   1. Authentication with choyt/RFIDGuy1!")
        print("   2. Health endpoint")
        print("   3. Streams endpoint (20+ streams with infoHash)")
        print("   4. Full streaming pipeline with ready_progress field")
        print("   5. Range request patterns (0-2097151, end-of-file)")
        print("   6. Discover and Addons endpoints")
        print("   7. All APIs under 5s performance target")
        print()
        
        # Test 1: Authentication (required for all other tests)
        auth_success = await tester.test_authentication()
        if not auth_success:
            print("❌ Authentication failed - cannot proceed with other tests")
            tester.print_summary()
            return
        
        # Test 2: Health endpoint
        await tester.test_health_endpoint()
        
        # Test 3: Stream fetching (and get an infoHash for streaming tests)
        info_hash = await tester.test_streams_endpoint()
        
        # Test 4: Full streaming pipeline (CRITICAL - with ready_progress field check)
        if info_hash:
            print(f"\n🎯 Testing full streaming pipeline with infoHash: {info_hash[:16]}...")
            await tester.test_full_streaming_pipeline(info_hash)
        else:
            tester.add_result("Full Streaming Pipeline", False, "", "No infoHash available from stream fetching")
        
        # Test 5: Discover content
        await tester.test_discover_endpoint()
        
        # Test 6: Addons management
        await tester.test_addons_endpoint()
        
        # Print final results
        return tester.print_summary()


if __name__ == "__main__":
    asyncio.run(run_enhanced_test())