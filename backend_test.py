#!/usr/bin/env python3
"""
Backend Testing for Privastream Cinema - Critical Backend Improvements
Testing the specific review request requirements:
1. Backend API Health & Auth
2. Stream Start Endpoint with sources array (bug fix verification)
3. Stream Status Endpoint with all required fields
4. Stream Seek Endpoint
5. Stream Video Endpoint with Range headers
"""

import asyncio
import httpx
import json
import time
import logging
from typing import Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Test configuration
BACKEND_URL = "https://privastream-cinema-4.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"
TEST_INFO_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10"  # Shawshank Redemption
TEST_CREDENTIALS = {"username": "choyt", "password": "RFIDGuy1!"}

class BackendTester:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.auth_token = None
        self.test_results = []
        
    async def __aenter__(self):
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.client.aclose()
    
    def log_test_result(self, test_name: str, success: bool, details: str, response_time: float = 0):
        """Log test result with timing"""
        status = "✅ PASS" if success else "❌ FAIL"
        time_str = f"({response_time:.3f}s)" if response_time > 0 else ""
        logger.info(f"{status} {test_name} {time_str}")
        if details:
            logger.info(f"    {details}")
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "response_time": response_time
        })
    
    async def test_health_endpoint(self):
        """Test 1: Health endpoint"""
        try:
            start_time = time.time()
            response = await self.client.get(f"{API_BASE}/health")
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                expected_fields = ["status", "service"]
                missing_fields = [f for f in expected_fields if f not in data]
                
                if not missing_fields and data.get("status") == "ok":
                    self.log_test_result(
                        "Health Endpoint", 
                        True, 
                        f"Returns {data}, all required fields present",
                        response_time
                    )
                    return True
                else:
                    self.log_test_result(
                        "Health Endpoint", 
                        False, 
                        f"Missing fields: {missing_fields} or incorrect status. Got: {data}",
                        response_time
                    )
            else:
                self.log_test_result(
                    "Health Endpoint", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}",
                    response_time
                )
        except Exception as e:
            self.log_test_result("Health Endpoint", False, f"Exception: {str(e)}")
        return False
    
    async def test_authentication(self):
        """Test 2: Authentication with specific credentials"""
        try:
            start_time = time.time()
            response = await self.client.post(
                f"{API_BASE}/auth/login",
                json=TEST_CREDENTIALS
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                # Check for either 'token' or 'access_token' field
                token = data.get("token") or data.get("access_token")
                
                if token:
                    self.auth_token = token
                    self.log_test_result(
                        "Authentication", 
                        True, 
                        f"Login successful, JWT token received ({len(token)} chars)",
                        response_time
                    )
                    return True
                else:
                    self.log_test_result(
                        "Authentication", 
                        False, 
                        f"No token in response. Got: {data}",
                        response_time
                    )
            else:
                self.log_test_result(
                    "Authentication", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}",
                    response_time
                )
        except Exception as e:
            self.log_test_result("Authentication", False, f"Exception: {str(e)}")
        return False
    
    async def test_stream_start_with_sources(self):
        """Test 3: Stream Start Endpoint with sources array (critical bug fix)"""
        try:
            # Test the specific bug fix: sources array with tracker URLs
            test_sources = [
                "tracker:http://tracker.opentrackr.org:1337/announce",
                "tracker:udp://tracker.opentrackr.org:1337/announce",
                "tracker:http://nyaa.tracker.wf:7777/announce",
                "tracker:udp://open.stealth.si:80/announce"
            ]
            
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            start_time = time.time()
            response = await self.client.post(
                f"{API_BASE}/stream/start/{TEST_INFO_HASH}",
                json={"sources": test_sources},
                headers=headers
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                expected_fields = ["status", "info_hash"]
                missing_fields = [f for f in expected_fields if f not in data]
                
                if not missing_fields and data.get("status") == "started":
                    self.log_test_result(
                        "Stream Start with Sources", 
                        True, 
                        f"Started with {len(test_sources)} tracker sources. Response: {data}",
                        response_time
                    )
                    return True
                else:
                    self.log_test_result(
                        "Stream Start with Sources", 
                        False, 
                        f"Missing fields: {missing_fields} or incorrect status. Got: {data}",
                        response_time
                    )
            else:
                self.log_test_result(
                    "Stream Start with Sources", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}",
                    response_time
                )
        except Exception as e:
            self.log_test_result("Stream Start with Sources", False, f"Exception: {str(e)}")
        return False
    
    async def test_stream_status(self):
        """Test 4: Stream Status Endpoint with all required fields"""
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            # Wait a moment for stream to initialize
            await asyncio.sleep(3)
            
            start_time = time.time()
            response = await self.client.get(
                f"{API_BASE}/stream/status/{TEST_INFO_HASH}",
                headers=headers
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                
                # Check for all required fields from review request
                required_fields = [
                    "status",           # should be "ready", "buffering", or "downloading_metadata"
                    "video_size",       # used for accurate seeking
                    "peers",            # peer count
                    "download_rate",    # download rate
                    "lt_peers",         # libtorrent peers
                    "wt_peers",         # webtorrent peers
                    "engine"            # engine field
                ]
                
                missing_fields = [f for f in required_fields if f not in data]
                
                if not missing_fields:
                    status = data.get("status")
                    valid_statuses = ["ready", "buffering", "downloading_metadata"]
                    
                    if status in valid_statuses:
                        self.log_test_result(
                            "Stream Status", 
                            True, 
                            f"All required fields present. Status: {status}, Peers: {data.get('peers')}, Engine: {data.get('engine')}, Video Size: {data.get('video_size')}",
                            response_time
                        )
                        return True
                    else:
                        self.log_test_result(
                            "Stream Status", 
                            False, 
                            f"Invalid status '{status}'. Expected one of: {valid_statuses}",
                            response_time
                        )
                else:
                    self.log_test_result(
                        "Stream Status", 
                        False, 
                        f"Missing required fields: {missing_fields}. Got: {list(data.keys())}",
                        response_time
                    )
            else:
                self.log_test_result(
                    "Stream Status", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}",
                    response_time
                )
        except Exception as e:
            self.log_test_result("Stream Status", False, f"Exception: {str(e)}")
        return False
    
    async def test_stream_seek(self):
        """Test 5: Stream Seek Endpoint"""
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            seek_position = 10000000  # 10MB as specified in review request
            
            start_time = time.time()
            response = await self.client.post(
                f"{API_BASE}/stream/seek/{TEST_INFO_HASH}",
                json={"position_bytes": seek_position},
                headers=headers
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                
                # Check for required fields from review request
                required_fields = ["target_piece", "buffer_pieces"]
                missing_fields = [f for f in required_fields if f not in data]
                
                if not missing_fields:
                    self.log_test_result(
                        "Stream Seek", 
                        True, 
                        f"Seek successful. Target piece: {data.get('target_piece')}, Buffer pieces: {data.get('buffer_pieces')}",
                        response_time
                    )
                    return True
                else:
                    self.log_test_result(
                        "Stream Seek", 
                        False, 
                        f"Missing required fields: {missing_fields}. Got: {data}",
                        response_time
                    )
            else:
                self.log_test_result(
                    "Stream Seek", 
                    False, 
                    f"HTTP {response.status_code}: {response.text}",
                    response_time
                )
        except Exception as e:
            self.log_test_result("Stream Seek", False, f"Exception: {str(e)}")
        return False
    
    async def test_stream_video_range(self):
        """Test 6: Stream Video Endpoint with Range headers"""
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            # Test Range request as specified in review request
            headers["Range"] = "bytes=0-65535"
            
            start_time = time.time()
            response = await self.client.get(
                f"{API_BASE}/stream/video/{TEST_INFO_HASH}",
                headers=headers
            )
            response_time = time.time() - start_time
            
            if response.status_code == 206:  # Partial Content
                content_range = response.headers.get("Content-Range")
                content_length = len(response.content)
                content_type = response.headers.get("Content-Type")
                
                # Verify we got the expected range
                expected_length = 65536  # bytes 0-65535 = 65536 bytes
                
                if content_length == expected_length:
                    self.log_test_result(
                        "Stream Video Range", 
                        True, 
                        f"206 Partial Content, {content_length} bytes, Content-Type: {content_type}, Content-Range: {content_range}",
                        response_time
                    )
                    return True
                else:
                    self.log_test_result(
                        "Stream Video Range", 
                        False, 
                        f"Expected {expected_length} bytes, got {content_length}. Content-Range: {content_range}",
                        response_time
                    )
            else:
                self.log_test_result(
                    "Stream Video Range", 
                    False, 
                    f"Expected HTTP 206, got {response.status_code}: {response.text[:200]}",
                    response_time
                )
        except Exception as e:
            self.log_test_result("Stream Video Range", False, f"Exception: {str(e)}")
        return False
    
    async def test_stream_video_head(self):
        """Test 7: Stream Video HEAD request"""
        try:
            headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else {}
            
            start_time = time.time()
            response = await self.client.head(
                f"{API_BASE}/stream/video/{TEST_INFO_HASH}",
                headers=headers
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                content_length = response.headers.get("Content-Length")
                content_type = response.headers.get("Content-Type")
                
                if content_length:
                    self.log_test_result(
                        "Stream Video HEAD", 
                        True, 
                        f"200 OK, Content-Length: {content_length}, Content-Type: {content_type}",
                        response_time
                    )
                    return True
                else:
                    self.log_test_result(
                        "Stream Video HEAD", 
                        False, 
                        f"Missing Content-Length header. Headers: {dict(response.headers)}",
                        response_time
                    )
            else:
                self.log_test_result(
                    "Stream Video HEAD", 
                    False, 
                    f"Expected HTTP 200, got {response.status_code}",
                    response_time
                )
        except Exception as e:
            self.log_test_result("Stream Video HEAD", False, f"Exception: {str(e)}")
        return False
    
    async def run_all_tests(self):
        """Run all backend tests in sequence"""
        logger.info("🚀 STARTING CRITICAL BACKEND IMPROVEMENTS TESTING")
        logger.info(f"Backend URL: {BACKEND_URL}")
        logger.info(f"Test Info Hash: {TEST_INFO_HASH}")
        logger.info("=" * 80)
        
        # Test sequence
        tests = [
            ("Health Check", self.test_health_endpoint),
            ("Authentication", self.test_authentication),
            ("Stream Start with Sources", self.test_stream_start_with_sources),
            ("Stream Status", self.test_stream_status),
            ("Stream Seek", self.test_stream_seek),
            ("Stream Video Range", self.test_stream_video_range),
            ("Stream Video HEAD", self.test_stream_video_head),
        ]
        
        passed = 0
        total = len(tests)
        
        for test_name, test_func in tests:
            logger.info(f"\n🧪 Running: {test_name}")
            try:
                success = await test_func()
                if success:
                    passed += 1
            except Exception as e:
                logger.error(f"Test {test_name} crashed: {e}")
                self.log_test_result(test_name, False, f"Test crashed: {str(e)}")
        
        # Summary
        logger.info("\n" + "=" * 80)
        logger.info("🎯 CRITICAL BACKEND IMPROVEMENTS TEST SUMMARY")
        logger.info("=" * 80)
        
        for result in self.test_results:
            status = "✅" if result["success"] else "❌"
            time_str = f" ({result['response_time']:.3f}s)" if result["response_time"] > 0 else ""
            logger.info(f"{status} {result['test']}{time_str}")
            if result["details"]:
                logger.info(f"    {result['details']}")
        
        logger.info("=" * 80)
        success_rate = (passed / total) * 100
        logger.info(f"🎉 FINAL RESULT: {passed}/{total} tests passed ({success_rate:.1f}% success rate)")
        
        if passed == total:
            logger.info("✅ ALL CRITICAL BACKEND IMPROVEMENTS VERIFIED!")
            logger.info("Backend is production-ready with all review request requirements met.")
        else:
            failed = total - passed
            logger.info(f"❌ {failed} test(s) failed. Review required.")
        
        return passed == total

async def main():
    """Main test runner"""
    async with BackendTester() as tester:
        success = await tester.run_all_tests()
        return success

if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)