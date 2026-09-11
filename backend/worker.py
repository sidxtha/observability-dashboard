from dotenv import load_dotenv
import os
import json
from celery import Celery
from google import genai
from google.genai.errors import APIError, ClientError
from database import SessionLocal, TelemetryLog

load_dotenv()

celery_app = Celery(
    "tasks",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/0"
)

def analyze_with_ai(service_name: str, log_level: str, log_message: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return "[Gemini Skipped]: API Key Missing"

    prompt = f"""
You are an SRE engineer. Analyze this error and give a 1-sentence cause and fix.
Service: {service_name}
Severity: {log_level}
Message: {log_message}

Format: [Root Cause]: <cause> | [Action]: <fix>
Under 25 words total.
"""
    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model='gemini-3.6-flash',
            contents=prompt,
        )
        return response.text.strip()
    except (APIError, ClientError) as e:
        # Graceful fallback on rate limit/quota exhausted
        return "[Gemini Rate Limited]: Quota reached. Check tier limit."
    except Exception as e:
        return f"[AI Diagnosis Failed]: {str(e)}"

@celery_app.task(name="process_telemetry")
def process_telemetry_event(raw_data: str):
    db = SessionLocal()
    try:
        data = json.loads(raw_data)
        ai_summary = None
        
        service_name = data.get("service_name", "unknown-service")
        level = data.get("level", "INFO")
        message = data.get("message", "")

        if level in ["WARNING", "ERROR", "CRITICAL"]:
            ai_summary = analyze_with_ai(service_name, level, message)

        log_entry = TelemetryLog(
            service_name=service_name,
            level=level,
            latency_ms=float(data.get("latency_ms", 0.0)),
            message=message,
            ai_analysis=ai_summary
        )
        db.add(log_entry)
        db.commit()
        return f"Processed log ID {log_entry.id}"
    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()