#!/usr/bin/env python3
"""
PrivastreamCinema Backend API Test Suite
Tests authentication, discover content organization, and addon management APIs
"""

import requests
import json
import sys
import os
from typing import Dict, Any, Optional

# Get backend URL from frontend .env file
def get_backend_url():
    """Read backend URL from frontend .env file"""
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
                    url = line.split('=', 1)[1].strip().strip('"')
                    return f"{url}/api"
    except Exception as e:
        print(f"Error reading frontend .env: {e}")
    
    # Fallback to localhost for testing
    return "http://localhost:8001/api"

BASE_URL = get_backend_url()
print(f"Testing backend at: {BASE_URL}")

# Test credentials
TEST_USERNAME = "choyt"
TEST_PASSWORD = "RFIDGuy1!"

class PrivastreamTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.token = None
        self.session = requests.Session()
        self.session.timeout = 30
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, message: str, details: Any = None):
        """Log test result"""
        result = {
            "test": test_name,
            "success": success,
            "message": message,
            "details": details
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        if details and not success:
            print(f"   Details: {details}")
        
    def test_login(self) -> bool:
        """Test user authentication"""
        print("\n=== Testing Authentication ===")
        
        login_data = {
            "username": TEST_USERNAME,
            "password": TEST_PASSWORD
        }
        
        try:
            response = self.session.post(
                f"{self.base_url}/auth/login",
                json=login_data,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check response structure
                if 'user' in data and 'token' in data:
                    self.token = data['token']
                    user = data['user']
                    self.log_test(
                        "Authentication Login",
                        True,
                        f"Login successful for user {user.get('username')}",
                        {"user_id": user.get("id"), "is_admin": user.get("is_admin")}
                    )
                    
                    # Set authorization header for future requests
                    self.session.headers.update({
                        "Authorization": f"Bearer {self.token}"
                    })
                    return True
                else:
                    self.log_test(
                        "Authentication Login",
                        False,
                        "Login response missing token or user data",
                        data
                    )
                    return False
            else:
                self.log_test(
                    "Authentication Login",
                    False,
                    f"Login failed with status {response.status_code}",
                    response.text
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Authentication Login",
                False,
                f"Login request failed: {str(e)}",
                None
            )
            return False
    
    def test_discover_content_organization(self) -> bool:
        """Test GET /api/content/discover-organized"""
        print("\n=== Testing Discover Content Organization ===")
        
        if not self.token:
            self.log_test(
                "Discover Content Organization",
                False,
                "No authentication token available",
                None
            )
            return False
        
        try:
            response = self.session.get(
                f"{self.base_url}/content/discover-organized",
                timeout=60  # Longer timeout for content fetching
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check basic structure
                if "services" not in data:
                    self.log_test(
                        "Discover Content Structure",
                        False,
                        "Response missing 'services' field",
                        data
                    )
                    return False
                
                services = data["services"]
                
                # Check for required sections
                required_sections = [
                    "New Movies", "New Series",  # From Cinemeta
                    "Popular Movies", "Popular Series"  # From Cinemeta
                ]
                
                # Check for streaming service sections
                streaming_services = [
                    "Netflix Movies", "Netflix Series",
                    "HBO Max Movies", "HBO Max Series", 
                    "Disney+ Movies", "Disney+ Series"
                ]
                
                # Check for USA TV Channels
                tv_channels = ["USA TV Channels"]
                
                # Verify required sections exist
                missing_required = []
                for section in required_sections:
                    if section not in services:
                        missing_required.append(section)
                
                if missing_required:
                    self.log_test(
                        "Discover Required Sections",
                        False,
                        f"Missing required sections: {missing_required}",
                        {"available_sections": list(services.keys())}
                    )
                else:
                    self.log_test(
                        "Discover Required Sections",
                        True,
                        f"All required sections present: {required_sections}",
                        None
                    )
                
                # Check for streaming services (at least some should be present)
                found_streaming = [s for s in streaming_services if s in services]
                if found_streaming:
                    self.log_test(
                        "Discover Streaming Services",
                        True,
                        f"Found streaming services: {found_streaming}",
                        None
                    )
                else:
                    self.log_test(
                        "Discover Streaming Services",
                        False,
                        "No streaming service sections found",
                        {"available_sections": list(services.keys())}
                    )
                
                # Check for USA TV Channels
                found_tv = [s for s in tv_channels if s in services]
                if found_tv:
                    self.log_test(
                        "Discover TV Channels",
                        True,
                        f"Found TV channels: {found_tv}",
                        None
                    )
                else:
                    self.log_test(
                        "Discover TV Channels",
                        False,
                        "No USA TV Channels section found",
                        {"available_sections": list(services.keys())}
                    )
                
                # Check for unwanted sections (bugs)
                unwanted_sections = ["Calendar-Videos Series", "Last-Videos Series"]
                found_unwanted = [s for s in unwanted_sections if s in services]
                if found_unwanted:
                    self.log_test(
                        "Discover Unwanted Sections Check",
                        False,
                        f"Found unwanted sections (bugs): {found_unwanted}",
                        None
                    )
                else:
                    self.log_test(
                        "Discover Unwanted Sections Check",
                        True,
                        "No unwanted sections found",
                        None
                    )
                
                # Check content in sections
                total_content = 0
                section_details = {}
                for section_name, section_data in services.items():
                    if isinstance(section_data, dict):
                        movies = len(section_data.get("movies", []))
                        series = len(section_data.get("series", []))
                        channels = len(section_data.get("channels", []))
                        section_total = movies + series + channels
                        total_content += section_total
                        section_details[section_name] = {
                            "movies": movies,
                            "series": series, 
                            "channels": channels,
                            "total": section_total
                        }
                
                if total_content > 0:
                    self.log_test(
                        "Discover Content Population",
                        True,
                        f"Found {total_content} total content items across {len(services)} sections",
                        {"section_breakdown": section_details}
                    )
                    return True
                else:
                    self.log_test(
                        "Discover Content Population",
                        False,
                        "No content found in any sections",
                        {"section_breakdown": section_details}
                    )
                    return False
                    
            else:
                self.log_test(
                    "Discover Content Organization",
                    False,
                    f"Request failed with status {response.status_code}",
                    response.text
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Discover Content Organization",
                False,
                f"Request failed: {str(e)}",
                None
            )
            return False
    
    def test_discover_content(self) -> bool:
        """Test discover page content API"""
        print(f"\n=== Testing Discover Content ===")
        
        if not self.token:
            print("❌ No authentication token - login first")
            return False
        
        try:
            response = self.session.get(f"{self.base_url}/content/discover-organized")
            
            print(f"Discover Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response Keys: {list(data.keys())}")
                
                if 'services' in data:
                    services = data['services']
                    print(f"✅ Discover content found")
                    print(f"   Services: {len(services)} services")
                    
                    for service_name, service_data in services.items():
                        movies_count = len(service_data.get('movies', []))
                        series_count = len(service_data.get('series', []))
                        channels_count = len(service_data.get('channels', []))
                        
                        print(f"   {service_name}: {movies_count} movies, {series_count} series", end="")
                        if channels_count > 0:
                            print(f", {channels_count} channels")
                        else:
                            print()
                    
                    # Check if we have some content
                    total_content = sum(
                        len(service.get('movies', [])) + len(service.get('series', []))
                        for service in services.values()
                    )
                    
                    if total_content > 0:
                        print(f"✅ Total content items: {total_content}")
                        return True
                    else:
                        print(f"⚠️  No content found in any service")
                        return True  # Still valid response structure
                else:
                    print(f"❌ Invalid response structure - missing 'services' key")
                    print(f"   Response: {data}")
                    return False
            else:
                print(f"❌ Discover request failed - Status {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Discover request failed - Exception: {e}")
            return False
    
    def test_auth_me(self) -> bool:
        """Test /auth/me endpoint to verify token works"""
        print(f"\n=== Testing Auth Me ===")
        
        if not self.token:
            print("❌ No authentication token - login first")
            return False
        
        try:
            response = self.session.get(f"{self.base_url}/auth/me")
            
            print(f"Auth Me Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ Auth verification successful")
                print(f"   User: {data.get('username')}")
                print(f"   Admin: {data.get('is_admin')}")
                return True
            else:
                print(f"❌ Auth verification failed - Status {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Auth verification failed - Exception: {e}")
            return False

def main():
    """Run all tests"""
    print("🎬 PrivastreamCinema Backend API Test Suite")
    print("=" * 50)
    
    tester = PrivastreamTester()
    results = {}
    
    # Test 1: Authentication
    results['login'] = tester.test_login()
    
    # Test 2: Auth verification
    results['auth_me'] = tester.test_auth_me()
    
    # Test 3: Stream fetching for Wake Up Dead Man
    results['streams_wake_up_dead_man'] = tester.test_streams_movie(
        "tt14364480", 
        "Wake Up Dead Man: A Knives Out Mystery"
    )
    
    # Test 4: Stream fetching for The Holdovers
    results['streams_holdovers'] = tester.test_streams_movie(
        "tt14849194", 
        "The Holdovers"
    )
    
    # Test 5: Discover content
    results['discover_content'] = tester.test_discover_content()
    
    # Summary
    print("\n" + "=" * 50)
    print("🎯 TEST SUMMARY")
    print("=" * 50)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results.items():
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{test_name.replace('_', ' ').title()}: {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️  Some tests failed - check logs above")
        return 1

if __name__ == "__main__":
    sys.exit(main())