@echo off
setlocal EnableExtensions DisableDelayedExpansion
title YouTube Super Thanks Scraper - Runner (Windows)

:: 0) Node.js?
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org/ and retry.
  pause
  exit /b 1
)

:: 1) Script present?
if not exist "superthanks.js" (
  echo [ERROR] superthanks.js not found in the current directory.
  echo Place run-superthanks.bat and superthanks.js in the same folder.
  pause
  exit /b 1
)

:: 2) npm project?
if not exist "package.json" (
  echo package.json not found. Initialize npm project? [Y/n]
  set /p CREATE_NPM=Choice: 
  if /I "%CREATE_NPM%"=="Y" (
    call npm init -y
  )
)

:: 3) puppeteer installed?
if not exist "node_modules\puppeteer" (
  echo Puppeteer not installed. Install now? [Y/n]
  set /p INSTALL_PUP=Choice: 
  if /I "%INSTALL_PUP%"=="Y" (
    call npm i puppeteer
    if errorlevel 1 (
      echo [ERROR] Puppeteer installation failed.
      pause
      exit /b 1
    )
  ) else (
    echo [WARN] Without Puppeteer the script will fail.
  )
)

echo.
echo ================== SETTINGS ==================
echo Leave blank to accept defaults. [*] required.
echo.

:ask_url
set "URL_INPUT="
set /p URL_INPUT=[*] YouTube Video URL: 
if "%URL_INPUT%"=="" (
  echo [WARN] URL is required.
  goto ask_url
)

:: Strip surrounding quotes (if any) to avoid nested-quote issues
set "URL_INPUT=%URL_INPUT:"=%"

:: The Node script will canonicalize to https://www.youtube.com/watch?v=VIDEOID
:: but we still pass the raw URL safely quoted:
set "SAFE_URL=%URL_INPUT%"

set "SECONDS=25"
set /p SECONDS=Scroll duration in seconds [25]: 
if "%SECONDS%"=="" set "SECONDS=25"

set "MIN=0"
set /p MIN=Minimum comment blocks before early stop [0]: 
if "%MIN%"=="" set "MIN=0"

set "OUT=out\super-thanks"
set /p OUT=Output file prefix [out\super-thanks]: 
if "%OUT%"=="" set "OUT=out\super-thanks"

set "HEADFUL=N"
set /p HEADFUL=Show browser (headful) [Y/N, default N]: 
if /I "%HEADFUL%"=="Y" (
  set "HEADFUL_FLAG=--headful"
) else (
  set "HEADFUL_FLAG="
)

:: Ensure output directory exists (prefix path only)
for %%I in ("%OUT%") do set "OUTDIR=%%~dpI"
if not "%OUTDIR%"=="" (
  if not exist "%OUTDIR%" (
    echo [INFO] Creating output directory: "%OUTDIR%"
    mkdir "%OUTDIR%" >nul 2>nul
  )
)

echo.
echo ================== SUMMARY ==================
echo URL       : %SAFE_URL%
echo seconds   : %SECONDS%
echo min       : %MIN%
echo out       : %OUT%
echo headful   : %HEADFUL%
echo ============================================
echo.

echo [INFO] Running...
:: IMPORTANT: Always quote the URL to prevent CMD from splitting on '&'
node "superthanks.js" "%SAFE_URL%" --seconds %SECONDS% --min %MIN% --out "%OUT%" %HEADFUL_FLAG%
set "ERR=%ERRORLEVEL%"

echo.
if "%ERR%"=="0" (
  echo [DONE] Completed successfully.
) else (
  echo [ERROR] Script exited with code: %ERR%
)
echo.
pause
endlocal
