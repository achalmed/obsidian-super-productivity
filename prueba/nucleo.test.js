// Pruebas del núcleo: `npm test` (node --test), sin Obsidian.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as n from "../src/nucleo.js";

/** Las secciones y elementos de lista que daría la caché de Obsidian para un texto sencillo (una línea por elemento). */
function cacheDe(texto, frontmatter = {}) {
    const lineas = texto.split("\n");
    const listItems = [];
    lineas.forEach((l, i) => {
        const m = /^\s*[-*+]\s+\[(.)\]/.exec(l);
        if (m) listItems.push({ inicio: i, fin: i, task: m[1] });
        else if (/^\s*[-*+]\s/.test(l)) listItems.push({ inicio: i, fin: i });
    });
    return { frontmatter, listItems, sections: [{ type: "paragraph", inicio: 0, fin: lineas.length - 1 }] };
}

const pagina = (ruta, texto, campos = {}, ctime = 0) => {
    const { campos: leidos, tareas } = n.leerNota(texto, cacheDe(texto, campos));
    return { ruta, nombre: ruta.split("/").pop().replace(/\.md$/, ""), ctime, campos: leidos, tareas };
};

const O = {
    campoTipo: "tipo",
    campoEstado: "estado",
    diarios: { carpetas: ["t"], tipo: "tareas" },
    notas: {
        carpetas: [],
        tipo: "tarea",
        estados: ["siguiente", "activo"],
        campoProyecto: "proyecto",
        campoEstimado: "sp_est",
        campoFecha: "fecha_limite",
        prefijo: "^\\d{4}-\\d{2}-\\d{2}(?: Tarea - |-tarea-)",
    },
};

test("limpiar: enlaces por su texto y espacios seguidos por uno", () => {
    assert.equal(n.limpiar("Leer  [[Acemoglu 2001|el paper]] y [[notas]] "), "Leer el paper y notas");
    assert.equal(n.limpiar("[[a#encabezado|b]]\tc"), "b c");
});

test("pendientes: las tareas sin hacer (las canceladas cuentan), sin las vacías", () => {
    const p = pagina("plan.md", "- [ ] uno [[x|equis]]\n- [x] hecha\n- [X] hecha\n- [-] cancelada\n- [ ] \n  - [ ] sub #a\n- lista");
    assert.deepEqual(n.pendientes(p), ["uno equis", "cancelada", "sub #a"]);
});

test("leerNota: los campos de una tarea son de la tarea; los de la nota, de la nota", () => {
    const p = pagina("n.md", "- [ ] algo [prioridad:: alta]\nproyecto:: Tesis\n- [area:: eco]", { tipo: "tarea" });
    assert.equal(p.campos.prioridad, undefined);
    assert.equal(p.campos.proyecto, "Tesis");
    assert.equal(p.campos.area, "eco");
    assert.equal(p.campos.tipo, "tarea");
    assert.deepEqual(n.pendientes(p), ["algo [prioridad:: alta]"]);
});

test("lineaDeNota: sin prefijo de fecha, con +proyecto, estimado y @fecha", () => {
    const p = pagina("x/2026-07-01 Tarea - Corregir exámenes.md", "", {
        proyecto: "Mi universidad",
        sp_est: "1h",
        fecha_limite: "2026-07-08",
    });
    assert.equal(n.lineaDeNota(p, O.notas), "Corregir exámenes +Mi-universidad 1h @2026-07-08");
    const q = pagina("x/2026-07-01-tarea-algo.md", "", { proyecto: "[[Tesis doctoral]]", sp_est: "", fecha_limite: "2026-07-08T10:00" });
    assert.equal(n.lineaDeNota(q, O.notas), "algo +Tesis-doctoral @2026-07-08");
    assert.equal(n.lineaDeNota(pagina("y/sin-fecha.md", ""), O.notas), "sin-fecha");
});

test("lineasDelVault: diarios por nombre y después notas de tarea por fecha límite o creación", () => {
    const ps = [
        pagina("t/2026-07-16-tareas.md", "- [ ] b\n- [x] hecha", { tipo: "tareas" }),
        pagina("t/2026-07-15-tareas.md", "- [ ] a", { tipo: "tareas" }),
        pagina("otra/2026-07-14-tareas.md", "- [ ] fuera de la carpeta", { tipo: "tareas" }),
        pagina("t/plan.md", "- [ ] no es diario", { tipo: "plan" }),
        pagina("n/sin-limite.md", "", { tipo: "tarea", estado: "activo" }, new Date(2026, 6, 10).getTime()),
        pagina("n/vacia.md", "", { tipo: "tarea", estado: "siguiente", fecha_limite: "" }, 0),
        pagina("n/pronto.md", "", { tipo: "tarea", estado: "siguiente", fecha_limite: "2026-07-05" }, new Date(2026, 6, 20).getTime()),
        pagina("n/hecha.md", "", { tipo: "tarea", estado: "hecho", fecha_limite: "2026-07-01" }),
    ];
    // «vacia» tiene fecha_limite "" (un texto): Dataview la deja después de todas las fechas.
    assert.deepEqual(n.lineasDelVault(ps, O), ["a", "b", "pronto @2026-07-05", "sin-limite", "vacia"]);
});

test("opcionesDeBloque: claves en kebab o camello, carpetas como lista", () => {
    assert.deepEqual(n.opcionesDeBloque('origen: tareas\n# nota\ncarpetas-notas: a, "b c"\nmensaje: "Hola: tú"'), {
        origen: "tareas",
        carpetasNotas: ["a", "b c"],
        mensaje: "Hola: tú",
    });
});

test("leerLinea: la sintaxis corta como campos (igual que planificar)", () => {
    const hoy = new Date(2026, 10, 1, 10).getTime();
    assert.deepEqual(n.leerLinea("Preparar clase de microeconomía +docencia 45m @2026-07-08", hoy), {
        titulo: "Preparar clase de microeconomía",
        proyecto: "docencia",
        etiquetas: [],
        estimadoMs: 2700000,
        dia: "2026-07-08",
        hora: "",
    });
    assert.deepEqual(n.leerLinea("- [ ] Revisar #trabajo/despacho +mi-proyecto 0m/1h30m @14:05", hoy), {
        titulo: "Revisar",
        proyecto: "mi proyecto",
        etiquetas: ["trabajo/despacho"],
        estimadoMs: 5400000,
        dia: "2026-11-01",
        hora: "14:05",
    });
    assert.equal(n.leerLinea("Llamar @mañana", hoy).dia, "2026-11-02");
    assert.equal(n.leerLinea("@hoy 30m", hoy), null);
    assert.equal(n.leerLinea("## título", hoy), null);
});

test("cuerpo: proyectos y etiquetas por nombre; lo que no existe se avisa", () => {
    const t = n.leerLinea("Leer #lectura #nueva +Tesis 30m @2026-07-08");
    const { cuerpo, avisos } = n.cuerpo(t, { tesis: "P1" }, { lectura: "E1" });
    assert.deepEqual(cuerpo, { title: "Leer", timeEstimate: 1800000, projectId: "P1", tagIds: ["E1"], dueDay: "2026-07-08" });
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /«nueva»/);
    const conHora = n.cuerpo(n.leerLinea("Llamar @09:30", new Date(2026, 6, 8, 7).getTime())).cuerpo;
    assert.equal(conHora.dueWithTime, new Date(2026, 6, 8, 9, 30).getTime());
    assert.equal(conHora.dueDay, undefined);
});

test("planDeEnvio: no repite lo que ya está sin hacer en Super Productivity ni dentro del mismo envío", () => {
    const sp = {
        proyectos: [{ id: "P1", title: "Docencia" }, { id: "P0", title: "Docencia", isArchived: true }],
        etiquetas: [
            { id: "E1", title: "lectura", taskIds: ["a"] },
            { id: "E2", title: "Lectura", taskIds: ["a", "b"] },
        ],
        tareas: [
            { title: "Leer paper", isDone: false },
            { title: "Corregir", isDone: true },
        ],
    };
    const plan = n.planDeEnvio(["Leer paper #lectura", "Corregir +docencia", "corregir", "", "Nueva #lectura"], sp);
    assert.deepEqual(
        plan.map((x) => [x.tarea.titulo, x.yaEsta]),
        [
            ["Leer paper", true],
            ["Corregir", false],
            ["corregir", true],
            ["Nueva", false],
        ],
    );
    assert.equal(plan[1].cuerpo.projectId, "P1");
    assert.deepEqual(plan[3].cuerpo.tagIds, ["E2"]);
});
