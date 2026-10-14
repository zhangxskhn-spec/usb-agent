@echo off
setlocal EnableExtensions
pushd "%~dp0.."
set "ROOT=%CD%"
popd
call "%~dp0runtime-home.bat"
if not defined USBAI_RUNTIME (echo    [ERROR] No usable runtime. & pause & exit /b 1)

set "HOME=%ROOT%\data\home"
set "USERPROFILE=%HOME%"
set "APPDATA=%HOME%\AppData\Roaming"
set "LOCALAPPDATA=%HOME%\AppData\Local"
set "TEMP=%HOME%\temp"
set "TMP=%TEMP%"
set "CLAUDE_CONFIG_DIR=%HOME%\.claude"
set "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
set "DISABLE_AUTOUPDATER=1"
set "CLAUDE_CODE_GIT_BASH_PATH=%USBAI_RUNTIME%\git\bin\bash.exe"
set "PATH=%USBAI_RUNTIME%\node;%USBAI_RUNTIME%\git\cmd;%PATH%"

for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ROOT%\config\keys.env") do (
  if not "%%~a"=="" set "%%~a=%%~b"
)
rem 数据区覆盖文件（密钥可与程序分离存放）：data\home\keys.env 存在时优先生效
if exist "%ROOT%\data\home\keys.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ROOT%\data\home\keys.env") do (
    if not "%%~a"=="" set "%%~a=%%~b"
  )
)
if not defined MIMO_MODEL set "MIMO_MODEL=mimo-v2.6-pro"
if not defined DEEPSEEK_MODEL set "DEEPSEEK_MODEL=deepseek-v4-pro"

rem 本脚本直连上游、不经过本地网关，[1m] 只是界面端的 1M 上下文标记，上游不认，必须剥掉
set "MIMO_MODEL=%MIMO_MODEL:[1m]=%"
set "DEEPSEEK_MODEL=%DEEPSEEK_MODEL:[1m]=%"

cd /d "%ROOT%\workspace"
echo ============================================
echo   连通性测试（分别给两个模型发一条消息）
echo ============================================
echo.

echo [测试 1] MiMo / %MIMO_MODEL%
if "%MIMO_API_KEY%"=="" (
  echo   跳过：未配置密钥
) else (
  set "ANTHROPIC_BASE_URL=https://api.xiaomimimo.com/anthropic"
  set "ANTHROPIC_AUTH_TOKEN=%MIMO_API_KEY%"
  set "ANTHROPIC_API_KEY="
  set "ANTHROPIC_MODEL=%MIMO_MODEL%"
  set "ANTHROPIC_DEFAULT_SONNET_MODEL=%MIMO_MODEL%"
  set "ANTHROPIC_DEFAULT_OPUS_MODEL=%MIMO_MODEL%"
  set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%MIMO_MODEL%"
  call claude -p "只回复两个字：正常"
)
echo.

echo [测试 2] DeepSeek / %DEEPSEEK_MODEL%
if "%DEEPSEEK_API_KEY%"=="" (
  echo   跳过：未配置密钥（请编辑 config\keys.env 填写）
) else (
  set "ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic"
  set "ANTHROPIC_AUTH_TOKEN=%DEEPSEEK_API_KEY%"
  set "ANTHROPIC_API_KEY="
  set "ANTHROPIC_MODEL=%DEEPSEEK_MODEL%"
  set "ANTHROPIC_DEFAULT_SONNET_MODEL=%DEEPSEEK_MODEL%"
  set "ANTHROPIC_DEFAULT_OPUS_MODEL=%DEEPSEEK_MODEL%"
  set "ANTHROPIC_DEFAULT_HAIKU_MODEL=%DEEPSEEK_MODEL%"
  call claude -p "只回复两个字：正常"
)
echo.
echo 测试结束。
pause
