@echo off
cd /d "%~dp0"
node --version
if errorlevel 1 goto missing
call npm.cmd run setup
if errorlevel 1 goto failed
call npm.cmd run doctor
if errorlevel 1 goto failed
call npm.cmd start
pause
exit /b
:missing
echo Please install Node.js 24 or newer, then run this file again.
pause
exit /b 1
:failed
echo Setup failed. Keep this window and read the message above.
pause
exit /b 1
