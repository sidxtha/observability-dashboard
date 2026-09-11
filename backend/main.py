from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional
from datetime import datetime, timedelta
from enum import Enum
import json
from worker import process_telemetry_event
from database import get_db, TelemetryLog

# Maps the time-range values the frontend sends to an actual timedelta window.
# Keeping this as an explicit whitelist (rather than parsing arbitrary strings)
# avoids letting a client request an unbounded/expensive query.
TIME_RANGE_WINDOWS = {
    "5m": timedelta(minutes=5),
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
}

class TimeRange(str, Enum):
    five_min = "5m"
    fifteen_min = "15m"
    one_hour = "1h"

# Whitelisting known levels rather than accepting arbitrary strings keeps the
# filter predictable and matches what simulator.py / worker.py actually emit.
class LogLevel(str, Enum):
    info = "INFO"
    warning = "WARNING"
    error = "ERROR"
    critical = "CRITICAL"

# Cap search term length to keep the ILIKE query cheap and prevent
# pathological inputs from turning into an expensive full-text scan.
MAX_SEARCH_LENGTH = 100

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class TelemetryPayload(BaseModel):
    service_name: str
    level: str
    latency_ms: float
    message: str

class TelemetryLogOut(BaseModel):
    id: int
    service_name: str
    level: str
    latency_ms: float
    message: str
    timestamp: datetime
    ai_analysis: Optional[str] = None

    class Config:
        from_attributes = True

@app.post("/api/v1/telemetry")
async def receive_telemetry(payload: TelemetryPayload):
    try:
        # Calling the task function directly (instead of .delay()) runs it
        # synchronously in this process, with no Redis/Celery worker needed.
        # Trade-off: the request blocks until the DB write (and, for
        # WARNING/ERROR/CRITICAL, the Gemini call) finishes, so this endpoint
        # is a bit slower than the queued version — fine for this app's
        # traffic volume, and it's what lets this run on a free web-service
        # tier with no separate paid worker.
        result = process_telemetry_event(json.dumps(payload.model_dump()))
        return {"status": "processed", "detail": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/logs", response_model=List[TelemetryLogOut])
async def get_logs(
    range: Optional[TimeRange] = Query(
        None,
        description="Restrict results to a rolling window: 5m, 15m, or 1h. Omit for no time filtering.",
    ),
    level: Optional[List[LogLevel]] = Query(
        None,
        description="Restrict results to one or more levels, e.g. ?level=ERROR&level=WARNING. Omit for all levels.",
    ),
    search: Optional[str] = Query(
        None,
        max_length=MAX_SEARCH_LENGTH,
        description="Case-insensitive substring match against service_name or message.",
    ),
    limit: int = Query(30, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    query = db.query(TelemetryLog)

    if range is not None:
        # timestamp column is stored as naive UTC (see database.py), so the
        # cutoff must also be naive UTC or the comparison silently matches nothing.
        cutoff = datetime.utcnow() - TIME_RANGE_WINDOWS[range.value]
        query = query.filter(TelemetryLog.timestamp >= cutoff)

    if level:
        query = query.filter(TelemetryLog.level.in_([lvl.value for lvl in level]))

    if search:
        term = search.strip()
        if term:
            like_pattern = f"%{term}%"
            query = query.filter(
                or_(
                    TelemetryLog.message.ilike(like_pattern),
                    TelemetryLog.service_name.ilike(like_pattern),
                )
            )

    logs = query.order_by(TelemetryLog.id.desc()).limit(limit).all()
    return logs