@echo off
setlocal
cd /d "%~dp0"
echo Skill Bridge Secure MCP Tunnel - private setup
echo.
set "PROFILE_FILE=%LOCALAPPDATA%\SkillBridgeTunnel\profiles\skill-bridge.yaml"
if exist "%PROFILE_FILE%" goto :set_key
echo No Skill Bridge tunnel profile was found on this PC.
echo First-time setup: paste the NEW tunnel_id for Skill Bridge when prompted.
echo Do NOT reuse a tunnel_id from CoS.
echo.
set /p "TUNNEL_ID=Tunnel ID (tunnel_...): "
if "%TUNNEL_ID%"=="" goto :failed
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\skill-bridge-tunnel.ps1" setup -TunnelId "%TUNNEL_ID%"
if errorlevel 1 goto :failed
goto :doctor
:set_key
echo Paste the NEW runtime API key at the next hidden prompt.
echo The key will not be printed or stored in this project.
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\skill-bridge-tunnel.ps1" set-key
if errorlevel 1 goto :failed
:doctor
echo.
echo [1/3] Validating private tunnel...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\skill-bridge-tunnel.ps1" doctor
if errorlevel 1 goto :failed
echo.
echo [2/3] Starting dedicated tunnel...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\skill-bridge-tunnel.ps1" start
if errorlevel 1 goto :failed
echo.
echo [3/3] Checking tunnel status...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\skill-bridge-tunnel.ps1" status
echo.
echo Setup commands completed. Confirm "Tunnel ready: True" above.
pause
exit /b 0
:failed
echo.
echo Setup stopped due to an error. CoS tunnels were not touched.
pause
exit /b 1
