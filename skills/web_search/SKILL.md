---
name: web_search
description: Search the live internet in parallel across multiple query angles and fetch web page contents for real-time grounding.
---

# Web Search & Grounding Skill

Use this skill whenever you need real-time data, current weather/temperature, news, sports scores, or up-to-date documentation beyond your training data.

## Available Functions

### `parallel_web_search(queries: list[str])`
Fans out multiple search queries in parallel across DuckDuckGo without API keys.
Returns structured snippets, titles, and links in ~1.5 seconds.

Example:
```python
parallel_web_search(queries=["current temperature 90024 Los Angeles", "weather 90024 now"])
```

### `fetch_web_pages(urls: list[str])`
Concurrently fetches and cleans up to 5 web pages into dense Markdown for in-depth research.

Example:
```python
fetch_web_pages(urls=["https://weather.com/weather/today/l/90024"])
```
