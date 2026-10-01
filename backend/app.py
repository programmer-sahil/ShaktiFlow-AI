"""Privacy-preserving, image-first crowd counting API for the ShaktiFlow MVP."""

from __future__ import annotations

import logging
import math
import platform
import re
import statistics
import time
from datetime import datetime
from io import BytesIO
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Literal, Optional

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from settings import (
    CORS_ORIGINS,
    CROWD_PRESENCE_THRESHOLDS,
    MAX_IMAGE_PIXELS,
    MAX_UPLOAD_BYTES,
    MODEL_CONFIDENCE,
    MODEL_IOU,
    GLOBAL_NMS_IOU,
    CONTAINMENT_THRESHOLD,
    MIN_PERSON_AREA_FRACTION,
    DETECTION_DEBUG,
    MODEL_IMAGE_SIZE,
    MODEL_NAME,
    MAX_ANALYSIS_LONG_SIDE,
    SLICED_IMAGE_THRESHOLD,
    TILE_IMAGE_SIZE,
    TILE_OVERLAP,
    N8N_TIMEOUT_SECONDS,
    N8N_WEBHOOK_URL,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_SECONDS,
    PROTOTYPE_ZONE_CAPACITY,
    RISK_THRESHOLDS,
)

logger = logging.getLogger("shaktiflow")
API_VERSION = "1.0.0"
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png"}
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
UNSUPPORTED_RECOMMENDATION_RE = re.compile(
    r"\b(staff|personnel|police|ambulance|emergency|evacuat\w*|injur\w*|fire|"
    r"stampede|panic|collapse|medical|hazard|redirect\w*|divert\w*|security team)\b",
    re.IGNORECASE,
)


class Detection(BaseModel):
    x1: float = Field(description="Pixel or normalized horizontal coordinate")
    y1: float = Field(description="Pixel or normalized vertical coordinate")
    x2: float = Field(description="Pixel or normalized horizontal coordinate")
    y2: float = Field(description="Pixel or normalized vertical coordinate")
    confidence: float = Field(ge=0, le=1)


class AnalysisResponse(BaseModel):
    peopleCount: int
    riskLevel: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    riskScore: int = Field(ge=0, le=100)
    occupancyPercent: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    processingMs: int = Field(ge=0)
    coordinatesNormalized: bool
    crowdPresence: Literal["NONE", "LIGHT", "MODERATE", "DENSE"]
    configuredCapacity: int
    frameBoxOccupancyPercent: float
    detections: list[Detection]


class RecommendationRequest(BaseModel):
    peopleCount: int = Field(ge=0, le=100000)
    riskLevel: Literal["LOW", "MODERATE", "HIGH", "CRITICAL"]
    riskScore: int = Field(ge=0, le=100)
    occupancyPercent: int = Field(ge=0, le=100)
    zoneName: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$")


class RecommendationResponse(BaseModel):
    recommendation: str
    model: str
    localInference: bool
    fallback: bool = False


class AutomationStatus(BaseModel):
    status: Literal["OFFLINE", "READY", "CONNECTED", "ERROR", "dispatched", "offline", "not_triggered"]
    configured: bool
    webhookConfigured: bool
    lastDispatchStatus: Optional[Literal["success", "failed"]] = None
    lastDispatchAt: Optional[str] = None
    dispatchedAt: Optional[str] = None
    detail: Optional[str] = None


class AutomationRequest(RecommendationRequest):
    recommendation: str = Field(min_length=1, max_length=500)


def load_yolo_model() -> Any:
    """Load the small pretrained model once when the application starts."""
    from ultralytics import YOLO

    local_weights = Path(__file__).resolve().parent / MODEL_NAME
    return YOLO(str(local_weights) if local_weights.is_file() else MODEL_NAME)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.model = None
    app.state.model_error = None
    app.state.last_dispatch_status = None
    app.state.last_dispatch_at = None
    logger.info("N8N configured: %s", str(bool(N8N_WEBHOOK_URL)).lower())
    try:
        app.state.model = load_yolo_model()
        logger.info("Loaded YOLO model %s", MODEL_NAME)
    except Exception as exc:  # Keep health available so the startup problem is diagnosable.
        app.state.model_error = str(exc)
        logger.exception("Could not load YOLO model %s", MODEL_NAME)
    yield


app = FastAPI(
    title="ShaktiFlow Crowd Analysis API",
    description="Image-only person detection for a crowd-safety prototype.",
    version=API_VERSION,
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def _package_version(package: str) -> str | None:
    try:
        return version(package)
    except PackageNotFoundError:
        return None


def _number(value: Any) -> float:
    """Convert Python, NumPy, or Torch scalar values to a float."""
    if hasattr(value, "item"):
        value = value.item()
    return float(value)


def _values(value: Any) -> list[float]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    return [float(part) for part in value]


def _risk_level(occupancy_percent: int) -> str:
    if occupancy_percent >= RISK_THRESHOLDS["CRITICAL_MIN_PERCENT"]:
        return "CRITICAL"
    if occupancy_percent >= RISK_THRESHOLDS["HIGH_MIN_PERCENT"]:
        return "HIGH"
    if occupancy_percent >= RISK_THRESHOLDS["MODERATE_MIN_PERCENT"]:
        return "MODERATE"
    return "LOW"


def _tile_origins(length: int, tile_size: int) -> list[int]:
    if length <= tile_size:
        return [0]
    stride = max(1, round(tile_size * (1 - TILE_OVERLAP)))
    origins = list(range(0, max(1, length - tile_size + 1), stride))
    final = length - tile_size
    if origins[-1] != final:
        origins.append(final)
    return origins


PersonBox = tuple[float, float, float, float, float]


def _valid_person_box(box: PersonBox, width: int, height: int) -> PersonBox | None:
    if not all(math.isfinite(value) for value in box):
        return None
    x1, y1, x2, y2, score = box
    if score < MODEL_CONFIDENCE or score > 1:
        return None
    x1, x2 = max(0.0, min(width, x1)), max(0.0, min(width, x2))
    y1, y2 = max(0.0, min(height, y1)), max(0.0, min(height, y2))
    area = (x2 - x1) * (y2 - y1)
    if x2 <= x1 or y2 <= y1 or (area < width * height * MIN_PERSON_AREA_FRACTION and score < 0.5):
        return None
    return x1, y1, x2, y2, score


def _intersection_area(a: PersonBox, b: PersonBox) -> float:
    return max(0.0, min(a[2], b[2]) - max(a[0], b[0])) * max(0.0, min(a[3], b[3]) - max(a[1], b[1]))


def _area(box: PersonBox) -> float:
    return (box[2] - box[0]) * (box[3] - box[1])


def _same_person_contained(a: PersonBox, b: PersonBox) -> bool:
    smaller, larger = (a, b) if _area(a) <= _area(b) else (b, a)
    if _intersection_area(a, b) / _area(smaller) < CONTAINMENT_THRESHOLD:
        return False
    # Small tile fragments need a clear confidence gap; similarly scored boxes
    # must cover a substantial portion of the person to be treated as duplicates.
    area_ratio = _area(smaller) / _area(larger)
    if area_ratio < 0.05 or (area_ratio < 0.25 and larger[4] - smaller[4] < 0.10):
        return False
    cx_small, cy_small = (smaller[0] + smaller[2]) / 2, (smaller[1] + smaller[3]) / 2
    cx_large, cy_large = (larger[0] + larger[2]) / 2, (larger[1] + larger[3]) / 2
    return (abs(cx_small - cx_large) <= 0.35 * (larger[2] - larger[0])
            and abs(cy_small - cy_large) <= 0.35 * (larger[3] - larger[1]))


def _merge_person_boxes(candidates: list[PersonBox], width: int, height: int, debug: bool = True) -> list[PersonBox]:
    valid = [box for candidate in candidates if (box := _valid_person_box(candidate, width, height)) is not None]
    valid.sort(key=lambda box: (box[4], _area(box)), reverse=True)
    after_nms: list[PersonBox] = []
    for box in valid:
        duplicate_index = next((index for index, kept in enumerate(after_nms)
                                if _intersection_area(box, kept) / (_area(box) + _area(kept) - _intersection_area(box, kept)) > GLOBAL_NMS_IOU), None)
        if duplicate_index is None:
            after_nms.append(box)
        elif box[4] >= after_nms[duplicate_index][4] - 0.10 and _area(box) > _area(after_nms[duplicate_index]):
            after_nms[duplicate_index] = box
    final: list[PersonBox] = []
    for box in after_nms:
        if not any(_same_person_contained(box, kept) for kept in final):
            final.append(box)
    if DETECTION_DEBUG and debug:
        logger.info("Combined candidates: %d; after global NMS: %d; after containment suppression: %d; final unique people: %d",
                    len(valid), len(after_nms), len(final), len(final))
    return final


def _should_use_tiling(width: int, height: int, whole: list[PersonBox], force_sliced: bool) -> bool:
    if force_sliced:
        return True
    if max(width, height) <= SLICED_IMAGE_THRESHOLD:
        return False
    if not whole or len(whole) > 8:
        return True
    fractions = [_area(box) / (width * height) for box in whole]
    small_count = sum(fraction < 0.01 for fraction in fractions)
    return not (statistics.median(fractions) >= 0.025 and small_count <= 1
                and statistics.median(box[4] for box in whole) >= 0.45)


def _predict_window(model: Any, image: np.ndarray, left: int, top: int, right: int, bottom: int) -> list[PersonBox]:
    result = model.predict(source=image[top:bottom, left:right], classes=[0], conf=MODEL_CONFIDENCE,
                           iou=MODEL_IOU, imgsz=MODEL_IMAGE_SIZE, device="cpu", verbose=False)[0]
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []
    candidates: list[PersonBox] = []
    for coordinates, confidence, class_id in zip(boxes.xyxy, boxes.conf, boxes.cls):
        if int(_number(class_id)) != 0:
            continue
        x1, y1, x2, y2 = _values(coordinates)
        # Ultralytics xyxy is in tile pixels. Apply the tile origin exactly once.
        candidates.append((x1 + left, y1 + top, x2 + left, y2 + top, _number(confidence)))
    return candidates


def _infer_person_boxes(model: Any, image: np.ndarray, force_sliced: bool) -> list[PersonBox]:
    height, width = image.shape[:2]
    whole = _predict_window(model, image, 0, 0, width, height)
    whole = [box for candidate in whole if (box := _valid_person_box(candidate, width, height)) is not None]
    initial_unique = _merge_person_boxes(whole, width, height, debug=False)
    tiled: list[PersonBox] = []
    if _should_use_tiling(width, height, initial_unique, force_sliced):
        tile_width = min(TILE_IMAGE_SIZE, width, max(640, round(width * 0.7)) if force_sliced else TILE_IMAGE_SIZE)
        tile_height = min(TILE_IMAGE_SIZE, height, max(640, round(height * 0.7)) if force_sliced else TILE_IMAGE_SIZE)
        for top in _tile_origins(height, tile_height):
            for left in _tile_origins(width, tile_width):
                right, bottom = min(width, left + tile_width), min(height, top + tile_height)
                if (left, top, right, bottom) != (0, 0, width, height):
                    tiled.extend(_predict_window(model, image, left, top, right, bottom))
    if DETECTION_DEBUG:
        logger.info("Whole-image detections: %d; tile raw detections: %d", len(whole), len(tiled))
    return _merge_person_boxes(whole + tiled, width, height)


def _crowd_presence(count: int, frame_box_occupancy_percent: float) -> str:
    if count == 0:
        return "NONE"
    if count <= 5:
        return "LIGHT"
    capacity_proxy_percent = min(100, round(count / max(1, PROTOTYPE_ZONE_CAPACITY) * 100))
    if (
        count >= CROWD_PRESENCE_THRESHOLDS["DENSE_MIN_VISIBLE"]
        or capacity_proxy_percent >= CROWD_PRESENCE_THRESHOLDS["DENSE_MIN_CAPACITY_PERCENT"]
        or (
            count >= CROWD_PRESENCE_THRESHOLDS["DENSE_MIN_BOX_COUNT"]
            and frame_box_occupancy_percent >= CROWD_PRESENCE_THRESHOLDS["DENSE_MIN_FRAME_BOX_PERCENT"]
        )
    ):
        return "DENSE"
    if (
        count >= CROWD_PRESENCE_THRESHOLDS["MODERATE_MIN_VISIBLE"]
        or (
            count >= CROWD_PRESENCE_THRESHOLDS["MODERATE_MIN_BOX_COUNT"]
            and frame_box_occupancy_percent >= CROWD_PRESENCE_THRESHOLDS["MODERATE_MIN_FRAME_BOX_PERCENT"]
        )
        or capacity_proxy_percent >= CROWD_PRESENCE_THRESHOLDS["MODERATE_MIN_CAPACITY_PERCENT"]
    ):
        return "MODERATE"
    return "LIGHT"


def _fallback_recommendation(metrics: RecommendationRequest) -> str:
    zone = metrics.zoneName.strip()
    if metrics.riskLevel == "CRITICAL":
        return f"Pause new entry into {zone} and reassess when its reported occupancy is below 70%."
    if metrics.riskLevel == "HIGH":
        return f"Meter new entry into {zone} while occupancy remains elevated. Reassess when reported occupancy falls below 70%."
    if metrics.riskLevel == "MODERATE":
        return f"Manage arrivals to {zone} at a controlled pace and monitor the reported risk score."
    return f"Continue monitoring {zone} and maintain normal flow while the supplied metrics remain low."


def _limit_sentences(text: str) -> str:
    cleaned = " ".join(text.strip().strip('"\'`').split())
    if cleaned.startswith(("- ", "* ", "• ")):
        cleaned = cleaned[2:].strip()
    sentences = re.split(r"(?<=[.!?])\s+", cleaned)
    return " ".join(sentences[:2]).strip()


async def _ollama_recommendation(metrics: RecommendationRequest) -> str:
    system_prompt = (
        "You are a concise operations decision-support assistant for crowd management. "
        "Use only the supplied zone name and numeric crowd metrics. Do not invent or imply "
        "injuries, emergencies, hazards, routes, staffing, observations, or other facts. "
        "Recommend only monitoring, controlled entry, metering entry, or temporarily pausing entry "
        "at the named zone; do not mention another gate or destination. "
        "Return exactly one practical operational recommendation in plain text, in no more "
        "than two concise sentences. Do not claim that any action has already been taken."
    )
    user_prompt = (
        f"Zone: {metrics.zoneName.strip()}\n"
        f"People count: {metrics.peopleCount}\n"
        f"Risk level: {metrics.riskLevel}\n"
        f"Risk score: {metrics.riskScore}/100\n"
        f"Occupancy proxy: {metrics.occupancyPercent}%\n"
        "Provide one operational recommendation based only on these values."
    )
    timeout = httpx.Timeout(OLLAMA_TIMEOUT_SECONDS, connect=min(5.0, OLLAMA_TIMEOUT_SECONDS))
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "stream": False,
                "think": False,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "options": {"temperature": 0.2, "num_predict": 100},
            },
        )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Ollama response was not a JSON object")
    message = payload.get("message")
    if not isinstance(message, dict):
        raise ValueError("Ollama response did not include a message")
    content = message.get("content", "")
    recommendation = _limit_sentences(content) if isinstance(content, str) else ""
    if not recommendation:
        raise ValueError("Ollama returned an empty recommendation")
    return recommendation


def _automation_snapshot(service_app: FastAPI) -> AutomationStatus:
    configured = bool(N8N_WEBHOOK_URL)
    last_status = getattr(service_app.state, "last_dispatch_status", None)
    last_at = getattr(service_app.state, "last_dispatch_at", None)
    status = ("OFFLINE" if not configured else "CONNECTED" if last_status == "success"
              else "ERROR" if last_status == "failed" else "READY")
    return AutomationStatus(status=status, configured=configured, webhookConfigured=configured,
                            lastDispatchStatus=last_status, lastDispatchAt=last_at)


async def _dispatch_critical_automation(
    metrics: RecommendationRequest,
    recommendation: str,
    service_app: FastAPI,
) -> AutomationStatus:
    snapshot = _automation_snapshot(service_app)
    if metrics.riskLevel != "CRITICAL":
        return snapshot.model_copy(update={"status": "not_triggered"})
    if not N8N_WEBHOOK_URL:
        return snapshot.model_copy(update={"status": "offline", "detail": "Webhook URL is not configured"})

    timestamp = datetime.now().astimezone().isoformat(timespec="seconds")
    payload = {
        "event": "crowd_risk_detected",
        "severity": "CRITICAL",
        "zone": metrics.zoneName,
        "peopleCount": metrics.peopleCount,
        "occupancyPercent": metrics.occupancyPercent,
        "riskScore": metrics.riskScore,
        "recommendation": recommendation,
        "timestamp": timestamp,
    }
    try:
        timeout = httpx.Timeout(N8N_TIMEOUT_SECONDS, connect=min(1.5, N8N_TIMEOUT_SECONDS))
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(N8N_WEBHOOK_URL, json=payload)
            response.raise_for_status()
        service_app.state.last_dispatch_status = "success"
        service_app.state.last_dispatch_at = timestamp
        return _automation_snapshot(service_app).model_copy(update={"status": "dispatched", "dispatchedAt": timestamp})
    except (httpx.HTTPError, ValueError) as exc:
        service_app.state.last_dispatch_status = "failed"
        service_app.state.last_dispatch_at = timestamp
        logger.warning("n8n webhook dispatch failed; monitoring remains available: %s", type(exc).__name__)
        return _automation_snapshot(service_app).model_copy(update={"status": "offline", "detail": "Webhook request failed"})


def _validate_image(file: UploadFile, content: bytes) -> tuple[np.ndarray, int, int]:
    filename = (file.filename or "").lower()
    extension = filename[filename.rfind(".") :] if "." in filename else ""
    if file.content_type not in ALLOWED_CONTENT_TYPES or extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Upload a JPG or PNG image.")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")

    try:
        with Image.open(BytesIO(content)) as inspected:
            if inspected.format not in {"JPEG", "PNG"}:
                raise HTTPException(status_code=415, detail="Upload a JPG or PNG image.")
            width, height = inspected.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=400, detail="The upload is not a valid JPG or PNG image.") from exc
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=413, detail="Image exceeds the configured safe decoding limit.")
    try:
        with Image.open(BytesIO(content)) as source:
            source = ImageOps.exif_transpose(source).convert("RGB")
            original_width, original_height = source.size
            source.thumbnail((MAX_ANALYSIS_LONG_SIDE, MAX_ANALYSIS_LONG_SIDE), Image.Resampling.LANCZOS)
            image = cv2.cvtColor(np.asarray(source), cv2.COLOR_RGB2BGR)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=400, detail="The upload is not a valid JPG or PNG image.") from exc
    if image is None or image.size == 0:
        raise HTTPException(status_code=400, detail="The upload is not a valid JPG or PNG image.")
    return image, original_width, original_height


@app.get("/health")
async def health(request: Request) -> dict[str, Any]:
    model = getattr(request.app.state, "model", None)
    return {
        "status": "ok" if model is not None else "degraded",
        "model": {
            "name": MODEL_NAME,
            "loaded": model is not None,
            "error": getattr(request.app.state, "model_error", None),
        },
        "versions": {
            "api": API_VERSION,
            "python": platform.python_version(),
            "fastapi": _package_version("fastapi"),
            "ultralytics": _package_version("ultralytics"),
            "opencv": cv2.__version__,
        },
    }


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze(
    request: Request,
    file: UploadFile = File(..., description="JPG or PNG crowd image"),
    normalized: bool = Query(
        default=False,
        description="Return box coordinates in the 0..1 image-relative range instead of pixels.",
    ),
    dense: bool = Query(default=False, description="Force overlapping person-detection tiles."),
) -> AnalysisResponse:
    model = getattr(request.app.state, "model", None)
    if model is None:
        raise HTTPException(status_code=503, detail="The detection model is not available.")

    started = time.perf_counter()
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Image exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.",
            )
        image, original_width, original_height = _validate_image(file, content)
    finally:
        await file.close()

    try:
        raw_detections = _infer_person_boxes(model, image, dense)
    except Exception as exc:
        logger.exception("YOLO inference failed")
        raise HTTPException(status_code=500, detail="Image analysis failed.") from exc
    height, width = image.shape[:2]
    scale_x = original_width / width
    scale_y = original_height / height
    detections: list[Detection] = []
    area_total = 0.0
    for bx1, by1, bx2, by2, score in raw_detections:
        area_total += (bx2 - bx1) * (by2 - by1)
        x1, x2 = bx1 * scale_x, bx2 * scale_x
        y1, y2 = by1 * scale_y, by2 * scale_y
        if normalized:
            x1, x2 = x1 / original_width, x2 / original_width
            y1, y2 = y1 / original_height, y2 / original_height
            x1, y1, x2, y2 = (round(value, 6) for value in (x1, y1, x2, y2))
        detections.append(Detection(x1=x1, y1=y1, x2=x2, y2=y2, confidence=round(score, 4)))

    count = len(detections)
    occupancy_percent = min(100, round(count / max(1, PROTOTYPE_ZONE_CAPACITY) * 100))
    frame_box_occupancy = min(100.0, area_total / max(1, width * height) * 100)
    risk_score = occupancy_percent
    mean_confidence = round(sum(item.confidence for item in detections) / count, 4) if count else 0.0
    processing_ms = round((time.perf_counter() - started) * 1000)

    return AnalysisResponse(
        peopleCount=count,
        riskLevel=_risk_level(occupancy_percent),
        riskScore=risk_score,
        occupancyPercent=occupancy_percent,
        confidence=mean_confidence,
        processingMs=processing_ms,
        coordinatesNormalized=normalized,
        crowdPresence=_crowd_presence(count, frame_box_occupancy),
        configuredCapacity=PROTOTYPE_ZONE_CAPACITY,
        frameBoxOccupancyPercent=round(frame_box_occupancy, 2),
        detections=detections,
    )


@app.post("/recommend", response_model=RecommendationResponse)
async def recommend(metrics: RecommendationRequest) -> RecommendationResponse:
    try:
        text = _limit_sentences(await _ollama_recommendation(metrics))
        if not text:
            raise ValueError("Recommendation was empty after formatting")
        if UNSUPPORTED_RECOMMENDATION_RE.search(text):
            raise ValueError("Ollama recommended unsupported facts or controls")
        return RecommendationResponse(
            recommendation=text,
            model=OLLAMA_MODEL,
            localInference=True,
            fallback=False,
        )
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Ollama recommendation unavailable; using local rules: %s", exc)
        fallback_text = _fallback_recommendation(metrics)
        return RecommendationResponse(
            recommendation=fallback_text,
            model="rule-based-fallback",
            localInference=True,
            fallback=True,
        )


@app.post("/automation/dispatch", response_model=AutomationStatus)
async def dispatch_automation(metrics: AutomationRequest, request: Request) -> AutomationStatus:
    """Optionally dispatch a critical analysis; webhook errors never affect monitoring."""
    return await _dispatch_critical_automation(metrics, metrics.recommendation, request.app)


@app.get("/automation/status", response_model=AutomationStatus)
async def automation_status(request: Request) -> AutomationStatus:
    """Report configuration without claiming the remote webhook is reachable."""
    return _automation_snapshot(request.app)
