
FROM eclipse-temurin:17-jdk-jammy

RUN apt-get update && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN mkdir -p out \
    && g++ -std=c++17 -O2 src/analytics.cpp -o out/analytics \
    && javac -d out src/SmartGridServer.java

ENV PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "java -Dsmartgrid.port=${PORT:-10000} -cp out SmartGridServer"]
