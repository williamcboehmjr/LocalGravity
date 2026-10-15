"""
Integration tests for FastAPI Brain endpoints.
"""

import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert "active_tier" in data
        assert "active_model" in data


@pytest.mark.asyncio
async def test_telemetry_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/telemetry")
        assert resp.status_code == 200
        data = resp.json()
        assert "vram_used_gb" in data
        assert "host_ram_used_gb" in data
        assert "cpu_utilization_percent" in data


@pytest.mark.asyncio
async def test_remote_info_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/remote/info")
        assert resp.status_code == 200
        data = resp.json()
        assert "primary_ip" in data
        assert "remote_url" in data
        assert data["port"] == 3390


@pytest.mark.asyncio
async def test_models_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/models")
        assert resp.status_code == 200
        data = resp.json()
        assert "configured_tiers" in data
        assert "low" in data["configured_tiers"]

