#!/usr/bin/env python3
"""
Final Comprehensive Test of Privastream Cinema Backend - Review Request Specific
Tests the exact scenarios specified in the review request with prefetch improvements
"""

import requests
import json
import time
import sys

# Backend URLs as specified in review request
BACKEND_URL = "http://localhost:8001"
TORRENT_STREAM_URL = "http://localhost:8002"
API_BASE = f"{BACKEND_URL}/api"

class FinalReviewTester:
    def __init__(self):
        self.test_results = []
        self.auth_token = None
        
    def log_test(self, name: str, success: bool, duration: float, details: str = "", response_code: int = None, response_data: str = ""):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        self.test_results.append({
            "name": name,
            "success": success,
            "duration": duration,
            "details": details,
            "response_code": response_code,
            "response_data": response_data
        })
        print(f"{status} {name} ({duration:.3f}s) - {details}")
        if response_code and len(str(response_data)) < 500:  # Only show short responses
            print(f"     HTTP {response_code}: {response_data}")
        
    def test_1_health(self) -> bool:
        """Test 1: GET /api/health"""
        print("🏥 Testing Health Endpoint...")
        start_time = time.time()
        try:
            response = requests.get(f"{API_BASE}/health", timeout=10)
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    response_text = json.dumps(data, indent=2)
                    
                    if data.get("status") == "ok":
                        self.log_test("Health Check", True, duration, 
                                    f"Status: {data.get('status')}, Service: {data.get('service', 'N/A')}", 
                                    response.status_code, response_text)
                        return True
                    else:
                        self.log_test("Health Check", False, duration, 
                                    f"Expected status 'ok', got: {data.get('status')}", response.status_code, response_text)
                        return False
                except json.JSONDecodeError:
                    self.log_test("Health Check", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Health Check", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Health Check", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_2_login(self) -> bool:
        """Test 2: POST /api/auth/login with choyt/RFIDGuy1!"""
        print("🔐 Testing Authentication...")
        start_time = time.time()
        try:
            login_data = {"username": "choyt", "password": "RFIDGuy1!"}
            response = requests.post(f"{API_BASE}/auth/login", json=login_data, timeout=10)
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    token = data.get("token")
                    if token:
                        self.auth_token = token
                        self.log_test("Authentication", True, duration, 
                                    f"JWT token received ({len(token)} chars)", 
                                    response.status_code, "Token received")
                        return True
                    else:
                        self.log_test("Authentication", False, duration, 
                                    "No token in response", response.status_code, json.dumps(data, indent=2))
                        return False
                except json.JSONDecodeError:
                    self.log_test("Authentication", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Authentication", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Authentication", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_3_stream_start(self, info_hash: str) -> bool:
        """Test 3: POST /api/stream/start/{info_hash} with sources"""
        print(f"🚀 Testing Stream Start with sources...")
        start_time = time.time()
        try:
            # Include sources as specified in review request
            sources_data = {
                "sources": ["tracker:udp://tracker.opentrackr.org:1337/announce"]
            }
            response = requests.post(f"{API_BASE}/stream/start/{info_hash}", json=sources_data, timeout=15)
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    response_text = json.dumps(data, indent=2)
                    
                    status = data.get("status")
                    if status in ["started", "starting"]:
                        self.log_test("Stream Start", True, duration, 
                                    f"Status: {status}", response.status_code, response_text)
                        return True
                    else:
                        self.log_test("Stream Start", False, duration, 
                                    f"Unexpected status: {status}", response.status_code, response_text)
                        return False
                except json.JSONDecodeError:
                    # Sometimes returns plain text
                    if response.text.strip() in ['"started"', 'started', '"starting"', 'starting']:
                        self.log_test("Stream Start", True, duration, 
                                    f"Status: {response.text.strip()}", response.status_code, response.text)
                        return True
                    else:
                        self.log_test("Stream Start", False, duration, 
                                    "Invalid response format", response.status_code, response.text)
                        return False
            else:
                self.log_test("Stream Start", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Stream Start", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_4_wait_and_status(self, info_hash: str) -> bool:
        """Test 4: Wait 3 seconds then GET /api/stream/status/{info_hash} - verify peers > 0"""
        print("⏳ Waiting 3 seconds as specified in review request...")
        time.sleep(3)
        
        print("📊 Testing Stream Status...")
        start_time = time.time()
        try:
            response = requests.get(f"{API_BASE}/stream/status/{info_hash}", timeout=10)
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    status = data.get("status")
                    peers = data.get("peers", 0)
                    
                    # Check if peers > 0 as required
                    if peers > 0:
                        self.log_test("Stream Status (peers > 0)", True, duration, 
                                    f"Status: {status}, Peers: {peers}", 
                                    response.status_code, f"Peers requirement met")
                        return True
                    else:
                        self.log_test("Stream Status (peers > 0)", False, duration, 
                                    f"Expected peers > 0, got: {peers}", 
                                    response.status_code, json.dumps(data, indent=2))
                        return False
                except json.JSONDecodeError:
                    self.log_test("Stream Status", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Stream Status", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Stream Status", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_5_prefetch_start(self, info_hash: str) -> bool:
        """Test 5: POST /api/stream/prefetch/{info_hash} with position_bytes: 0 - verify status is 'ready'"""
        print("🎯 Testing Prefetch at Start (position_bytes: 0)...")
        start_time = time.time()
        try:
            prefetch_data = {"position_bytes": 0}
            response = requests.post(
                f"{API_BASE}/stream/prefetch/{info_hash}", 
                json=prefetch_data,
                headers={"Content-Type": "application/json"},
                timeout=15
            )
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    response_text = json.dumps(data, indent=2)
                    
                    status = data.get("status")
                    
                    # CRITICAL: verify status is "ready" as specified in review request
                    if status == "ready":
                        self.log_test("Prefetch Start (status=ready)", True, duration, 
                                    f"Status: {status} - CRITICAL requirement met", 
                                    response.status_code, response_text)
                        return True
                    else:
                        self.log_test("Prefetch Start (status=ready)", False, duration, 
                                    f"Expected status 'ready', got: {status}", 
                                    response.status_code, response_text)
                        return False
                except json.JSONDecodeError:
                    self.log_test("Prefetch Start", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Prefetch Start", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Prefetch Start", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_6_prefetch_middle(self, info_hash: str) -> bool:
        """Test 6: POST /api/stream/prefetch/{info_hash} with position_bytes: 50000000 - test seeking to middle"""
        print("🎯 Testing Prefetch at Middle (position_bytes: 50000000)...")
        start_time = time.time()
        try:
            prefetch_data = {"position_bytes": 50000000}
            response = requests.post(
                f"{API_BASE}/stream/prefetch/{info_hash}", 
                json=prefetch_data,
                headers={"Content-Type": "application/json"},
                timeout=15
            )
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    response_text = json.dumps(data, indent=2)
                    
                    status = data.get("status")
                    
                    # Accept any valid status for middle seek (ready, buffering, etc.)
                    if status in ["ready", "buffering", "downloading", "ok"]:
                        self.log_test("Prefetch Middle", True, duration, 
                                    f"Status: {status} - Middle seek working", 
                                    response.status_code, response_text)
                        return True
                    else:
                        self.log_test("Prefetch Middle", False, duration, 
                                    f"Unexpected status: {status}", 
                                    response.status_code, response_text)
                        return False
                except json.JSONDecodeError:
                    self.log_test("Prefetch Middle", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Prefetch Middle", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Prefetch Middle", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_7_video_range(self, info_hash: str) -> bool:
        """Test 7: GET /api/stream/video/{info_hash} with Range: bytes=0-65535 - verify 206"""
        print("🎬 Testing Video Range Request...")
        start_time = time.time()
        try:
            headers = {"Range": "bytes=0-65535"}
            response = requests.get(f"{API_BASE}/stream/video/{info_hash}", headers=headers, timeout=15)
            duration = time.time() - start_time
            
            # CRITICAL: verify 206 Partial Content as specified in review request
            if response.status_code == 206:
                content_length = len(response.content)
                content_type = response.headers.get('content-type', 'unknown')
                
                self.log_test("Video Range Request (206)", True, duration, 
                            f"206 Partial Content, {content_length} bytes, {content_type}", 
                            response.status_code, f"Range request working correctly")
                return True
            else:
                self.log_test("Video Range Request (206)", False, duration, 
                            f"Expected 206, got {response.status_code}", response.status_code, response.text[:200])
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Video Range Request", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_8_torrent_stream_health(self) -> bool:
        """Test 8: GET http://localhost:8002/health"""
        print("🌐 Testing Torrent-Stream Server Health...")
        start_time = time.time()
        try:
            response = requests.get(f"{TORRENT_STREAM_URL}/health", timeout=10)
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    response_text = json.dumps(data, indent=2)
                    
                    status = data.get("status")
                    if status == "ok":
                        self.log_test("Torrent-Stream Health", True, duration, 
                                    f"Status: {status}", 
                                    response.status_code, response_text)
                        return True
                    else:
                        self.log_test("Torrent-Stream Health", False, duration, 
                                    f"Expected status 'ok', got: {status}", response.status_code, response_text)
                        return False
                except json.JSONDecodeError:
                    self.log_test("Torrent-Stream Health", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Torrent-Stream Health", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Torrent-Stream Health", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_9_torrent_stream_status(self, info_hash: str) -> bool:
        """Test 9: GET http://localhost:8002/status/{info_hash}"""
        print("📊 Testing Torrent-Stream Status...")
        start_time = time.time()
        try:
            response = requests.get(f"{TORRENT_STREAM_URL}/status/{info_hash}", timeout=10)
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    response_text = json.dumps(data, indent=2)
                    
                    # Check for expected fields
                    has_peers = "peers" in data or "wt_peers" in data
                    has_status = "ready" in data or "status" in data
                    
                    if has_peers and has_status:
                        self.log_test("Torrent-Stream Status", True, duration, 
                                    f"Status fields present", 
                                    response.status_code, response_text[:200])
                        return True
                    else:
                        self.log_test("Torrent-Stream Status", False, duration, 
                                    f"Missing expected fields", response.status_code, response_text)
                        return False
                except json.JSONDecodeError:
                    self.log_test("Torrent-Stream Status", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Torrent-Stream Status", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Torrent-Stream Status", False, duration, f"Exception: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all review request tests in the exact sequence specified"""
        print("🎬 PRIVASTREAM CINEMA FINAL COMPREHENSIVE BACKEND TEST")
        print("=" * 70)
        print(f"Backend URL: {BACKEND_URL}")
        print(f"Torrent-Stream URL: {TORRENT_STREAM_URL}")
        print("Testing seeking/prefetch improvements as specified in review request")
        print()
        
        # Test hash from review request
        test_info_hash = "08ada5a7a6183aae1e09d831df6748d566095a10"
        
        # Test 1: Health check
        test1_success = self.test_1_health()
        print()
        
        # Test 2: Authentication
        test2_success = self.test_2_login()
        print()
        
        # Test 3: Stream start with sources
        test3_success = self.test_3_stream_start(test_info_hash)
        print()
        
        # Test 4: Wait 3 seconds and check status (peers > 0)
        test4_success = self.test_4_wait_and_status(test_info_hash)
        print()
        
        # Test 5: Prefetch at start (CRITICAL: status must be "ready")
        test5_success = self.test_5_prefetch_start(test_info_hash)
        print()
        
        # Test 6: Prefetch at middle (test seeking)
        test6_success = self.test_6_prefetch_middle(test_info_hash)
        print()
        
        # Test 7: Video range request (CRITICAL: must return 206)
        test7_success = self.test_7_video_range(test_info_hash)
        print()
        
        # Test 8: Torrent-stream health
        test8_success = self.test_8_torrent_stream_health()
        print()
        
        # Test 9: Torrent-stream status
        test9_success = self.test_9_torrent_stream_status(test_info_hash)
        print()
        
        # Print summary
        print("=" * 70)
        print("📋 FINAL COMPREHENSIVE TEST SUMMARY")
        print("=" * 70)
        
        passed = sum(1 for r in self.test_results if r["success"])
        total = len(self.test_results)
        
        for result in self.test_results:
            status = "✅ PASS" if result["success"] else "❌ FAIL"
            code_info = f" [{result['response_code']}]" if result["response_code"] else ""
            print(f"{status} {result['name']}{code_info} ({result['duration']:.3f}s)")
            if result["details"]:
                print(f"     {result['details']}")
        
        print(f"\n🎯 OVERALL RESULT: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
        
        if passed == total:
            print("🎉 ALL REVIEW REQUEST REQUIREMENTS VERIFIED!")
            print("\n📋 CRITICAL VERIFICATIONS COMPLETED:")
            print("1. ✅ GET /api/health → 200 OK")
            print("2. ✅ POST /api/auth/login → JWT token received")
            print("3. ✅ POST /api/stream/start/{hash} with sources → started")
            print("4. ✅ GET /api/stream/status/{hash} → peers > 0")
            print("5. ✅ POST /api/stream/prefetch/{hash} position_bytes:0 → status 'ready'")
            print("6. ✅ POST /api/stream/prefetch/{hash} position_bytes:50000000 → seeking works")
            print("7. ✅ GET /api/stream/video/{hash} Range:bytes=0-65535 → 206 Partial Content")
            print("8. ✅ GET localhost:8002/health → torrent-stream healthy")
            print("9. ✅ GET localhost:8002/status/{hash} → torrent-stream status")
            print("\n🚀 PREFETCH-BEFORE-SEEK MECHANISM VERIFIED!")
        else:
            print("⚠️  Some tests failed - see details above")
            
        return passed == total

def main():
    """Main entry point"""
    tester = FinalReviewTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()