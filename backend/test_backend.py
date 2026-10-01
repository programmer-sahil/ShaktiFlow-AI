"""Small no-model-download smoke test: python test_backend.py"""

from __future__ import annotations

import io
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import httpx
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

from app import app, _merge_person_boxes, _predict_window, _risk_level, _should_use_tiling


class FakeBoxes:
    xyxy = [[10, 20, 50, 60]]
    conf = [0.92]
    cls = [0]


class FakeResult:
    boxes = FakeBoxes()


class FakeModel:
    def __init__(self):
        self.calls = []

    def predict(self, **_kwargs):
        self.calls.append(_kwargs)
        return [FakeResult()]


class EmptyModel(FakeModel):
    def predict(self, **kwargs):
        self.calls.append(kwargs)
        class EmptyBoxes:
            xyxy = []
            conf = []
            cls = []
        class EmptyResult:
            boxes = EmptyBoxes()
        return [EmptyResult()]


def jpeg_bytes() -> bytes:
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    if not ok:
        raise RuntimeError("Could not create test image")
    return encoded.tobytes()


class BackendSmokeTest(unittest.TestCase):
    def test_duplicate_suppression_and_distinct_neighbors(self):
        a = (10, 10, 110, 210, 0.9)
        cases = [
            ([a, a], 1),  # exact
            ([a, (13, 13, 113, 213, 0.8)], 1),  # high IoU
            ([a, (30, 35, 90, 185, 0.8)], 1),  # centered nested box
            ([a, (85, 10, 185, 210, 0.8)], 2),  # adjacent people
            ([a, (12, 9, 112, 209, 0.8)], 1),  # overlapping tiles
            ([a, (11, 12, 111, 212, 0.8)], 1),  # whole image plus tile
        ]
        for candidates, expected in cases:
            with self.subTest(candidates=candidates):
                self.assertEqual(len(_merge_person_boxes(candidates, 300, 300)), expected)

    def test_tiled_fragments_do_not_replace_complete_person(self):
        complete = (51, 395, 247, 904, 0.8159)
        cropped = (56, 400, 200, 755, 0.8948)
        fragments = [(170, 491, 199, 754, 0.7005), (170, 516, 246, 901, 0.5588)]
        final = _merge_person_boxes([complete, cropped, *fragments], 810, 1080)
        self.assertEqual(len(final), 1)
        self.assertEqual(final[0], complete)

    def test_group_skips_tiling_and_dense_scene_uses_it(self):
        group = [(i * 180 + 10, 100, i * 180 + 140, 600, 0.85) for i in range(5)]
        self.assertFalse(_should_use_tiling(1000, 700, group, False))
        distant = [(i * 60, 100, i * 60 + 25, 175, 0.7) for i in range(15)]
        self.assertTrue(_should_use_tiling(1400, 700, distant, False))

    def test_five_people_with_24_raw_boxes_return_five(self):
        class DuplicateModel(FakeModel):
            def predict(self, **kwargs):
                self.calls.append(kwargs)
                boxes = []
                for person in range(5):
                    left = 50 + person * 260
                    boxes.extend([[left + offset, 80 + offset, left + 160 + offset, 720 + offset]
                                  for offset in range(4)])
                    if person < 4:
                        boxes.append([left + 25, 160, left + 135, 650])
                result_boxes = type("Boxes", (), {"xyxy": boxes, "conf": [0.9] * 20 + [0.75] * 4,
                                                     "cls": [0] * 24})()
                return [type("Result", (), {"boxes": result_boxes})()]

        image = np.zeros((900, 1400, 3), dtype=np.uint8)
        ok, encoded = cv2.imencode(".jpg", image)
        self.assertTrue(ok)
        model = DuplicateModel()
        with patch("app.load_yolo_model", return_value=model):
            with TestClient(app) as client:
                response = client.post("/analyze", files={"file": ("five.jpg", io.BytesIO(encoded.tobytes()), "image/jpeg")})
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["peopleCount"], 5)
        self.assertEqual(len(payload["detections"]), 5)
        self.assertEqual(payload["occupancyPercent"], 10)
        self.assertEqual(payload["crowdPresence"], "LIGHT")
        self.assertEqual(len(model.calls), 1)

    def test_dense_scene_keeps_distinct_people_and_runs_tiles(self):
        class DenseModel(FakeModel):
            def predict(self, **kwargs):
                self.calls.append(kwargs)
                if len(self.calls) == 1:
                    boxes = [[20 + i * 90, 100, 60 + i * 90, 270] for i in range(15)]
                else:
                    boxes = []
                result_boxes = type("Boxes", (), {"xyxy": boxes, "conf": [0.8] * len(boxes),
                                                     "cls": [0] * len(boxes)})()
                return [type("Result", (), {"boxes": result_boxes})()]

        model = DenseModel()
        from app import _infer_person_boxes
        final = _infer_person_boxes(model, np.zeros((700, 1400, 3), dtype=np.uint8), False)
        self.assertGreater(len(model.calls), 1)
        self.assertEqual(len(final), 15)

    def test_tile_coordinates_are_global_and_merged(self):
        class TileModel(FakeModel):
            def predict(self, **kwargs):
                self.calls.append(kwargs)
                boxes = type("Boxes", (), {"xyxy": [[50, 30, 150, 330]], "conf": [0.9], "cls": [0]})()
                return [type("Result", (), {"boxes": boxes})()]

        image = np.zeros((600, 900, 3), dtype=np.uint8)
        tile_box = _predict_window(TileModel(), image, 200, 100, 600, 500)[0]
        self.assertEqual(tile_box[:4], (250, 130, 350, 430))
        whole_box = (251, 132, 351, 432, 0.85)
        self.assertEqual(len(_merge_person_boxes([whole_box, tile_box], 900, 600)), 1)

    def test_capacity_occupancy_risk_threshold_boundaries(self):
        self.assertEqual(_risk_level(29), "LOW")
        self.assertEqual(_risk_level(30), "MODERATE")
        self.assertEqual(_risk_level(59), "MODERATE")
        self.assertEqual(_risk_level(60), "HIGH")
        self.assertEqual(_risk_level(84), "HIGH")
        self.assertEqual(_risk_level(85), "CRITICAL")

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
                self.assertEqual(payload["peopleCount"], len(payload["detections"]))
                self.assertEqual(payload["riskLevel"], "LOW")
                self.assertTrue(payload["coordinatesNormalized"])
                self.assertEqual(payload["detections"][0]["x1"], 0.05)
                self.assertEqual(payload["detections"][0]["y1"], 0.2)
                self.assertEqual(payload["configuredCapacity"], 50)
                self.assertEqual(payload["crowdPresence"], "LIGHT")

    def test_no_people_returns_empty_detection_list(self):
        with patch("app.load_yolo_model", return_value=EmptyModel()):
            with TestClient(app) as client:
                response = client.post(
                    "/analyze",
                    files={"file": ("empty.jpg", io.BytesIO(jpeg_bytes()), "image/jpeg")},
                )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["peopleCount"], 0)
        self.assertEqual(response.json()["crowdPresence"], "NONE")
        self.assertEqual(response.json()["detections"], [])

    def test_dense_option_runs_overlapping_tiles(self):
        model = FakeModel()
        image = np.zeros((700, 900, 3), dtype=np.uint8)
        ok, encoded = cv2.imencode(".jpg", image)
        self.assertTrue(ok)
        with patch("app.load_yolo_model", return_value=model):
            with TestClient(app) as client:
                response = client.post(
                    "/analyze?normalized=true&dense=true",
                    files={"file": ("dense.jpg", io.BytesIO(encoded.tobytes()), "image/jpeg")},
                )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreater(len(model.calls), 1)
        self.assertTrue(response.json()["coordinatesNormalized"])

    def test_24_megapixel_image_is_resized_and_coordinates_stay_normalized(self):
        large = Image.new("RGB", (6000, 4000), (40, 42, 38))
        encoded = io.BytesIO()
        large.save(encoded, format="JPEG", quality=82)
        model = FakeModel()
        with patch("app.load_yolo_model", return_value=model):
            with TestClient(app) as client:
                response = client.post(
                    "/analyze?normalized=true",
                    files={"file": ("phone.jpg", io.BytesIO(encoded.getvalue()), "image/jpeg")},
                )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertGreater(len(model.calls), 1)
        self.assertTrue(all(max(call["source"].shape[:2]) <= 2560 for call in model.calls))
        self.assertTrue(response.json()["coordinatesNormalized"])
        self.assertAlmostEqual(response.json()["detections"][0]["x1"], 10 / 2560, places=6)

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
                before = client.get("/automation/status").json()
                response = client.post("/automation/dispatch", json=payload)
                after = client.get("/automation/status").json()
        self.assertEqual(response.status_code, 200, response.text)
        status = response.json()
        self.assertEqual(status["status"], "dispatched")
        self.assertIsNotNone(status["dispatchedAt"])
        self.assertEqual(before["status"], "READY")
        self.assertEqual(after["status"], "CONNECTED")
        self.assertEqual(after["lastDispatchStatus"], "success")
        self.assertEqual(after["lastDispatchAt"], status["dispatchedAt"])
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
                error = client.get("/automation/status").json()
                payload["riskLevel"] = "HIGH"
                idle = client.post("/automation/dispatch", json=payload)
        self.assertEqual(failed.status_code, 200)
        self.assertEqual(failed.json()["status"], "offline")
        self.assertEqual(error["status"], "ERROR")
        self.assertEqual(error["lastDispatchStatus"], "failed")
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
                ready = client.get("/automation/status")
        self.assertEqual(offline.json()["status"], "OFFLINE")
        self.assertFalse(offline.json()["configured"])
        self.assertEqual(ready.json()["status"], "READY")
        self.assertTrue(ready.json()["webhookConfigured"])
        self.assertIsNone(ready.json()["lastDispatchStatus"])

    def test_dotenv_is_loaded_from_backend_in_either_working_directory(self):
        backend = Path(__file__).resolve().parent
        env = dict(os.environ)
        env.pop("N8N_WEBHOOK_URL", None)
        env["PYTHONPATH"] = str(backend)
        command = [str(backend / ".venv" / "bin" / "python"), "-c",
                   "import settings; print(bool(settings.N8N_WEBHOOK_URL))"]
        for cwd in (backend, backend.parent):
            with self.subTest(cwd=cwd):
                output = subprocess.check_output(command, cwd=cwd, env=env, text=True).strip()
                self.assertEqual(output, "True")


if __name__ == "__main__":
    unittest.main()
