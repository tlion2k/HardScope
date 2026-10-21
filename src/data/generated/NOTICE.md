# Datos de terceros

Los archivos de esta carpeta los genera `scripts/import-external.js` a partir de datos públicos.

## Blender Open Data

- Origen: https://opendata.blender.org/ (instantánea diaria del conjunto completo)
- Licencia: Creative Commons Zero (CC0 1.0), dedicación al dominio público.
- Uso en HardScope: mediana de *samples per minute* por dispositivo en las escenas monster, junkshop y classroom (`blender` en `gpus-extra.json` y `cpus-blender.json`).

## open-gpu-db

- Origen: https://github.com/onepunk/open-gpu-db (`dist/catalog.json`)
- Licencia: Apache License 2.0. open-gpu-db incluye datos del proyecto dbgpu (licencia MIT); ver su archivo NOTICE.
- Uso en HardScope: nombre, marca, año, VRAM, interfaz PCIe y TDP de cada tarjeta (`gpus-extra.json`).
- Cambios: se seleccionan algunos campos, se excluyen aceleradores de centro de datos y se unen con los resultados de Blender Open Data.

## Valores estimados

El campo `est` (índice de juegos estimado) es un cálculo de HardScope, no un dato de estas fuentes: puntaje de Blender × factor calibrado con las tarjetas de `src/data/gpus.json`. El método y el error medido están en `meta.calibration`.
