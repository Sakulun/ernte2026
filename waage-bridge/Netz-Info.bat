@echo off
title Netz-Info sammeln
REM ===================================================================
REM  Sammelt den Netzwerkzustand des PCs in eine Textdatei (netz-info.txt)
REM  und oeffnet sie. Diese Datei bitte an Lukas / den Support schicken.
REM  Zeigt alle Netzwerk-Adapter, ihre IP-Adressen und direkt
REM  angeschlossene Geraete (z.B. das Waagen-Terminal am Direktkabel).
REM ===================================================================
set "OUT=%~dp0netz-info.txt"
echo Sammle Netzwerk-Infos, bitte warten (ca. 10 Sekunden) ...
(
  echo ############ ipconfig /all ############
  ipconfig /all
  echo.
  echo ############ arp -a ############
  arp -a
  echo.
  echo ############ Adapter / IPv4 / Nachbarn ############
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetAdapter | Sort-Object ifIndex | Format-Table -Auto ifIndex,Name,InterfaceDescription,Status,LinkSpeed; '==== IPv4-Adressen ===='; Get-NetIPAddress -AddressFamily IPv4 | Sort-Object ifIndex | Format-Table -Auto ifIndex,IPAddress,PrefixLength,InterfaceAlias; '==== Direkt erreichbare Geraete (ARP/Neighbor) ===='; Get-NetNeighbor -AddressFamily IPv4 | Where-Object { $_.LinkLayerAddress -and $_.IPAddress -notmatch '^(224|239|255)\.' -and $_.LinkLayerAddress -ne 'FF-FF-FF-FF-FF-FF' } | Sort-Object ifIndex | Format-Table -Auto ifIndex,IPAddress,LinkLayerAddress,State"
) > "%OUT%" 2>&1
echo.
echo Fertig. Datei wird geoeffnet: "%OUT%"
start "" notepad "%OUT%"
