param([switch]$NoOpen)
$ErrorActionPreference='Stop'
$bookingRoot=Split-Path $PSScriptRoot -Parent
$bookingNode=(Get-Command node -ErrorAction SilentlyContinue).Source
if(!$bookingNode){$bookingNode='C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
if(!(Test-Path -LiteralPath $bookingNode)){throw 'Node.js not found. Install Node.js 20 or later.'}
$bookingListener=Get-NetTCPConnection -LocalPort 3827 -State Listen -ErrorAction SilentlyContinue
if($bookingListener){
  $bookingProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($bookingListener[0].OwningProcess)"
  if($bookingProcess.Name -ne 'node.exe' -or $bookingProcess.CommandLine -notmatch 'app[/\\]server.mjs'){throw 'Port 3827 belongs to another application.'}
}else{
  $bookingLocal=Join-Path $bookingRoot '.local'
  New-Item -ItemType Directory -Path $bookingLocal -Force|Out-Null
  $bookingStamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  Start-Process -FilePath $bookingNode -ArgumentList 'app/server.mjs' -WorkingDirectory $bookingRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bookingLocal "server-$bookingStamp.out.log") -RedirectStandardError (Join-Path $bookingLocal "server-$bookingStamp.err.log")|Out-Null
}
$bookingReady=$false
for($bookingAttempt=0;$bookingAttempt -lt 20;$bookingAttempt++){
  try{
    $bookingReply=Invoke-RestMethod -Uri 'http://127.0.0.1:3827/api/bootstrap' -TimeoutSec 2
    if($null -ne $bookingReply.configured){$bookingReady=$true;break}
  }catch{}
  Start-Sleep -Milliseconds 250
}
if(!$bookingReady){throw 'Startup failed. Check .local/server-*.err.log.'}
Write-Output 'Booking service is running in the background: http://127.0.0.1:3827/'
if(!$NoOpen){Start-Process 'http://127.0.0.1:3827/'}
