@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\tu-khoi-dong.ps1" -Disable
echo Đã TẮT tự khởi động cùng Windows.
echo (Phần mềm đang chạy ngầm, nếu có, vẫn chạy cho đến khi tắt máy hoặc bấm DUNG-PHAN-MEM.bat)
pause
