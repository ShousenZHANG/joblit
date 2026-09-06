@echo off
setlocal
rem Developer entry point. Tailor's Windows installer registers browser launch.
pushd "%~dp0..\.."

title Joblit local assistant

where node >nul 2>&1
if errorlevel 1 (
  echo Node is not on PATH. Install the Windows assistant from Tailor, or Node 24 for development.
  goto :halt
)

echo Starting the Joblit local assistant on http://127.0.0.1:8791
echo No repository .env or database connection is used by this assistant.
echo Install the Windows assistant once to enable Start ^& connect in your browser.
echo Leave this window open while you generate. Ctrl+C or close it to stop.
echo.

node tools/companion/app.mjs

rem Reached on a crash or on Ctrl+C. Hold the window so the reason stays
rem readable instead of vanishing with it.
echo.
echo Sidecar stopped (exit code %errorlevel%).

:halt
popd
pause
endlocal
