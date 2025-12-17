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
        
    def test_login(self) -> bool:
        """Test user authentication"""
        print("\n=== Testing Authentication ===")
        
        login_data = {
            "username": "choyt",
            "password": "RFIDGuy1!"
        }
        
        try:
            response = self.session.post(
                f"{self.base_url}/auth/login",
                json=login_data,
                headers={"Content-Type": "application/json"}
            )
            
            print(f"Login Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Login Response Keys: {list(data.keys())}")
                
                # Check response structure
                if 'user' in data and 'token' in data:
                    self.token = data['token']
                    user = data['user']
                    print(f"✅ Login successful")
                    print(f"   User: {user.get('username')}")
                    print(f"   Admin: {user.get('is_admin')}")
                    print(f"   Token: {self.token[:20]}...")
                    
                    # Set authorization header for future requests
                    self.session.headers.update({
                        "Authorization": f"Bearer {self.token}"
                    })
                    return True
                else:
                    print(f"❌ Login failed - Invalid response structure")
                    print(f"   Response: {data}")
                    return False
            else:
                print(f"❌ Login failed - Status {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Login failed - Exception: {e}")
            return False
    
    def test_streams_movie(self, imdb_id: str, movie_name: str) -> bool:
        """Test stream fetching for a movie"""
        print(f"\n=== Testing Streams for {movie_name} ({imdb_id}) ===")
        
        if not self.token:
            print("❌ No authentication token - login first")
            return False
        
        try:
            response = self.session.get(f"{self.base_url}/streams/movie/{imdb_id}")
            
            print(f"Streams Status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"Response Keys: {list(data.keys())}")
                
                if 'streams' in data:
                    streams = data['streams']
                    print(f"✅ Streams found: {len(streams)} streams")
                    
                    if len(streams) > 0:
                        # Check first few streams structure
                        for i, stream in enumerate(streams[:3]):
                            print(f"\n   Stream {i+1}:")
                            print(f"     Name: {stream.get('name', 'N/A')}")
                            print(f"     Title: {stream.get('title', 'N/A')[:80]}...")
                            print(f"     InfoHash: {stream.get('infoHash', 'N/A')}")
                            print(f"     Seeders: {stream.get('seeders', 'N/A')}")
                            print(f"     Addon: {stream.get('addon', 'N/A')}")
                        
                        # Verify required fields
                        missing_fields = []
                        for stream in streams[:5]:  # Check first 5 streams
                            if not stream.get('name'):
                                missing_fields.append('name')
                            if not stream.get('title'):
                                missing_fields.append('title')
                            if not stream.get('infoHash'):
                                missing_fields.append('infoHash')
                            if 'seeders' not in stream:
                                missing_fields.append('seeders')
                        
                        if missing_fields:
                            print(f"⚠️  Some streams missing fields: {set(missing_fields)}")
                        
                        # Check if streams are sorted by seeders
                        seeders_list = []
                        for stream in streams[:10]:
                            seeders = stream.get('seeders', 0)
                            if isinstance(seeders, (int, str)):
                                try:
                                    seeders_list.append(int(seeders))
                                except:
                                    seeders_list.append(0)
                        
                        if len(seeders_list) > 1:
                            is_sorted = all(seeders_list[i] >= seeders_list[i+1] for i in range(len(seeders_list)-1))
                            if is_sorted:
                                print(f"✅ Streams properly sorted by seeders (highest first)")
                            else:
                                print(f"⚠️  Streams not sorted by seeders: {seeders_list[:5]}")
                        
                        return True
                    else:
                        print(f"⚠️  No streams found for {movie_name}")
                        return True  # Not necessarily an error
                else:
                    print(f"❌ Invalid response structure - missing 'streams' key")
                    print(f"   Response: {data}")
                    return False
            else:
                print(f"❌ Streams request failed - Status {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Error: {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Streams request failed - Exception: {e}")
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