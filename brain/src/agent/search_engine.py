"""
High-Speed Parallel Internet Search & Grounding Engine for LocalGravity.
Provides non-API, zero-cost, asynchronous multi-query fan-out and concurrent page extraction.
"""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional
import httpx
from ddgs import DDGS
import trafilatura

logger = logging.getLogger("LocalGravity.SearchEngine")


class FastSearchEngine:
    """
    Asynchronous web search and webpage content extractor.
    Executes multiple search angles and URL fetches in parallel with in-memory caching.
    """

    def __init__(self, cache_ttl_seconds: int = 900):
        self.cache_ttl = cache_ttl_seconds
        self._query_cache: Dict[str, Dict[str, Any]] = {}
        self._url_cache: Dict[str, Dict[str, Any]] = {}
        self._search_semaphore = asyncio.Semaphore(6)
        self._fetch_semaphore = asyncio.Semaphore(8)

        self._headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/133.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }

    async def search_single(self, query: str, max_results: int = 4) -> List[Dict[str, str]]:
        """Executes a single search query with caching and semaphore protection."""
        clean_q = query.strip()
        now = time.time()

        # Check in-memory cache
        if clean_q in self._query_cache:
            entry = self._query_cache[clean_q]
            if now - entry["timestamp"] < self.cache_ttl:
                logger.debug(f"Cache hit for search query: '{clean_q}'")
                return entry["results"]

        async with self._search_semaphore:
            def _execute_ddgs():
                try:
                    with DDGS() as ddgs:
                        return list(ddgs.text(clean_q, max_results=max_results))
                except Exception as e:
                    logger.warning(f"Search query '{clean_q}' encountered: {e}")
                    return []

            results = await asyncio.to_thread(_execute_ddgs)

        formatted_results = []
        for r in results:
            if isinstance(r, dict) and "href" in r:
                formatted_results.append({
                    "title": r.get("title", "No Title"),
                    "href": r.get("href", ""),
                    "body": r.get("body", "").strip(),
                })

        # Cache results
        self._query_cache[clean_q] = {
            "results": formatted_results,
            "timestamp": now,
        }
        return formatted_results

    async def search_parallel(
        self, queries: List[str], max_results_per_query: int = 4
    ) -> List[Dict[str, Any]]:
        """
        Fans out multiple search queries concurrently across the web.
        Deduplicates results by URL while preserving the most relevant snippets.
        """
        if not queries:
            return []

        # Remove duplicate queries
        unique_queries = list(dict.fromkeys(q.strip() for q in queries if q.strip()))
        t0 = time.time()
        logger.info(f"Fanning out {len(unique_queries)} concurrent web searches: {unique_queries}")

        tasks = [self.search_single(q, max_results=max_results_per_query) for q in unique_queries]
        batch_results = await asyncio.gather(*tasks)

        elapsed = time.time() - t0
        logger.info(f"Parallel search fan-out completed in {elapsed:.2f}s")

        seen_urls = set()
        deduped_results = []

        for q, res_list in zip(unique_queries, batch_results):
            for item in res_list:
                url = item.get("href", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    deduped_results.append({
                        "query": q,
                        "title": item.get("title", ""),
                        "url": url,
                        "snippet": item.get("body", ""),
                    })

        return deduped_results

    async def fetch_page(
        self, url: str, client: httpx.AsyncClient, max_chars: int = 4000
    ) -> Dict[str, str]:
        """Fetches and cleans a single web page into Markdown."""
        clean_url = url.strip()
        now = time.time()

        if clean_url in self._url_cache:
            entry = self._url_cache[clean_url]
            if now - entry["timestamp"] < self.cache_ttl:
                return entry["data"]

        async with self._fetch_semaphore:
            try:
                resp = await client.get(clean_url, timeout=5.0, follow_redirects=True)
                if resp.status_code == 200:
                    text_content = trafilatura.extract(
                        resp.text,
                        output_format="markdown",
                        include_tables=True,
                        include_links=True,
                        favor_precision=True,
                    ) or ""
                    cleaned = text_content.strip()[:max_chars]
                    result = {
                        "url": clean_url,
                        "status": "success",
                        "content": cleaned if cleaned else "No text could be extracted from page.",
                    }
                else:
                    result = {
                        "url": clean_url,
                        "status": "error",
                        "content": f"HTTP {resp.status_code} {resp.reason_phrase}",
                    }
            except Exception as e:
                result = {
                    "url": clean_url,
                    "status": "error",
                    "content": f"Failed to fetch: {str(e)}",
                }

        self._url_cache[clean_url] = {
            "data": result,
            "timestamp": now,
        }
        return result

    async def fetch_pages_parallel(
        self, urls: List[str], max_chars_per_page: int = 4000
    ) -> List[Dict[str, str]]:
        """Concurrently fetches multiple web pages and converts them to Markdown."""
        unique_urls = list(dict.fromkeys(u.strip() for u in urls if u.strip().startswith("http")))
        if not unique_urls:
            return []

        t0 = time.time()
        logger.info(f"Concurrently fetching {len(unique_urls)} web pages...")

        async with httpx.AsyncClient(headers=self._headers, verify=False) as client:
            tasks = [self.fetch_page(u, client, max_chars=max_chars_per_page) for u in unique_urls]
            results = await asyncio.gather(*tasks)

        elapsed = time.time() - t0
        logger.info(f"Parallel page extraction completed in {elapsed:.2f}s for {len(unique_urls)} pages")
        return results

    @staticmethod
    def format_search_markdown(results: List[Dict[str, Any]]) -> str:
        """Formats search results as a dense, citation-friendly markdown block."""
        if not results:
            return "No web search results found."

        lines = [f"Found {len(results)} relevant web sources:"]
        for i, item in enumerate(results, 1):
            title = item.get("title", "Untitled")
            url = item.get("url", "")
            snippet = item.get("snippet", "")
            q = item.get("query", "")
            lines.append(f"[{i}] [{title}]({url})\nQuery: \"{q}\"\nSummary: {snippet}\n")

        return "\n".join(lines).strip()

    @staticmethod
    def format_pages_markdown(results: List[Dict[str, str]]) -> str:
        """Formats extracted web pages into structured markdown documentation."""
        if not results:
            return "No web pages extracted."

        blocks = []
        for item in results:
            url = item.get("url", "")
            status = item.get("status", "")
            content = item.get("content", "")
            blocks.append(f"--- Document Source: {url} ({status}) ---\n{content}")

        return "\n\n".join(blocks).strip()


_global_engine: Optional[FastSearchEngine] = None


def get_search_engine() -> FastSearchEngine:
    global _global_engine
    if _global_engine is None:
        _global_engine = FastSearchEngine()
    return _global_engine
