@echo off
setlocal EnableExtensions

if not exist node_modules\vite\bin\vite.js (
	echo [INFO] Dependencies are missing or invalid. Relinking from local pnpm store...
	pnpm install --prefer-offline --frozen-lockfile
	if errorlevel 1 (
		echo [ERROR] Failed to prepare dependencies.
		pause
		exit /b 1
	)
)

node node_modules\vite\bin\vite.js
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
	echo [INFO] Start failed. Trying one-time relink from local pnpm store...
	pnpm install --prefer-offline --frozen-lockfile
	if errorlevel 1 (
		echo [ERROR] Relink failed.
		pause
		exit /b 1
	)

	node node_modules\vite\bin\vite.js
	set "EXIT_CODE=%ERRORLEVEL%"
)

pause
exit /b %EXIT_CODE%