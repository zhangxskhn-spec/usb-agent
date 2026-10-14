@echo off
setlocal EnableExtensions EnableDelayedExpansion
pushd "%~dp0.."
set "ROOT=%CD%"
popd
call "%~dp0runtime-home.bat"
if not defined USBAI_RUNTIME (echo    [ERROR] No usable runtime. & pause & exit /b 1)
echo ============================================
echo   环境自检 (U 盘 AI 助手)
echo ============================================
echo.
echo [1] 便携 Node
if exist "%USBAI_RUNTIME%\node\node.exe" ("%USBAI_RUNTIME%\node\node.exe" -v) else (echo     缺失!)
echo.
echo [2] Claude Code
if exist "%USBAI_RUNTIME%\node\claude.cmd" (call "%USBAI_RUNTIME%\node\claude.cmd" --version) else (echo     缺失!)
echo.
echo [3] 便携 Git Bash
if exist "%USBAI_RUNTIME%\git\bin\bash.exe" (echo     存在) else (echo     缺失)
echo.
echo [4] 网页壳 CloudCLI
if exist "%USBAI_RUNTIME%\node\node_modules\@cloudcli-ai\cloudcli" (echo     已安装) else (echo     缺失)
echo.
echo [5] 密钥配置（config\keys.env，可被 data\home\keys.env 覆盖）
rem 注意：不要用「(命令A & 命令B) | findstr ... && .. || ..」--括号组里失败命令的退出码会污染
rem 整条链的判定，导致随机误报。这里逐条判断、用变量记录，结果确定。
set "MIMOOK="
findstr /c:"MIMO_API_KEY=sk-" "%ROOT%\config\keys.env" >nul 2>&1 && set "MIMOOK=1"
if not defined MIMOOK findstr /c:"MIMO_API_KEY=sk-" "%ROOT%\data\home\keys.env" >nul 2>&1 && set "MIMOOK=1"
if defined MIMOOK (echo     MiMo: 已配置) else (echo     MiMo: 未配置)
set "DSOK="
findstr /c:"DEEPSEEK_API_KEY=sk-" "%ROOT%\config\keys.env" >nul 2>&1 && set "DSOK=1"
if not defined DSOK findstr /c:"DEEPSEEK_API_KEY=sk-" "%ROOT%\data\home\keys.env" >nul 2>&1 && set "DSOK=1"
if defined DSOK (echo     DeepSeek: 已配置) else (echo     DeepSeek: 未配置 / 待填)
echo.
echo [6] Model gateway (dynamic port)
rem The gateway uses a dynamic port; the PID marker identifies this session.
if exist "%ROOT%\data\run\gateway.pid" echo     gateway running; see startup window for dynamic port
if not exist "%ROOT%\data\run\gateway.pid" echo     gateway stopped; choose 1 or 2 in the menu to start it
echo.
echo [7] 前端补丁完整性
set "BUNDLE="
for /f "delims=" %%f in ('dir /b /o-n "%USBAI_RUNTIME%\node\node_modules\@cloudcli-ai\cloudcli\dist\assets\index-*.js" 2^>nul') do (
  if not defined BUNDLE set "BUNDLE=%%f"
)
if not defined BUNDLE (
  echo     找不到前端 bundle！
) else (
  set "MISSING="
  findstr /c:"wb-projects-block" "%USBAI_RUNTIME%\node\node_modules\@cloudcli-ai\cloudcli\dist\assets\%BUNDLE%" >nul 2>&1 || set "MISSING=!MISSING! 项目区"
  findstr /c:"wb-plus-menu" "%USBAI_RUNTIME%\node\node_modules\@cloudcli-ai\cloudcli\dist\assets\%BUNDLE%" >nul 2>&1 || set "MISSING=!MISSING! ＋菜单"
  findstr /c:"wb-autotitle" "%USBAI_RUNTIME%\node\node_modules\@cloudcli-ai\cloudcli\dist\assets\%BUNDLE%" >nul 2>&1 || set "MISSING=!MISSING! 自动命名"
  findstr /c:"wb-date-sep" "%USBAI_RUNTIME%\node\node_modules\@cloudcli-ai\cloudcli\dist\assets\%BUNDLE%" >nul 2>&1 || set "MISSING=!MISSING! 日期分组"
  if defined MISSING (
    echo     [警告] %BUNDLE% 缺少补丁:!MISSING!
    echo            请运行 python tools\build-frontend.py 重新构建
  ) else (
    echo     正常（%BUNDLE% 包含全部补丁）
  )
  rem --- 源码是否比 bundle 新（防"改了源码忘构建"）---
  powershell -NoProfile -Command "$p=(Get-ChildItem '%ROOT%\patches\frontend\*.js' -Exclude _* | Sort-Object LastWriteTime -Descending | Select-Object -First 1); $b=(Get-Item '%USBAI_RUNTIME%\node\node_modules\@cloudcli-ai\cloudcli\dist\assets\%BUNDLE%'); if ($p -and $p.LastWriteTime -gt $b.LastWriteTime) { exit 1 } else { exit 0 }" >nul 2>&1
  if errorlevel 1 (
    echo     [警告] patches\frontend 源码比 %BUNDLE% 新--有改动未构建！
    echo            请运行 python tools\build-frontend.py 后按 Ctrl+F5
  )
)
echo.
pause
