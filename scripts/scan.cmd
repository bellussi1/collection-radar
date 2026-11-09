@echo off
setlocal
cd /d "C:\Users\Bellussi\Documents\Workspace\collection-radar"
if not exist "logs" mkdir "logs"
echo [%date% %time%] inicio >> "logs\scan.log"
call npm.cmd run scan >> "logs\scan.log" 2>&1
echo [%date% %time%] fim (exit %errorlevel%) >> "logs\scan.log"
endlocal
