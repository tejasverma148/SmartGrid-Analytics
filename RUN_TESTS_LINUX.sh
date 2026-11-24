#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
echo '[1/3] Compile C++ analytics'
g++ -std=c++17 -O2 -Wall -Wextra -pedantic src/analytics.cpp -o out/analytics
echo '[2/3] Compile Java application and tests'
javac -encoding UTF-8 -d out src/SmartGridServer.java tests/SmartGridTests.java
echo '[3/3] Run automated test suite'
java -cp out SmartGridTests
