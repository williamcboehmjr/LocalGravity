"""
High-performance asynchronous HTTP client for local Ollama API.
"""

import json
import logging
from typing import Any, AsyncGenerator, Dict, List, Optional
import httpx

logger = logging.getLogger("LocalGravity.OllamaClient")


class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434", timeout: float = 180.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.client = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout)

    async def close(self):
        await self.client.aclose()

    async def list_models(self) -> List[Dict[str, Any]]:
        resp = await self.client.get("/api/tags")
        resp.raise_for_status()
        data = resp.json()
        return data.get("models", [])

    async def show_model(self, model: str) -> Dict[str, Any]:
        resp = await self.client.post("/api/show", json={"name": model})
        resp.raise_for_status()
        return resp.json()

    async def generate(
        self,
        model: str,
        prompt: str = "",
        images: Optional[List[str]] = None,
        system: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
        keep_alive: Optional[Any] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        if images:
            payload["images"] = images
        if system:
            payload["system"] = system
        if options:
            payload["options"] = options
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive

        resp = await self.client.post("/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json()

    async def generate_stream(
        self,
        model: str,
        prompt: str = "",
        images: Optional[List[str]] = None,
        system: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
        keep_alive: Optional[Any] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": True,
        }
        if images:
            payload["images"] = images
        if system:
            payload["system"] = system
        if options:
            payload["options"] = options
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive

        async with self.client.stream("POST", "/api/generate", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        yield chunk
                    except json.JSONDecodeError:
                        continue

    async def chat_stream(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        options: Optional[Dict[str, Any]] = None,
        keep_alive: Optional[Any] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # Clean images in messages (Ollama requires raw base64 without data:image/...;base64, prefix)
        sanitized_messages = []
        for m in messages:
            m_copy = dict(m)
            if "images" in m_copy and isinstance(m_copy["images"], list):
                cleaned_imgs = []
                for img in m_copy["images"]:
                    if isinstance(img, str) and "," in img and img.startswith("data:"):
                        cleaned_imgs.append(img.split(",", 1)[1])
                    else:
                        cleaned_imgs.append(img)
                m_copy["images"] = cleaned_imgs
            sanitized_messages.append(m_copy)

        payload: Dict[str, Any] = {
            "model": model,
            "messages": sanitized_messages,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools
        if options:
            payload["options"] = options
        if keep_alive is not None:
            payload["keep_alive"] = keep_alive

        async with self.client.stream("POST", "/api/chat", json=payload) as response:
            if response.status_code >= 400:
                error_body = await response.aread()
                logger.error(f"Ollama API returned HTTP {response.status_code}: {error_body.decode('utf-8', errors='replace')}")
                response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        yield chunk
                    except json.JSONDecodeError:
                        continue
