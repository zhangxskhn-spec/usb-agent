<#
  usb-eject.ps1 —— 智能释放并弹出 U 盘（独立运行，不依赖包内 node/runtime）

  一般不用手敲，双击同目录的 usb-eject.bat 就行。直接调用：
    powershell -NoProfile -ExecutionPolicy Bypass -File usb-eject.ps1 -Drive E:
    ... -Check     只诊断：扫出谁在占用 + 做一次"能不能弹"的权威判定，不结束任何进程
    ... -NoKill    不结束进程，直接尝试弹出
    ... -Force     锁定失败时，追加 mountvol /p 强制下线（可绕过顽固句柄，会清掉盘符）

  为什么要它：Windows 只会说"该设备正在使用中"，不会告诉你持有者是谁。
  本脚本分三层扫描找出真正的持有者：
    ① 命令行 / 可执行文件路径指向该盘
    ② 从该盘加载了 DLL/EXE（模块扫描，能抓到"命令行里一个字都没有"的后台进程）
    ③ 进程的当前工作目录在该盘（读 PEB；这一层连 Process Explorer 之外的
       工具都常常漏掉，而 cmd 窗口只要 CWD 停在 U 盘上就会一直锁着卷）
  最后用 FSCTL_LOCK_VOLUME 做权威判定 —— 这正是"安全删除硬件"内部用的同一把锁，
  锁得上就一定能弹，锁不上就是真的还有句柄。
#>
[CmdletBinding()]
param(
  [string]$Drive = '',
  [switch]$Check,
  [switch]$NoKill,
  [switch]$Force
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Off

# ============================== 小工具 ==============================
function Write-Head([string]$t) {
  Write-Host ''
  Write-Host ('=' * 62) -ForegroundColor DarkGray
  Write-Host "  $t" -ForegroundColor Cyan
  Write-Host ('=' * 62) -ForegroundColor DarkGray
}
function Write-Ok([string]$t)   { Write-Host "[OK]   $t" -ForegroundColor Green }
function Write-Bad([string]$t)  { Write-Host "[!!]   $t" -ForegroundColor Red }
function Write-Warn2([string]$t){ Write-Host "[警告] $t" -ForegroundColor Yellow }
function Write-Info([string]$t) { Write-Host "       $t" -ForegroundColor Gray }

function Get-Win32Text([int]$code) {
  if ($code -eq 0) { return '成功' }
  try { return (New-Object ComponentModel.Win32Exception($code)).Message } catch { return "Win32 错误 $code" }
}

# ============================== 原生调用 ==============================
$nativeCs = @'
using System;
using System.Runtime.InteropServices;

public static class UsbEjectNative
{
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateFileW(string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition, uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool DeviceIoControl(IntPtr hDevice, uint dwIoControlCode, IntPtr lpInBuffer,
        uint nInBufferSize, IntPtr lpOutBuffer, uint nOutBufferSize, out uint lpBytesReturned, IntPtr lpOverlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr lpBaseAddress, byte[] lpBuffer,
        int dwSize, out IntPtr lpNumberOfBytesRead);

    [DllImport("ntdll.dll")]
    public static extern int NtQueryInformationProcess(IntPtr hProcess, int infoClass, byte[] info, int infoLength,
        out int returnLength);

    public const uint GENERIC_READ  = 0x80000000;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_READ   = 0x00000001;
    public const uint FILE_SHARE_WRITE  = 0x00000002;
    public const uint FILE_SHARE_DELETE = 0x00000004;
    public const uint OPEN_EXISTING = 3;

    public const uint FSCTL_LOCK_VOLUME     = 0x00090018;
    public const uint FSCTL_UNLOCK_VOLUME   = 0x0009001C;
    public const uint FSCTL_DISMOUNT_VOLUME = 0x00090020;
    public const uint IOCTL_STORAGE_MEDIA_REMOVAL = 0x002D4804;
    public const uint IOCTL_STORAGE_EJECT_MEDIA   = 0x002D4808;

    static readonly IntPtr INVALID = (IntPtr)(-1);

    static IntPtr OpenVolume(string volume)
    {
        return CreateFileW(volume, GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
    }

    // 只做"能不能弹"的判定：锁上再解锁，不改变任何状态
    public static bool TestLock(string volume, out int win32Error)
    {
        win32Error = 0;
        IntPtr h = OpenVolume(volume);
        if (h == INVALID) { win32Error = Marshal.GetLastWin32Error(); return false; }
        try
        {
            uint br;
            if (!DeviceIoControl(h, FSCTL_LOCK_VOLUME, IntPtr.Zero, 0, IntPtr.Zero, 0, out br, IntPtr.Zero))
            {
                win32Error = Marshal.GetLastWin32Error();
                return false;
            }
            DeviceIoControl(h, FSCTL_UNLOCK_VOLUME, IntPtr.Zero, 0, IntPtr.Zero, 0, out br, IntPtr.Zero);
            return true;
        }
        finally { CloseHandle(h); }
    }

    // 真正弹出：锁定 -> 允许移除介质 -> 卸载卷 -> 弹出介质
    public static bool EjectVolume(string volume, out int win32Error, out string stage)
    {
        win32Error = 0; stage = "";
        IntPtr h = OpenVolume(volume);
        if (h == INVALID) { win32Error = Marshal.GetLastWin32Error(); stage = "打开卷"; return false; }
        try
        {
            uint br;
            stage = "锁定卷";
            if (!DeviceIoControl(h, FSCTL_LOCK_VOLUME, IntPtr.Zero, 0, IntPtr.Zero, 0, out br, IntPtr.Zero))
            { win32Error = Marshal.GetLastWin32Error(); return false; }

            stage = "允许移除介质";
            IntPtr buf = Marshal.AllocHGlobal(1);
            Marshal.WriteByte(buf, 0);
            try
            {
                if (!DeviceIoControl(h, IOCTL_STORAGE_MEDIA_REMOVAL, buf, 1, IntPtr.Zero, 0, out br, IntPtr.Zero))
                { win32Error = Marshal.GetLastWin32Error(); return false; }
            }
            finally { Marshal.FreeHGlobal(buf); }

            stage = "卸载卷";
            if (!DeviceIoControl(h, FSCTL_DISMOUNT_VOLUME, IntPtr.Zero, 0, IntPtr.Zero, 0, out br, IntPtr.Zero))
            { win32Error = Marshal.GetLastWin32Error(); return false; }

            stage = "弹出介质";
            if (!DeviceIoControl(h, IOCTL_STORAGE_EJECT_MEDIA, IntPtr.Zero, 0, IntPtr.Zero, 0, out br, IntPtr.Zero))
            { win32Error = Marshal.GetLastWin32Error(); return false; }

            DeviceIoControl(h, FSCTL_UNLOCK_VOLUME, IntPtr.Zero, 0, IntPtr.Zero, 0, out br, IntPtr.Zero);
            return true;
        }
        finally { CloseHandle(h); }
    }

    // 读别的进程的当前工作目录（PEB -> ProcessParameters -> CurrentDirectory）
    public static string GetProcessCwd(int pid)
    {
        IntPtr h = OpenProcess(0x0410, false, pid);   // QUERY_INFORMATION | VM_READ
        if (h == IntPtr.Zero) { return null; }
        try
        {
            byte[] pbi = new byte[48];
            int ret;
            if (NtQueryInformationProcess(h, 0, pbi, pbi.Length, out ret) != 0) { return null; }
            long peb = BitConverter.ToInt64(pbi, 8);
            if (peb == 0) { return null; }

            byte[] p8 = new byte[8];
            IntPtr read;
            if (!ReadProcessMemory(h, (IntPtr)(peb + 0x20), p8, 8, out read)) { return null; }
            long pp = BitConverter.ToInt64(p8, 0);
            if (pp == 0) { return null; }

            byte[] us = new byte[16];   // UNICODE_STRING @ ProcessParameters+0x38
            if (!ReadProcessMemory(h, (IntPtr)(pp + 0x38), us, 16, out read)) { return null; }
            int len = BitConverter.ToUInt16(us, 0);
            long strp = BitConverter.ToInt64(us, 8);
            if (len <= 0 || len > 4096 || strp == 0) { return null; }

            byte[] sb = new byte[len];
            if (!ReadProcessMemory(h, (IntPtr)strp, sb, len, out read)) { return null; }
            return System.Text.Encoding.Unicode.GetString(sb);
        }
        catch { return null; }
        finally { CloseHandle(h); }
    }
}
'@

try {
  Add-Type -TypeDefinition $nativeCs -ErrorAction Stop
} catch {
  Write-Bad "内部组件编译失败：$($_.Exception.Message)"
  Write-Info "（.NET Framework 缺失或被安全软件拦截时会出现这种情况）"
  exit 2
}

# ============================== 解析目标盘 ==============================
if (-not $Drive) {
  # 没给就用本脚本所在盘（双击场景：脚本被拷到 %TEMP% 时由 .bat 显式传 -Drive）
  $Drive = [System.IO.Path]::GetPathRoot($PSScriptRoot)
}
$Drive = $Drive.Trim()
if ($Drive.Length -eq 1) { $Drive = $Drive + ':' }
if ($Drive.EndsWith('\')) { $Drive = $Drive.TrimEnd('\') }
if ($Drive -notmatch '^[A-Za-z]:$') {
  Write-Bad "盘符不合法：$Drive（应该像 E: 这样）"
  exit 2
}
$Letter    = $Drive.Substring(0, 1).ToUpper()
$Drive     = $Letter + ':'
$DriveRoot = $Letter + ':\'
$Volume    = '\\.\' + $Drive

Write-Head "释放并弹出 U 盘 —— 目标 $Drive"

# 盘符体检：必须是可移动盘，且不是系统盘
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$Drive'" -ErrorAction SilentlyContinue
if (-not $disk) {
  Write-Bad "$Drive 不存在（没插好？盘符变了？）"
  exit 2
}
Write-Info ("卷标：{0}   文件系统：{1}   剩余：{2} GB" -f `
  $(if ($disk.VolumeName) { $disk.VolumeName } else { '(无)' }), $disk.FileSystem,
  [Math]::Round($disk.FreeSpace / 1GB, 1))

if ($disk.DriveType -ne 2) {
  $dt = switch ($disk.DriveType) { 3 { '本地固定磁盘' } 4 { '网络驱动器' } 5 { '光驱' } default { "类型 $($disk.DriveType)" } }
  Write-Warn2 "$Drive 是「$dt」，不是可移动盘。为安全起见，本脚本不弹出固定磁盘。"
  if (-not $Check) { exit 1 }
}
if ($Letter -eq $env:SystemDrive.Substring(0, 1)) {
  Write-Bad "$Drive 是系统盘，绝对不能弹。"
  exit 1
}

# 把自己挪出目标盘 —— 否则这个窗口自己就是占用者（最容易踩的坑）
$before = (Get-Location).Path
try { Set-Location -LiteralPath $env:SystemRoot } catch {}
try { [Environment]::CurrentDirectory = $env:SystemRoot } catch {}
$after = (Get-Location).Path
if ($before -and $before.ToUpper().StartsWith($DriveRoot)) {
  Write-Info "已把本窗口的工作目录从 $before 挪到 $after（原来的目录本身就锁着 U 盘）"
}

if ([IntPtr]::Size -ne 8) {
  Write-Warn2 '这是 32 位 PowerShell，读 64 位进程的工作目录会失败，建议用系统自带的 64 位 powershell.exe。'
}

# ============================== 扫描占用者 ==============================
function Get-AncestorSet {
  $all = @{}
  foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
    $all[[int]$p.ProcessId] = [int]$p.ParentProcessId
  }
  $set = @{}
  $cur = $PID
  for ($i = 0; $i -lt 12 -and $cur -gt 0; $i++) {
    $set[$cur] = $true
    if (-not $all.ContainsKey($cur)) { break }
    $cur = [int]$all[$cur]
  }
  return $set
}

function Get-Holders {
  param([hashtable]$Ancestors)

  $found = @{}          # pid -> [pscustomobject]
  function Add-One($pid_, $name, $reason, $detail) {
    if ($Ancestors.ContainsKey([int]$pid_)) { return }         # 绝不碰自己这条进程链
    if (-not $found.ContainsKey([int]$pid_)) {
      $found[[int]$pid_] = [pscustomobject]@{ Pid = [int]$pid_; Name = $name; Reason = $reason; Detail = $detail }
    } elseif ($found[[int]$pid_].Reason -notlike "*$reason*") {
      $found[[int]$pid_].Reason = $found[[int]$pid_].Reason + ' + ' + $reason
    }
  }

  $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)

  # ① 命令行 / 可执行文件路径指向该盘
  foreach ($p in $procs) {
    $cmd = [string]$p.CommandLine
    $exe = [string]$p.ExecutablePath
    if ($cmd -and $cmd.ToUpper().Contains($DriveRoot)) {
      Add-One $p.ProcessId $p.Name '命令行指向该盘' $cmd.Substring(0, [Math]::Min(150, $cmd.Length))
    } elseif ($exe -and $exe.ToUpper().StartsWith($DriveRoot)) {
      Add-One $p.ProcessId $p.Name '可执行文件在该盘' $exe
    }
  }

  # ② 从该盘加载了 DLL/EXE（后台常驻进程的关键检测手段）
  foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
    try {
      $hit = $p.Modules | Where-Object { $_.FileName -and $_.FileName.ToUpper().StartsWith($DriveRoot) } | Select-Object -First 1
      if ($hit) { Add-One $p.Id $p.ProcessName '已加载该盘上的文件' $hit.FileName }
    } catch {}
  }

  # ③ 工作目录停在该盘（cmd/终端窗口最常见的元凶）
  foreach ($p in $procs) {
    $cwd = [UsbEjectNative]::GetProcessCwd([int]$p.ProcessId)
    if ($cwd -and $cwd.ToUpper().StartsWith($DriveRoot)) {
      Add-One $p.ProcessId $p.Name '工作目录停在该盘' $cwd
    }
  }

  # ④ 包内的 pid 文件（网关/监督者/浏览器）
  foreach ($f in @('gateway.pid', 'gw-watch.pid', 'browser.pid', 'hold.pid')) {
    $pf = Join-Path $DriveRoot "data\run\$f"
    if (Test-Path -LiteralPath $pf) {
      $txt = (Get-Content -LiteralPath $pf -ErrorAction SilentlyContinue | Select-Object -First 1)
      $n = 0
      if ([int]::TryParse(([string]$txt).Trim(), [ref]$n) -and $n -gt 0) {
        if (Get-Process -Id $n -ErrorAction SilentlyContinue) {
          $pn = (Get-Process -Id $n).ProcessName
          Add-One $n $pn "包内 $f 记录" "PID $n"
        }
      }
    }
  }

  return @($found.Values | Sort-Object Pid)
}

# 关掉停在目标盘上的资源管理器窗口（不杀 explorer 本身）
function Close-ExplorerWindows {
  $closed = 0
  try {
    $shell = New-Object -ComObject Shell.Application
    $prefix = "FILE:///$Letter"        # LocationURL 形如 file:///E:/xxx
    foreach ($w in @($shell.Windows())) {
      try {
        $loc = [string]$w.LocationURL
        if ($loc -and $loc.ToUpper().StartsWith($prefix)) { $w.Quit(); $closed++ }
      } catch {}
    }
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
  } catch {}
  return $closed
}

$ancestors = Get-AncestorSet
$round = 0
$holders = @(Get-Holders -Ancestors $ancestors)

Write-Head "第 1 轮扫描：谁在占用 $Drive"
if ($holders.Count -eq 0) {
  Write-Ok '三层扫描都没发现占用者。'
} else {
  Write-Host ("       发现 {0} 个占用进程：" -f $holders.Count) -ForegroundColor Yellow
  foreach ($h in $holders) {
    Write-Host ("   PID {0,-7} {1,-22} {2}" -f $h.Pid, $h.Name, $h.Reason) -ForegroundColor Yellow
    if ($h.Detail) { Write-Info ("        {0}" -f $h.Detail) }
  }
}

$win = Close-ExplorerWindows
if ($win -gt 0) { Write-Info "顺手关掉了 $win 个停在 $Drive 上的资源管理器窗口（它们持有目录句柄）。" }

# ============================== 结束占用 ==============================
if (-not $Check -and -not $NoKill -and $holders.Count -gt 0) {
  Write-Head '结束占用进程'
  foreach ($h in $holders) {
    try {
      Stop-Process -Id $h.Pid -Force -ErrorAction Stop
      Write-Host ("   已结束  PID {0,-7} {1}  ({2})" -f $h.Pid, $h.Name, $h.Reason) -ForegroundColor DarkYellow
    } catch {
      Write-Warn2 ("结束 PID {0} ({1}) 失败：{2}" -f $h.Pid, $h.Name, $_.Exception.Message)
    }
  }

  # 复查三轮，直到干净（句柄回收有延迟）
  for ($round = 1; $round -le 3; $round++) {
    Start-Sleep -Milliseconds (900 * $round)
    $left = @(Get-Holders -Ancestors $ancestors)
    if ($left.Count -eq 0) { break }
    Write-Info "第 $($round + 1) 轮复查：还剩 $($left.Count) 个，再清一次…"
    foreach ($h in $left) { try { Stop-Process -Id $h.Pid -Force -ErrorAction Stop } catch {} }
  }
  $holders = @(Get-Holders -Ancestors $ancestors)
  if ($holders.Count -eq 0) { Write-Ok '占用进程已全部结束。' }
  else {
    Write-Warn2 "还有 $($holders.Count) 个没结束（通常是被杀毒软件保护或需要管理员权限）："
    foreach ($h in $holders) { Write-Info ("PID {0,-7} {1}  {2}" -f $h.Pid, $h.Name, $h.Reason) }
  }
} elseif ($Check) {
  Write-Info '（-Check：不结束任何进程）'
} elseif ($NoKill) {
  Write-Info '（-NoKill：跳过结束进程）'
} else {
  Write-Info '（没有需要结束的进程）'
}

# ============================== 先停掉「惯犯」搜索索引 ==============================
# Windows 搜索索引读的是整盘，是「扫描看不到持有者、却死活弹不出」的头号常客。
# 它随时会自己重启，停掉零副作用。
if (-not $Check) {
  $idxNames = @('searchindexer', 'searchprotocolhost', 'searchfilterhost')
  $idx = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $idxNames -contains $_.ProcessName.ToLower() })
  if ($idx.Count -gt 0) {
    Write-Info ("停掉 {0} 个 Windows 搜索索引进程（系统会自动重启它们）…" -f $idx.Count)
    foreach ($p in $idx) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch {} }
    Start-Sleep -Milliseconds 1500
  }
}

# ============================== 权威判定：能不能弹 ==============================
Write-Head '权威判定（FSCTL_LOCK_VOLUME）'
Write-Info '这是「安全删除硬件」内部用的同一把锁：锁得上就一定能弹。'

$lockErr = 0
Start-Sleep -Milliseconds 1200     # 等外层 .bat 自己退干净，别把自己的句柄算进来
$canLock = [UsbEjectNative]::TestLock($Volume, [ref]$lockErr)

if ($canLock) {
  Write-Ok "$Drive 当前没有任何东西占用，可以安全弹出。"
} else {
  Write-Warn2 ("锁定失败（Win32 {0}：{1}）" -f $lockErr, (Get-Win32Text $lockErr))
  switch ($lockErr) {
    5  { Write-Info '  5 = 拒绝访问。实测最常见：①该盘上的程序还在运行（可执行文件被映射，进程一退就好）；'
         Write-Info '       ②杀毒软件正在扫该盘；③有别人以管理员权限打开的句柄。' }
    19 { Write-Info ' 19 = 写保护：介质被设成不可写（部分 U 盘有物理写保护开关）。' }
    32 { Write-Info ' 32 = 共享冲突：还有进程开着该盘上的文件。' }
    33 { Write-Info ' 33 = 区域已锁定：别的程序（多为杀毒 / 同步 / 备份 / 虚拟机）正独占该卷。' }
    21 { Write-Info ' 21 = 设备未就绪：介质被抽走，或系统正在重置该设备。' }
  }

  # 已知惯犯：即使三层扫描看不到，它们也常年锁着 U 盘（仅供参考，不自动结束）
  $usualNames = @('msmpeng', 'nissrv', 'onedrive', 'dropbox', 'baidunetdisk', 'sogoucloud', 'wpscloudsvr',
                  'qqprotect', 'qhsafetray', 'everything', 'listary', 'sync', 'vmware', 'vboxsvc')
  $usual = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $usualNames -contains $_.ProcessName.ToLower() })
  if ($usual.Count -gt 0) {
    Write-Host '       另外这些「惯犯」正在运行，可能持有扫描看不到的句柄：' -ForegroundColor Yellow
    foreach ($p in $usual) { Write-Info ("PID {0,-7} {1}" -f $p.Id, $p.ProcessName) }
  }

  Write-Info '建议：'
  Write-Info '  1) 先关掉所有打开着 U 盘目录的资源管理器 / 压缩软件 / 编辑器窗口；'
  Write-Info '  2) 关掉启动器的黑窗（它的工作目录就在 U 盘上）；'
  Write-Info '  3) 暂停杀毒软件对 U 盘的实时扫描，等 10 秒再试；'
  Write-Info "  4) 仍不行就用 -Force（mountvol $Drive /p 强制下线，会清掉盘符）；"
  Write-Info '  5) 还不行只能注销/重启。'
}

# ============================== 弹出 ==============================
if (-not $Check) {
  Write-Head '弹出'
  if ($canLock) {
    $verr = 0; $stage = ''
    $ok = [UsbEjectNative]::EjectVolume($Volume, [ref]$verr, [ref]$stage)
    if ($ok) {
      Write-Ok "已弹出：$Drive 现在可以拔下来了。"
    } else {
      Write-Bad ("在「{0}」这一步失败（Win32 {1}：{2}）" -f $stage, $verr, (Get-Win32Text $verr))
      Write-Info '多数 U 盘没有物理弹出机构，这属于正常现象；上面既然判定可锁定，直接拔即可。'
    }
  } else {
    Write-Bad '锁定失败，没有尝试弹出（强行弹可能丢数据）。'

    if ($Force) {
      Write-Head "强制下线（mountvol $Drive /p）"
      Write-Warn2 '这会把盘符直接摘掉、卷离线；如果有写到一半的数据可能丢失。'
      $out = & mountvol "$Drive" /p 2>&1
      $rc = $LASTEXITCODE
      if ($rc -eq 0) {
        Write-Ok "$Drive 已强制下线，现在可以拔下来了。"
      } else {
        Write-Bad "mountvol 失败（退出码 $rc）："
        $out | ForEach-Object { Write-Info $_ }
        Write-Info '如果提示拒绝访问，请用「以管理员身份运行」再执行一次本工具。'
      }
    } else {
      Write-Info '加 -Force 可以强试一次 mountvol /p（会清掉盘符）。'
    }
  }
}

Write-Host ''
