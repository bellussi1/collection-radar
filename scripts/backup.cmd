@echo off
setlocal
cd /d "C:\Users\Bellussi\Documents\Workspace\collection-radar"
if not exist "logs" mkdir "logs"
if exist "logs\backup.log" (
  for %%A in ("logs\backup.log") do if %%~zA GTR 5242880 move /Y "logs\backup.log" "logs\backup.log.1" >nul
)
echo [%date% %time%] inicio >> "logs\backup.log"
call npm.cmd run backup >> "logs\backup.log" 2>&1
echo [%date% %time%] fim (exit %errorlevel%) >> "logs\backup.log"
endlocal
