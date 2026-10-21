param([string]$Marker, [ValidateSet('open')][string]$Action = 'open')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$children = [System.Windows.Automation.TreeScope]::Children
$descendants = [System.Windows.Automation.TreeScope]::Descendants
function By-Class([string]$name) { return [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ClassNameProperty, $name) }
$taskbar = $root.FindFirst($children, (By-Class 'Shell_TrayWnd'))
if (!$taskbar) { throw 'Windows taskbar was not found' }
$trayButton = $taskbar.FindAll($descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name.Contains($Marker) } | Select-Object -First 1
if (!$trayButton) {
  $overflow = $root.FindFirst($children, (By-Class 'TopLevelWindowForOverflowXamlIsland'))
  if (!$overflow -or $overflow.Current.IsOffscreen) {
    $more = $taskbar.FindAll($descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -match '显示隐藏的图标|Show hidden icons' } | Select-Object -First 1
    if (!$more) { throw 'Tray overflow button was not found' }
    $more.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    $overflow = $root.FindFirst($children, (By-Class 'TopLevelWindowForOverflowXamlIsland'))
  }
  if ($overflow) { $trayButton = $overflow.FindAll($descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name.Contains($Marker) } | Select-Object -First 1 }
}
if (!$trayButton) { throw "SubCal verification tray icon was not found: $Marker" }
$trayButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Write-Output 'Native Windows tray icon invoked'
