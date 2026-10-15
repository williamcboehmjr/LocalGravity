import pytest
from src.agent.search_engine import FastSearchEngine, get_search_engine
from src.agent.loop import AgentSession
from src.protocol.events import PlatformType, ModelTier, ThinkingBudget


@pytest.mark.asyncio
async def test_search_engine_parallel():
    engine = FastSearchEngine(cache_ttl_seconds=60)
    queries = ["Python documentation", "FastAPI web framework"]

    results = await engine.search_parallel(queries, max_results_per_query=2)
    assert isinstance(results, list)
    assert len(results) > 0

    first = results[0]
    assert "title" in first
    assert "url" in first
    assert "snippet" in first
    assert "query" in first

    # Verify formatting helper
    md = engine.format_search_markdown(results)
    assert "Found" in md
    assert "[" in md and "](" in md


@pytest.mark.asyncio
async def test_search_cache():
    engine = FastSearchEngine(cache_ttl_seconds=60)
    query = "Python asyncio event loop"

    # First call fills cache
    res1 = await engine.search_single(query, max_results=2)
    # Second call should hit in-memory cache
    res2 = await engine.search_single(query, max_results=2)

    assert len(res1) == len(res2)
    assert query in engine._query_cache


def test_agent_tool_detection():
    # Dummy mock session to test _detect_tool_call regex parser
    class DummyAgent:
        _detect_tool_call = AgentSession._detect_tool_call

    dummy = DummyAgent()

    # Test multi-query parallel_web_search
    sample_text_1 = 'Let me search: parallel_web_search(queries=["FastAPI performance", "Pydantic v2 release"])'
    tool_1 = dummy._detect_tool_call(sample_text_1)
    assert tool_1 is not None
    assert tool_1["name"] == "parallel_web_search"
    assert tool_1["args"]["queries"] == ["FastAPI performance", "Pydantic v2 release"]

    # Test single query search_web
    sample_text_2 = 'search_web("RTX 5090 Blackwell specs")'
    tool_2 = dummy._detect_tool_call(sample_text_2)
    assert tool_2 is not None
    assert tool_2["name"] == "parallel_web_search"
    assert tool_2["args"]["queries"] == ["RTX 5090 Blackwell specs"]

    # Test multi-url fetch_web_pages
    sample_text_3 = 'fetch_web_pages(urls=["https://docs.python.org", "https://fastapi.tiangolo.com"])'
    tool_3 = dummy._detect_tool_call(sample_text_3)
    assert tool_3 is not None
    assert tool_3["name"] == "fetch_web_pages"
    assert tool_3["args"]["urls"] == ["https://docs.python.org", "https://fastapi.tiangolo.com"]
