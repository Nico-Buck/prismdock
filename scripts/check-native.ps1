# Compiles the native code without running it: the C# inside helper.ps1 and the guardian (guard.cs).
# Catches errors that would otherwise only show up when PrismDock starts. Nothing touches the taskbar.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-native.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$helper = Join-Path $root 'src\main\native\helper.ps1'

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($helper, [ref]$tokens, [ref]$errors)
if ($errors) { $errors | ForEach-Object { Write-Error $_.ToString() }; exit 1 }

# the C# of the helper is the here-string assigned to $src
$src = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$src' }, $true) | Select-Object -First 1
if (-not $src) { Write-Error 'no $src block found in helper.ps1'; exit 1 }
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition $src.Right.Expression.Value -ReferencedAssemblies System.Drawing -Language CSharp
Write-Output 'helper.ps1: C# compiles'

$out = Join-Path ([IO.Path]::GetTempPath()) ("prism-guard-check-" + [Guid]::NewGuid().ToString('N') + '.exe')
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $root 'src\main\native\guard.cs'))) -OutputAssembly $out -OutputType WindowsApplication
Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
Write-Output 'guard.cs: compiles'
