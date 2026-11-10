@echo off
setlocal
cd /d "C:\Users\Bellussi\Documents\Workspace\collection-radar"
if not exist "logs" mkdir "logs"
if exist "logs\digest.log" (
  for %%A in ("logs\digest.log") do if %%~zA GTR 5242880 move /Y "logs\digest.log" "logs\digest.log.1" >nul
)
echo [%date% %time%] inicio >> "logs\digest.log"
call npm.cmd run digest -- --new >> "logs\digest.log" 2>&1
echo [%date% %time%] fim (exit %errorlevel%) >> "logs\digest.log"
endlocal
