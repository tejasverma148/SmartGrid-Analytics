@echo off
setlocal
set "PATH=C:\msys64\ucrt64\bin;%PATH%"
cd /d "%~dp0"
echo ==================================================
echo SmartGrid Analytics - Multi-Profile Functional Edition v7
echo ==================================================
where javac >nul 2>nul
if errorlevel 1 (echo ERROR: JDK 17+ javac not found. & pause & exit /b 1)
where g++ >nul 2>nul
if errorlevel 1 (echo ERROR: g++ not found. Check MSYS2 UCRT64 PATH. & pause & exit /b 1)
if not exist out mkdir out
echo [1/3] Compiling C++ analytics engine...
g++ -std=c++17 -O2 -Wall -Wextra -pedantic src\analytics.cpp -o out\analytics.exe
if errorlevel 1 (echo C++ compilation failed. & pause & exit /b 1)
echo [2/3] Compiling Java backend...
javac -encoding UTF-8 -d out src\SmartGridServer.java
if errorlevel 1 (echo Java compilation failed. & pause & exit /b 1)
echo [3/3] Starting SmartGrid Analytics...
echo Dashboard: http://localhost:8080
echo.
echo PHONE ACCESS: use one of the phone-access URLs printed below.
echo Connect both devices to the same Wi-Fi network.
echo If blocked, allow Java through Windows Firewall on Private networks.
echo This is a simulated software prototype - no hardware is connected.
echo Keep this window open. Press Ctrl+C to stop the server.
java -cp out SmartGridServer
pause
