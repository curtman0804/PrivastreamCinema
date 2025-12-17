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
    
    def test_addon_management(self) -> bool:
        """Test addon management APIs"""
        print("\n=== Testing Addon Management ===")
        
        if not self.token:
            self.log_test(
                "Addon Management",
                False,
                "No authentication token available",
                None
            )
            return False
        
        try:
            # Test GET /api/addons
            response = self.session.get(f"{self.base_url}/addons", timeout=30)
            
            if response.status_code == 200:
                addons = response.json()
                self.log_test(
                    "Get Addons List",
                    True,
                    f"Retrieved {len(addons)} installed addons",
                    {"addon_count": len(addons), "addon_names": [a.get("manifest", {}).get("name", "Unknown") for a in addons]}
                )
                
                # Test addon deletion if we have addons
                if addons:
                    # Pick the first addon to test deletion
                    test_addon = addons[0]
                    addon_id = test_addon.get("id")
                    addon_name = test_addon.get("manifest", {}).get("name", "Unknown")
                    addon_manifest_url = test_addon.get("manifestUrl")
                    
                    if addon_id:
                        # Test DELETE /api/addons/{addon_id}
                        delete_response = self.session.delete(
                            f"{self.base_url}/addons/{addon_id}",
                            timeout=30
                        )
                        
                        if delete_response.status_code == 200:
                            self.log_test(
                                "Delete Addon",
                                True,
                                f"Successfully deleted addon '{addon_name}'",
                                {"addon_id": addon_id}
                            )
                            
                            # Test POST /api/addons/install to reinstall
                            if addon_manifest_url:
                                install_data = {"manifestUrl": addon_manifest_url}
                                install_response = self.session.post(
                                    f"{self.base_url}/addons/install",
                                    json=install_data,
                                    timeout=30
                                )
                                
                                if install_response.status_code == 200:
                                    installed_addon = install_response.json()
                                    self.log_test(
                                        "Reinstall Addon",
                                        True,
                                        f"Successfully reinstalled addon '{addon_name}'",
                                        {"new_addon_id": installed_addon.get("id")}
                                    )
                                    return True
                                else:
                                    self.log_test(
                                        "Reinstall Addon",
                                        False,
                                        f"Failed to reinstall addon: {install_response.status_code}",
                                        install_response.text
                                    )
                                    return False
                            else:
                                self.log_test(
                                    "Reinstall Addon",
                                    False,
                                    "No manifest URL available for reinstallation",
                                    None
                                )
                                return False
                        else:
                            self.log_test(
                                "Delete Addon",
                                False,
                                f"Failed to delete addon: {delete_response.status_code}",
                                delete_response.text
                            )
                            return False
                    else:
                        self.log_test(
                            "Delete Addon",
                            False,
                            "No addon ID available for deletion test",
                            None
                        )
                        return False
                else:
                    self.log_test(
                        "Addon Deletion Test",
                        False,
                        "No addons available to test deletion",
                        None
                    )
                    return False
                    
            else:
                self.log_test(
                    "Get Addons List",
                    False,
                    f"Failed to get addons: {response.status_code}",
                    response.text
                )
                return False
                
        except Exception as e:
            self.log_test(
                "Addon Management",
                False,
                f"Request failed: {str(e)}",
                None
            )
            return False

def main():
    """Run all tests"""
    print("🎬 PrivastreamCinema Backend API Test Suite")
    print("=" * 60)
    print(f"Backend URL: {BASE_URL}")
    print(f"Test User: {TEST_USERNAME}")
    
    tester = PrivastreamTester()
    
    # Run tests in order
    auth_success = tester.test_login()
    discover_success = tester.test_discover_content_organization()
    addon_success = tester.test_addon_management()
    
    # Summary
    print("\n" + "="*60)
    print("📊 TEST SUMMARY")
    print("="*60)
    
    passed = sum(1 for r in tester.test_results if r["success"])
    total = len(tester.test_results)
    
    print(f"Total Tests: {total}")
    print(f"Passed: {passed}")
    print(f"Failed: {total - passed}")
    print(f"Success Rate: {(passed/total)*100:.1f}%")
    
    print("\nDetailed Results:")
    for result in tester.test_results:
        status = "✅" if result["success"] else "❌"
        print(f"{status} {result['test']}: {result['message']}")
    
    # Overall result
    overall_success = auth_success and discover_success and addon_success
    
    if overall_success:
        print("\n🎉 ALL CRITICAL TESTS PASSED!")
        return 0
    else:
        print("\n⚠️  SOME TESTS FAILED - See details above")
        return 1

if __name__ == "__main__":
    sys.exit(main())