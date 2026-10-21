param([Parameter(Mandatory=$true)][string]$WindowHandle,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SubCalCapture {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
# Per-monitor awareness makes the capture rectangle physical pixels at Windows 150%.
[void][SubCalCapture]::SetThreadDpiAwarenessContext([IntPtr](-4))
$handle = [IntPtr]::new([Int64]$WindowHandle)
if ($handle -eq [IntPtr]::Zero) { throw 'SubCal supplied an empty native window handle.' }
$rect = New-Object SubCalCapture+Rect
if (-not [SubCalCapture]::GetWindowRect($handle,[ref]$rect)) { throw 'GetWindowRect failed.' }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap($width,$height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $hdc = $graphics.GetHdc()
  try { if (-not [SubCalCapture]::PrintWindow($handle,$hdc,2)) { throw 'Unoccluded native window capture failed.' } }
  finally { $graphics.ReleaseHdc($hdc) }
  $bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png)
  @{width=$width;height=$height;dpi=[SubCalCapture]::GetDpiForWindow($handle);file=$OutputPath} | ConvertTo-Json -Compress
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
