# Prepara el equipo para levantar HardScope desde el código fuente:
# instala o actualiza Node.js y Git con winget (Windows pide permiso de administrador
# sólo para el paso que lo necesita), instala las dependencias de npm y abre la app.
#
# Uso:  setup.cmd            (doble clic o desde la consola)
#       setup.cmd -Yes       (sin preguntas)
#       setup.cmd -Check     (sólo revisa, no instala nada)
param(
  [switch]$Yes,
  [switch]$Check,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$MinNode = 20

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Ok($text) { Say "  [OK] $text" 'Green' }
function Warn($text) { Say "  [!]  $text" 'Yellow' }
function Fail($text) { Say "  [X]  $text" 'Red' }

function Ask($question) {
  if ($Yes) { return $true }
  $answer = Read-Host "$question (S/N)"
  return $answer -match '^(s|si|sí|y|yes)$'
}

# Recarga el PATH del sistema y del usuario para ver programas recién instalados.
function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return $null }
  $v = (& node -v) -replace '^v', ''
  return [int]($v.Split('.')[0])
}

# Sólo consulta: "winget list --upgrade-available" no instala nada.
# (Ojo: "winget upgrade --id X" sí instala la actualización, por eso no se usa aquí.)
function Get-UpgradeAvailable($id) {
  $out = winget list --id $id --exact --upgrade-available --accept-source-agreements 2>$null | Out-String
  return $LASTEXITCODE -eq 0 -and $out -match [regex]::Escape($id)
}

# winget eleva sólo el instalador que lo necesita (aparece el aviso de Windows).
function Invoke-Winget($verb, $id, $name) {
  Say "  Ejecutando: winget $verb $name ..." 'Cyan'
  winget $verb --id $id --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
    # -1978335189 = "no hay actualización aplicable"
    throw "winget terminó con código $LASTEXITCODE al instalar $name."
  }
  Update-SessionPath
}

Say ''
Say '=== HardScope · preparación del entorno ===' 'Magenta'
Say ''

# 1. Sistema operativo
$os = [Environment]::OSVersion.Version
if ($os.Major -lt 10 -or -not [Environment]::Is64BitOperatingSystem) {
  Fail 'HardScope necesita Windows 10 u 11 de 64 bits.'
  exit 1
}
Ok "Windows $(if ($os.Build -ge 22000) { 11 } else { 10 }) de 64 bits"

$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) { Ok 'winget disponible' }
else { Warn 'winget no está disponible: instala "Instalador de aplicación" desde Microsoft Store para instalar automáticamente.' }

# 2. Node.js
$pending = @()
$nodeMajor = Get-NodeMajor
if ($null -eq $nodeMajor) {
  Warn "Node.js no está instalado (se necesita $MinNode o superior)."
  $pending += @{ verb = 'install'; id = 'OpenJS.NodeJS.LTS'; name = 'Node.js LTS'; required = $true }
} elseif ($nodeMajor -lt $MinNode) {
  Warn "Node.js $nodeMajor es antiguo (se necesita $MinNode o superior)."
  $pending += @{ verb = 'upgrade'; id = 'OpenJS.NodeJS.LTS'; name = 'Node.js LTS'; required = $true }
} else {
  Ok "Node.js $(& node -v)"
  if ($winget -and (Get-UpgradeAvailable 'OpenJS.NodeJS.LTS')) {
    $pending += @{ verb = 'upgrade'; id = 'OpenJS.NodeJS.LTS'; name = 'Node.js LTS'; required = $false }
  }
}

# 3. Git (para clonar y recibir actualizaciones del repositorio)
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Warn 'Git no está instalado.'
  $pending += @{ verb = 'install'; id = 'Git.Git'; name = 'Git'; required = $false }
} else {
  Ok "$(& git --version)"
  if ($winget -and (Get-UpgradeAvailable 'Git.Git')) {
    $pending += @{ verb = 'upgrade'; id = 'Git.Git'; name = 'Git'; required = $false }
  }
}

if ($pending.Count) {
  Say ''
  Say 'Instalaciones o actualizaciones disponibles:' 'White'
  foreach ($p in $pending) {
    $tag = if ($p.required) { 'necesaria' } else { 'opcional' }
    Say ("  - {0} {1} ({2})" -f ($(if ($p.verb -eq 'install') { 'Instalar' } else { 'Actualizar' })), $p.name, $tag)
  }
  Say '  Windows puede pedir permiso de administrador durante la instalación.' 'DarkGray'
}

if ($Check) {
  Say ''
  Say 'Modo revisión: no se instaló nada.' 'Cyan'
  exit 0
}

foreach ($p in $pending) {
  if (-not $winget) {
    if ($p.required) { Fail "Instala $($p.name) manualmente desde https://nodejs.org y vuelve a ejecutar este script."; exit 1 }
    continue
  }
  $verbText = if ($p.verb -eq 'install') { 'Instalar' } else { 'Actualizar' }
  if (Ask "¿$verbText $($p.name)?") {
    Invoke-Winget $p.verb $p.id $p.name
  } elseif ($p.required) {
    Fail "$($p.name) es necesario para continuar."
    exit 1
  }
}

$nodeMajor = Get-NodeMajor
if ($null -eq $nodeMajor -or $nodeMajor -lt $MinNode) {
  Fail 'Node.js no quedó disponible en esta ventana. Cierra la consola, ábrela de nuevo y vuelve a ejecutar setup.cmd.'
  exit 1
}

# 4. Dependencias del proyecto
Say ''
Say 'Instalando dependencias del proyecto (npm install)...' 'Cyan'
Push-Location $root
try {
  & npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'npm install falló.' }
  if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) {
    Say '  Descargando Electron...' 'Cyan'
    & npm rebuild electron
  }
  if (-not (Test-Path 'node_modules\electron\dist\electron.exe')) { throw 'No se pudo descargar Electron.' }
  Ok 'Dependencias instaladas'

  Say ''
  Say 'Todo listo. Para abrir la app más adelante: npm start' 'Green'
  if (-not $NoStart -and (Ask '¿Abrir HardScope ahora?')) {
    Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory $root -WindowStyle Hidden
  }
} finally {
  Pop-Location
}
