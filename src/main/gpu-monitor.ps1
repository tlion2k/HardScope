# Emite una línea JSON por segundo con el uso 3D de la GPU y la VRAM dedicada en uso.
# Usa las clases WMI de contadores (sus nombres no cambian con el idioma de Windows),
# así funciona con NVIDIA, AMD e Intel.
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $eng = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
    Where-Object { $_.Name -like '*engtype_3D' }
  $util = ($eng | Measure-Object -Property UtilizationPercentage -Sum).Sum
  $mem = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory |
    Measure-Object -Property DedicatedUsage -Maximum).Maximum
  [Console]::Out.WriteLine((@{ gpu = [math]::Min(100, [double]$util); vramUsed = [double]$mem } | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}
