@echo off
setlocal
cd /d "C:\Users\Bellussi\Documents\Workspace\collection-radar"
if not exist "logs" mkdir "logs"
if exist "logs\sebos-scan.log" (
  for %%A in ("logs\sebos-scan.log") do if %%~zA GTR 5242880 move /Y "logs\sebos-scan.log" "logs\sebos-scan.log.1" >nul
)
echo [%date% %time%] inicio >> "logs\sebos-scan.log"
call npm.cmd run sebos-scan >> "logs\sebos-scan.log" 2>&1
echo [%date% %time%] fim (exit %errorlevel%) >> "logs\sebos-scan.log"
endlocal
