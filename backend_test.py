#!/usr/bin/env python3
"""
Comprehensive PrivastreamCinema Backend API Testing
Focus on NEW pre-warm endpoint and existing endpoint verification
Review Request Specific Testing
"""

import asyncio
import httpx
import json
import time
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "https://fix-test-deploy.preview.emergentagent.com/api"
CREDENTIALS = {"username": "choyt", "password": "RFIDGuy1!"}
TEST_INFO_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10"  # Shawshank Redemption
MOVIE_ID = "tt0111161"  # Shawshank Redemption IMDB ID

class PrivastreamAPITester:
    def __init__(self):
        self.token = None
        self.client = httpx.AsyncClient(timeout=30.0)
        self.test_results = []
        
    async def log_test(self, test_name: str, success: bool, message: str, response_time: float = 0, data: Any = None):
        """Log test result with details"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = {
            "test": test_name,
            "status": status, 
            "success": success,
            "message": message,
            "response_time": f"{response_time:.3f}s" if response_time > 0 else "N/A",
            "data": data
        }
        self.test_results.append(result)
        print(f"{status} {test_name}: {message} ({response_time:.3f}s)" if response_time > 0 else f"{status} {test_name}: {message}")

    async def authenticate(self) -> bool:
        """Test authentication endpoint - Required for all subsequent tests"""
        try:
            start_time = time.time()
            response = await self.client.post(
                f"{BASE_URL}/auth/login", 
                json=CREDENTIALS
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                self.token = data.get("token")  # The response uses "token" not "access_token"
                if self.token:
                    await self.log_test("Authentication", True, f"Login successful with choyt/RFIDGuy1!", response_time, data)
                    return True
                else:
                    await self.log_test("Authentication", False, "No access token in response", response_time, data)
                    return False
            else:
                await self.log_test("Authentication", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Authentication", False, f"Exception: {str(e)}")
            return False

    async def test_health_endpoint(self) -> bool:
        """Test health check endpoint"""
        try:
            start_time = time.time()
            response = await self.client.get(f"{BASE_URL}/health")
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                expected_service = "PrivastreamCinema"
                if data.get("status") == "ok" and data.get("service") == expected_service:
                    await self.log_test("Health Check", True, f"Health endpoint working: {data}", response_time, data)
                    return True
                else:
                    await self.log_test("Health Check", False, f"Unexpected response format: {data}", response_time, data)
                    return False
            else:
                await self.log_test("Health Check", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Health Check", False, f"Exception: {str(e)}")
            return False

    async def test_streams_endpoint(self) -> bool:
        """Test streams endpoint to verify it returns streams with infoHash"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            start_time = time.time()
            response = await self.client.get(f"{BASE_URL}/streams/movie/{MOVIE_ID}", headers=headers)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                streams = data.get("streams", [])
                streams_with_infohash = [s for s in streams if s.get("infoHash")]
                
                if len(streams_with_infohash) > 0:
                    await self.log_test(
                        "Streams Endpoint", 
                        True, 
                        f"Returns {len(streams_with_infohash)} streams with infoHash (total: {len(streams)})", 
                        response_time, 
                        {"total_streams": len(streams), "streams_with_infohash": len(streams_with_infohash)}
                    )
                    return True
                else:
                    await self.log_test("Streams Endpoint", False, f"No streams with infoHash found. Total streams: {len(streams)}", response_time, data)
                    return False
            else:
                await self.log_test("Streams Endpoint", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Streams Endpoint", False, f"Exception: {str(e)}")
            return False

    async def test_prewarm_endpoint(self) -> bool:
        """Test NEW pre-warm endpoint - Key focus of review request"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            start_time = time.time()
            response = await self.client.post(f"{BASE_URL}/stream/prewarm/{TEST_INFO_HASH}", headers=headers)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                status = data.get("status")
                
                if status in ["warming", "already_warming"]:
                    await self.log_test(
                        "Pre-warm Endpoint", 
                        True, 
                        f"Pre-warm successful: status='{status}'", 
                        response_time, 
                        data
                    )
                    return True
                elif status == "prewarm_failed":
                    await self.log_test("Pre-warm Endpoint", False, f"Pre-warm failed: {data.get('error')}", response_time, data)
                    return False
                else:
                    await self.log_test("Pre-warm Endpoint", False, f"Unexpected status: {status}", response_time, data)
                    return False
            else:
                await self.log_test("Pre-warm Endpoint", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Pre-warm Endpoint", False, f"Exception: {str(e)}")
            return False

    async def test_prewarm_status_check(self) -> bool:
        """Test status after pre-warming - should show downloading_metadata or buffering"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            # Wait a moment for pre-warm to start
            await asyncio.sleep(2)
            
            start_time = time.time()
            response = await self.client.get(f"{BASE_URL}/stream/status/{TEST_INFO_HASH}", headers=headers)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                status = data.get("status")
                peers = data.get("peers", 0)
                
                # After pre-warming, should be in downloading_metadata or buffering state
                if status in ["downloading_metadata", "buffering", "ready"]:
                    await self.log_test(
                        "Pre-warm Status Check", 
                        True, 
                        f"Torrent started in background: status='{status}', peers={peers}", 
                        response_time, 
                        data
                    )
                    return True
                else:
                    await self.log_test("Pre-warm Status Check", False, f"Unexpected status after pre-warm: {status}", response_time, data)
                    return False
            else:
                await self.log_test("Pre-warm Status Check", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Pre-warm Status Check", False, f"Exception: {str(e)}")
            return False

    async def test_stream_start(self) -> bool:
        """Test stream start - should return immediately since pre-warmed"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            start_time = time.time()
            response = await self.client.post(f"{BASE_URL}/stream/start/{TEST_INFO_HASH}", headers=headers)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "started":
                    await self.log_test(
                        "Stream Start", 
                        True, 
                        f"Stream started immediately (pre-warmed): {response_time:.3f}s", 
                        response_time, 
                        data
                    )
                    return True
                else:
                    await self.log_test("Stream Start", False, f"Unexpected response: {data}", response_time, data)
                    return False
            else:
                await self.log_test("Stream Start", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Stream Start", False, f"Exception: {str(e)}")
            return False

    async def test_stream_status_ready_progress(self) -> bool:
        """Test stream status - verify ready_progress field exists"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            # Wait for torrent to get ready
            await asyncio.sleep(5)
            
            start_time = time.time()
            response = await self.client.get(f"{BASE_URL}/stream/status/{TEST_INFO_HASH}", headers=headers)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                ready_progress = data.get("ready_progress")
                
                if ready_progress is not None:
                    await self.log_test(
                        "Stream Status - ready_progress Field", 
                        True, 
                        f"ready_progress field exists: {ready_progress}% (status: {data.get('status')})", 
                        response_time, 
                        data
                    )
                    return True
                else:
                    await self.log_test("Stream Status - ready_progress Field", False, f"ready_progress field missing from response", response_time, data)
                    return False
            else:
                await self.log_test("Stream Status - ready_progress Field", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Stream Status - ready_progress Field", False, f"Exception: {str(e)}")
            return False

    async def test_video_endpoint_range_request(self) -> bool:
        """Test video endpoint with Range header - Critical for ExoPlayer"""
        try:
            headers = {
                "Authorization": f"Bearer {self.token}",
                "Range": "bytes=0-65535"
            }
            
            start_time = time.time()
            response = await self.client.get(
                f"{BASE_URL}/stream/video/{TEST_INFO_HASH}?fileIdx=0", 
                headers=headers
            )
            response_time = time.time() - start_time
            
            if response.status_code == 206:  # Partial Content
                content_length = len(response.content)
                content_type = response.headers.get("content-type", "unknown")
                
                await self.log_test(
                    "Video Endpoint - Range Request", 
                    True, 
                    f"Range request successful: 206 Partial Content, {content_length} bytes, {content_type}", 
                    response_time, 
                    {
                        "status_code": 206,
                        "content_length": content_length,
                        "content_type": content_type,
                        "content_range": response.headers.get("content-range", "Not present")
                    }
                )
                return True
            elif response.status_code == 200:
                await self.log_test("Video Endpoint - Range Request", False, f"Expected 206 but got 200 - Range request not supported", response_time)
                return False
            else:
                await self.log_test("Video Endpoint - Range Request", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
        except Exception as e:
            await self.log_test("Video Endpoint - Range Request", False, f"Exception: {str(e)}")
            return False

    async def print_summary(self):
        """Print comprehensive test summary"""
        print("\n" + "="*80)
        print("🎯 PRIVASTREAMCINEMA BACKEND API TEST RESULTS - REVIEW REQUEST SPECIFIC")
        print("="*80)
        
        passed = sum(1 for result in self.test_results if result["success"])
        total = len(self.test_results)
        
        print(f"📊 OVERALL RESULTS: {passed}/{total} tests passed ({(passed/total*100):.1f}%)")
        print()
        
        # Group results by success/failure
        passed_tests = [r for r in self.test_results if r["success"]]
        failed_tests = [r for r in self.test_results if not r["success"]]
        
        if failed_tests:
            print("❌ FAILED TESTS:")
            for result in failed_tests:
                print(f"   • {result['test']}: {result['message']}")
            print()
        
        if passed_tests:
            print("✅ PASSED TESTS:")
            for result in passed_tests:
                print(f"   • {result['test']}: {result['message']}")
            print()
        
        # Critical endpoint verification
        print("🔍 REVIEW REQUEST VERIFICATION:")
        key_endpoints = [
            "Authentication",
            "Health Check", 
            "Pre-warm Endpoint",
            "Pre-warm Status Check",
            "Streams Endpoint",
            "Stream Start",
            "Stream Status - ready_progress Field",
            "Video Endpoint - Range Request"
        ]
        
        for endpoint in key_endpoints:
            result = next((r for r in self.test_results if r["test"] == endpoint), None)
            if result:
                status = "✅" if result["success"] else "❌"
                print(f"   {status} {endpoint}: {result['message']}")
            else:
                print(f"   ⚠️ {endpoint}: Not tested")
        
        print("\n🎉 NEW PRE-WARM ENDPOINT STATUS:")
        prewarm_result = next((r for r in self.test_results if r["test"] == "Pre-warm Endpoint"), None)
        if prewarm_result and prewarm_result["success"]:
            print("   ✅ Pre-warm endpoint working correctly - returns 'warming' or 'already_warming'")
        else:
            print("   ❌ Pre-warm endpoint has issues")
            
        print("\n" + "="*80)

    async def run_all_tests(self):
        """Run all tests in the correct order"""
        print("🚀 Starting PrivastreamCinema Backend API Testing...")
        print(f"📍 Testing against: {BASE_URL}")
        print(f"🎬 Using test infoHash: {TEST_INFO_HASH} (Shawshank Redemption)")
        print(f"📺 Using movie ID: {MOVIE_ID}")
        print("="*80)
        
        # Step 1: Authentication (required for all other tests)
        auth_success = await self.authenticate()
        if not auth_success:
            print("❌ Authentication failed - cannot proceed with other tests")
            await self.print_summary()
            return
        
        # Step 2: Health Check
        await self.test_health_endpoint()
        
        # Step 3: NEW Pre-warm endpoint (main focus)
        await self.test_prewarm_endpoint()
        
        # Step 4: Pre-warm status check (verify torrent started in background)
        await self.test_prewarm_status_check()
        
        # Step 5: Streams endpoint
        await self.test_streams_endpoint()
        
        # Step 6: Stream start (should be fast since pre-warmed)
        await self.test_stream_start()
        
        # Step 7: Stream status with ready_progress field
        await self.test_stream_status_ready_progress()
        
        # Step 8: Video endpoint with Range request
        await self.test_video_endpoint_range_request()
        
        # Print final summary
        await self.print_summary()
        
        await self.client.aclose()

async def main():
    """Main test runner"""
    tester = PrivastreamAPITester()
    await tester.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())