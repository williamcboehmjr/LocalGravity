import asyncio
import time
from ddgs import DDGS
import trafilatura
import httpx

async def search_single(query: str, max_results: int = 3):
    t0 = time.time()
    def _run():
        try:
            with DDGS() as ddgs:
                return list(ddgs.text(query, max_results=max_results))
        except Exception as e:
            return []
    results = await asyncio.to_thread(_run)
    return query, results, time.time() - t0

async def fetch_page(url: str, client: httpx.AsyncClient):
    t0 = time.time()
    try:
        resp = await client.get(url, timeout=4.0, follow_redirects=True)
        if resp.status_code == 200:
            md = trafilatura.extract(resp.text, output_format="markdown") or ""
            return url, md[:500], time.time() - t0
    except Exception as e:
        return url, f"Error: {e}", time.time() - t0
    return url, "", time.time() - t0

async def main():
    queries = [
        "Python 3.14 features",
        "FastAPI latest performance",
        "RTX 5090 Blackwell specs",
        "Qwen 2.5 vs 3.5 AI benchmarks",
        "Vite 6 release updates"
    ]
    
    print(f"--- Fanning out {len(queries)} parallel web searches ---")
    t0 = time.time()
    search_tasks = [search_single(q) for q in queries]
    search_results = await asyncio.gather(*search_tasks)
    search_time = time.time() - t0
    
    all_urls = []
    total_found = 0
    for q, res, elapsed in search_results:
        print(f"  [OK] [{elapsed:.2f}s] '{q}' -> {len(res)} results")
        total_found += len(res)
        for r in res:
            if "href" in r and r["href"].startswith("http"):
                all_urls.append(r["href"])
                
    print(f"\nTotal Search Fan-out Time: {search_time:.2f}s for {total_found} search items across {len(queries)} queries.")
    
    # Deduplicate URLs and take top 6 to fetch in parallel
    unique_urls = list(dict.fromkeys(all_urls))[:6]
    print(f"\n--- Concurrently fetching & extracting {len(unique_urls)} web pages ---")
    t_fetch = time.time()
    async with httpx.AsyncClient(headers={"User-Agent": "Mozilla/5.0"}) as client:
        fetch_tasks = [fetch_page(u, client) for u in unique_urls]
        extracted = await asyncio.gather(*fetch_tasks)
    fetch_time = time.time() - t_fetch
    
    for u, md, el in extracted:
        chars = len(md) if md and not md.startswith("Error") else 0
        print(f"  [OK] [{el:.2f}s] {u[:50]}... -> {chars} chars markdown")
        
    print(f"\nTotal Page Extraction Time: {fetch_time:.2f}s for {len(unique_urls)} pages.")
    print(f"GRAND TOTAL PIPELINE: {search_time + fetch_time:.2f}s!")

if __name__ == "__main__":
    asyncio.run(main())
