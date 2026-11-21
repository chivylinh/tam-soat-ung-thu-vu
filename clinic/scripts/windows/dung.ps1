# Dung tien trinh node dang chay phan mem phong kham
$p = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*src\server.js*' }
if ($p) {
  $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Write-Host 'Da dung phan mem.'
} else {
  Write-Host 'Phan mem khong chay.'
}
