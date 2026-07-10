@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "AUTOTEST_ROOT=%SCRIPT_DIR%.."
set "NODE_MODULES=%AUTOTEST_ROOT%\node_modules\playwright\package.json"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found in PATH.
  set "EXIT_CODE=1"
  goto finish
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is required but was not found in PATH.
  set "EXIT_CODE=1"
  goto finish
)

if not exist "%NODE_MODULES%" (
  echo Installing Playwright into %AUTOTEST_ROOT% ...
  call npm --prefix "%AUTOTEST_ROOT%" install
  if errorlevel 1 (
    set "EXIT_CODE=1"
    goto finish
  )
)

echo Ensuring Playwright Firefox browser is installed ...
call "%AUTOTEST_ROOT%\node_modules\.bin\playwright.cmd" install firefox
if errorlevel 1 (
  set "EXIT_CODE=1"
  goto finish
)

node "%SCRIPT_DIR%lesson1_firefox_headless.mjs"
set "EXIT_CODE=%ERRORLEVEL%"

:finish
echo.
echo Press any key to close this window...
pause >nul
exit /b %EXIT_CODE%
