#!/bin/bash
# GoalMind Health & Latency Monitor
# Target: API and Database readiness for 50k Surge

API_URL="http://localhost:8080/health"
LOG_FILE="/home/team/shared/backend/health_monitor.log"

echo "Starting GoalMind Health Monitor..."
echo "Logging to $LOG_FILE"

while true; do
  TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  
  # Check API Health
  START_TIME=$(date +%s%N)
  RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null "$API_URL")
  END_TIME=$(date +%s%N)
  LATENCY_MS=$(( (END_TIME - START_TIME) / 1000000 ))

  # Check DB Latency (via query_db.mjs)
  DB_START=$(date +%s%N)
  DB_CHECK=$(node /home/team/shared/backend/query_db.mjs "SELECT 1" > /dev/null 2>&1 && echo "OK" || echo "FAIL")
  DB_END=$(date +%s%N)
  DB_LATENCY=$(( (DB_END - DB_START) / 1000000 ))

  # Check User Count
  USER_COUNT=$(node /home/team/shared/backend/query_db.mjs "SELECT COUNT(*) FROM users" | jq -r '.[0].count')

  STATUS="[${TIMESTAMP}] API_CODE=${RESPONSE} API_LATENCY=${LATENCY_MS}ms DB_STATUS=${DB_CHECK} DB_LATENCY=${DB_LATENCY}ms USERS=${USER_COUNT}"
  echo "$STATUS"
  echo "$STATUS" >> "$LOG_FILE"

  if [ "$RESPONSE" != "200" ] || [ "$DB_CHECK" == "FAIL" ]; then
    echo "CRITICAL: System health check failed!"
  fi

  sleep 10
done
