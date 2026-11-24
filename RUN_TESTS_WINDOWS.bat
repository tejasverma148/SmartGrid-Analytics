@echo off
setlocal
set "PATH=C:\msys64\ucrt64\bin;%PATH%"
cd /d "%~dp0"
echo ============================================
echo SmartGrid Analytics v7 - Automated Test Suite
echo ============================================
where javac >nul 2>nul
if errorlevel 1 (echo ERROR: JDK javac not found. & pause & exit /b 1)
where g++ >nul 2>nul
if errorlevel 1 (echo ERROR: g++ not found. Check MSYS2 UCRT64 PATH. & pause & exit /b 1)
if not exist out mkdir out
echo [1/3] Compiling C++ analytics...
g++ -std=c++17 -O2 -Wall -Wextra -pedantic src\analytics.cpp -o out\analytics.exe
if errorlevel 1 (echo C++ compilation failed. & pause & exit /b 1)
echo [2/3] Compiling Java application and tests...
javac -encoding UTF-8 -d out src\SmartGridServer.java tests\SmartGridTests.java
if errorlevel 1 (echo Java compilation failed. & pause & exit /b 1)
echo [3/3] Running automated tests...
java -cp out SmartGridTests
if errorlevel 1 (echo Tests failed. & pause & exit /b 1)
echo All tests passed.
pause
