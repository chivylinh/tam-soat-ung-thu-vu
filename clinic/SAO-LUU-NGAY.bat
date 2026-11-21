@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Đang sao lưu dữ liệu...
node --disable-warning=ExperimentalWarning scripts\backup.js
echo.
echo Lưu ý: phần mềm cũng TỰ ĐỘNG sao lưu mỗi ngày vào data\backups khi đang chạy.
pause
