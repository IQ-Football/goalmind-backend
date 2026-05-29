#!/bin/bash
# Kill any process on port 8080
lsof -ti:8080 | xargs -r kill -9 2>/dev/null
sleep 1
# Start fresh server
cd /home/team/shared/backend
node src/server.js > /home/team/shared/backend/server.log 2>&1 &
echo "Server started with PID $!"
sleep 5
echo "Testing..."
curl -s http://localhost:8080/health
echo ""
curl -s http://localhost:8080/referrals/leaderboard | head -c 300