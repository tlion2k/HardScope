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
    checks.js        lista «Verifica antes de comprar»
    explain.js       versión simple y evidencia técnica de cada hallazgo
  data/        base de datos editable
    gpus.json        GPUs: puntaje, PCIe, carriles y VRAM
    platforms.json   chipsets y plataformas: PCIe, socket, techo y mejores CPUs
    brands.json      marcas y series para los perfiles (placas, fuentes, RAM, SSD, ensambladoras)
  renderer/    interfaz (HTML, CSS y JS sin paso de compilación)
scripts/
  setup.ps1          instalación automática del entorno (lo llama setup.cmd)
  validate-data.js   validador de los catálogos (npm run validate)
  format-data.js     formato de los catálogos, una línea por entrada
  capture-fixture.js captura anonimizada del inventario del PC (npm run fixture)
test/
  engine.test.js     reglas, planificador y perfiles
  fixtures.test.js   análisis sobre inventarios completos
  data.test.js       validador de catálogos
  fixtures/          inventarios: 1 real anonimizado y 5 sintéticos
```

### Base de datos: procedencia y validación

Cada catálogo de `src/data` tiene un bloque `meta` con versión, fecha de revisión, método y fuentes. Los índices de GPU son **aproximaciones a partir de reseñas públicas** (no medidos por HardScope) y cada entrada tiene una confianza (`alta`, `media` por defecto o `baja` para integradas y modelos de 2025). La vista Developer muestra la versión, la fuente y la confianza de tu tarjeta.

- **GPU nueva**: agrega una línea en `src/data/gpus.json` (`id` en minúsculas tal como aparece en el nombre, `score` en la escala RTX 4090 = 100, `pcie`, `lanes`, `vram`, `year` y, si corresponde, `conf`).
- **Chipset nuevo**: agrégalo en `src/data/platforms.json` → `chipsets`, apuntando a su plataforma.
- **Regla nueva**: añade un `add({ id, severity, component, title, detail, action })` en `src/analysis/engine.js`, su texto simple en `src/analysis/explain.js` y una prueba en `test/`.
- Después de editar, ejecuta el validador y el formateador:

  ```bash
  npm run validate
  ```

  ```bash
  npm run format-data
  ```

  `validate` detecta ids duplicados o que nunca coincidirían con el nombre, valores fuera de rango, chipsets que apuntan a plataformas inexistentes, procesadores no reconocidos y catálogos sin revisar hace más de un año. GitHub Actions lo ejecuta antes de compilar.

### Inventarios de prueba (equipos reales anonimizados)

`test/fixtures/` contiene inventarios completos con el formato real del recolector. Cada uno indica su origen (`real` o `synthetic`) y un bloque `expect` con los hechos conocidos del equipo; las pruebas analizan cada inventario en todas las combinaciones de uso, resolución y perfil.

Para aportar el inventario de tu PC:

```bash
npm run fixture -- mi-pc
```

Crea `test/fixtures/mi-pc.json` sin el nombre del equipo, sin nombres de monitores ni rutas de unidades, y con la fecha reducida a año y mes. Revísalo, completa `expect` con lo que sabes que es cierto (chipset, GPU, canal de RAM, hallazgos esperados) y envíalo en un pull request.

### Publicar una versión

1. Sube la versión en `package.json`.
2. Crea una etiqueta: `git tag v1.4.0 && git push --tags`.
3. GitHub Actions ejecuta las pruebas, compila `HardScope-Setup.exe` y `HardScope-Portable.exe` y los publica en Releases. Los enlaces de *Descarga directa* apuntan solos a la nueva versión, y la app avisa desde *Acerca de → Buscar actualizaciones*.

## Vista Simple y vista Developer

Arriba a la derecha hay un selector **Simple / Developer** que se recuerda entre sesiones. Los dos modos muestran **los mismos resultados**; solo cambia el nivel de detalle:

| | Simple (por defecto) | Developer |
|---|---|---|
| Lenguaje | Cotidiano, sin siglas ni índices: *"Tu memoria RAM funciona más lenta de lo que puede"* | Técnico: *"La RAM no va a su velocidad: 4800 de 5200 MT/s"* |
| Diagnóstico | Lo importante primero; "lo que está bien" plegado; explicación técnica desplegable | Cada hallazgo con su **evidencia**: índices, relación, umbrales, origen del dato e id |
| Resumen | Componentes e índice del equipo | Además, índice de cada componente, plataforma, enlace PCIe y el cálculo del índice |
| Placa vs GPU | La conclusión en una frase | Escala de índices, carriles PCIe y comparación CPU/GPU |
| Próxima mejora | El cambio, cuánto mejora y lo esencial de la comparación | Tabla completa, índices antes/después y criterio de selección |
| Monitor en vivo | CPU, GPU, RAM y temperatura | Además, núcleo más cargado, VRAM, gráfico y carga por hilo |
| Componentes | Inventario básico | Todo: PCIe, BIOS, números de parte, ranuras y origen de cada dato |

En ningún modo se ocultan avisos ni la lista "Verifica antes de comprar".

## Cómo interpretar los resultados

- **Índices estimados:** cada tarjeta y procesador tiene un índice de referencia (RTX 4090 = 100) aproximado a partir de pruebas públicas. Sirven para comparar componentes; no son FPS ni mediciones de tu equipo.
- **"El procesador limitaría ≈ X %"** es una tendencia según esos índices. El resultado real depende del juego, la resolución, la calidad y los límites de FPS. Para confirmarlo usa el **Monitor en vivo** mientras juegas.
- **Índice del equipo (0-100):** parte de 100 y resta por cada aviso (18 crítico, 8 advertencia, 2 consejo). Es un resumen de los avisos, no una medida de rendimiento. Los avisos de "dato no reconocido" no restan.
- **Compatibilidad de compra:** se deduce del chipset. Cada recomendación incluye **"Verifica antes de comprar"**: lista de CPUs compatibles y BIOS de tu placa, tamaño y conectores de la tarjeta, fuente, RAM y disipador.
- **Datos que no se pudieron leer:** la app los muestra en Diagnóstico y en el Resumen en lugar de ocultarlos.
- **Portátiles:** se detectan automáticamente y no se sugieren cambios de procesador, placa o tarjeta de video.
- **Privacidad:** todo se analiza en tu equipo; el reporte exportado no incluye el nombre del equipo salvo que lo actives en *Acerca de*.

## Licencia

MIT
