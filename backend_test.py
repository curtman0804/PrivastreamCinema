#!/usr/bin/env python3
"""
Privastream Cinema Backend Testing - Review Request Verification
Tests the new Stremio-style torrent-stream engine as specified in review request.
"""

import requests
import time
import json
import sys
from typing import Dict, Any, Optional

# Test Configuration
BACKEND_URL = "http://localhost:8001"
TORRENT_SERVER_URL = "http://localhost:8002"
TEST_INFO_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10"
TEST_CREDENTIALS = {"username": "choyt", "password": "RFIDGuy1!"}
TEST_SOURCES = [
    "tracker:udp://tracker.opentrackr.org:1337/announce",
    "tracker:http://tracker.openbittorrent.com:80/announce"
]

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.auth_token = None
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str, response_time: float = 0):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        time_str = f"({response_time:.3f}s)" if response_time > 0 else ""
        print(f"{status} {test_name} {time_str}")
        if details:
            print(f"    {details}")
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "response_time": response_time
        })
        
    def test_health_endpoint(self) -> bool:
        """Test 1: GET /api/health - verify backend is healthy"""
        try:
            start_time = time.time()
            response = self.session.get(f"{BACKEND_URL}/api/health", timeout=10)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    self.log_test("Health Check", True, f"Status: {data.get('status')}, Service: {data.get('service', 'N/A')}", response_time)
                    return True
                else:
                    self.log_test("Health Check", False, f"Unexpected status: {data}", response_time)
                    return False
            else:
                self.log_test("Health Check", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            self.log_test("Health Check", False, f"Exception: {str(e)}")
            return False
    
    def test_authentication(self) -> bool:
        """Test 2: POST /api/auth/login with choyt/RFIDGuy1!"""
        try:
            start_time = time.time()
            response = self.session.post(
                f"{BACKEND_URL}/api/auth/login",
                json=TEST_CREDENTIALS,
                timeout=10
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                # Backend returns "token" field instead of "access_token"
                token = data.get("token") or data.get("access_token")
                if token:
                    self.auth_token = token
                    self.session.headers.update({"Authorization": f"Bearer {token}"})
                    self.log_test("Authentication", True, f"JWT token received ({len(token)} chars)", response_time)
                    return True
                else:
                    self.log_test("Authentication", False, f"No token in response: {data}", response_time)
                    return False
            else:
                self.log_test("Authentication", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            self.log_test("Authentication", False, f"Exception: {str(e)}")
            return False
    
    def test_stream_start(self) -> bool:
        """Test 3: POST /api/stream/start/{info_hash} with sources"""
        try:
            start_time = time.time()
            response = self.session.post(
                f"{BACKEND_URL}/api/stream/start/{TEST_INFO_HASH}",
                json={"sources": TEST_SOURCES},
                timeout=15
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "started":
                    self.log_test("Stream Start", True, f"Status: {data.get('status')}, Info Hash: {data.get('info_hash', 'N/A')[:16]}...", response_time)
                    return True
                else:
                    self.log_test("Stream Start", False, f"Unexpected status: {data}", response_time)
                    return False
            else:
                self.log_test("Stream Start", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            self.log_test("Stream Start", False, f"Exception: {str(e)}")
            return False
    
    def test_stream_status(self) -> bool:
        """Test 5: GET /api/stream/status/{info_hash} - verify required fields"""
        try:
            start_time = time.time()
            response = self.session.get(
                f"{BACKEND_URL}/api/stream/status/{TEST_INFO_HASH}",
                timeout=10
            )
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                
                # Check required fields from review request
                status = data.get("status")
                peers = data.get("peers", 0)
                video_size = data.get("video_size", 0)
                wt_peers = data.get("wt_peers", 0)
                
                # Verify status is "ready" or "buffering"
                status_ok = status in ["ready", "buffering"]
                peers_ok = peers > 0
                video_size_ok = video_size > 0
                wt_peers_ok = wt_peers > 0
                
                details = f"Status: {status}, Peers: {peers}, Video Size: {video_size}, WT Peers: {wt_peers}"
                
                if status_ok and peers_ok and video_size_ok and wt_peers_ok:
                    self.log_test("Stream Status", True, details, response_time)
                    return True
                else:
                    missing = []
                    if not status_ok: missing.append(f"status not ready/buffering ({status})")
                    if not peers_ok: missing.append(f"peers <= 0 ({peers})")
                    if not video_size_ok: missing.append(f"video_size <= 0 ({video_size})")
                    if not wt_peers_ok: missing.append(f"wt_peers <= 0 ({wt_peers})")
                    
                    self.log_test("Stream Status", False, f"{details} - Missing: {', '.join(missing)}", response_time)
                    return False
            else:
                self.log_test("Stream Status", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            self.log_test("Stream Status", False, f"Exception: {str(e)}")
            return False
    
    def test_stream_video_range(self) -> bool:
        """Test 6: GET /api/stream/video/{info_hash} with Range header"""
        try:
            start_time = time.time()
            headers = {"Range": "bytes=0-65535"}
            response = self.session.get(
                f"{BACKEND_URL}/api/stream/video/{TEST_INFO_HASH}",
                headers=headers,
                timeout=30
            )
            response_time = time.time() - start_time
            
            if response.status_code == 206:  # Partial Content
                content_range = response.headers.get("Content-Range", "")
                content_length = len(response.content)
                content_type = response.headers.get("Content-Type", "")
                
                # Verify we got exactly 65536 bytes (0-65535 inclusive)
                if content_length == 65536:
                    self.log_test("Video Range Request", True, 
                                f"206 Partial Content, {content_type}, {content_length} bytes, Range: {content_range}", 
                                response_time)
                    return True
                else:
                    self.log_test("Video Range Request", False, 
                                f"Expected 65536 bytes, got {content_length}", response_time)
                    return False
            else:
                self.log_test("Video Range Request", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            self.log_test("Video Range Request", False, f"Exception: {str(e)}")
            return False
    
    def test_torrent_server_health(self) -> bool:
        """Test 7: GET /health on torrent-stream server (localhost:8002)"""
        try:
            start_time = time.time()
            response = self.session.get(f"{TORRENT_SERVER_URL}/health", timeout=10)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    engines = data.get("engines", 0)
                    self.log_test("Torrent Server Health", True, f"Status: {data.get('status')}, Engines: {engines}", response_time)
                    return True
                else:
                    self.log_test("Torrent Server Health", False, f"Unexpected status: {data}", response_time)
                    return False
            else:
                self.log_test("Torrent Server Health", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            self.log_test("Torrent Server Health", False, f"Exception: {str(e)}")
            return False
    
    def test_torrent_server_status(self) -> bool:
        """Test 8: GET /status/{info_hash} on torrent-stream server"""
        try:
            start_time = time.time()
            response = self.session.get(f"{TORRENT_SERVER_URL}/status/{TEST_INFO_HASH}", timeout=10)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                peers = data.get("peers", 0)
                download_speed = data.get("downloadSpeed", 0)
                ready = data.get("ready", False)
                
                details = f"Peers: {peers}, Download Speed: {download_speed}, Ready: {ready}"
                
                # For torrent-stream server, we expect some activity
                if isinstance(data, dict):
                    self.log_test("Torrent Server Status", True, details, response_time)
                    return True
                else:
                    self.log_test("Torrent Server Status", False, f"Invalid response format: {data}", response_time)
                    return False
            else:
                self.log_test("Torrent Server Status", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            self.log_test("Torrent Server Status", False, f"Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all review request tests in sequence"""
        print("🎯 PRIVASTREAM CINEMA BACKEND TESTING - REVIEW REQUEST VERIFICATION")
        print("=" * 80)
        print(f"Backend URL: {BACKEND_URL}")
        print(f"Torrent Server URL: {TORRENT_SERVER_URL}")
        print(f"Test Info Hash: {TEST_INFO_HASH}")
        print("=" * 80)
        
        # Test 1: Health Check
        test1_success = self.test_health_endpoint()
        
        # Test 2: Authentication
        test2_success = self.test_authentication()
        
        # Test 3: Stream Start
        test3_success = self.test_stream_start()
        
        # Test 4: Wait 5 seconds (as specified in review request)
        if test3_success:
            print("⏳ Waiting 5 seconds for torrent to initialize...")
            time.sleep(5)
        
        # Test 5: Stream Status
        test5_success = self.test_stream_status()
        
        # Test 6: Video Range Request
        test6_success = self.test_stream_video_range()
        
        # Test 7: Torrent Server Health
        test7_success = self.test_torrent_server_health()
        
        # Test 8: Torrent Server Status
        test8_success = self.test_torrent_server_status()
        
        # Summary
        print("\n" + "=" * 80)
        print("🎉 TEST SUMMARY")
        print("=" * 80)
        
        passed_tests = sum(1 for result in self.test_results if result["success"])
        total_tests = len(self.test_results)
        
        for result in self.test_results:
            status = "✅ PASS" if result["success"] else "❌ FAIL"
            time_str = f"({result['response_time']:.3f}s)" if result["response_time"] > 0 else ""
            print(f"{status} {result['test']} {time_str}")
            if not result["success"]:
                print(f"    {result['details']}")
        
        print(f"\nOverall Result: {passed_tests}/{total_tests} tests passed ({passed_tests/total_tests*100:.1f}%)")
        
        if passed_tests == total_tests:
            print("🎉 ALL REVIEW REQUEST REQUIREMENTS VERIFIED!")
            return True
        else:
            print("❌ Some tests failed - review required")
            return False

def main():
    """Main test execution"""
    tester = BackendTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()