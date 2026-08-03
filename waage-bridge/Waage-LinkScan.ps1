<#
  Waage-LinkScan  -  sucht das Terminal am DIREKTKABEL (Ethernet 2).

  Bei einem Direktkabel ohne DHCP bekommt der PC-Anschluss eine 169.254.x.x-
  Adresse. Dieses Skript durchsucht genau diese Direktleitung nach dem Terminal:
    1) findet den/die "Up"-Anschluss/anschluesse mit 169.254-Adresse
    2) Ping-Sweep ueber 169.254.x.x  (bzw. -Subnet, falls angegeben)
    3) liest die ARP-Tabelle dieser Leitung -> gefundene Geraete (IP + MAC)
    4) fragt sie mit MinProz ab und meldet, wer mit GEWICHT antwortet

  Doppelklick auf "Waage-LinkScan.bat".  Optionen:
    -Subnet 192.168.0     festes /24 scannen (wenn Terminal eine feste IP hat
                          und du dem PC-Anschluss vorher eine IP im selben
                          Bereich gegeben hast, z.B. 192.168.0.100)
    -Deep                 offene Ports zusaetzlich mit MinProz tief pruefen
    -Timeout 150          Ping-Timeout je Host (ms)
#>
param(
  [string]$Subnet = '',
  [int[]]$Ports   = @(8000, 4001, 4000, 10001, 2101, 1001, 5000, 9761, 502, 23),
  [int]$Timeout   = 150
)
$ErrorActionPreference = 'SilentlyContinue'
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

function Ping-Batch([string[]]$ips, [int]$timeout, [int]$chunk, [string]$label) {
  $live = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $ips.Count; $i += $chunk) {
    $slice = $ips[$i..([Math]::Min($i + $chunk - 1, $ips.Count - 1))]
    $ps = foreach ($ip in $slice) { $p = New-Object System.Net.NetworkInformation.Ping; [pscustomobject]@{ ip = $ip; t = $p.SendPingAsync($ip, $timeout) } }
    try { [System.Threading.Tasks.Task]::WaitAll(($ps | ForEach-Object { $_.t })) } catch {}
    foreach ($x in $ps) { try { if ($x.t.Result.Status -eq 'Success') { [void]$live.Add($x.ip) } } catch {} }
    Write-Progress -Activity $label -PercentComplete ([int]($i / [Math]::Max(1, $ips.Count) * 100)) -Status "$i / $($ips.Count)"
  }
  Write-Progress -Activity $label -Completed
  return $live
}

function Arp-For([string]$srcIp) {
  $m = @{}
  (arp -a -N $srcIp) | ForEach-Object {
    if ($_ -match '(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F]{2}(?:[-:][0-9a-fA-F]{2}){5})') {
      $ip = $matches[1]; $mac = $matches[2].ToUpper()
      if ($mac -ne 'FF-FF-FF-FF-FF-FF' -and $ip -notmatch '\.255$' -and $ip -notmatch '^(224|239|255)\.') { $m[$ip] = $mac }
    }
  }
  return $m
}

function Probe-Scale([string]$ip, [int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect($ip, $port, $null, $null); if (-not $iar.AsyncWaitHandle.WaitOne(700)) { return $null }
    $c.EndConnect($iar); $s = $c.GetStream()
    $readAll = { param($stream, $ms) Start-Sleep -Milliseconds $ms; $sb = New-Object System.Text.StringBuilder; $buf = New-Object byte[] 4096; while ($stream.DataAvailable) { $n = $stream.Read($buf, 0, $buf.Length); if ($n -le 0) { break }; [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n)) }; $sb.ToString() }
    $raw = & $readAll $s 700
    foreach ($cmd in @("SI`r`n", "S`r`n", "P`r`n")) { if ($raw -and (Parse-Weight $raw)) { break }; $b = [System.Text.Encoding]::ASCII.GetBytes($cmd); $s.Write($b, 0, $b.Length); $s.Flush(); $raw += (& $readAll $s 700) }
    return $raw
  } catch { return $null } finally { $c.Close() }
}

# -- Direktleitung(en) finden: Up-Adapter mit 169.254-Adresse -----------------
$upIdx = (Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }).ifIndex
$links = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '169.254.*' -and $upIdx -contains $_.InterfaceIndex } |
  ForEach-Object { [pscustomobject]@{ ip = $_.IPAddress; alias = $_.InterfaceAlias } }

Write-Host '==================================================================='
Write-Host '  Waage-LinkScan  -  Terminal am Direktkabel suchen' -ForegroundColor White
Write-Host '==================================================================='

if ($Subnet) {
  $targetSubnets = @([pscustomobject]@{ src = ''; net = $Subnet.TrimEnd('.'); alias = "(manuell $Subnet.x)" })
  Write-Host ("Modus: festes Subnetz {0}.1-254" -f $Subnet.TrimEnd('.'))
} elseif ($links) {
  Head 'Direktleitung(en) gefunden (Up + 169.254):'
  $links | ForEach-Object { Write-Host ("  {0,-16} {1}" -f $_.ip, $_.alias) -ForegroundColor Yellow }
  $targetSubnets = $links | ForEach-Object { [pscustomobject]@{ src = $_.ip; net = '169.254'; alias = $_.alias } }
} else {
  Write-Host 'Keine aktive 169.254-Direktleitung gefunden.' -ForegroundColor Red
  Write-Host 'Ist das Waagen-Kabel eingesteckt und das Terminal an? (Adapter muss "Up" sein.)'
  return
}

$found = @()
foreach ($ts in $targetSubnets) {
  if ($ts.net -eq '169.254') {
    Head ("Durchsuche Direktleitung {0} (169.254.x.x, das dauert ~1 Min.) ..." -f $ts.alias)
    $ips = for ($a = 1; $a -le 254; $a++) { for ($b = 1; $b -le 254; $b++) { "169.254.$a.$b" } }
  } else {
    Head ("Durchsuche {0}.1-254 ..." -f $ts.net)
    $ips = 1..254 | ForEach-Object { "$($ts.net).$_" }
  }

  $live = Ping-Batch $ips $Timeout 500 ("Ping-Sweep " + $ts.alias)
  Start-Sleep -Milliseconds 300
  $arp = if ($ts.src) { Arp-For $ts.src } else { Arp-For (($ips[0]) -replace '\.\d+$', '.1') }
  $devices = @(@($live) + @($arp.Keys) | Select-Object -Unique | Where-Object { $_ -notmatch '\.(0|255)$' })

  if (-not $devices) { Write-Host '  Kein Geraet auf dieser Leitung gefunden.' -ForegroundColor Yellow; continue }
  Write-Host ("  {0} Geraet(e) auf der Leitung:" -f $devices.Count) -ForegroundColor Gray
  foreach ($d in ($devices | Sort-Object)) { Write-Host ("     {0,-16} {1}" -f $d, $arp[$d]) -ForegroundColor Gray }

  Head '  Frage gefundene Geraete mit MinProz ab ...'
  foreach ($ip in $devices) {
    $hit = $null
    foreach ($pt in $Ports) {
      $raw = Probe-Scale $ip $pt
      if ($raw) { foreach ($ln in ($raw -split "`r?`n")) { $w = Parse-Weight $ln; if ($w) { $hit = [pscustomobject]@{ port = $pt; w = $w }; break } } }
      if ($hit) { break }
    }
    if ($hit) {
      Write-Host ("  >>> {0}  Port {1}  =  {2:N0} kg  [{3}]" -f $ip, $hit.port, $hit.w.kg, $hit.w.status) -ForegroundColor Green
      Write-Host ("        Rohdaten: {0}" -f $hit.w.raw) -ForegroundColor DarkGray
      $found += [pscustomobject]@{ ip = $ip; port = $hit.port; src = $ts.src }
    } else {
      Write-Host ("  {0}  erreichbar, aber keine Waagen-Antwort auf Standard-Ports" -f $ip) -ForegroundColor Yellow
    }
  }
}

Write-Host ''
Write-Host '==================================================================='
if ($found.Count -ge 1) {
  $f = $found[0]
  Write-Host ("  WAAGE GEFUNDEN:  {0}   (Port {1})" -f $f.ip, $f.port) -ForegroundColor Green
  Write-Host ''
  Write-Host  '  Naechster Schritt (feste IPs fuers Direktkabel):' -ForegroundColor Green
  Write-Host ("   - PC-Anschluss Ethernet 2 feste IP geben (gleiches Netz wie {0})" -f $f.ip) -ForegroundColor Green
  Write-Host ("   - waage-bridge\.env:  WAAGE_IP={0}   WAAGE_PORT={1}" -f $f.ip, $f.port) -ForegroundColor Green
} else {
  Write-Host '  Terminal (noch) nicht gefunden.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Wahrscheinlich hat das Terminal eine FESTE IP in einem anderen'  -ForegroundColor Yellow
  Write-Host '  Bereich und meldet sich nicht von selbst. Moeglichkeiten:'        -ForegroundColor Yellow
  Write-Host '   1) IP aus der Inbetriebnahme-Doku / beim Waagen-Monteur erfragen.'
  Write-Host '   2) 1-Min-Mitschnitt mit Wireshark auf "Ethernet 2" -> zeigt die IP sofort.'
  Write-Host '   3) Kabel am Terminal kurz ab-/anstecken WAEHREND dieses Skript laeuft'
  Write-Host '      (beim Link-Aufbau sendet das Terminal oft ein ARP mit seiner IP).'
}
Write-Host '==================================================================='
