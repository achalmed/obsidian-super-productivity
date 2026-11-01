# Exportar a Super Productivity

Complemento de Obsidian que convierte las tareas del vault en líneas de la **sintaxis corta** de
[Super Productivity](https://super-productivity.com), listas para pegar en su barra «Add task» (una línea, una tarea).
Obsidian piensa (capturar, clarificar, decidir) y Super Productivity ejecuta (una tarea visible, el temporizador, el
registro). No hace falta Dataview.

````markdown
## Exportar a Super Productivity

```super-productivity
```
````

El bloque muestra un párrafo y un bloque de código con las líneas (su botón 📋 las copia), y se recalcula solo al
cambiar las notas.

## Qué exporta

- **Las tareas de la nota** (el bloque sin opciones, o `origen: actual`): sus casillas sin completar, en orden. Las
  marcadas con `x` o `X` no salen; las canceladas (`- [-]`) y las de otros estados sí. Las vacías tampoco salen, así una
  plantilla con `- [ ]` por rellenar no exporta nada.
- **Lo accionable del vault** (`origen: tareas`): primero las casillas sin completar de los **diarios de tareas**
  (notas con `tipo: tareas`, en orden de nombre), y después una línea por **nota de tarea** (`tipo: tarea` con
  `estado: siguiente` o `activo`), ordenadas por su fecha límite o, si no la tienen, por la fecha de creación.

En las dos, los `[[enlaces]]` se convierten en su texto y los espacios seguidos, en uno. La línea de una nota de tarea
es su nombre sin el prefijo de fecha (`2026-07-01 Tarea - `, `2026-07-01-tarea-`) más sus campos:

```
<texto de la tarea> +<proyecto> #<etiqueta> <estimado> @<AAAA-MM-DD>
```

```
Preparar clase de microeconomía +docencia 45m @2026-07-08
Leer paper de Acemoglu #lectura 30m
Corregir exámenes +universidad 1h
```

`proyecto` sale como `+proyecto` (los espacios como guiones, un enlace por su texto), `sp_est` como el estimado tal cual
(`30m`, `1h`) y `fecha_limite` como `@AAAA-MM-DD` (sin la hora, si la trae). Las `#etiquetas` van dentro del texto si
las escribiste. Los campos se leen del frontmatter y de los campos en línea `[clave:: valor]`, `(clave:: valor)` y
`clave:: valor`, igual que Dataview; los de una tarea son de la tarea, no de la nota.

### Opciones del bloque

Una por línea, `clave: valor` (en kebab o en camello), debajo de la apertura:

| opción | qué hace |
|---|---|
| `origen` | `actual` (por defecto) o `tareas` |
| `carpetas-diarios` | carpetas de los diarios de tareas, separadas por comas (manda sobre los ajustes) |
| `carpetas-notas` | carpetas de las notas de tarea |
| `mensaje` | el párrafo de encima de las líneas (Markdown) |
| `vacio` | lo que se muestra si no hay nada que exportar |

## Órdenes

| orden | qué hace |
|---|---|
| Copiar las tareas de esta nota | deja en el portapapeles las líneas de la nota abierta |
| Copiar las tareas activas del vault | lo mismo con lo accionable del vault |
| Enviar las tareas de esta nota… | las crea en Super Productivity por su API REST local |
| Enviar las tareas activas del vault… | lo mismo con lo accionable del vault |

Las órdenes de **enviar** son opcionales: necesitan Super Productivity 18 o posterior abierto y con la API REST local
activada (Ajustes → Misceláneo → «Local REST API», `127.0.0.1:3876`). Primero muestran una **simulación**: qué tareas se
crearían, las que ya están sin hacer en Super Productivity con el mismo título (se saltan, como las repetidas en el
mismo envío) y los proyectos o etiquetas que no existen allí (la API no los crea: la tarea va a la bandeja y la etiqueta
se omite). Solo al pulsar «Crear» escriben, y solo tareas nuevas por esa API: nunca tocan los archivos de datos de
Super Productivity. Traducen cada línea como la barra «Add task»: `+proyecto` y `#etiqueta` por su nombre, el estimado
(`30m`, `1h30m`, o gastado/estimado `0m/1h`) y `@AAAA-MM-DD`, `@hoy`, `@mañana` o `@HH:MM` (hoy a esa hora).

## Ajustes

Los campos del tipo y del estado (`tipo`, `estado`); las carpetas y el tipo de los diarios de tareas; las carpetas, el
tipo, los estados que se exportan, los campos del proyecto, del estimado y de la fecha límite y el prefijo del nombre de
las notas de tarea; los dos textos del bloque; y la dirección de la API REST. Sin carpetas, se mira todo el vault.

## Instalar

Desde una versión publicada: copia `main.js`, `manifest.json` y `styles.css` de la
[última versión](https://github.com/achalmed/obsidian-super-productivity/releases/latest) a
`<vault>/.obsidian/plugins/super-productivity/`, o instálalo con [BRAT](https://github.com/TfTHacker/obsidian42-brat)
dando `achalmed/obsidian-super-productivity`. Después: Ajustes → Complementos de la comunidad → activar «Exportar a
Super Productivity».

Desde este repo:

```bash
npm install
npm run build
./instalar.sh <ruta-del-vault>             # simula
./instalar.sh <ruta-del-vault> --aplicar
```

## Desarrollar

```bash
npm test     # el núcleo (src/nucleo.js): lectura de tareas y campos, las líneas, la sintaxis corta y el plan de envío
```

## Familia

Exportar a Super Productivity es parte de una familia de complementos independientes que se complementan por
convenciones de datos (frontmatter y campos en línea), no por dependencias:
[Omitir carpetas](https://github.com/achalmed/obsidian-omitir-carpetas) ·
[Formatear Markdown](https://github.com/achalmed/obsidian-formatear-markdown) ·
[Tema de iconos](https://github.com/achalmed/obsidian-tema-de-iconos) ·
[Captura](https://github.com/achalmed/obsidian-captura) ·
[Notas tipadas](https://github.com/achalmed/obsidian-notas-tipadas) ·
[Tableros](https://github.com/achalmed/obsidian-tableros) · Exportar a Super Productivity.

No está afiliado a Super Productivity.

## Licencia

MIT.
