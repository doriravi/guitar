#!/bin/bash
# Restart the Spring Boot server
# Kills any process on port 8080, then starts the server

PORT=8080
MVN="/c/tools/apache-maven-3.9.9/bin/mvn"

# Find and kill process on the port
PID=$(netstat -ano 2>/dev/null | grep ":${PORT}.*LISTENING" | awk '{print $5}' | head -1)

if [ -n "$PID" ]; then
  echo "Port $PORT is in use by PID $PID — killing it..."
  taskkill //F //PID "$PID" 2>/dev/null
  sleep 2
else
  echo "Port $PORT is free."
fi

echo "Starting Spring Boot server..."
"$MVN" spring-boot:run