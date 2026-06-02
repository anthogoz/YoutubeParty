@echo off
title YoutubeParty - Serveur
cd /d "%~dp0"

echo =================================================================
echo.
echo    🔥  Y O U T U B E   P A R T Y   T V  -  S E R V E U R  🔥
echo.
echo =================================================================
echo.
echo  [+] Lancement du serveur en cours...
echo  [+] Ouverture automatique de la TV principale dans votre navigateur...
echo.
echo -----------------------------------------------------------------

:: Démarre une commande séparée en arrière-plan pour attendre 2 secondes
:: puis ouvre la page TV dans le navigateur par défaut
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000/screen.html"

:: Lance le serveur Node.js principal
node server.js

if %errorlevel% neq 0 (
  echo.
  echo  [!] Une erreur s'est produite lors du lancement du serveur.
  echo  [!] Assurez-vous que Node.js est bien installe sur votre PC.
  echo.
  pause
)
