@echo off
setlocal
set "DIR=%~dp0"
title Magister - graphical autotest (Firefox)

where node >nul 2>nul || (echo [ERROR] Node.js not found in PATH.& goto end)
where npm  >nul 2>nul || (echo [ERROR] npm not found in PATH.& goto end)

if not exist "%DIR%node_modules\playwright\package.json" (
  echo Installing dependencies ...
  call npm --prefix "%DIR%." install || goto end
)
echo Ensuring Firefox for Playwright ...
call "%DIR%node_modules\.bin\playwright.cmd" install firefox || goto end

echo.
echo Running GRAPHICAL autotest (you will see the browser and the bot's cursor).
echo.
node "%DIR%run.mjs" --headed --browser firefox %*
set "CODE=%ERRORLEVEL%"

:end
echo.
echo Press any key to close...
pause >nul
exit /b %CODE%
