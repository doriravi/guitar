FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY server/pom.xml .
RUN mvn dependency:go-offline -q
COPY server/src ./src
RUN mvn clean package -DskipTests
RUN ls -la target/

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN mkdir -p /app/data
COPY --from=build /app/target/guitar-reach-api-0.0.1-SNAPSHOT.jar ./app.jar
ENV SPRING_PROFILES_ACTIVE=prod
ENV BUILD_DATE=2026-05-19
ENTRYPOINT ["java", "-jar", "app.jar"]
