@echo off
setlocal
cd /d "%~dp0"
call node_modules\.bin\supabase.cmd %*
