#!/usr/bin/env python3
"""
Privastream Cinema Backend Testing Script - EXACT REVIEW REQUEST VERIFICATION
Tests the specific review request scenarios exactly as specified
"""

import asyncio
import httpx
import json
import time
import sys
from typing import Dict, Any, Optional

# Configuration - Use the production URL from frontend/.env
BACKEND_URL = "https://torrent-playback-fix.preview.emergentagent.com"
TEST_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10"
TEST_CREDENTIALS = {"username": "choyt", "password": "RFIDGuy1!"}

class ReviewRequestTester:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.auth_token = None
        self.test_results = []
        
    async def __aenter__(self):
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()
    
    def log_test(self, test_name: str, success: bool, details: str, response_time: float = 0):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name} ({response_time:.3f}s)")
        if details:
            print(f"    {details}")
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "response_time": response_time
        })
    
    async def authenticate(self) -> bool:
        """Authenticate and get JWT token"""
        start_time = time.time()
        try:
            response = await self.client.post(
                f"{BACKEND_URL}/api/auth/login",
                json=TEST_CREDENTIALS
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                self.auth_token = data.get("token")
                if self.auth_token:
                    self.log_test("Authentication", True, f"JWT token received ({len(self.auth_token)} chars)", response_time)
                    return True
                else:
                    self.log_test("Authentication", False, "No token in response", response_time)
                    return False
            else:
                self.log_test("Authentication", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Authentication", False, f"Exception: {str(e)}", response_time)
            return False
    
    def get_auth_headers(self) -> Dict[str, str]:
        """Get authorization headers"""
        if self.auth_token:
            return {"Authorization": f"Bearer {self.auth_token}"}
        return {}
    
    async def test_step_1_health_check(self) -> bool:
        """Step 1: Health check: GET /api/health"""
        start_time = time.time()
        try:
            response = await self.client.get(f"{BACKEND_URL}/api/health")
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok" and data.get("service") == "PrivastreamCinema":
                    self.log_test("Step 1: Health Check", True, f"Returns {data}", response_time)
                    return True
                else:
                    self.log_test("Step 1: Health Check", False, f"Unexpected values: {data}", response_time)
                    return False
            else:
                self.log_test("Step 1: Health Check", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Step 1: Health Check", False, f"Exception: {str(e)}", response_time)
            return False
    
    async def test_step_2_start_stream(self) -> bool:
        """Step 2: Start stream: POST /api/stream/start/{hash} with body {"sources": []}"""
        start_time = time.time()
        try:
            body = {"sources": []}
            response = await self.client.post(
                f"{BACKEND_URL}/api/stream/start/{TEST_HASH}",
                json=body,
                headers=self.get_auth_headers()
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "started" and data.get("info_hash"):
                    self.log_test("Step 2: Start Stream", True, f"Started: {data}", response_time)
                    return True
                else:
                    self.log_test("Step 2: Start Stream", False, f"Unexpected response: {data}", response_time)
                    return False
            else:
                self.log_test("Step 2: Start Stream", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Step 2: Start Stream", False, f"Exception: {str(e)}", response_time)
            return False
    
    async def test_step_3_wait_5_seconds(self) -> bool:
        """Step 3: Wait 5 seconds"""
        print("⏳ Step 3: Waiting 5 seconds...")
        await asyncio.sleep(5)
        self.log_test("Step 3: Wait 5 Seconds", True, "Completed", 5.0)
        return True
    
    async def test_step_4_check_status(self) -> bool:
        """Step 4: Check status: GET /api/stream/status/{hash} - verify it shows status=ready"""
        start_time = time.time()
        try:
            response = await self.client.get(
                f"{BACKEND_URL}/api/stream/status/{TEST_HASH}",
                headers=self.get_auth_headers()
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                status = data.get("status")
                
                if status == "ready":
                    self.log_test("Step 4: Check Status", True, f"Status is 'ready': {data}", response_time)
                    return True
                else:
                    self.log_test("Step 4: Check Status", False, f"Status is '{status}', expected 'ready': {data}", response_time)
                    return False
            else:
                self.log_test("Step 4: Check Status", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Step 4: Check Status", False, f"Exception: {str(e)}", response_time)
            return False
    
    async def test_step_5_video_range_request(self) -> bool:
        """Step 5: Test video with range: GET /api/stream/video/{hash} with header "Range: bytes=0-65535" 
        - MUST return HTTP 206 with headers Content-Range, Content-Type: video/mp4, Accept-Ranges: bytes"""
        start_time = time.time()
        try:
            headers = {
                "Range": "bytes=0-65535",
                **self.get_auth_headers()
            }
            response = await self.client.get(
                f"{BACKEND_URL}/api/stream/video/{TEST_HASH}",
                headers=headers
            )
            response_time = time.time() - start_time
            
            # Check status code
            if response.status_code != 206:
                self.log_test("Step 5: Video Range Request", False, f"Expected HTTP 206, got {response.status_code}", response_time)
                return False
            
            # Check required headers
            content_type = response.headers.get("content-type", "")
            content_range = response.headers.get("content-range", "")
            accept_ranges = response.headers.get("accept-ranges", "")
            
            issues = []
            
            # Check Content-Type
            if "video/mp4" not in content_type:
                issues.append(f"Content-Type is '{content_type}', expected 'video/mp4'")
            
            # Check Content-Range header exists
            if not content_range:
                issues.append("Missing Content-Range header")
            
            # Check Accept-Ranges header
            if "bytes" not in accept_ranges:
                issues.append(f"Accept-Ranges is '{accept_ranges}', expected 'bytes'")
            
            # Check content length
            content_length = len(response.content)
            if content_length != 65536:
                issues.append(f"Content length is {content_length}, expected 65536 bytes")
            
            if issues:
                self.log_test("Step 5: Video Range Request", False, f"Issues: {'; '.join(issues)}", response_time)
                return False
            else:
                self.log_test("Step 5: Video Range Request", True, 
                             f"HTTP 206, Content-Type: {content_type}, Content-Range: {content_range}, Accept-Ranges: {accept_ranges}, {content_length} bytes", 
                             response_time)
                return True
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Step 5: Video Range Request", False, f"Exception: {str(e)}", response_time)
            return False
    
    async def test_step_6_video_full_request(self) -> bool:
        """Step 6: Test video full: GET /api/stream/video/{hash} without Range header - should return HTTP 200 with video data"""
        start_time = time.time()
        try:
            response = await self.client.get(
                f"{BACKEND_URL}/api/stream/video/{TEST_HASH}",
                headers=self.get_auth_headers()
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                content_length = len(response.content)
                content_type = response.headers.get("content-type", "")
                
                # Check if we got actual video data (should be substantial)
                if content_length > 1000:  # At least 1KB of data
                    self.log_test("Step 6: Video Full Request", True, 
                                 f"HTTP 200, Content-Type: {content_type}, {content_length} bytes", 
                                 response_time)
                    return True
                else:
                    self.log_test("Step 6: Video Full Request", False, 
                                 f"Content too small: {content_length} bytes", 
                                 response_time)
                    return False
            else:
                self.log_test("Step 6: Video Full Request", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Step 6: Video Full Request", False, f"Exception: {str(e)}", response_time)
            return False
    
    async def test_step_7_head_request(self) -> bool:
        """Step 7: HEAD request: HEAD /api/stream/video/{hash} - verify it returns proper headers"""
        start_time = time.time()
        try:
            response = await self.client.head(
                f"{BACKEND_URL}/api/stream/video/{TEST_HASH}",
                headers=self.get_auth_headers()
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                content_length = response.headers.get("content-length", "")
                content_type = response.headers.get("content-type", "")
                accept_ranges = response.headers.get("accept-ranges", "")
                
                # Check if we got proper headers
                if content_length and content_type:
                    self.log_test("Step 7: HEAD Request", True, 
                                 f"HTTP 200, Content-Type: {content_type}, Content-Length: {content_length}, Accept-Ranges: {accept_ranges}", 
                                 response_time)
                    return True
                else:
                    self.log_test("Step 7: HEAD Request", False, 
                                 f"Missing headers - Content-Length: {content_length}, Content-Type: {content_type}", 
                                 response_time)
                    return False
            else:
                self.log_test("Step 7: HEAD Request", False, f"HTTP {response.status_code}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Step 7: HEAD Request", False, f"Exception: {str(e)}", response_time)
            return False
    
    async def run_review_request_tests(self) -> bool:
        """Run all review request tests in exact sequence"""
        print("🎯 PRIVASTREAM CINEMA BACKEND - EXACT REVIEW REQUEST VERIFICATION")
        print("=" * 80)
        print(f"Testing backend at: {BACKEND_URL}")
        print(f"Test hash: {TEST_HASH}")
        print("=" * 80)
        
        # Authentication (needed for API access)
        if not await self.authenticate():
            print("❌ Authentication failed - cannot proceed with review request tests")
            return False
        
        # Execute exact review request steps
        test1 = await self.test_step_1_health_check()
        test2 = await self.test_step_2_start_stream()
        test3 = await self.test_step_3_wait_5_seconds()
        test4 = await self.test_step_4_check_status()
        test5 = await self.test_step_5_video_range_request()
        test6 = await self.test_step_6_video_full_request()
        test7 = await self.test_step_7_head_request()
        
        # Summary
        print("\n" + "=" * 80)
        print("📊 REVIEW REQUEST TEST SUMMARY")
        print("=" * 80)
        
        passed = sum(1 for result in self.test_results if result["success"])
        total = len(self.test_results)
        
        for result in self.test_results:
            status = "✅" if result["success"] else "❌"
            print(f"{status} {result['test']}: {result['details']}")
        
        print(f"\n🎯 OVERALL RESULT: {passed}/{total} tests passed")
        
        if passed == total:
            print("🎉 ALL REVIEW REQUEST REQUIREMENTS VERIFIED!")
            print("\n✅ Critical things verified:")
            print("   • Video endpoint returns ACTUAL video bytes (not JSON error)")
            print("   • Range requests return 206 with proper Content-Range header")
            print("   • Content-Type is video/mp4")
            print("   • Accept-Ranges: bytes is present")
            return True
        else:
            print("⚠️  Some tests failed - see details above")
            return False

async def main():
    """Main test runner"""
    async with ReviewRequestTester() as tester:
        success = await tester.run_review_request_tests()
        sys.exit(0 if success else 1)

if __name__ == "__main__":
    asyncio.run(main())