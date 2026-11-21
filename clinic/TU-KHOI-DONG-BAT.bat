@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [LỖI] Máy chưa cài Node.js. Tải tại https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo Đang cài đặt lần đầu, vui lòng chờ...
  call npm install --omit=dev --no-audit --no-fund
)
if not exist config.env copy /y config.env.example config.env >nul

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\tu-khoi-dong.ps1" -Enable
if errorlevel 1 (
  echo [LỖI] Không tạo được lối tắt khởi động.
  pause
  exit /b 1
)

rem Chay ngay bay gio (an) neu chua chay
curl -s -o nul "http://localhost:3000/login" >nul 2>nul || wscript "%~dp0chay-an.vbs"

echo.
echo  Đã BẬT tự khởi động. Phần mềm sẽ tự chạy ngầm mỗi khi đăng nhập Windows.
echo  - Mở phần mềm: bấm đúp CHAY-PHAN-MEM.bat (hoặc vào http://localhost:3000)
echo  - Tắt phần mềm đang chạy ngầm: bấm đúp DUNG-PHAN-MEM.bat
echo  - Bỏ tự khởi động: bấm đúp TU-KHOI-DONG-TAT.bat
echo  - Nhật ký chạy: data\server.log
echo.
pause
