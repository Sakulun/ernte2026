<#
  Waage-Mitschnitt  -  findet die Terminal-IP per kurzem Netzwerk-Mitschnitt.

  Nutzt das in Windows eingebaute "pktmon" (kein Zusatzprogramm noetig),
  filtert gezielt auf die Direktleitung (Ethernet 2 / 169.254) und schneidet
  30 s mit. Wenn du in dieser Zeit das LAN-Kabel am Terminal kurz aus- und
  wieder einsteckst, verraet das Terminal beim Verbinden seine IP.

  Muss als ADMINISTRATOR laufen -> per "Waage-Mitschnitt.bat" starten.
#>
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $dir) { $dir = (Get-Location).Path }
$etl = Join-Path $dir 'PktMon.etl'
$txt = Join-Path $dir 'waage-mitschnitt.txt'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host 'FEHLER: Bitte ueber Waage-Mitschnitt.bat als Administrator starten.' -ForegroundColor Red; return }
if (-not (Get-Command pktmon.exe -ErrorAction SilentlyContinue)) { Write-Host 'FEHLER: pktmon nicht verfuegbar. Dann bitte Wireshark nutzen.' -ForegroundColor Red; return }

$myIps = @((Get-NetIPAddress -AddressFamily IPv4).IPAddress)

Write-Host '==================================================================='
Write-Host '  Waage-Mitschnitt  -  Terminal-IP am Direktkabel herausfinden' -ForegroundColor White
Write-Host '==================================================================='

# Direktleitung (Up + 169.254) + deren MAC bestimmen
$upIdx = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }).ifIndex
$termIf = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '169.254.*' -and $upIdx -contains $_.InterfaceIndex } | Select-Object -First 1
$compArgs = @()
if ($termIf) {
  $mac = (Get-NetAdapter -InterfaceIndex $termIf.InterfaceIndex).MacAddress.ToUpper()
  Write-Host ("  Direktleitung: {0}  (MAC {1})" -f $termIf.InterfaceAlias, $mac) -ForegroundColor Yellow
  $compId = $null
  foreach ($ln in (& pktmon list 2>$null)) { if ($ln -match '^\s*(\d+)\s+([0-9A-Fa-f-]{17})' -and $matches[2].ToUpper() -eq $mac) { $compId = $matches[1] } }
  if (-not $compId) { foreach ($ln in (& pktmon comp list 2>$null)) { if ($ln -match '^\s*(\d+)\s+([0-9A-Fa-f-]{17})' -and $matches[2].ToUpper() -eq $mac) { $compId = $matches[1] } } }
  if ($compId) { $compArgs = @('--comp', $compId); Write-Host ("  Mitschnitt nur auf Komponente {0}" -f $compId) -ForegroundColor DarkGray }
  else { Write-Host '  (Konnte Komponente nicht isolieren - schneide alles mit.)' -ForegroundColor DarkGray }
} else {
  Write-Host '  Keine aktive 169.254-Direktleitung gefunden - schneide alles mit.' -ForegroundColor DarkGray
}

Push-Location $dir
& pktmon stop 2>&1 | Out-Null
Remove-Item $etl, $txt -ErrorAction SilentlyContinue

$started = $false
foreach ($start in @((@('start', '--capture', '--pkt-size', '0') + $compArgs), (@('start', '--etw') + $compArgs), @('start', '--capture'), @('start', '--etw'))) {
  & pktmon @start 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $started = $true; break }
}
if (-not $started) { Pop-Location; Write-Host 'FEHLER: pktmon-Aufnahme liess sich nicht starten.' -ForegroundColor Red; return }

Write-Host ''
Write-Host '  >>> JETZT das LAN-Kabel AM TERMINAL abziehen und nach 3 Sek. wieder' -ForegroundColor Yellow
Write-Host '  >>> einstecken. Aufnahme laeuft 30 Sekunden ...' -ForegroundColor Yellow
for ($i = 30; $i -ge 1; $i--) { Write-Progress -Activity 'Mitschnitt laeuft' -Status "$i Sekunden" -PercentComplete ((30 - $i) / 30 * 100); Start-Sleep 1 }
Write-Progress -Activity 'Mitschnitt' -Completed

& pktmon stop 2>&1 | Out-Null
& pktmon format $etl -o $txt 2>&1 | Out-Null
if (-not (Test-Path $txt) -or (Get-Item $txt -ErrorAction SilentlyContinue).Length -lt 10) { & pktmon etl2txt $etl -o $txt 2>&1 | Out-Null }
Pop-Location

if (-not (Test-Path $txt)) { Write-Host 'Konnte den Mitschnitt nicht auswerten.' -ForegroundColor Red; return }

$counts = @{}
$re = [regex]'(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])'
Get-Content $txt | ForEach-Object {
  foreach ($m in $re.Matches($_)) {
    $ip = $m.Value; $fo = [int]$m.Groups[1].Value; $lo = [int]$m.Groups[4].Value
    if ($fo -lt 1 -or $fo -ge 224 -or $fo -eq 127) { continue }
    if ($lo -eq 0 -or $lo -eq 255) { continue }
    if ($myIps -contains $ip) { continue }
    $counts[$ip] = ([int]$counts[$ip] + 1)
  }
}

Write-Host ''
Write-Host '==================================================================='
if ($counts.Count) {
  Write-Host '  Gegenstellen-IPs im Mitschnitt (Haeufigkeit) - eine davon ist die Waage:' -ForegroundColor Green
  $counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 15 | ForEach-Object { Write-Host ("     {0,-16} {1}x" -f $_.Key, $_.Value) -ForegroundColor Green }
} else {
  Write-Host '  Keine fremde IP im Mitschnitt gefunden.' -ForegroundColor Yellow
  Write-Host '  Das Terminal sendet von sich aus nichts Auswertbares.'
  Write-Host '  -> Dann hilft nur die konfigurierte IP aus der Inbetriebnahme-Doku'
  Write-Host '     bzw. vom Waagen-Monteur (und pruefen, ob die Ethernet-Ausgabe'
  Write-Host '     am Disomat ueberhaupt aktiviert ist).'
}
Write-Host ("  Volltext-Datei: {0}" -f $txt)
Write-Host '  (Diese Datei kannst du mir schicken - ich lese die Terminal-IP raus.)'
Write-Host '==================================================================='
