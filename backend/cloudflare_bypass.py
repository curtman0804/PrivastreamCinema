"""
Cloudflare bypass service using Playwright and cloudscraper fallbacks
"""
import asyncio
import logging
import json
from typing import Optional, Dict, Any
from playwright.async_api import async_playwright, Browser, BrowserContext

logger = logging.getLogger(__name__)

class CloudflareBypass:
    """Service to bypass Cloudflare protection using Playwright"""

    def __init__(self):
        self.playwright = None
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self._lock = asyncio.Lock()
        self._started = False

    async def start(self):
        """Start the browser"""
        if self._started:
            return
            
        async with self._lock:
            if self._started:
                return
                
            try:
                logger.info("Starting Playwright browser for Cloudflare bypass...")
                self.playwright = await async_playwright().start()
                self.browser = await self.playwright.chromium.launch(
                    headless=True,
                    args=[
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-web-security',
                        '--disable-features=IsolateOrigins,site-per-process',
                        '--disable-setuid-sandbox'
                    ]
                )
                self.context = await self.browser.new_context(
                    viewport={'width': 1920, 'height': 1080},
                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                )
                self._started = True
                logger.info("Playwright browser started successfully")
            except Exception as e:
                logger.error(f"Failed to start Playwright: {e}")
                raise

    async def stop(self):
        """Stop the browser"""
        if self.browser:
            try:
                await self.browser.close()
            except:
                pass
        if self.playwright:
            try:
                await self.playwright.stop()
            except:
                pass
        self.browser = None
        self.context = None
        self.playwright = None
        self._started = False

    async def fetch_json(self, url: str, timeout: int = 60000) -> Dict[str, Any]:
        """
        Fetch JSON from URL, bypassing Cloudflare if needed

        Args:
            url: URL to fetch
            timeout: Timeout in milliseconds

        Returns:
            Dict containing the JSON response
        """
        await self.start()

        page = None
        try:
            page = await self.context.new_page()

            # Add stealth scripts to mask automation
            await page.add_init_script("""
                // Remove webdriver property
                Object.defineProperty(navigator, 'webdriver', {get: () => undefined});

                // Mock plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });

                // Mock languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });

                // Add chrome object
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {},
                    csi: function() {}
                };

                // Mask headless
                Object.defineProperty(navigator, 'headless', {get: () => false});
            """)

            logger.info(f"Fetching {url} with Playwright...")

            # Navigate to the page
            response = await page.goto(url, wait_until='domcontentloaded', timeout=timeout)

            # Initial content check
            content = await page.content()
            
            # Check if we hit Cloudflare challenge
            if 'cloudflare' in content.lower() or 'just a moment' in content.lower():
                logger.info("Cloudflare challenge detected, waiting...")
                
                # Wait for challenge to resolve (up to 30 seconds)
                for wait in [5, 10, 15]:
                    await asyncio.sleep(wait)
                    content = await page.content()
                    if 'cloudflare' not in content.lower() and 'just a moment' not in content.lower():
                        logger.info(f"Cloudflare challenge solved after {wait}s")
                        break
                else:
                    logger.warning("Cloudflare challenge may not be fully resolved")

            # Try to get JSON content
            try:
                # Method 1: Look for <pre> tag (common for JSON API responses)
                json_text = await page.evaluate('() => document.querySelector("pre")?.textContent || document.body.textContent')
                result = json.loads(json_text)
                logger.info(f"Successfully fetched JSON from {url}")
                return result
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON from {url}: {e}")
                # Log first 500 chars of content for debugging
                text_content = await page.evaluate('() => document.body.textContent')
                logger.error(f"Page content: {text_content[:500]}")
                raise

        except Exception as e:
            logger.error(f"Playwright fetch error for {url}: {str(e)}")
            raise
        finally:
            if page:
                try:
                    await page.close()
                except:
                    pass


# Global instance
cloudflare_bypass = CloudflareBypass()


async def fetch_with_cloudflare_bypass(url: str) -> Optional[Dict[str, Any]]:
    """
    Helper function to fetch JSON URL with Cloudflare bypass
    
    Args:
        url: URL to fetch
        
    Returns:
        JSON dict or None if failed
    """
    try:
        return await cloudflare_bypass.fetch_json(url)
    except Exception as e:
        logger.error(f"Cloudflare bypass failed for {url}: {e}")
        return None
