#!/usr/bin/env python3
"""
Privastream Cinema Backend API Test - Review Request Specific (Updated)
Tests the exact endpoints specified in the review request against localhost:8001
With extended wait time for torrent to become ready
"""

import requests
import json
import time
import sys

# Backend URL as specified in review request
BACKEND_URL = "http://localhost:8001"
API_BASE = f"{BACKEND_URL}/api"

class ReviewRequestTester:
    def __init__(self):
        self.test_results = []
        
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
        """Test 1: GET http://localhost:8001/api/health - should return {"status": "ok"}"""
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
    
    def test_2_stream_start(self, info_hash: str) -> bool:
        """Test 2: POST http://localhost:8001/api/stream/start/{info_hash} - start Shawshank torrent"""
        print(f"▶️ Testing Stream Start (hash: {info_hash[:16]}...)...")
        start_time = time.time()
        try:
            response = requests.post(f"{API_BASE}/stream/start/{info_hash}", timeout=15)
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
    
    def wait_for_torrent_ready(self, info_hash: str, max_wait_seconds: int = 60) -> bool:
        """Wait for torrent to become ready for seeking"""
        print(f"⏳ Waiting for torrent to become ready (max {max_wait_seconds}s)...")
        start_time = time.time()
        
        while time.time() - start_time < max_wait_seconds:
            try:
                response = requests.get(f"{API_BASE}/stream/status/{info_hash}", timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    status = data.get("status")
                    progress = data.get("ready_progress", 0)
                    peers = data.get("peers", 0)
                    
                    elapsed = time.time() - start_time
                    print(f"   {elapsed:.1f}s: Status={status}, Progress={progress}%, Peers={peers}")
                    
                    # Consider ready if status is 'ready' or 'buffering' with progress > 0
                    if status in ['ready', 'buffering'] and progress > 0:
                        print(f"✅ Torrent ready after {elapsed:.1f}s!")
                        return True
                        
                time.sleep(5)  # Check every 5 seconds
            except Exception as e:
                print(f"   Error checking status: {e}")
                time.sleep(5)
        
        print(f"❌ Torrent not ready after {max_wait_seconds}s")
        return False
    
    def test_3_stream_seek(self, info_hash: str, position_bytes: int) -> bool:
        """Test 3: POST http://localhost:8001/api/stream/seek/{info_hash} with body {"position_bytes": 100000000}"""
        print(f"🎯 Testing Stream Seek (position: {position_bytes:,} bytes)...")
        start_time = time.time()
        try:
            seek_data = {"position_bytes": position_bytes}
            response = requests.post(
                f"{API_BASE}/stream/seek/{info_hash}", 
                json=seek_data,
                headers={"Content-Type": "application/json"},
                timeout=15
            )
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    response_text = json.dumps(data, indent=2)
                    
                    status = data.get("status")
                    target_piece = data.get("target_piece")
                    buffer_pieces = data.get("buffer_pieces")
                    
                    if status == "ok" and target_piece is not None and buffer_pieces is not None:
                        self.log_test("Stream Seek", True, duration, 
                                    f"Status: {status}, Target piece: {target_piece}, Buffer pieces: {buffer_pieces}", 
                                    response.status_code, response_text)
                        return True
                    else:
                        self.log_test("Stream Seek", False, duration, 
                                    f"Missing expected fields - status: {status}, target_piece: {target_piece}, buffer_pieces: {buffer_pieces}", 
                                    response.status_code, response_text)
                        return False
                except json.JSONDecodeError:
                    self.log_test("Stream Seek", False, duration, 
                                "Invalid JSON response", response.status_code, response.text)
                    return False
            else:
                self.log_test("Stream Seek", False, duration, 
                            f"Expected 200, got {response.status_code}", response.status_code, response.text)
                return False
                
        except Exception as e:
            duration = time.time() - start_time
            self.log_test("Stream Seek", False, duration, f"Exception: {str(e)}")
            return False
    
    def test_4_stream_status(self, info_hash: str) -> bool:
        """Test 4: GET http://localhost:8001/api/stream/status/{info_hash} - verify status returns, check peers count and ready_progress"""
        print(f"📊 Testing Stream Status...")
        start_time = time.time()
        try:
            response = requests.get(f"{API_BASE}/stream/status/{info_hash}", timeout=10)
            duration = time.time() - start_time
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    
                    status = data.get("status")
                    peers = data.get("peers")
                    ready_progress = data.get("ready_progress")
                    
                    # Check if all expected fields are present
                    has_status = status is not None
                    has_peers = peers is not None
                    has_ready_progress = ready_progress is not None
                    
                    if has_status and has_peers and has_ready_progress:
                        self.log_test("Stream Status", True, duration, 
                                    f"Status: {status}, Peers: {peers}, Ready progress: {ready_progress}%", 
                                    response.status_code, f"Status fields verified")
                        return True
                    else:
                        missing_fields = []
                        if not has_status: missing_fields.append("status")
                        if not has_peers: missing_fields.append("peers")
                        if not has_ready_progress: missing_fields.append("ready_progress")
                        
                        self.log_test("Stream Status", False, duration, 
                                    f"Missing fields: {', '.join(missing_fields)}", 
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
    
    def run_all_tests(self):
        """Run all review request tests in the exact sequence specified"""
        print("🎬 PRIVASTREAM CINEMA BACKEND API TESTING - REVIEW REQUEST")
        print("=" * 60)
        print(f"Testing against: {BACKEND_URL}")
        print()
        
        # Test hash from review request
        test_info_hash = "08ada5a7a6183aae1e09d831df6748d566095a10"
        seek_position = 100000000  # 100MB as specified in review request
        
        # Test 1: Health check
        test1_success = self.test_1_health()
        print()
        
        # Test 2: Stream start
        test2_success = self.test_2_stream_start(test_info_hash)
        print()
        
        # Wait 5 seconds as specified in review request
        print("⏳ Waiting 5 seconds as specified in review request...")
        time.sleep(5)
        print()
        
        # Check if torrent is ready, if not wait longer
        torrent_ready = self.wait_for_torrent_ready(test_info_hash, max_wait_seconds=60)
        print()
        
        # Test 3: Stream seek (only if torrent is ready)
        if torrent_ready:
            test3_success = self.test_3_stream_seek(test_info_hash, seek_position)
        else:
            self.log_test("Stream Seek", False, 0, "Torrent not ready for seeking after 60s wait")
            test3_success = False
        print()
        
        # Test 4: Stream status
        test4_success = self.test_4_stream_status(test_info_hash)
        print()
        
        # Print summary
        print("=" * 60)
        print("📋 FINAL TEST SUMMARY")
        print("=" * 60)
        
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
            print("\n📋 RESPONSE SUMMARY:")
            print("1. GET /api/health → 200 OK with {\"status\": \"ok\"}")
            print("2. POST /api/stream/start/{hash} → 200 OK with {\"status\": \"started\"}")
            print("3. POST /api/stream/seek/{hash} → 200 OK with status \"ok\", target_piece, and buffer_pieces")
            print("4. GET /api/stream/status/{hash} → 200 OK with status, peers count, and ready_progress")
        else:
            print("⚠️  Some tests failed - see details above")
            
        return passed == total

def main():
    """Main entry point"""
    tester = ReviewRequestTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()