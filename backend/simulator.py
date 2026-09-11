import os
import requests
import random
import time

# Set API_BASE_URL to your deployed backend (e.g. https://your-app.onrender.com)
# to point the simulator at a hosted instance instead of your local machine.
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
URL = f"{API_BASE_URL}/api/v1/telemetry"
SERVICES = ["auth-service", "payment-api", "analytics-engine", "user-db"]

last_anomaly_time = time.time()
print("🚀 Simulator running! Sending clean telemetry with safe 65s anomaly interval...")

while True:
    service = random.choice(SERVICES)
    current_time = time.time()
    
    # Strictly limit error triggers to once every 65 seconds
    if current_time - last_anomaly_time > 65:
        level = random.choice(["WARNING", "ERROR"])
        msg = "High memory consumption detected: 85%" if level == "WARNING" else "Database Connection Refused: Timeout after 5000ms"
        latency = random.uniform(300, 1200)
        last_anomaly_time = current_time
    else:
        level = "INFO"
        msg = "Request processed successfully"
        latency = random.uniform(50, 200)

    payload = {
        "service_name": service,
        "level": level,
        "latency_ms": latency,
        "message": msg
    }

    try:
        response = requests.post(URL, json=payload)
        print(f"[{level}] Sent to {service} | Status: {response.status_code}")
    except Exception as e:
        print(f"❌ Failed: {e}")

    time.sleep(2)  # Emit telemetry every 2 seconds