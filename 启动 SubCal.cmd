@echo off
chcp 65001 >nul
pushd "%~dp0"
call npm run dev
if errorlevel 1 pause
popd
