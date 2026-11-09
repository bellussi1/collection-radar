@echo off
setlocal
cd /d "C:\Users\Bellussi\Documents\Workspace\collection-radar"
if not exist "logs" mkdir "logs"
if exist "logs\scan.log" (
  for %%A in ("logs\scan.log") do if %%~zA GTR 5242880 move /Y "logs\scan.log" "logs\scan.log.1" >nul
)
echo [%date% %time%] inicio >> "logs\scan.log"
call npm.cmd run scan >> "logs\scan.log" 2>&1
echo [%date% %time%] fim (exit %errorlevel%) >> "logs\scan.log"
endlocal
