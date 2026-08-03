<#
  Waage-Finder  -  sucht das Schenck-Disomat-Opus-Terminal im lokalen Netz.

  1) Zeigt die eigenen Netzwerk-Adressen (welche Subnetze werden gescannt?)
  2) Listet ALLE Geraete im Netz (Ping + ARP, mit MAC)
  3) Scannt Standard-Waagen-Ports; findet er nichts, macht er einen TIEFEN-Scan
     (Ports 1-10240) NUR auf den gefundenen Geraeten
  4) Fragt offene Ports mit MinProz ab und meldet, wer mit GEWICHT antwortet

  Doppelklick auf "Waage-Finder.bat".  Direkt:
    powershell -ExecutionPolicy Bypass -File waage-finder.ps1
  Optionen:
    -Deep                       Tiefen-Scan (1-10240) immer ausfuehren
    -Hosts 192.168.112.202,...  nur diese IP(s) tief scannen
    -Port 8000                  einen Port zuerst pruefen
    -Subnet 192.168.10          festes Subnetz statt Auto-Erkennung
    -Timeout 300                Wartezeit pro Port-Welle (ms)
#>
param(
  [int]$Port      = 0,
  [int[]]$Ports   = @(8000, 4001, 4000, 10001, 2101, 1001, 5000, 9761, 502, 23),
  [string]$Subnet = '',
  [string[]]$Hosts = @(),
  [switch]$Deep,
  [int]$Timeout   = 300
)

$ErrorActionPreference = 'SilentlyContinue'
if ($Port -gt 0) { $Ports = @($Port) + ($Ports | Where-Object { $_ -ne $Port }) }

function Head($t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }

function Parse-Weight([string]$line) {
  $t = ($line -replace '[\x00-\x08\x0e-\x1f]', ' ').Trim()
  if ($t -match '([+-]?\d+[.,]?\d*)\s*(kg|t|lb)') {
    $val = [double]($matches[1] -replace ',', '.')
    switch ($matches[2].ToLower()) { 't' { $val *= 1000 } 'lb' { $val *= 0.453592 } }
    $status = 'unstable'; $u = $t.ToUpper()
    if ($u -match '\bST\b') { $status = 'stable' } elseif ($u -match '\bOL\b') { $status = 'overload' } elseif ($u -match '\bER\b') { $status = 'error' }
    return [pscustomobject]@{ kg = [math]::Round($val); status = $status; raw = $t }
  }
  return $null
}

# -- (IP,Port)-Matrix in Wellen scannen (zuverlaessig, gedrosselt) -------------
function Scan-Matrix([string[]]$ips, [int[]]$ports, [int]$timeout, [int]$chunk, [string]$label) {
  $result = @{}
  $total = [Math]::Max(1, $ips.Count * $ports.Count); $done = 0
  $batch = New-Object System.Collections.ArrayList
  $flush = {
    Start-Sleep -Milliseconds $timeout
    foreach ($it in $batch) {
      try { if ($it.iar.IsCompleted) { $it.client.EndConnect($it.iar); if ($it.client.Connected) { if (-not $result.ContainsKey($it.ip)) { $result[$it.ip] = @() }; $result[$it.ip] += $it.port } } } catch {}
      $it.client.Close()
    }
    $batch.Clear()
  }
  foreach ($ip in $ips) {
    foreach ($pt in $ports) {
      $c = New-Object System.Net.Sockets.TcpClient
      [void]$batch.Add([pscustomobject]@{ ip = $ip; port = $pt; client = $c; iar = $c.BeginConnect($ip, $pt, $null, $null) })
      $done++
      if ($batch.Count -ge $chunk) { & $flush; Write-Progress -Activity $label -PercentComplete ([int]($done / $total * 100)) -Status "$done / $total" }
    }
  }
  if ($batch.Count) { & $flush }
  Write-Progress -Activity $label -Completed
  return $result
}

function Ping-Sweep([string]$net) {
  $tasks = 1..254 | ForEach-Object { $p = New-Object System.Net.NetworkInformation.Ping; [pscustomobject]@{ ip = "$net.$_"; t = $p.SendPingAsync("$net.$_", 600) } }
  try { [System.Threading.Tasks.Task]::WaitAll(($tasks | ForEach-Object { $_.t })) } catch {}
  $live = @(); foreach ($x in $tasks) { try { if ($x.t.Result.Status -eq 'Success') { $live += $x.ip } } catch {} }
  return $live
}

function Get-ArpMap {
  $map = @{}
  (arp -a) | ForEach-Object {
    if ($_ -match '(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2}[-:][0-9a-fA-F]{2})') { $map[$matches[1]] = $matches[2].ToUpper() }
  }
  return $map
}

function Probe-Scale([string]$ip, [int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect($ip, $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne(700)) { return $null }
    $c.EndConnect($iar); $s = $c.GetStream()
    $readAll = { param($stream, $ms) Start-Sleep -Milliseconds $ms; $sb = New-Object System.Text.StringBuilder; $buf = New-Object byte[] 4096; while ($stream.DataAvailable) { $n = $stream.Read($buf, 0, $buf.Length); if ($n -le 0) { break }; [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n)) }; $sb.ToString() }
    $raw = & $readAll $s 700
    foreach ($cmd in @("SI`r`n", "S`r`n", "P`r`n")) {
      if ($raw -and (Parse-Weight $raw)) { break }
      $b = [System.Text.Encoding]::ASCII.GetBytes($cmd); $s.Write($b, 0, $b.Length); $s.Flush(); $raw += (& $readAll $s 700)
    }
    return $raw
  } catch { return $null } finally { $c.Close() }
}

# -- Netzwerk-Adressen ermitteln ----------------------------------------------
$nics = @()
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object {
  $p = $_.IPAddress.Split('.'); $nics += [pscustomobject]@{ ip = $_.IPAddress; net = "$($p[0]).$($p[1]).$($p[2])"; if = $_.InterfaceAlias }
}
$myIps = @($nics.ip)
$subnets = if ($Subnet) { @($Subnet.TrimEnd('.')) } else { ($nics.net | Select-Object -Unique) }

Write-Host '==================================================================='
Write-Host '  Waage-Finder  -  Disomat Opus im Netzwerk suchen (v3)' -ForegroundColor White
Write-Host '==================================================================='
Head 'Dieser PC im Netzwerk:'
if ($nics) { $nics | ForEach-Object { Write-Host ("  {0,-16} ({1})" -f $_.ip, $_.if) } } else { Write-Host '  (keine Netzwerk-Adresse gefunden!)' -ForegroundColor Red }
Write-Host ("  Zu scannende Subnetze: {0}" -f ($subnets -join ', '))

# Gezielter Tiefen-Scan bestimmter Hosts (-Hosts ...) und Schluss
if ($Hosts.Count -gt 0) {
  Head ("Tiefen-Scan (Ports 1-10240) der angegebenen Hosts: {0}" -f ($Hosts -join ', '))
  $openByIp = Scan-Matrix $Hosts (1..10240) 250 256 'Tiefen-Scan'
  $arp = Get-ArpMap
} else {
  if (-not $subnets) { Write-Host 'Kein Subnetz - Abbruch.' -ForegroundColor Red; return }
  $openByIp = @{}; $arp = @{}
  foreach ($net in $subnets) {
    Head ("Subnetz {0}.x  ---------------------------------------------" -f $net)
    Write-Host '  Suche aktive Geraete (Ping/ARP) ...'
    $live = Ping-Sweep $net; Start-Sleep -Milliseconds 200; $arp = Get-ArpMap
    $devices = @($live) + @($arp.Keys | Where-Object { $_ -like "$net.*" }) |
      Select-Object -Unique |
      Where-Object { $_ -notmatch '\.(0|255)$' -and $arp[$_] -ne 'FF-FF-FF-FF-FF-FF' } |
      Sort-Object { [int]($_.Split('.')[3]) }
    if ($devices) { Write-Host ("  {0} Geraet(e):" -f $devices.Count) -ForegroundColor Gray; foreach ($d in $devices) { Write-Host ("     {0,-16} {1}" -f $d, $arp[$d]) -ForegroundColor DarkGray } }
    else { Write-Host '  Keine Geraete per Ping/ARP gefunden.' -ForegroundColor Yellow }

    Write-Host ("  Scanne Standard-Ports ({0}) ..." -f ($Ports -join ','))
    $std = Scan-Matrix (1..254 | ForEach-Object { "$net.$_" }) $Ports $Timeout 256 "Port-Scan $net.x"
    foreach ($k in $std.Keys) { $openByIp[$k] = $std[$k] }

    $targets = @($devices | Where-Object { $myIps -notcontains $_ })
    if (($std.Count -eq 0 -or $Deep) -and $targets.Count -gt 0) {
      Write-Host ("  Tiefen-Scan (Ports 1-10240) auf {0} Geraet(e) ... (dauert 1-3 Min.)" -f $targets.Count) -ForegroundColor Cyan
      $deep = Scan-Matrix $targets (1..10240) 250 256 "Tiefen-Scan $net.x"
      foreach ($k in $deep.Keys) { $openByIp[$k] = (@($openByIp[$k]) + $deep[$k] | Where-Object { $_ } | Select-Object -Unique) }
    }
  }
}

# -- Offene Ports mit MinProz abfragen ----------------------------------------
$found = @()
if ($openByIp.Count -gt 0) {
  Head 'Offene Ports gefunden - frage mit MinProz ab:'
  foreach ($ip in ($openByIp.Keys | Sort-Object { [int]($_.Split('.')[3]) })) {
    $ports = ($openByIp[$ip] | Sort-Object) -join ', '
    $hit = $null
    foreach ($pt in $openByIp[$ip]) {
      $raw = Probe-Scale $ip $pt
      if ($raw) { foreach ($ln in ($raw -split "`r?`n")) { $w = Parse-Weight $ln; if ($w) { $hit = [pscustomobject]@{ port = $pt; w = $w }; break } } }
      if ($hit) { break }
    }
    if ($hit) {
      Write-Host ("  >>> {0}  Port {1}  =  {2:N0} kg  [{3}]   MAC {4}" -f $ip, $hit.port, $hit.w.kg, $hit.w.status, $arp[$ip]) -ForegroundColor Green
      Write-Host ("        Rohdaten: {0}" -f $hit.w.raw) -ForegroundColor DarkGray
      $found += [pscustomobject]@{ ip = $ip; port = $hit.port }
    } else {
      Write-Host ("  {0}  offen: {1}   MAC {2}  (kein Gewicht - evtl. trotzdem die Waage?)" -f $ip, $ports, $arp[$ip]) -ForegroundColor Yellow
    }
  }
}

Write-Host ''
Write-Host '==================================================================='
if ($found.Count -ge 1) {
  $f = $found[0]
  Write-Host ("  WAAGE GEFUNDEN:  {0}   (Port {1})" -f $f.ip, $f.port) -ForegroundColor Green
  Write-Host ''
  Write-Host  '  In waage-bridge\.env eintragen:' -ForegroundColor Green
  Write-Host ("      WAAGE_IP={0}"   -f $f.ip)   -ForegroundColor Green
  Write-Host ("      WAAGE_PORT={0}" -f $f.port) -ForegroundColor Green
} else {
  Write-Host '  Keine Waage mit Gewicht erkannt.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Wenn oben "offen: ..."-Zeilen stehen: das ist ein heisser Kandidat -'
  Write-Host '  dann gezielt testen:  Waage-Finder.bat -Hosts <IP>'
  Write-Host ''
  Write-Host '  Sonst am sichersten: IP + Port am Terminal ablesen'
  Write-Host '  (Disomat Opus: Service-/Setup-Menue -> Ethernet / Netzwerk / TCP-IP).'
  Write-Host '  Steht die Waage in einem ANDEREN Subnetz als der PC oben? -> VLAN/Router.'
}
Write-Host '==================================================================='
