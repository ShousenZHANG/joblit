@echo off
setlocal
rem Starts the tailoring sidecar by double-click, so the dialog's generate
rem button has something to talk to without anyone typing a command.
rem
rem A web page cannot start this itself: the browser sandbox has no API for
rem launching a local process, and it should not — a page that could spawn
rem node on your machine would be a page any site could imitate. So the
rem process starts here, and the page only connects to it.
rem
rem Double-click it, pin it to the taskbar, or drop a shortcut in
rem shell:startup to have it running after every login.

rem Explorer starts scripts in unpredictable directories; the sidecar needs the
rem repo root because it reads .env and the loader by relative path.
pushd "%~dp0..\.."

title Joblit tailoring sidecar

where node >nul 2>&1
if errorlevel 1 (
  echo Node is not on PATH. Install Node 20+ and reopen this window.
  goto :halt
)

if not exist ".env" (
  echo No .env in %CD%.
  echo The sidecar reads DATABASE_URL from it, so it cannot start without one.
  goto :halt
)

echo Starting the Joblit tailoring sidecar on http://127.0.0.1:8791
echo Leave this window open while you generate. Ctrl+C or close it to stop.
echo.

node --env-file=.env --experimental-loader ./tools/evals/aliasLoader.mjs tools/tailor/serve.mjs %*

rem Reached on a crash or on Ctrl+C. Hold the window so the reason stays
rem readable instead of vanishing with it.
echo.
echo Sidecar stopped (exit code %errorlevel%).

:halt
popd
pause
endlocal
