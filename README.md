# HardScope

**Analizador de hardware y cuellos de botella para PC (Windows).**

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
- **Próxima mejora**: simula paso a paso qué actualizar (GPU, CPU compatible con tu placa o una plataforma nueva) para ganar rendimiento **sin crear un cuello de botella nuevo**. Muestra la ganancia estimada, alternativas (incluida una opción económica), el equilibrio antes y después de cada paso, y primero las mejoras gratis o baratas (XMP, doble canal, SSD).
- **Perfiles de preferencias**: al principio todo se muestra en una **vista global** genérica. Si creas un perfil (marca de procesador, de tarjeta de video y su ensambladora, de placa, fuente, RAM y SSD, nivel de gasto, uso y resolución), la próxima mejora y los consejos se anclan a tus preferencias. Si tu marca preferida no tiene una opción sin cuello de botella, la app lo avisa y propone la mejor alternativa. Puedes tener varios perfiles y cambiar entre ellos desde la barra superior.
- **Monitor en vivo**: uso de CPU (total y por hilo), GPU, RAM, VRAM y temperatura de la GPU, con diagnóstico en tiempo real (*"Cuello de botella de CPU ahora mismo"*).
- **Reporte exportable** en HTML.

## Instalar

Descarga el instalador o la versión portable desde [Releases](../../releases).

## Desarrollo

Requisitos: Node.js 20 o superior, en Windows 10/11.

```bash
npm install
npm start        # abre la app
npm test         # pruebas del motor de diagnóstico
npm run dist     # genera el instalador y el portable en dist/
```

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
  data/        base de datos editable
    gpus.json        GPUs: puntaje, PCIe, carriles y VRAM
    platforms.json   chipsets y plataformas: PCIe, socket, techo y mejores CPUs
    brands.json      marcas y series para los perfiles (placas, fuentes, RAM, SSD, ensambladoras)
  renderer/    interfaz (HTML, CSS y JS sin paso de compilación)
test/          pruebas con node:test
```

### Añadir hardware nuevo

- **GPU nueva**: agrega una entrada en `src/data/gpus.json` (`id` en minúsculas tal como aparece en el nombre, `score` en la escala donde RTX 4090 = 100).
- **Chipset nuevo**: agrégalo en `src/data/platforms.json` → `chipsets`, apuntando a su plataforma.
- **Regla nueva**: añade un `add({ id, severity, component, title, detail, action })` en `src/analysis/engine.js` y una prueba en `test/`.

### Publicar una versión

1. Sube la versión en `package.json`.
2. Crea una etiqueta: `git tag v1.1.0 && git push --tags`.
3. GitHub Actions compila el instalador y lo publica en Releases. La app avisa de la nueva versión desde *Acerca de → Buscar actualizaciones*.

## Nota

Los puntajes de rendimiento son estimaciones basadas en promedios de pruebas públicas y sirven para comparar componentes, no como benchmark exacto.

## Licencia

MIT
