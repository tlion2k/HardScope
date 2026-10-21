# Datos que systeminformation no entrega en Windows: enlace PCIe real de la GPU,
# velocidad nominal de la RAM, ranuras, disco del sistema y plan de energía.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$keys = 'DEVPKEY_PciDevice_CurrentLinkSpeed', 'DEVPKEY_PciDevice_CurrentLinkWidth', 'DEVPKEY_PciDevice_MaxLinkSpeed', 'DEVPKEY_PciDevice_MaxLinkWidth'
$gpus = @(Get-PnpDevice -Class Display -PresentOnly | ForEach-Object {
  $p = @{}
  Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $keys | ForEach-Object { $p[$_.KeyName] = $_.Data }
  # SUBSYS_ddddvvvv: los últimos 4 dígitos son el fabricante de la tarjeta (ASUS, MSI...).
  $subsys = if ($_.InstanceId -match 'SUBSYS_[0-9A-F]{4}([0-9A-F]{4})') { $matches[1] } else { $null }
  [pscustomobject]@{
    name     = $_.FriendlyName
    subsys   = $subsys
    curGen   = $p['DEVPKEY_PciDevice_CurrentLinkSpeed']
    curWidth = $p['DEVPKEY_PciDevice_CurrentLinkWidth']
    maxGen   = $p['DEVPKEY_PciDevice_MaxLinkSpeed']
    maxWidth = $p['DEVPKEY_PciDevice_MaxLinkWidth']
  }
})

$memory = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
  [pscustomobject]@{
    size            = [double]$_.Capacity
    speed           = $_.Speed
    configuredSpeed = $_.ConfiguredClockSpeed
    smbiosType      = $_.SMBIOSMemoryType
    partNum         = ($_.PartNumber -as [string]).Trim()
    manufacturer    = ($_.Manufacturer -as [string]).Trim()
    locator         = $_.DeviceLocator
    bank            = $_.BankLabel
  }
})
$array = Get-CimInstance Win32_PhysicalMemoryArray | Where-Object Use -eq 3 | Select-Object -First 1

$sysDiskNumber = (Get-Partition -DriveLetter ($env:SystemDrive.TrimEnd(':')) | Select-Object -First 1).DiskNumber
$disks = @(Get-PhysicalDisk | ForEach-Object {
  [pscustomobject]@{
    name     = $_.FriendlyName
    type     = "$($_.MediaType)"
    bus      = "$($_.BusType)"
    size     = [double]$_.Size
    number   = [int]$_.DeviceId
    isSystem = ([int]$_.DeviceId -eq $sysDiskNumber)
  }
})

$scheme = (powercfg /getactivescheme) -join ' '
$guid = if ($scheme -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { $matches[1] } else { $null }
$planName = if ($scheme -match '\((.+)\)') { $matches[1] } else { $null }

[pscustomobject]@{
  gpus        = $gpus
  memory      = $memory
  slots       = $array.MemoryDevices
  maxCapacity = if ($array.MaxCapacityEx) { [double]$array.MaxCapacityEx * 1024 } elseif ($array.MaxCapacity) { [double]$array.MaxCapacity * 1024 } else { $null }
  disks       = $disks
  power       = @{ guid = $guid; name = $planName }
} | ConvertTo-Json -Depth 5 -Compress
