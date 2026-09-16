param([switch]$UseClash)
$ErrorActionPreference='Stop'
$bookingRoot=Split-Path $PSScriptRoot -Parent
$bookingExe=Join-Path $bookingRoot '.local\sync-venv\Scripts\mitmdump.exe'
if(!(Test-Path -LiteralPath $bookingExe)){throw 'Sync dependency missing: .local\sync-venv\Scripts\mitmdump.exe'}
$bookingListener=Get-NetTCPConnection -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue
if($bookingListener){
  $bookingProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($bookingListener[0].OwningProcess)"
  if($bookingProcess.Name -notin @('python.exe','mitmdump.exe') -or $bookingProcess.CommandLine -notmatch 'session_sync\.py'){throw 'Port 8899 belongs to another application. No process was stopped.'}
  if($UseClash -and $bookingProcess.CommandLine -notmatch 'upstream:http://127.0.0.1:17897'){throw 'Existing helper uses direct mode. Restart the helper in Clash mode; keep Clash running.'}
  Write-Output 'Session sync helper is already running. Reusing it.'
  exit 0
}
$bookingStamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$bookingLog=Join-Path $bookingRoot ".local\sync-$bookingStamp.err.log"
$bookingArguments='--listen-host 127.0.0.1 --listen-port 8899 --set confdir=.local/sync-ca --allow-hosts "^nswtt\.rim20\.com:443$" --set flow_detail=0 --set termlog_verbosity=error -s tools/session_sync.py'
if($UseClash){
  if(!(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 17897 -State Listen -ErrorAction SilentlyContinue)){throw 'Clash port 17897 is not running. Keep Clash open.'}
  $bookingArguments+=' --mode upstream:http://127.0.0.1:17897'
  Write-Output 'Route: applications -> sync 8899 -> Clash 17897 -> Internet. Keep Clash running.'
}
$bookingProcess=Start-Process -FilePath $bookingExe -ArgumentList $bookingArguments -WorkingDirectory $bookingRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $bookingRoot ".local\sync-$bookingStamp.out.log") -RedirectStandardError $bookingLog -PassThru
for($bookingAttempt=0;$bookingAttempt -lt 30;$bookingAttempt++){
  $bookingProcess.Refresh()
  if($bookingProcess.HasExited){throw "Sync helper exited. Check $bookingLog"}
  $bookingListener=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 8899 -State Listen -ErrorAction SilentlyContinue
  if($bookingListener){Write-Output 'Session sync helper is running in the background on 127.0.0.1:8899.';exit 0}
  Start-Sleep -Milliseconds 300
}
throw "Sync helper is not ready. Check $bookingLog"
