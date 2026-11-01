/**
 * nucleo.js — lo que el complemento hace con los datos, sin Obsidian: leer los campos de una nota (frontmatter y campos
 * en línea `[clave:: valor]`, `clave:: valor`) y sus tareas como lo hace Dataview, juntar las tareas por exportar (las de
 * una nota, o las de los diarios de tareas y las notas de tarea del vault) en líneas de la sintaxis corta de Super
 * Productivity, y traducir esas líneas a los campos de su API REST local. Una página es un objeto
 * { ruta, nombre, ctime, campos, tareas }.
 */

// ---- campos en línea (como Dataview 0.5) ------------------------------------------------------------------------------

/** La clave canónica de un campo, como la de Dataview: «Fecha Límite» → «fecha-límite». */
export function canonica(clave) {
    let r = "";
    for (const parte of String(clave).match(/\p{Extended_Pictographic}|[0-9\p{Letter}_-]+|\s+|./gsu) ?? []) {
        if (/^\s+$/.test(parte)) r += "-";
        else if (/^[0-9\p{Letter}_-]+$/u.test(parte)) r += parte.toLowerCase();
        else if (/\p{Extended_Pictographic}/u.test(parte)) r += parte;
    }
    return r;
}

// ---- campos en línea --------------------------------------------------------------------------------------------------

const ENVOLTURAS = { "[": "]", "(": ")" };

/** El cierre que corresponde a la apertura, respetando anidamientos y escapes; el valor y el índice tras el cierre. */
function cierre(linea, desde, abre, cierra) {
    let nivel = 0;
    let escapado = false;
    for (let i = desde; i < linea.length; i++) {
        const c = linea.charAt(i);
        if (c === "\\") {
            escapado = !escapado;
            continue;
        }
        if (escapado) {
            escapado = false;
            continue;
        }
        if (c === abre) nivel++;
        else if (c === cierra) nivel--;
        if (nivel < 0) return { valor: linea.substring(desde, i).trim(), fin: i + 1 };
    }
    return undefined;
}

function campoEn(linea, inicio) {
    const abre = linea.charAt(inicio);
    const sep = linea.indexOf("::", inicio + 1);
    if (sep < 0) return undefined;
    const clave = linea.substring(inicio + 1, sep).trim();
    if (/[[\]()]/.test(clave)) return undefined;
    const v = cierre(linea, sep + 2, abre, ENVOLTURAS[abre]);
    if (!v) return undefined;
    return { clave, valor: v.valor, inicio, fin: v.fin };
}

const EMOJIS_DE_TAREA = [
    { re: /\u{2795}\s*(\d{4}-\d{2}-\d{2})/u, clave: "created" },
    { re: /\u{1F6EB}\s*(\d{4}-\d{2}-\d{2})/u, clave: "start" },
    { re: /[\u{23F3}\u{231B}]\s*(\d{4}-\d{2}-\d{2})/u, clave: "scheduled" },
    { re: /(?:\u{1F4C5}|\u{1F4C6}|\u{1F5D3}\u{FE0F}?)\s*(\d{4}-\d{2}-\d{2})/u, clave: "due" },
    { re: /\u{2705}\s*(\d{4}-\d{2}-\d{2})/u, clave: "completion" },
];

/** Los campos `[clave:: valor]` y `(clave:: valor)` de una línea, en orden y sin solaparse (más las fechas con emoji). */
export function camposEnLinea(linea, conEmojis = false) {
    let hallados = [];
    for (const abre of Object.keys(ENVOLTURAS)) {
        let i = linea.indexOf(abre);
        while (i >= 0) {
            const c = campoEn(linea, i);
            if (!c) {
                i = linea.indexOf(abre, i + 1);
                continue;
            }
            hallados.push(c);
            i = linea.indexOf(abre, c.fin);
        }
    }
    if (conEmojis)
        for (const { re, clave } of EMOJIS_DE_TAREA) {
            const m = re.exec(linea);
            if (m) hallados.push({ clave, valor: m[1], inicio: m.index, fin: m.index + m[0].length });
        }
    hallados.sort((a, b) => a.inicio - b.inicio);
    return hallados.filter((c, i, todos) => i === 0 || todos[i - 1].fin < c.inicio);
}

/** Un campo de línea completa, `clave:: valor` (la clave puede ir en negrita o cursiva); undefined si no lo es. */
export function campoDeLinea(linea) {
    const sep = linea.indexOf("::");
    if (sep < 0) return undefined;
    const m = /^[^0-9\w\p{Letter}]*((?:\p{Extended_Pictographic}|[0-9\p{Letter}\w\s_/-])*?)[_*~`]*$/u.exec(linea.substring(0, sep).trim());
    if (!m) return undefined;
    return { clave: m[1], valor: linea.substring(sep + 2).trim() };
}

/** El valor de un campo en línea: null si está vacío, el texto si no. */
export const valorEnLinea = (v) => (String(v).trim() === "" ? null : String(v).trim());

const LINEA_DE_LISTA = /^[\s>]*(\d+\.|\d+\)|\*|-|\+)\s*(\[.{0,1}\])?\s*(.*)$/mu;

function anadir(mapa, clave, valor) {
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(valor);
}

function unir(destino, fuente) {
    for (const [k, vs] of fuente) destino.set(k, destino.has(k) ? destino.get(k).concat(vs) : vs);
    return destino;
}

/**
 * Los campos y las tareas de una nota, como Dataview 0.5: el frontmatter; los `[clave:: valor]` (y los `clave:: valor`
 * de línea completa) de los elementos de lista que no son tareas; y los de los párrafos, encabezados, tablas… fuera de
 * las listas. Los campos de una tarea son de la tarea, no de la nota. `cache` trae de la caché de metadatos de Obsidian
 * `frontmatter`, `sections` [{ type, inicio, fin }] y `listItems` [{ inicio, fin, task }] (líneas desde 0). Un campo que
 * aparece varias veces vale la lista de sus valores; cada clave tiene además su forma canónica («Fecha Límite» →
 * «fecha-límite») si no existe ya.
 */
export function leerNota(contenido, cache = {}) {
    const lineas = String(contenido ?? "").split("\n");
    const delFrontmatter = new Map();
    const fm = cache.frontmatter ?? {};
    for (const k of Object.keys(fm)) if (k !== "position") anadir(delFrontmatter, k, fm[k]);
    const tareas = [];
    const delTexto = new Map();
    const enListas = new Set();
    // Un elemento por línea, el último: «- [ ] 1. algo» da en la caché una tarea y una lista numerada en la misma línea, y
    // Dataview se queda con la lista (la tarea no cuenta).
    const porLinea = new Map();
    for (const el of cache.listItems ?? []) {
        const m = LINEA_DE_LISTA.exec(lineas[el.inicio] ?? "");
        if (!m) continue;
        for (let i = el.inicio; i <= el.fin; i++) enListas.add(i);
        porLinea.set(el.inicio, { el, m });
    }
    for (const { el, m } of [...porLinea.values()].sort((a, b) => a.el.inicio - b.el.inicio)) {
        const partes = [m[3], ...lineas.slice(el.inicio + 1, el.fin + 1)].map((t) => t.trim());
        if (el.task) {
            tareas.push({ linea: el.inicio, estado: el.task, texto: partes.join("\n") });
            continue;
        }
        const sinSaltos = partes.join(" ");
        const propios = camposEnLinea(sinSaltos, true);
        for (const c of propios) anadir(delTexto, c.clave, valorEnLinea(c.valor));
        if (!propios.length) {
            const c = campoDeLinea(sinSaltos);
            if (c) anadir(delTexto, c.clave, valorEnLinea(c.valor));
        }
    }
    for (const s of cache.sections ?? []) {
        if (s.type === "list" || s.type === "ruling") continue;
        for (let i = s.inicio; i <= s.fin; i++) {
            const linea = lineas[i];
            if (linea === undefined || enListas.has(i) || linea.length > 32768 || !linea.includes("::")) continue;
            const t = linea.trim();
            const enLinea = camposEnLinea(t);
            if (enLinea.length) for (const c of enLinea) anadir(delTexto, c.clave, valorEnLinea(c.valor));
            else {
                const c = campoDeLinea(t);
                if (c) anadir(delTexto, c.clave, valorEnLinea(c.valor));
            }
        }
    }
    const crudos = unir(delFrontmatter, delTexto);
    const canonicos = new Map();
    for (const [k, vs] of crudos) {
        const c = canonica(k);
        if (c && !crudos.has(c)) canonicos.set(c, canonicos.has(c) ? canonicos.get(c).concat(vs) : vs);
    }
    const campos = {};
    for (const [k, vs] of unir(unir(new Map(), crudos), canonicos)) campos[k] = vs.length === 1 ? vs[0] : vs;
    return { campos, tareas };
}

/** ¿La ruta está en alguna de las carpetas? Sin carpetas, todo el vault. */
export const dentroDe = (ruta, carpetas = []) =>
    !carpetas.length || carpetas.some((c) => c === "/" || c === "" || ruta === c || ruta.startsWith(c.replace(/\/+$/, "") + "/"));

const tipoDe = (x) => (Array.isArray(x) ? "array" : typeof x === "object" ? "object" : typeof x);

/**
 * Comparar dos valores como Dataview: null primero, los de tipos distintos por el nombre del tipo, los números por
 * valor, los textos por localeCompare y las listas por elementos.
 */
export function comparar(a, b) {
    const n = (x) => (x === undefined ? null : x);
    [a, b] = [n(a), n(b)];
    if (a === null && b === null) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    if (Array.isArray(a) && Array.isArray(b)) {
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
            const r = comparar(a[i], b[i]);
            if (r) return r;
        }
        return a.length - b.length;
    }
    const [ta, tb] = [tipoDe(a), tipoDe(b)];
    if (ta !== tb) return ta.localeCompare(tb);
    if (ta === "number") return a - b;
    if (ta === "boolean") return Number(a) - Number(b);
    return String(typeof a === "object" ? JSON.stringify(a) : a).localeCompare(String(typeof b === "object" ? JSON.stringify(b) : b));
}

// ---- opciones de un bloque ----------------------------------------------------------------------------------------------

const camello = (k) => k.trim().replace(/[-_ ]+(\p{Letter})/gu, (m, l) => l.toUpperCase());

/** Las opciones de un bloque: una por línea, `clave: valor` (en kebab o en camello); `carpetas` es una lista con comas. */
export function opcionesDeBloque(fuente) {
    const o = {};
    for (const l of String(fuente ?? "").split("\n")) {
        const i = l.indexOf(":");
        if (!l.trim() || l.trim().startsWith("#") || i < 0) continue;
        const k = camello(l.slice(0, i));
        const v = l.slice(i + 1).trim();
        o[k] = /^carpetas/.test(k)
            ? v
                  .split(",")
                  .map((x) => x.trim().replace(/^["']|["']$/g, ""))
                  .filter(Boolean)
            : v.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
    }
    return o;
}

// ---- las líneas por exportar --------------------------------------------------------------------------------------------

/** Una tarea o un nombre como texto de una línea: los [[enlaces]] por su texto y los espacios seguidos por uno. */
export const limpiar = (texto) =>
    String(texto ?? "")
        .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
        .replace(/\s+/g, " ")
        .trim();

/** ¿Hecha? Como Dataview: solo `x` y `X`; las canceladas (`-`) y demás estados siguen pendientes. */
export const hecha = (t) => t.estado === "x" || t.estado === "X";

/** Las tareas sin completar de una página, limpias y sin las vacías (las casillas aún sin texto no se exportan). */
export const pendientes = (p) =>
    p.tareas
        .filter((t) => !hecha(t))
        .map((t) => limpiar(t.texto))
        .filter((t) => t.length > 0);

const FECHA = /^(\d{4})-(\d{2})-(\d{2})/;

/** Un valor de un campo como texto: el primero si es una lista, sin [[ ]], vacío si no hay. */
export function texto(v) {
    if (Array.isArray(v)) return texto(v.find((x) => x !== null && x !== undefined && x !== ""));
    if (v === null || v === undefined) return "";
    return limpiar(typeof v === "object" ? JSON.stringify(v) : v);
}

/** Una fecha límite como `AAAA-MM-DD` (sin la hora, si la trae); lo que no es fecha, tal cual. */
export const fecha = (v) => {
    const t = texto(v);
    return FECHA.exec(t)?.[0] ?? t;
};

/**
 * La clave con que se ordenan las notas de tarea, como Dataview ordena `fecha_limite ?? file.ctime`: una fecha (la
 * límite, o la de creación si no hay campo) antes que un texto; las fechas por su instante, los textos entre sí.
 */
export function claveDeOrden(p, campoFecha) {
    const v = p.campos[campoFecha];
    if (v === null || v === undefined) return { fecha: p.ctime };
    const m = FECHA.exec(String(v));
    if (m && !Array.isArray(v)) return { fecha: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() };
    return { texto: Array.isArray(v) ? v.join(", ") : String(v) };
}

const compararClaves = (a, b) =>
    "fecha" in a && "fecha" in b ? a.fecha - b.fecha : "fecha" in a ? -1 : "fecha" in b ? 1 : a.texto.localeCompare(b.texto);

const porRuta = (a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0);

/** La línea de una nota de tarea: su nombre sin el prefijo de fecha, `+proyecto`, el estimado y `@fecha`. */
export function lineaDeNota(p, o) {
    const prefijo = o.prefijo ? new RegExp(o.prefijo, "i") : null;
    let linea = limpiar(prefijo ? p.nombre.replace(prefijo, "") : p.nombre);
    const proyecto = texto(p.campos[o.campoProyecto]);
    const estimado = texto(p.campos[o.campoEstimado]);
    const limite = fecha(p.campos[o.campoFecha]);
    if (proyecto) linea += ` +${proyecto.replace(/\s+/g, "-")}`;
    if (estimado) linea += ` ${estimado}`;
    if (limite) linea += ` @${limite}`;
    return linea;
}

/**
 * Todo lo accionable del vault: (1) las tareas sin completar de los diarios de tareas (páginas de `o.diarios.carpetas`
 * con el tipo `o.diarios.tipo`), por nombre; (2) una línea por nota de tarea (páginas de `o.notas.carpetas` con el tipo
 * `o.notas.tipo` y un estado de `o.notas.estados`), por fecha límite o, si no la tiene, por fecha de creación.
 */
export function lineasDelVault(paginas, o) {
    const tipo = o.campoTipo;
    const est = o.campoEstado;
    const deDiarios = paginas
        .filter((p) => dentroDe(p.ruta, o.diarios.carpetas) && p.campos[tipo] === o.diarios.tipo)
        .sort((a, b) => comparar(a.nombre, b.nombre) || porRuta(a, b))
        .flatMap(pendientes);
    const deNotas = paginas
        .filter((p) => dentroDe(p.ruta, o.notas.carpetas) && p.campos[tipo] === o.notas.tipo && o.notas.estados.includes(p.campos[est]))
        .map((p) => ({ p, k: claveDeOrden(p, o.notas.campoFecha) }))
        .sort((a, b) => compararClaves(a.k, b.k) || porRuta(a.p, b.p))
        .map(({ p }) => lineaDeNota(p, o.notas));
    return [...deDiarios, ...deNotas];
}

// ---- de la sintaxis corta a la API REST -----------------------------------------------------------------------------------
// La barra «Añadir tarea» de Super Productivity entiende la sintaxis corta; su API REST no: allí cada cosa es un campo.

const RE_ETIQUETA = /(?<!\S)#([\p{L}\p{N}_/-]+)/gu;
const RE_PROYECTO = /(?<!\S)\+([\p{L}\p{N}_-]+)/gu;
const RE_ARROBA = /(?<!\S)@(\S+)/gu;
const RE_ESTIMADO = /^(?:(?:\d+h)?(?:\d+m)?\/)?((?:\d+h)(?:\d+m)?|\d+m)$/;
const RE_DURACION = /^(?:(\d+)h)?(?:(\d+)m)?$/;

const dos = (x) => String(x).padStart(2, "0");

/** «AAAA-MM-DD» de un instante, en hora local. */
export const fechaLocal = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
};

/** Milisegundos de un estimado «1h30m», «45m» o «2h»; 0 si no lo es. */
export function duracionMs(t) {
    const m = RE_DURACION.exec(t ?? "");
    if (!t || !m || (!m[1] && !m[2])) return 0;
    return (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60000;
}

/** { dia, hora } de `@AAAA-MM-DD`, `@hoy`, `@mañana` o `@HH:MM` (esta última, hoy a esa hora). */
export function cuando(valor, hoy = Date.now()) {
    const v = String(valor).toLowerCase();
    if (v === "hoy" || v === "today") return { dia: fechaLocal(hoy), hora: "" };
    if (["mañana", "manana", "tomorrow"].includes(v)) {
        const d = new Date(hoy);
        return { dia: fechaLocal(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()), hora: "" };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { dia: v, hora: "" };
    if (/^\d{1,2}:\d{2}$/.test(v)) return { dia: fechaLocal(hoy), hora: v.padStart(5, "0") };
    return { dia: "", hora: "" };
}

/**
 * Una línea de la sintaxis corta como tarea: { titulo, proyecto, etiquetas, estimadoMs, dia, hora }, o null si no hay
 * título. El proyecto vuelve con espacios («mi-proyecto» → «mi proyecto»); el estimado puede ir como gastado/estimado.
 */
export function leerLinea(linea, hoy = Date.now()) {
    let t = String(linea ?? "").trim();
    if (!t || t.startsWith("<!--") || t.startsWith("##") || t.startsWith("```")) return null;
    t = t.replace(/^[-*]\s+(\[[ xX]\]\s+)?/, "");
    const r = { titulo: "", proyecto: "", etiquetas: [], estimadoMs: 0, dia: "", hora: "" };
    r.etiquetas = [...t.matchAll(RE_ETIQUETA)].map((m) => m[1]);
    const p = [...t.matchAll(RE_PROYECTO)].map((m) => m[1]);
    r.proyecto = p.length ? p[0].replace(/-/g, " ") : "";
    for (const m of t.matchAll(RE_ARROBA)) {
        const c = cuando(m[1], hoy);
        r.dia = c.dia || r.dia;
        r.hora = c.hora || r.hora;
    }
    const resto = t.replace(RE_ETIQUETA, "").replace(RE_PROYECTO, "").replace(RE_ARROBA, "");
    const palabras = [];
    for (const w of resto.split(/\s+/).filter(Boolean)) {
        const m = RE_ESTIMADO.exec(w);
        if (m) r.estimadoMs = duracionMs(m[1]);
        else palabras.push(w);
    }
    r.titulo = palabras.join(" ").trim();
    return r.titulo ? r : null;
}

/**
 * El cuerpo de `POST /tasks` de una tarea y sus avisos. `proyectos` y `etiquetas` son mapas {nombre en minúsculas: id}
 * de lo que existe en Super Productivity: su API no crea proyectos ni etiquetas, así que lo que falta se avisa (la tarea
 * va a la bandeja, la etiqueta se omite).
 */
export function cuerpo(t, proyectos = {}, etiquetas = {}) {
    const avisos = [];
    const c = { title: t.titulo };
    if (t.estimadoMs) c.timeEstimate = t.estimadoMs;
    if (t.proyecto) {
        const id = proyectos[t.proyecto.toLowerCase()];
        if (id) c.projectId = id;
        else avisos.push(`el proyecto «${t.proyecto}» no existe en Super Productivity: va a la bandeja`);
    }
    const ids = [];
    for (const e of t.etiquetas) {
        const id = etiquetas[e.toLowerCase()];
        if (id) ids.push(id);
        else avisos.push(`la etiqueta «${e}» no existe en Super Productivity: se omite`);
    }
    if (ids.length) c.tagIds = ids;
    if (t.dia && t.hora) c.dueWithTime = new Date(`${t.dia}T${t.hora}:00`).getTime();
    else if (t.dia) c.dueDay = t.dia;
    return { cuerpo: c, avisos };
}

/** {título en minúsculas: id} de una lista de Super Productivity; con dos del mismo nombre, el que más tareas tiene. */
export function idsPorTitulo(lista = []) {
    const elegido = new Map();
    for (const x of lista) {
        if (x.isArchived) continue;
        const k = String(x.title ?? "").toLowerCase();
        const antes = elegido.get(k);
        if (!antes || (x.taskIds?.length ?? 0) > (antes.taskIds?.length ?? 0)) elegido.set(k, x);
    }
    return Object.fromEntries([...elegido].map(([k, x]) => [k, x.id]));
}

/**
 * El plan de envío: por línea, la tarea, su cuerpo, sus avisos y si ya está (una tarea sin hacer con el mismo título en
 * Super Productivity, o repetida más arriba en el mismo envío), que no se vuelve a crear.
 */
export function planDeEnvio(lineas, sp = {}, hoy = Date.now()) {
    const proyectos = idsPorTitulo(sp.proyectos);
    const etiquetas = idsPorTitulo(sp.etiquetas);
    const vistos = new Set((sp.tareas ?? []).filter((t) => !t.isDone).map((t) => String(t.title ?? "").toLowerCase()));
    const r = [];
    for (const linea of lineas) {
        const t = leerLinea(linea, hoy);
        if (!t) continue;
        const { cuerpo: c, avisos } = cuerpo(t, proyectos, etiquetas);
        const clave = t.titulo.toLowerCase();
        r.push({ linea, tarea: t, cuerpo: c, avisos, yaEsta: vistos.has(clave) });
        vistos.add(clave);
    }
    return r;
}
