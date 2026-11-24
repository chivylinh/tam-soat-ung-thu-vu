@echo off
chcp 65001 >nul
title Phan mem quan ly phong kham
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [LỖI] Máy chưa cài Node.js.
  echo  Hãy tải bản LTS tại https://nodejs.org , cài đặt, rồi bấm đúp lại file này.
  echo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist config.env copy /y config.env.example config.env >nul

set "PORT=3000"
for /f "usebackq eol=# tokens=1,* delims==" %%a in ("config.env") do (
  if /i "%%a"=="PORT" set "PORT=%%b"
)

rem Neu phan mem da chay san (vi du tu khoi dong cung Windows) thi chi mo trinh duyet
curl -s -o nul "http://localhost:%PORT%/login" >nul 2>nul
if not errorlevel 1 (
  echo Phần mềm đang chạy sẵn. Đang mở trình duyệt...
  start "" "http://localhost:%PORT%"
  timeout /t 3 >nul
  exit /b 0
)

if not exist node_modules (
  echo Đang cài đặt lần đầu, vui lòng chờ 1-2 phút...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo [LỖI] Cài đặt thất bại. Kiểm tra kết nối Internet rồi thử lại.
    pause
    exit /b 1
  )
)

echo.
echo  ==========================================================
echo   PHẦN MỀM QUẢN LÝ PHÒNG KHÁM ĐANG CHẠY
echo   Máy này:        http://localhost:%PORT%
echo   Máy khác cùng mạng: http://[địa chỉ IP máy này]:%PORT%
echo   KHÔNG ĐÓNG cửa sổ này trong khi sử dụng.
echo   Muốn tắt: bấm Ctrl+C hoặc đóng cửa sổ.
echo  ==========================================================
echo.
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /c:"IPv4"') do echo   Địa chỉ IP máy này:%%i

start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%PORT%'"
node --disable-warning=ExperimentalWarning src\server.js
echo.
echo Phần mềm đã dừng.
pause
