param(
  [string]$DevEcoHome = 'C:\Program Files\Huawei\DevEco Studio',
  [ValidateSet('debug', 'release')][string]$Mode = 'debug'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $DevEcoHome 'tools\node\node.exe'
$hvigor = Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.js'
if (!(Test-Path $node) -or !(Test-Path $hvigor)) {
  throw 'DevEco Studio tools were not found. Set -DevEcoHome to your installation directory.'
}
$previousSdk = $env:DEVECO_SDK_HOME
$previousJava = $env:JAVA_HOME
$previousPath = $env:Path
try {
  $env:DEVECO_SDK_HOME = Join-Path $DevEcoHome 'sdk'
  $env:JAVA_HOME = Join-Path $DevEcoHome 'jbr'
  $env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + $previousPath
  Push-Location $root
  & $node $hvigor --mode module -p product=default -p module=entry@default -p buildMode=$Mode assembleHap --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "Hvigor failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
  $env:DEVECO_SDK_HOME = $previousSdk
  $env:JAVA_HOME = $previousJava
  $env:Path = $previousPath
}
