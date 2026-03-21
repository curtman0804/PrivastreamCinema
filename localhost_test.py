#!/usr/bin/env python3
"""
Backend API Testing Script for Privastream Cinema - Localhost Testing
Tests the specific streaming pipeline requirements from the review request at localhost:8001.
"""

import requests
import time
import json
import sys
from typing import Dict, Any

# Test configuration - EXACTLY as specified in review request
BASE_URL = "http://localhost:8001"
INFO_HASH = "08ada5a7a6183aae1e09d831df6748d566095a10"

def log_test(test_name: str, success: bool, details: str = ""):
    """Log test results with consistent formatting"""
    status = "✅ PASS" if success else "❌ FAIL"
    print(f"{status} {test_name}")
    if details:
        print(f"    {details}")
    print()

def test_health_check() -> bool:
    """Test 1: GET http://localhost:8001/api/health"""
    print("🏥 Testing Health Check...")
    try:
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            log_test("Health Check", True, f"Response: {data}")
            return True
        else:
            log_test("Health Check", False, f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Health Check", False, f"Exception: {e}")
        return False

def test_stream_start() -> bool:
    """Test 2: POST http://localhost:8001/api/stream/start/08ada5a7a6183aae1e09d831df6748d566095a10"""
    print("🚀 Testing Stream Start...")
    try:
        response = requests.post(f"{BASE_URL}/api/stream/start/{INFO_HASH}", timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            log_test("Stream Start", True, f"Response: {data}")
            return True
        else:
            log_test("Stream Start", False, f"HTTP {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        log_test("Stream Start", False, f"Exception: {e}")
        return False

def test_stream_status() -> Dict[str, Any]:
    """Test 4: GET http://localhost:8001/api/stream/status/08ada5a7a6183aae1e09d831df6748d566095a10
    
    CRITICAL CHECKS from review request:
    - CHECK: must have "engine" field (should be "webtorrent")
    - CHECK: must have "wt_peers" field  
    - CHECK: must have "lt_peers" field
    - CHECK: peers should be > 0
    - CHECK: status should be "ready"
    """
    print("📊 Testing Stream Status...")
    try:
        response = requests.get(f"{BASE_URL}/api/stream/status/{INFO_HASH}", timeout=10)
        
        if response.status_code != 200:
            log_test("Stream Status", False, f"HTTP {response.status_code}: {response.text}")
            return {}
            
        data = response.json()
        print(f"    Full response: {json.dumps(data, indent=2)}")
        
        # CHECK: must have "engine" field (should be "webtorrent")
        engine = data.get("engine")
        if "engine" not in data:
            log_test("Stream Status - Engine Field Present", False, "Missing 'engine' field")
            return data
        else:
            log_test("Stream Status - Engine Field Present", True, f"Engine: {engine}")
            
            # Verify engine value
            if engine == "webtorrent":
                log_test("Stream Status - Engine Value", True, f"Engine is 'webtorrent' as expected")
            else:
                log_test("Stream Status - Engine Value", False, f"Engine is '{engine}' (expected 'webtorrent')")
        
        # CHECK: must have "wt_peers" field
        if "wt_peers" not in data:
            log_test("Stream Status - wt_peers Field", False, "Missing 'wt_peers' field")
        else:
            wt_peers = data.get("wt_peers", 0)
            log_test("Stream Status - wt_peers Field", True, f"wt_peers: {wt_peers}")
        
        # CHECK: must have "lt_peers" field
        if "lt_peers" not in data:
            log_test("Stream Status - lt_peers Field", False, "Missing 'lt_peers' field")
        else:
            lt_peers = data.get("lt_peers", 0)
            log_test("Stream Status - lt_peers Field", True, f"lt_peers: {lt_peers}")
        
        # CHECK: peers should be > 0
        wt_peers = data.get("wt_peers", 0)
        lt_peers = data.get("lt_peers", 0)
        total_peers = wt_peers + lt_peers
        
        if total_peers > 0:
            log_test("Stream Status - Peers Count > 0", True, f"Total peers: {total_peers} (wt: {wt_peers}, lt: {lt_peers})")
        else:
            log_test("Stream Status - Peers Count > 0", False, f"No peers found (wt: {wt_peers}, lt: {lt_peers})")
        
        # CHECK: status should be "ready"
        status = data.get("status")
        if status == "ready":
            log_test("Stream Status - Ready Status", True, f"Status: {status}")
        else:
            log_test("Stream Status - Ready Status", False, f"Status: {status} (expected 'ready')")
        
        return data
        
    except Exception as e:
        log_test("Stream Status", False, f"Exception: {e}")
        return {}

def test_video_range_request() -> bool:
    """Test 5: GET http://localhost:8001/api/stream/video/08ada5a7a6183aae1e09d831df6748d566095a10 
    with header "Range: bytes=0-65535"
    
    CRITICAL CHECKS from review request:
    - CHECK: HTTP 206
    - CHECK: body > 0 bytes
    """
    print("🎬 Testing Video Range Request...")
    try:
        headers = {"Range": "bytes=0-65535"}
        response = requests.get(f"{BASE_URL}/api/stream/video/{INFO_HASH}", 
                              headers=headers, timeout=30)
        
        # CHECK: HTTP 206
        if response.status_code == 206:
            log_test("Video Range Request - HTTP 206", True, f"Status: {response.status_code}")
        else:
            log_test("Video Range Request - HTTP 206", False, f"Status: {response.status_code} (expected 206)")
            return False
        
        # CHECK: body > 0 bytes
        content_length = len(response.content)
        if content_length > 0:
            log_test("Video Range Request - Body > 0 bytes", True, f"Received {content_length} bytes")
            
            # Additional verification: should be exactly 65536 bytes for this range
            if content_length == 65536:
                log_test("Video Range Request - Exact Range Size", True, f"Received exactly 65536 bytes as requested")
            else:
                log_test("Video Range Request - Exact Range Size", False, f"Received {content_length} bytes (expected 65536)")
            
            return True
        else:
            log_test("Video Range Request - Body > 0 bytes", False, "No content received")
            return False
            
    except Exception as e:
        log_test("Video Range Request", False, f"Exception: {e}")
        return False

def test_video_head_request() -> bool:
    """Test 6: HEAD http://localhost:8001/api/stream/video/08ada5a7a6183aae1e09d831df6748d566095a10
    
    CRITICAL CHECKS from review request:
    - CHECK: HTTP 200
    - CHECK: Content-Length header present
    """
    print("🔍 Testing Video HEAD Request...")
    try:
        response = requests.head(f"{BASE_URL}/api/stream/video/{INFO_HASH}", timeout=10)
        
        # CHECK: HTTP 200
        if response.status_code == 200:
            log_test("Video HEAD Request - HTTP 200", True, f"Status: {response.status_code}")
        else:
            log_test("Video HEAD Request - HTTP 200", False, f"Status: {response.status_code} (expected 200)")
            return False
        
        # CHECK: Content-Length header present
        content_length = response.headers.get("Content-Length")
        if content_length:
            log_test("Video HEAD Request - Content-Length Present", True, f"Content-Length: {content_length}")
            return True
        else:
            log_test("Video HEAD Request - Content-Length Present", False, "Content-Length header missing")
            return False
            
    except Exception as e:
        log_test("Video HEAD Request", False, f"Exception: {e}")
        return False

def main():
    """Run all tests in sequence exactly as specified in review request"""
    print("🎯 PRIVASTREAM CINEMA BACKEND API TESTING - LOCALHOST:8001")
    print("=" * 60)
    print(f"Base URL: {BASE_URL}")
    print(f"Info Hash: {INFO_HASH}")
    print("=" * 60)
    print()
    
    # Track test results
    results = []
    
    # Test 1: GET http://localhost:8001/api/health
    results.append(test_health_check())
    
    # Test 2: POST http://localhost:8001/api/stream/start/08ada5a7a6183aae1e09d831df6748d566095a10
    results.append(test_stream_start())
    
    # Test 3: Wait 3 seconds
    print("⏳ Waiting 3 seconds as specified in review request...")
    time.sleep(3)
    print("    Wait complete")
    print()
    
    # Test 4: GET http://localhost:8001/api/stream/status/08ada5a7a6183aae1e09d831df6748d566095a10
    status_data = test_stream_status()
    results.append(bool(status_data))
    
    # Test 5: GET http://localhost:8001/api/stream/video/08ada5a7a6183aae1e09d831df6748d566095a10 with Range header
    results.append(test_video_range_request())
    
    # Test 6: HEAD http://localhost:8001/api/stream/video/08ada5a7a6183aae1e09d831df6748d566095a10
    results.append(test_video_head_request())
    
    # Summary
    print("=" * 60)
    print("🎉 TEST SUMMARY - REVIEW REQUEST VERIFICATION")
    print("=" * 60)
    
    passed = sum(results)
    total = len(results)
    
    test_names = [
        "1. Health Check",
        "2. Stream Start", 
        "4. Stream Status (with engine/peers fields)",
        "5. Video Range Request (206 + body > 0)",
        "6. Video HEAD Request (200 + Content-Length)"
    ]
    
    for i, (name, result) in enumerate(zip(test_names, results)):
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} {name}")
    
    print()
    print(f"Overall: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
    
    if passed == total:
        print("🎉 ALL REVIEW REQUEST TESTS PASSED! Backend streaming pipeline is working correctly.")
        return 0
    else:
        print("⚠️  Some tests failed. Check the details above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())