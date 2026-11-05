@echo off
node "%~dp0plugin.mjs" %*
exit /b %errorlevel%
