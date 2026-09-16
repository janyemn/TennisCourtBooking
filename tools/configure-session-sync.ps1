param([switch]$Restore)
$ErrorActionPreference='Stop'
$bookingRoot=Split-Path $PSScriptRoot -Parent
$bookingBackup=Join-Path $bookingRoot '.local/sync-network-backup.json'
$bookingKey='HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
if($Restore){
  if(!(Test-Path -LiteralPath $bookingBackup)){throw 'No saved proxy settings'}
  $bookingOld=Get-Content -LiteralPath $bookingBackup -Raw | ConvertFrom-Json
  foreach($bookingName in @('ProxyEnable','ProxyServer','ProxyOverride','AutoConfigURL')){
    $bookingValue=$bookingOld.values.$bookingName
    if($null -eq $bookingValue){Remove-ItemProperty -LiteralPath $bookingKey -Name $bookingName -ErrorAction SilentlyContinue}
    else{Set-ItemProperty -LiteralPath $bookingKey -Name $bookingName -Value $bookingValue}
  }
  if($bookingOld.addedCert){Remove-Item -LiteralPath ('Cert:\CurrentUser\Root\'+$bookingOld.thumbprint) -ErrorAction SilentlyContinue}
}else{
  if(Test-Path -LiteralPath $bookingBackup){throw 'Backup exists. Restore previous setup before configuring again.'}
  $bookingCertPath=Join-Path $bookingRoot '.local/sync-ca/mitmproxy-ca-cert.cer'
  $bookingCert=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($bookingCertPath)
  $bookingValues=@{};$bookingOriginal=Get-ItemProperty -LiteralPath $bookingKey
  foreach($bookingName in @('ProxyEnable','ProxyServer','ProxyOverride','AutoConfigURL')){$bookingValues[$bookingName]=$bookingOriginal.$bookingName}
  $bookingAdded=!(Test-Path -LiteralPath ('Cert:\CurrentUser\Root\'+$bookingCert.Thumbprint))
  @{values=$bookingValues;thumbprint=$bookingCert.Thumbprint;addedCert=$bookingAdded}|ConvertTo-Json -Depth 5|Set-Content -LiteralPath $bookingBackup -Encoding utf8
  if($bookingAdded){Import-Certificate -FilePath $bookingCertPath -CertStoreLocation 'Cert:\CurrentUser\Root'|Out-Null}
  Set-ItemProperty -LiteralPath $bookingKey -Name ProxyEnable -Value 1
  Set-ItemProperty -LiteralPath $bookingKey -Name ProxyServer -Value '127.0.0.1:8899'
  Set-ItemProperty -LiteralPath $bookingKey -Name ProxyOverride -Value 'localhost;127.*;<local>'
  Remove-ItemProperty -LiteralPath $bookingKey -Name AutoConfigURL -ErrorAction SilentlyContinue
}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class BookingProxyNotify { [DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l); }'
[BookingProxyNotify]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null
[BookingProxyNotify]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null
Write-Output 'Proxy settings applied. Restart the mini-program if needed.'
