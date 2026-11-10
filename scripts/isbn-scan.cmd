@echo off
setlocal
cd /d "C:\Users\Bellussi\Documents\Workspace\collection-radar"
if not exist "logs" mkdir "logs"
if exist "logs\isbn-scan.log" (
  for %%A in ("logs\isbn-scan.log") do if %%~zA GTR 5242880 move /Y "logs\isbn-scan.log" "logs\isbn-scan.log.1" >nul
)
echo [%date% %time%] inicio >> "logs\isbn-scan.log"
call npm.cmd run isbn-scan >> "logs\isbn-scan.log" 2>&1
echo [%date% %time%] fim (exit %errorlevel%) >> "logs\isbn-scan.log"
endlocal
