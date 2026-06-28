# ─── Stage 1: build the React frontend ──────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /web

# OAuth client IDs and the API base are baked into the static build, so they
# must be provided as build args (Railway: set them as build-time variables).
# VITE_API_URL is empty → the app talks to its OWN origin (this backend serves it).
ARG VITE_API_URL=""
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_FACEBOOK_APP_ID=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_FACEBOOK_APP_ID=$VITE_FACEBOOK_APP_ID

COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build          # outputs to /web/dist

# ─── Stage 2: build the Spring Boot backend (with the frontend bundled in) ───
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY server/pom.xml .
RUN mvn dependency:go-offline -q
COPY server/src ./src
# Drop the built SPA into Spring's static resources so the jar serves it.
COPY --from=frontend /web/dist/ ./src/main/resources/static/
RUN mvn clean package -DskipTests
RUN ls -la target/

# ─── Stage 3: runtime ───────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN mkdir -p /app/data
COPY --from=build /app/target/guitar-reach-api-0.0.1-SNAPSHOT.jar ./app.jar
ENV SPRING_PROFILES_ACTIVE=prod
ENV BUILD_DATE=2026-06-28
ENTRYPOINT ["java", "-jar", "app.jar"]
