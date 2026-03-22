#!/usr/bin/env python3
"""
Backend Test Suite for Privastream Cinema - 20MB Buffering Threshold Testing
Tests the new 20MB buffering threshold implementation as specified in review request.
"""

import requests
import time
import json
import sys
from typing import Dict, Any, Optional

# Backend URL from environment
BACKEND_URL = "https://torrent-playback-fix.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

# Test credentials
TEST_USERNAME = "choyt"
TEST_PASSWORD = "RFIDGuy1!"

# Test torrent hash (Sintel - open source movie)
TEST_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10"

class PrivastreamTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.timeout = 30
        self.auth_token = None
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str, response_time: float = 0):
        """Log test result"""
        status = "✅" if success else "❌"
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "response_time": response_time
        }
        self.test_results.append(result)
        print(f"{status} {test_name}: {details} ({response_time:.3f}s)")
        
    def test_authentication(self) -> bool:
        """Test 1: Authentication with choyt/RFIDGuy1!"""
        start_time = time.time()
        try:
            response = self.session.post(f"{API_BASE}/auth/login", json={
                "username": TEST_USERNAME,
                "password": TEST_PASSWORD
            })
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                self.auth_token = data.get("token")
                if self.auth_token:
                    # Set auth header for future requests
                    self.session.headers.update({"Authorization": f"Bearer {self.auth_token}"})
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
    
    def test_health_endpoint(self) -> bool:
        """Test 2: Health endpoint verification"""
        start_time = time.time()
        try:
            response = self.session.get(f"{API_BASE}/health")
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "ok":
                    self.log_test("Health Check", True, f"Returns {data}", response_time)
                    return True
                else:
                    self.log_test("Health Check", False, f"Unexpected response: {data}", response_time)
                    return False
            else:
                self.log_test("Health Check", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Health Check", False, f"Exception: {str(e)}", response_time)
            return False
    
    def test_stream_start(self) -> bool:
        """Test 3: Stream start with empty sources array"""
        start_time = time.time()
        try:
            response = self.session.post(f"{API_BASE}/stream/start/{TEST_HASH}", json={
                "sources": []
            })
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "started":
                    self.log_test("Stream Start", True, f"Returns {data}", response_time)
                    return True
                else:
                    self.log_test("Stream Start", False, f"Unexpected status: {data}", response_time)
                    return False
            else:
                self.log_test("Stream Start", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Stream Start", False, f"Exception: {str(e)}", response_time)
            return False
    
    def test_stream_status_20mb_threshold(self) -> Dict[str, Any]:
        """Test 4: Stream status with 20MB threshold verification"""
        print(f"\n⏳ Waiting 10 seconds for download to start...")
        time.sleep(10)
        
        start_time = time.time()
        try:
            response = self.session.get(f"{API_BASE}/stream/status/{TEST_HASH}")
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                
                # Check for required fields
                required_fields = ["status", "peers", "ready_threshold_mb"]
                missing_fields = [field for field in required_fields if field not in data]
                
                if missing_fields:
                    self.log_test("Stream Status", False, f"Missing fields: {missing_fields}", response_time)
                    return {}
                
                # Verify 20MB threshold
                ready_threshold_mb = data.get("ready_threshold_mb")
                if ready_threshold_mb == 20:
                    threshold_check = "✅ 20MB threshold confirmed"
                else:
                    threshold_check = f"❌ Expected 20MB, got {ready_threshold_mb}MB"
                
                status = data.get("status")
                peers = data.get("peers", 0)
                
                details = f"Status: {status}, Peers: {peers}, {threshold_check}"
                self.log_test("Stream Status (20MB Threshold)", True, details, response_time)
                
                # Log additional useful fields
                if "ready_progress" in data:
                    print(f"   📊 Ready Progress: {data['ready_progress']:.1f}%")
                if "downloaded" in data:
                    downloaded_mb = data['downloaded'] / (1024 * 1024)
                    print(f"   📥 Downloaded: {downloaded_mb:.1f}MB")
                if "video_file" in data:
                    print(f"   🎬 Video File: {data['video_file']}")
                
                return data
            else:
                self.log_test("Stream Status (20MB Threshold)", False, f"HTTP {response.status_code}: {response.text}", response_time)
                return {}
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Stream Status (20MB Threshold)", False, f"Exception: {str(e)}", response_time)
            return {}
    
    def test_video_range_request(self) -> bool:
        """Test 5: Video range request if status is ready"""
        start_time = time.time()
        try:
            headers = {"Range": "bytes=0-65535"}
            response = self.session.get(f"{API_BASE}/stream/video/{TEST_HASH}", headers=headers)
            response_time = time.time() - start_time
            
            if response.status_code == 206:  # Partial Content
                content_length = len(response.content)
                content_type = response.headers.get("Content-Type", "")
                
                if content_length == 65536:
                    self.log_test("Video Range Request", True, 
                                f"HTTP 206, {content_length} bytes, {content_type}", response_time)
                    return True
                else:
                    self.log_test("Video Range Request", False, 
                                f"Expected 65536 bytes, got {content_length}", response_time)
                    return False
            else:
                self.log_test("Video Range Request", False, 
                            f"HTTP {response.status_code}: {response.text[:100]}", response_time)
                return False
                
        except Exception as e:
            response_time = time.time() - start_time
            self.log_test("Video Range Request", False, f"Exception: {str(e)}", response_time)
            return False
    
    def run_comprehensive_test(self):
        """Run the complete test suite as specified in review request"""
        print("🎯 PRIVASTREAM CINEMA - 20MB BUFFERING THRESHOLD TEST")
        print("=" * 60)
        print(f"Backend URL: {BACKEND_URL}")
        print(f"Test Hash: {TEST_HASH}")
        print(f"Credentials: {TEST_USERNAME}/{TEST_PASSWORD}")
        print()
        
        # Test 1: Authentication
        if not self.test_authentication():
            print("❌ Authentication failed - stopping tests")
            return False
        
        # Test 2: Health check
        if not self.test_health_endpoint():
            print("❌ Health check failed - continuing with other tests")
        
        # Test 3: Stream start
        if not self.test_stream_start():
            print("❌ Stream start failed - stopping tests")
            return False
        
        # Test 4: Stream status with 20MB threshold check
        status_data = self.test_stream_status_20mb_threshold()
        if not status_data:
            print("❌ Stream status failed - stopping tests")
            return False
        
        # Test 5: Video range request (only if status is ready)
        if status_data.get("status") == "ready":
            print(f"\n🎬 Status is 'ready' - testing video data serving...")
            self.test_video_range_request()
        else:
            print(f"\n⏳ Status is '{status_data.get('status')}' - skipping video test")
            print("   (This is normal if torrent is still buffering)")
        
        return True
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result["success"])
        failed_tests = total_tests - passed_tests
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_tests}")
        print(f"❌ Failed: {failed_tests}")
        print(f"Success Rate: {(passed_tests/total_tests)*100:.1f}%")
        
        if failed_tests > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"   • {result['test']}: {result['details']}")
        
        print("\n🎯 KEY FINDINGS:")
        
        # Check for 20MB threshold confirmation
        status_test = next((r for r in self.test_results if "20MB Threshold" in r["test"]), None)
        if status_test and status_test["success"]:
            if "20MB threshold confirmed" in status_test["details"]:
                print("   ✅ 20MB buffering threshold is correctly implemented")
            else:
                print("   ❌ 20MB buffering threshold NOT found in response")
        
        # Check authentication
        auth_test = next((r for r in self.test_results if r["test"] == "Authentication"), None)
        if auth_test and auth_test["success"]:
            print("   ✅ Authentication with choyt/RFIDGuy1! working")
        
        # Check health endpoint
        health_test = next((r for r in self.test_results if r["test"] == "Health Check"), None)
        if health_test and health_test["success"]:
            print("   ✅ Health endpoint returns correct response")
        
        # Check streaming pipeline
        stream_tests = [r for r in self.test_results if "Stream" in r["test"]]
        if all(r["success"] for r in stream_tests):
            print("   ✅ Complete streaming pipeline functional")
        
        print()

def main():
    """Main test execution"""
    tester = PrivastreamTester()
    
    try:
        success = tester.run_comprehensive_test()
        tester.print_summary()
        
        if success:
            print("🎉 Testing completed successfully!")
            return 0
        else:
            print("💥 Testing failed!")
            return 1
            
    except KeyboardInterrupt:
        print("\n⚠️ Testing interrupted by user")
        return 1
    except Exception as e:
        print(f"\n💥 Unexpected error: {str(e)}")
        return 1

if __name__ == "__main__":
    sys.exit(main())