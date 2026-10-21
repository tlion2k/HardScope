# HardScope

**Analizador de hardware y cuellos de botella para PC (Windows).**

## ⬇️ Descarga directa

| | Archivo | |
|---|---|---|
| **Instalador** (recomendado) | `HardScope-Setup.exe` | [Descargar](https://github.com/tlion2k/HardScope/releases/latest/download/HardScope-Setup.exe) |
| **Portable** (sin instalar, se abre con doble clic) | `HardScope-Portable.exe` | [Descargar](https://github.com/tlion2k/HardScope/releases/latest/download/HardScope-Portable.exe) |

Los enlaces siempre bajan la última versión. Todas las versiones están en [Releases](https://github.com/tlion2k/HardScope/releases).

> Requiere Windows 10 u 11 de 64 bits. **No hay que instalar nada más:** el `.exe` trae todo lo necesario y solo usa componentes que ya vienen con Windows (PowerShell y WMI). No necesita permisos de administrador. Como el ejecutable no tiene firma digital, Windows SmartScreen puede mostrar un aviso la primera vez: pulsa **Más información → Ejecutar de todas formas**.

## 💻 Levantar el proyecto en local

### Opción rápida: instalación automática

Descarga el código ([ZIP](https://github.com/tlion2k/HardScope/archive/refs/heads/main.zip) o `git clone`) y haz **doble clic en `setup.cmd`**. El script:

1. Revisa que tengas Windows 10/11 de 64 bits.
2. Instala Node.js LTS si falta o es anterior a la 20, e instala Git si no lo tienes (con `winget`).
3. Si hay versiones nuevas de Node.js o Git, pregunta si quieres actualizarlas.
4. Ejecuta `npm install` (descarga Electron) y ofrece abrir la app.

Windows pedirá **permiso de administrador** solo en el paso que instala Node.js o Git; el resto no lo necesita. Opciones: `setup.cmd -Check` solo revisa sin instalar nada, `setup.cmd -Yes` acepta todo sin preguntar y `setup.cmd -NoStart` no abre la app al final.

### Opción manual

**Requisitos:** [Node.js](https://nodejs.org) 20 o superior y [Git](https://git-scm.com), en Windows 10/11.

1. Clona el repositorio:

   ```bash
   git clone https://github.com/tlion2k/HardScope.git
   ```

2. Entra a la carpeta:

   ```bash
   cd HardScope
   ```

3. Instala las dependencias (descarga Electron, unos 100 MB la primera vez):

   ```bash
   npm install
   ```

   Si npm avisa de *install scripts* bloqueados, apruébalos y vuelve a instalar:

   ```bash
   npm install-scripts approve electron electron-winstaller
   ```

4. Abre la aplicación:

   ```bash
   npm start
   ```

   Al abrirse analiza el equipo sola en unos segundos. Si cambias algo en `src/`, cierra la app y vuelve a ejecutar `npm start`.

**Otros comandos:**

| Comando | Qué hace |
|---|---|
| `npm test` | Ejecuta las pruebas del motor de diagnóstico |
| `npm run dist` | Genera `HardScope-Setup.exe` y `HardScope-Portable.exe` en `dist/` |
| `npm run dist:dir` | Genera la app sin instalador en `dist/win-unpacked/` (prueba rápida) |

---

HardScope revisa tu equipo, compara la **placa madre con la tarjeta de video** y el **procesador con la GPU**, revisa RAM, discos y configuración, y te dice con colores qué tienes que mejorar:

| Color | Significado |
|---|---|
| 🔴 **Crítico** | Cuello de botella real que debes corregir |
| 🟡 **Advertencia** | Conviene mejorarlo |
| 🔵 **Consejo** | Recomendación o mejora opcional |
| 🟢 **Correcto** | Ese componente está bien |

## Qué detecta

- **Placa vs tarjeta de video**
  - *"La placa no aprovecha todo el rendimiento de tu tarjeta de video"*: la plataforma (chipset, socket y mejor CPU compatible) no alcanza a alimentar a la GPU.
  - *"Tu placa es superior a tu tarjeta de video"*: la placa soporta tarjetas mucho más potentes, y te sugiere modelos concretos.
  - Generación PCIe del slot frente a la de la tarjeta, carriles usados (x16/x8/x4) medidos en vivo y pérdida estimada (por ejemplo, una RX 6500 XT x4 en una placa PCIe 3.0).
- **Procesador vs GPU**: porcentaje estimado de cuello de botella según la resolución (1080p, 1440p o 4K) y qué CPU compatible conviene.
- **RAM**: cantidad según el uso (juegos, creación u oficina), canal simple o doble, módulos mezclados, ranuras libres y RAM que no corre a su velocidad nominal (XMP/EXPO desactivado; la velocidad se lee del número de parte).
- **Almacenamiento**: Windows en HDD, SSD SATA frente a NVMe y poco espacio libre.
- **Sistema**: plan de energía en ahorro y BIOS antigua.
- **Próxima mejora**: simula paso a paso qué actualizar (GPU, CPU compatible con tu placa o una plataforma nueva) para ganar rendimiento **sin crear un cuello de botella nuevo**. Muestra la ganancia estimada, alternativas (incluida una opción económica) y una comparativa antes/después: potencia, VRAM, enlace PCIe, fuente recomendada y equilibrio.
- **Perfiles de preferencias**: al principio todo se muestra en una **vista global** genérica. Si creas un perfil (marca de procesador, de tarjeta de video y su ensambladora, de placa, fuente, RAM y SSD, nivel de gasto, uso y resolución), la próxima mejora y los consejos se anclan a tus preferencias. Si tu marca preferida no tiene una opción sin cuello de botella, la app lo avisa y propone la mejor alternativa. Puedes tener varios perfiles y cambiar entre ellos desde la barra superior.
- **Actual vs perfil**: compara cada componente de tu equipo con lo que pide tu perfil (Cumple / Cambiar / Opcional). Si, por ejemplo, tienes Intel y tu perfil pide AMD, te indica que debes cambiar placa y procesador y te da opciones **equivalentes o superiores** a tu rendimiento actual, con la placa de tu marca preferida y si la RAM sirve o no. Detecta la marca de tu placa, la ensambladora de tu tarjeta, tu RAM y tu SSD.
- **Monitor en vivo**: uso de CPU (total y por hilo), GPU, RAM, VRAM y temperatura de la GPU, con diagnóstico en tiempo real (*"Cuello de botella de CPU ahora mismo"*).
- **Reporte exportable** en HTML.

## Desarrollo

### Estructura

```
src/
  main/        proceso principal de Electron (recolección de datos, monitor, IPC)
    probe.ps1        enlace PCIe, módulos de RAM, disco del sistema y plan de energía
    gpu-monitor.ps1  uso de la GPU por contadores WMI (sirve con NVIDIA, AMD e Intel)
  analysis/    motor de diagnóstico (sin dependencias de Electron, se puede probar con node)
    hardware.js      identificación de GPU, CPU, chipset y RAM
    engine.js        reglas, severidades y consejos
    upgrade.js       planificador de la próxima mejora
    profile-match.js comparación entre el equipo actual y el perfil
  data/        base de datos editable
    gpus.json        GPUs: puntaje, PCIe, carriles y VRAM
    platforms.json   chipsets y plataformas: PCIe, socket, techo y mejores CPUs
    brands.json      marcas y series para los perfiles (placas, fuentes, RAM, SSD, ensambladoras)
  renderer/    interfaz (HTML, CSS y JS sin paso de compilación)
scripts/
  setup.ps1      instalación automática del entorno (lo llama setup.cmd)
test/          pruebas con node:test
```

### Añadir hardware nuevo

- **GPU nueva**: agrega una entrada en `src/data/gpus.json` (`id` en minúsculas tal como aparece en el nombre, `score` en la escala donde RTX 4090 = 100).
- **Chipset nuevo**: agrégalo en `src/data/platforms.json` → `chipsets`, apuntando a su plataforma.
- **Regla nueva**: añade un `add({ id, severity, component, title, detail, action })` en `src/analysis/engine.js` y una prueba en `test/`.

### Publicar una versión

1. Sube la versión en `package.json`.
2. Crea una etiqueta: `git tag v1.4.0 && git push --tags`.
3. GitHub Actions ejecuta las pruebas, compila `HardScope-Setup.exe` y `HardScope-Portable.exe` y los publica en Releases. Los enlaces de *Descarga directa* apuntan solos a la nueva versión, y la app avisa desde *Acerca de → Buscar actualizaciones*.

## Nota

Los puntajes de rendimiento son estimaciones basadas en promedios de pruebas públicas y sirven para comparar componentes, no como benchmark exacto.

## Licencia

MIT
