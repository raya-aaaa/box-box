# =========================================================
# BOX BOX: desktop shortcut
# ---------------------------------------------------------
# Draws the app icon (icon\box-box.ico + icon\box-box.png) and
# puts a "Box Box" shortcut on your Desktop that opens index.html
# in its own window (Chrome / Edge app mode: no address bar, no tabs).
#
# Run it again any time, e.g. after moving the folder or to
# recolour the icon for another team:
#   powershell -ExecutionPolicy Bypass -File create-shortcut.ps1 -Team mclaren
# =========================================================

param(
  [string]$Team = 'ferrari',      # team id from app.js: sets the icon's accent colour
  [ValidateSet('auto', 'edge', 'chrome')]
  [string]$Browser = 'auto'       # auto = your default browser if it's Chrome or Edge
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Add-Type -AssemblyName System.Drawing


# ---------- 1. Operating system ----------

if ([Environment]::OSVersion.Platform -ne 'Win32NT') {
  throw 'This script makes a Windows shortcut (.lnk). macOS and Linux need a different setup.'
}
Write-Host "Operating system: $((Get-CimInstance Win32_OperatingSystem).Caption)"


# ---------- 2. Browser ----------

# Finds an installed browser through the "App Paths" registry keys
function Find-Exe([string]$exe) {
  foreach ($hive in 'HKCU:', 'HKLM:') {
    $path = (Get-ItemProperty "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction SilentlyContinue).'(default)'
    if ($path -and (Test-Path $path)) { return $path }
  }
  return $null
}

$browsers = @{ edge = Find-Exe 'msedge.exe'; chrome = Find-Exe 'chrome.exe' }

if ($Browser -eq 'auto') {
  # Prefer your default browser: the app window then shares the tasks
  # saved when you open index.html with a double-click
  $default = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction SilentlyContinue).ProgId
  if ($default -like 'ChromeHTML*' -and $browsers.chrome) { $Browser = 'chrome' }
  elseif ($browsers.edge) { $Browser = 'edge' }
  else { $Browser = 'chrome' }
}

$browserExe = $browsers[$Browser]
if (-not $browserExe) { throw "Couldn't find $Browser. Install Chrome or Edge, or pick the other one with -Browser." }
Write-Host "Browser: $browserExe"


# ---------- 3. Team colour (read from app.js so it stays in sync) ----------

$teamLine = (Select-String -Path (Join-Path $root 'app.js') -Pattern "id: '$Team'" | Select-Object -First 1).Line
if (-not $teamLine) { throw "Unknown team '$Team'. Use an id from the TEAMS list in app.js, e.g. ferrari, mclaren, red-bull." }
# Same rule as the app: use the brighter `ui` colour when the team has one
if ($teamLine -match "ui: '(#[0-9A-Fa-f]{6})'" -or $teamLine -match "color: '(#[0-9A-Fa-f]{6})'") { $accentHex = $Matches[1] }
Write-Host "Accent: $Team $accentHex"


# ---------- 4. Icon ----------

$accent      = [System.Drawing.ColorTranslator]::FromHtml($accentHex)
$white       = [System.Drawing.ColorTranslator]::FromHtml('#F2F3F7')
$track       = [System.Drawing.ColorTranslator]::FromHtml('#2B303E')
$panelTop    = [System.Drawing.ColorTranslator]::FromHtml('#1C1F2A')
$panelBottom = [System.Drawing.ColorTranslator]::FromHtml('#07080C')
$purple      = [System.Drawing.ColorTranslator]::FromHtml('#B146FF')
$green       = [System.Drawing.ColorTranslator]::FromHtml('#22D36B')

function Get-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-RoundPen($color, [float]$width) {
  $pen = New-Object System.Drawing.Pen $color, $width
  $pen.StartCap = 'Round'
  $pen.EndCap = 'Round'
  return $pen
}

# Draws the icon on a 256x256 grid, scaled down to $size.
# A dark rounded square with a stopwatch whose lap arc is in the team colour,
# and three mini-sector bars (purple, green, team colour) like the timing tower.
# 32px and smaller get a bolder version without the small details.
function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.ScaleTransform($size / 256, $size / 256)
  $simple = $size -le 32

  # Background with a soft glow in the team colour
  $bg = Get-RoundedRect 8 8 240 240 56
  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 8), (New-Object System.Drawing.PointF 0, 248), $panelTop, $panelBottom
  $g.FillPath($bgBrush, $bg)
  $g.SetClip($bg)
  $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glowPath.AddEllipse(-40, -50, 336, 300)
  $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush $glowPath
  $glow.CenterColor = [System.Drawing.Color]::FromArgb(80, $accent)
  $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $accent))
  $g.FillPath($glow, $glowPath)
  $g.ResetClip()
  $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 255, 255, 255)), 2), $bg)

  # Stopwatch geometry
  if ($simple) { $cy = 140; $r = 74; $ring = 30; $hand = 20; $crownW = 60; $crownH = 28; $gap = 4 }
  else         { $cy = 124; $r = 62; $ring = 16; $hand = 10; $crownW = 40; $crownH = 16; $gap = 6 }
  $cx = 128
  $ringTop = $cy - $r - $ring / 2

  # Crown and its stem
  $whiteBrush = New-Object System.Drawing.SolidBrush $white
  $g.FillPath($whiteBrush, (Get-RoundedRect ($cx - $crownW / 2) ($ringTop - $gap - $crownH) $crownW $crownH ($crownH / 3)))
  $g.FillRectangle($whiteBrush, [float]($cx - $crownW / 6), [float]($ringTop - $gap - 1), [float]($crownW / 3), [float]($gap + 4))

  # Side button at 45 degrees
  if (-not $simple) {
    $saved = $g.Save()
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform(45)
    $g.FillPath($whiteBrush, (Get-RoundedRect -8 (-$r - $ring / 2 - 14) 16 14 4))
    $g.Restore($saved)
  }

  # Ring: dark track, then the lap arc in the team colour
  $box = New-Object System.Drawing.RectangleF ($cx - $r), ($cy - $r), (2 * $r), (2 * $r)
  $g.DrawEllipse((New-Object System.Drawing.Pen $track, $ring), $box)
  $sweep = 250
  $g.DrawArc((New-RoundPen $accent $ring), $box, -90, $sweep)

  # Hand pointing at the end of the arc, plus the centre cap
  $angle = (-90 + $sweep) * [Math]::PI / 180
  $length = $r * 0.62
  $g.DrawLine((New-RoundPen $white $hand), [float]$cx, [float]$cy, [float]($cx + $length * [Math]::Cos($angle)), [float]($cy + $length * [Math]::Sin($angle)))
  $dot = $hand * 0.95
  $g.FillEllipse($whiteBrush, [float]($cx - $dot), [float]($cy - $dot), [float](2 * $dot), [float](2 * $dot))

  # Mini-sector bars
  if (-not $simple) {
    $x = 58; $barW = 42; $barGap = 8; $y = 216
    foreach ($colour in $purple, $green, $accent) {
      $g.DrawLine((New-RoundPen $colour 12), [float]($x + 6), [float]$y, [float]($x + $barW - 6), [float]$y)
      $x += $barW + $barGap
    }
  }

  $g.Dispose()
  return $bmp
}

# Image data for one .ico entry: PNG for 256px (how Windows stores big icons),
# a classic 32-bit bitmap for the smaller sizes, which every part of Windows can read
function Get-IcoImage($bmp) {
  $size = $bmp.Width
  $ms = New-Object System.IO.MemoryStream
  if ($size -ge 256) {
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return , $ms.ToArray()
  }

  # Read the pixels (BGRA, top row first)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $data = $bmp.LockBits($rect, 'ReadOnly', [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $pixels = New-Object byte[] ($stride * $size)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $pixels.Length)
  $bmp.UnlockBits($data)

  $maskStride = [int][Math]::Ceiling($size / 32) * 4
  $w = New-Object System.IO.BinaryWriter $ms
  # BITMAPINFOHEADER: the height is doubled because colour rows are followed by mask rows
  $w.Write([UInt32]40); $w.Write([Int32]$size); $w.Write([Int32]($size * 2))
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]0)
  $w.Write([UInt32]($size * $size * 4 + $maskStride * $size))
  $w.Write([Int32]0); $w.Write([Int32]0); $w.Write([UInt32]0); $w.Write([UInt32]0)
  # Colour rows, bottom row first
  for ($y = $size - 1; $y -ge 0; $y--) { $w.Write($pixels, $y * $stride, $size * 4) }
  # Transparency mask, bottom row first: one bit per pixel, set where the pixel is fully transparent
  for ($y = $size - 1; $y -ge 0; $y--) {
    $row = New-Object byte[] $maskStride
    for ($x = 0; $x -lt $size; $x++) {
      if ($pixels[$y * $stride + $x * 4 + 3] -eq 0) { $row[$x -shr 3] = $row[$x -shr 3] -bor (0x80 -shr ($x -band 7)) }
    }
    $w.Write($row)
  }
  $w.Flush()
  return , $ms.ToArray()
}

# Writes all the sizes into one .ico file
function Save-Ico($bitmaps, [string]$path) {
  $images = foreach ($bmp in $bitmaps) { , (Get-IcoImage $bmp) }
  $writer = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($path))
  $writer.Write([UInt16]0)                 # reserved
  $writer.Write([UInt16]1)                 # type: icon
  $writer.Write([UInt16]$bitmaps.Count)
  $offset = 6 + 16 * $bitmaps.Count
  for ($i = 0; $i -lt $bitmaps.Count; $i++) {
    $size = $bitmaps[$i].Width
    $writer.Write([byte]($size % 256))     # width (0 means 256)
    $writer.Write([byte]($size % 256))     # height
    $writer.Write([byte]0)                 # palette colours
    $writer.Write([byte]0)                 # reserved
    $writer.Write([UInt16]1)               # colour planes
    $writer.Write([UInt16]32)              # bits per pixel
    $writer.Write([UInt32]$images[$i].Length)
    $writer.Write([UInt32]$offset)
    $offset += $images[$i].Length
  }
  foreach ($image in $images) { $writer.Write([byte[]]$image) }
  $writer.Close()
}

$iconDir = Join-Path $root 'icon'
New-Item -ItemType Directory -Force $iconDir | Out-Null
$icoPath = Join-Path $iconDir 'box-box.ico'
$pngPath = Join-Path $iconDir 'box-box.png'

$bitmaps = foreach ($size in 16, 24, 32, 48, 64, 128, 256) { New-IconBitmap $size }
Save-Ico $bitmaps $icoPath
$bitmaps[-1].Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)   # also the page favicon
$bitmaps | ForEach-Object { $_.Dispose() }
Write-Host "Icon: $icoPath"


# ---------- 5. Desktop shortcut ----------

$desktop = [Environment]::GetFolderPath('Desktop')   # follows OneDrive if the Desktop is synced there
$shortcutPath = Join-Path $desktop 'Box Box.lnk'
$url = ([Uri](Join-Path $root 'index.html')).AbsoluteUri

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $browserExe
$shortcut.Arguments = "--app=`"$url`""
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = "$icoPath,0"
$shortcut.Description = 'Box Box: your daily pit wall'
$shortcut.Save()

Write-Host "Shortcut: $shortcutPath"
Write-Host "Opens: $url"
