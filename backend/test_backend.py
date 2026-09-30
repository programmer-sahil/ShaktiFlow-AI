"""Small no-model-download smoke test: python test_backend.py"""

from __future__ import annotations

import io
import unittest
from unittest.mock import patch

import cv2
import httpx
import numpy as np
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from app import app


class FakeBoxes:
    xyxy = [[10, 20, 50, 60]]
    conf = [0.92]
    cls = [0]


class FakeResult:
    boxes = FakeBoxes()


class FakeModel:
    def predict(self, **_kwargs):
        return [FakeResult()]


def jpeg_bytes() -> bytes:
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    if not ok:
        raise RuntimeError("Could not create test image")
    return encoded.tobytes()


class BackendSmokeTest(unittest.TestCase):
    def test_health_and_normalized_analysis(self):
        with patch("app.load_yolo_model", return_value=FakeModel()):
            with TestClient(app) as client:
                health_response = client.get("/health")
                self.assertEqual(health_response.status_code, 200)
                self.assertTrue(health_response.json()["model"]["loaded"])

                response = client.post(
                    "/analyze?normalized=true",
                    files={"file": ("crowd.jpg", io.BytesIO(jpeg_bytes()), "image/jpeg")},
                )
                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertEqual(payload["peopleCount"], 1)
                self.assertEqual(payload["riskLevel"], "LOW")
                self.assertTrue(payload["coordinatesNormalized"])
                self.assertEqual(payload["detections"][0]["x1"], 0.05)
                self.assertEqual(payload["detections"][0]["y1"], 0.2)

    def test_recommendation_uses_ollama_result(self):
        metrics = {
            "peopleCount": 24,
            "riskLevel": "HIGH",
            "riskScore": 78,
            "occupancyPercent": 82,
            "zoneName": "Gate A",
        }
        with patch("app.load_yolo_model", return_value=FakeModel()), patch(
            "app._ollama_recommendation",
            new=AsyncMock(return_value="Meter entry at Gate A. Reassess soon. Extra sentence."),
        ):
            with TestClient(app) as client:
                payload = client.post("/recommend", json=metrics).json()
        self.assertEqual(payload["model"], "gemma4:e2b")
        self.assertTrue(payload["localInference"])
        self.assertFalse(payload["fallback"])
        self.assertEqual(payload["recommendation"], "Meter entry at Gate A. Reassess soon.")

    def test_recommendation_falls_back_when_ollama_is_offline(self):
        metrics = {
            "peopleCount": 42,
            "riskLevel": "CRITICAL",
            "riskScore": 100,
            "occupancyPercent": 92,
            "zoneName": "Gate A",
        }
        with patch("app.load_yolo_model", return_value=FakeModel()), patch(
            "app._ollama_recommendation", new=AsyncMock(side_effect=httpx.ConnectError("offline"))
        ):
            with TestClient(app) as client:
                response = client.post("/recommend", json=metrics)
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model"], "rule-based-fallback")
        self.assertTrue(payload["fallback"])
        self.assertIn("Pause new entry into Gate A", payload["recommendation"])

    def test_recommendation_rejects_unsupported_staffing_claim(self):
        metrics = {
            "peopleCount": 42,
            "riskLevel": "CRITICAL",
            "riskScore": 100,
            "occupancyPercent": 92,
            "zoneName": "Gate A",
        }
        with patch("app.load_yolo_model", return_value=FakeModel()), patch(
            "app._ollama_recommendation",
            new=AsyncMock(return_value="Increase personnel presence at Gate A immediately."),
        ):
            with TestClient(app) as client:
                payload = client.post("/recommend", json=metrics).json()
        self.assertTrue(payload["fallback"])
        self.assertEqual(payload["model"], "rule-based-fallback")
        self.assertIn("Pause new entry into Gate A", payload["recommendation"])

    def test_critical_dispatch_posts_payload_and_reports_success(self):
        sent = {}

        class SuccessfulClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, _url, json):
                sent.update(json)
                return httpx.Response(200, request=httpx.Request("POST", "https://n8n.test"))

        payload = {
            "peopleCount": 43,
            "riskLevel": "CRITICAL",
            "riskScore": 94,
            "occupancyPercent": 91,
            "zoneName": "Gate A",
            "recommendation": "Pause new entry into Gate A and reassess occupancy.",
        }
        with patch("app.N8N_WEBHOOK_URL", "https://n8n.test/webhook/demo"), patch(
            "app.httpx.AsyncClient", SuccessfulClient
        ), patch("app.load_yolo_model", return_value=FakeModel()):
            with TestClient(app) as client:
                response = client.post("/automation/dispatch", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        status = response.json()
        self.assertEqual(status["status"], "dispatched")
        self.assertIsNotNone(status["dispatchedAt"])
        self.assertEqual(sent["event"], "crowd_risk_detected")
        self.assertEqual(sent["severity"], "CRITICAL")
        self.assertEqual(sent["zone"], "Gate A")
        self.assertEqual(sent["peopleCount"], 43)
        self.assertEqual(sent["occupancyPercent"], 91)
        self.assertEqual(sent["riskScore"], 94)
        self.assertEqual(sent["recommendation"], payload["recommendation"])

    def test_dispatch_failure_is_offline_and_noncritical_is_not_triggered(self):
        class FailedClient:
            def __init__(self, **_kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *_args):
                return None

            async def post(self, _url, json):
                return httpx.Response(503, request=httpx.Request("POST", _url))

        payload = {
            "peopleCount": 43,
            "riskLevel": "CRITICAL",
            "riskScore": 94,
            "occupancyPercent": 91,
            "zoneName": "Gate A",
            "recommendation": "Pause new entry into Gate A and reassess occupancy.",
        }
        with patch("app.N8N_WEBHOOK_URL", "https://n8n.test/webhook/demo"), patch(
            "app.httpx.AsyncClient", FailedClient
        ), patch("app.load_yolo_model", return_value=FakeModel()):
            with TestClient(app) as client:
                failed = client.post("/automation/dispatch", json=payload)
                payload["riskLevel"] = "HIGH"
                idle = client.post("/automation/dispatch", json=payload)
        self.assertEqual(failed.status_code, 200)
        self.assertEqual(failed.json()["status"], "offline")
        self.assertEqual(idle.status_code, 200)
        self.assertEqual(idle.json()["status"], "not_triggered")

    def test_automation_status_does_not_claim_connectivity(self):
        with patch("app.N8N_WEBHOOK_URL", ""), patch("app.load_yolo_model", return_value=FakeModel()):
            with TestClient(app) as client:
                offline = client.get("/automation/status")
        with patch("app.N8N_WEBHOOK_URL", "https://n8n.test/webhook/configured"), patch(
            "app.load_yolo_model", return_value=FakeModel()
        ):
            with TestClient(app) as client:
                standby = client.get("/automation/status")
        self.assertEqual(offline.json()["status"], "offline")
        self.assertEqual(standby.json()["status"], "standby")


if __name__ == "__main__":
    unittest.main()
