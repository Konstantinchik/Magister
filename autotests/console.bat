@echo off
setlocal
set "DIR=%~dp0"
title Magister - console autotest (Firefox)

where node >nul 2>nul || (echo [ERROR] Node.js not found in PATH.& goto end)
where npm  >nul 2>nul || (echo [ERROR] npm not found in PATH.& goto end)

if not exist "%DIR%node_modules\playwright\package.json" (
  echo Installing dependencies ...
  call npm --prefix "%DIR%." install || goto end
)
echo Ensuring Firefox for Playwright ...
call "%DIR%node_modules\.bin\playwright.cmd" install firefox || goto end

echo.
echo Running CONSOLE autotest (headless) ...
echo.
node "%DIR%run.mjs" --browser firefox %*
set "CODE=%ERRORLEVEL%"

:end
echo.
echo Press any key to close...
pause >nul
exit /b %CODE%
