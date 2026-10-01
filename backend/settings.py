"""Prototype operating settings. Calibrate these per physical zone before deployment."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Resolve beside this module so `uvicorn app:app --reload` works from either cwd.
# Explicit process environment values take precedence over the local file.
ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(ENV_PATH, override=False)

# Prototype occupancy thresholds. These are not certified safety limits.
RISK_THRESHOLDS = {
    "MODERATE_MIN_PERCENT": 30,
    "HIGH_MIN_PERCENT": 60,
    "CRITICAL_MIN_PERCENT": 85,
}
CROWD_PRESENCE_THRESHOLDS = {
    "MODERATE_MIN_VISIBLE": 10,
    "MODERATE_MIN_CAPACITY_PERCENT": 30,
    "MODERATE_MIN_BOX_COUNT": 5,
    "MODERATE_MIN_FRAME_BOX_PERCENT": 12,
    "DENSE_MIN_VISIBLE": 25,
    "DENSE_MIN_CAPACITY_PERCENT": 50,
    "DENSE_MIN_BOX_COUNT": 10,
    "DENSE_MIN_FRAME_BOX_PERCENT": 25,
}

MODEL_NAME = os.getenv("SHAKTIFLOW_MODEL", "yolov8n.pt")
MODEL_CONFIDENCE = float(os.getenv("SHAKTIFLOW_MODEL_CONFIDENCE", "0.25"))
MODEL_IOU = float(os.getenv("SHAKTIFLOW_MODEL_IOU", "0.45"))
GLOBAL_NMS_IOU = float(os.getenv("SHAKTIFLOW_GLOBAL_NMS_IOU", "0.45"))
CONTAINMENT_THRESHOLD = float(os.getenv("SHAKTIFLOW_CONTAINMENT_THRESHOLD", "0.80"))
MIN_PERSON_AREA_FRACTION = float(os.getenv("SHAKTIFLOW_MIN_PERSON_AREA_FRACTION", "0.00001"))
DETECTION_DEBUG = os.getenv("DETECTION_DEBUG", "false").lower() in {"1", "true", "yes"}
MODEL_IMAGE_SIZE = int(os.getenv("SHAKTIFLOW_MODEL_IMAGE_SIZE", "960"))
TILE_IMAGE_SIZE = int(os.getenv("SHAKTIFLOW_TILE_IMAGE_SIZE", "1280"))
TILE_OVERLAP = float(os.getenv("SHAKTIFLOW_TILE_OVERLAP", "0.2"))
SLICED_IMAGE_THRESHOLD = int(os.getenv("SHAKTIFLOW_SLICED_IMAGE_THRESHOLD", "1280"))
MAX_ANALYSIS_LONG_SIDE = int(os.getenv("SHAKTIFLOW_MAX_ANALYSIS_LONG_SIDE", "2560"))
OLLAMA_BASE_URL = os.getenv("SHAKTIFLOW_OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("SHAKTIFLOW_OLLAMA_MODEL", "gemma4:e2b")
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("SHAKTIFLOW_OLLAMA_TIMEOUT_SECONDS", "45"))
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "").strip()
N8N_TIMEOUT_SECONDS = float(os.getenv("N8N_TIMEOUT_SECONDS", "3"))
MAX_UPLOAD_BYTES = int(os.getenv("SHAKTIFLOW_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("SHAKTIFLOW_MAX_IMAGE_PIXELS", "80000000"))

# A demo denominator for a count-based occupancy proxy, not real capacity.
PROTOTYPE_ZONE_CAPACITY = int(os.getenv("SHAKTIFLOW_PROTOTYPE_ZONE_CAPACITY", "50"))

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "SHAKTIFLOW_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if origin.strip()
]
