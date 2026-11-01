/**
 * main.js — Exportar a Super Productivity, complemento de Obsidian (https://github.com/achalmed/obsidian-super-productivity).
 *
 * Convierte las tareas del vault en líneas de la sintaxis corta de Super Productivity (`<texto> +<proyecto> #<etiqueta>
 * <estimado> @<fecha>`), listas para pegar en su barra «Añadir tarea». Un bloque ```super-productivity``` las muestra
 * (las de la nota, o con `origen: tareas` las de los diarios de tareas y las notas de tarea del vault) y se recalcula
 * solo; las órdenes «Copiar…» las dejan en el portapapeles. Las órdenes «Enviar…» las crean por la API REST local de
 * Super Productivity (Ajustes → Misceláneo), después de mostrar lo que harían; no escriben nada más ni en otro sitio.
 * Lee el frontmatter y los campos en línea `[clave:: valor]` como Dataview, sin necesitarlo. El núcleo está en nucleo.js.
 */
import {
    Plugin,
    PluginSettingTab,
    Setting,
    Notice,
    Modal,
    MarkdownRenderer,
    MarkdownRenderChild,
    Component,
    TFile,
    debounce,
    requestUrl,
} from "obsidian";
import * as n from "./nucleo.js";

const AJUSTES = {
    campoTipo: "tipo",
    campoEstado: "estado",
    diarios: { carpetas: [], tipo: "tareas" },
    notas: {
        carpetas: [],
        tipo: "tarea",
        estados: ["siguiente", "activo"],
        campoProyecto: "proyecto",
        campoEstimado: "sp_est",
        campoFecha: "fecha_limite",
        prefijo: "^\\d{4}-\\d{2}-\\d{2}(?: Tarea - |-tarea-)",
    },
    mensaje: "Copia el bloque (botón 📋 del bloque de código) y pega **línea por línea** en la barra *Add task* de Super Productivity:",
    vacio: "✅ Nada que exportar.",
    api: "http://127.0.0.1:3876",
};

export default class ExportarSuperProductivity extends Plugin {
    async onload() {
        const g = (await this.loadData()) || {};
        const d = structuredClone(AJUSTES);
        this.ajustes = { ...d, ...g, diarios: { ...d.diarios, ...(g.diarios || {}) }, notas: { ...d.notas, ...(g.notas || {}) } };
        this.indice = new Map();
        this.vivos = new Set();
        this.refrescar = debounce(() => this.vivos.forEach((b) => b.pintar()), 1500, true);

        this.registerMarkdownCodeBlockProcessor("super-productivity", (fuente, el, ctx) => ctx.addChild(new Bloque(this, el, fuente, ctx)));
        this.registerEvent(this.app.metadataCache.on("changed", (f) => (this.indice.delete(f.path), this.refrescar())));
        this.registerEvent(this.app.metadataCache.on("resolved", () => this.refrescar()));
        this.registerEvent(this.app.vault.on("delete", (f) => (this.indice.delete(f.path), this.refrescar())));
        this.registerEvent(this.app.vault.on("rename", (f, antes) => (this.indice.delete(antes), this.refrescar())));

        const deLaNota = (accion) => (comprobando) => {
            const f = this.app.workspace.getActiveFile();
            if (!f || f.extension !== "md") return false;
            if (!comprobando) accion("actual", f.path);
            return true;
        };
        this.addCommand({ id: "copiar-nota", name: "Copiar las tareas de esta nota", checkCallback: deLaNota((o, r) => this.copiar(o, r)) });
        this.addCommand({ id: "copiar-tareas", name: "Copiar las tareas activas del vault", callback: () => this.copiar("tareas") });
        this.addCommand({ id: "enviar-nota", name: "Enviar las tareas de esta nota…", checkCallback: deLaNota((o, r) => this.enviar(o, r)) });
        this.addCommand({ id: "enviar-tareas", name: "Enviar las tareas activas del vault…", callback: () => this.enviar("tareas") });
        this.addSettingTab(new PestanaAjustes(this.app, this));
    }

    async guardar() {
        await this.saveData(this.ajustes);
    }

    /** Las opciones de un bloque o de una orden: los ajustes, con lo que el bloque cambie. */
    opciones(b = {}) {
        const a = this.ajustes;
        return {
            origen: b.origen || "actual",
            mensaje: b.mensaje ?? a.mensaje,
            vacio: b.vacio ?? a.vacio,
            campoTipo: a.campoTipo,
            campoEstado: a.campoEstado,
            diarios: { ...a.diarios, ...(b.carpetasDiarios ? { carpetas: b.carpetasDiarios } : {}) },
            notas: { ...a.notas, ...(b.carpetasNotas ? { carpetas: b.carpetasNotas } : {}) },
        };
    }

    // ---- lectura ------------------------------------------------------------------------------------------------------

    /** Una nota como página del núcleo; se guarda mientras no cambie. */
    async pagina(f) {
        const guardada = this.indice.get(f.path);
        if (guardada && guardada.mtime === f.stat.mtime && guardada.size === f.stat.size) return guardada.pagina;
        const cache = this.app.metadataCache.getFileCache(f) ?? {};
        const linea = (p) => ({ inicio: p.position.start.line, fin: p.position.end.line });
        const { campos, tareas } = n.leerNota(await this.app.vault.cachedRead(f), {
            frontmatter: cache.frontmatter,
            sections: (cache.sections ?? []).map((s) => ({ type: s.type, ...linea(s) })),
            listItems: (cache.listItems ?? []).map((l) => ({ task: l.task, ...linea(l) })),
        });
        const pagina = { ruta: f.path, nombre: f.basename, ctime: f.stat.ctime, campos, tareas };
        this.indice.set(f.path, { mtime: f.stat.mtime, size: f.stat.size, pagina });
        return pagina;
    }

    /** Las líneas por exportar: las tareas pendientes de la nota `ruta` («actual») o lo accionable del vault («tareas»). */
    async lineas(o, ruta) {
        if (o.origen === "actual") {
            const f = this.app.vault.getAbstractFileByPath(ruta);
            return f instanceof TFile ? n.pendientes(await this.pagina(f)) : [];
        }
        if (o.origen !== "tareas") throw new Error(`origen desconocido «${o.origen}»: actual o tareas`);
        const archivos = this.app.vault
            .getMarkdownFiles()
            .filter((f) => n.dentroDe(f.path, o.diarios.carpetas) || n.dentroDe(f.path, o.notas.carpetas));
        return n.lineasDelVault(await Promise.all(archivos.map((f) => this.pagina(f))), o);
    }

    // ---- órdenes ------------------------------------------------------------------------------------------------------

    async copiar(origen, ruta) {
        const lineas = await this.lineas(this.opciones({ origen }), ruta);
        if (!lineas.length) return new Notice(this.ajustes.vacio);
        await navigator.clipboard.writeText(lineas.join("\n"));
        new Notice(`📋 ${lineas.length} línea(s) copiada(s): pégalas en la barra «Add task» de Super Productivity.`);
    }

    async enviar(origen, ruta) {
        const lineas = await this.lineas(this.opciones({ origen }), ruta);
        if (!lineas.length) return new Notice(this.ajustes.vacio);
        const sp = new ApiSP(this.ajustes.api);
        let datos;
        try {
            datos = await sp.leer();
        } catch (e) {
            return new Notice(`Super Productivity: ${e.message}`, 10000);
        }
        new Envio(this.app, sp, n.planDeEnvio(lineas, datos)).open();
    }
}

/** La API REST local de Super Productivity (18.x): GET /health, /projects, /tags, /tasks y POST /tasks. */
class ApiSP {
    constructor(base) {
        this.base = String(base || AJUSTES.api).replace(/\/+$/, "");
    }

    async pedir(metodo, ruta, cuerpo) {
        let r;
        try {
            r = await requestUrl({
                url: this.base + ruta,
                method: metodo,
                contentType: "application/json",
                body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
                throw: false,
            });
        } catch (e) {
            throw new Error(`no responde en ${this.base} (¿cerrado, o con la API REST local apagada en Ajustes → Misceláneo?)`);
        }
        let j;
        try {
            j = r.json;
        } catch (e) {
            j = null;
        }
        if (r.status >= 400 || !j || !j.ok) throw new Error(`${metodo} ${ruta}: HTTP ${r.status} ${j?.error?.message ?? ""}`.trim());
        return j.data;
    }

    /** Lo que hace falta para el plan: si está lista, sus proyectos, sus etiquetas y sus tareas. */
    async leer() {
        const salud = await this.pedir("GET", "/health");
        if (!salud?.rendererReady) throw new Error("está arrancando; inténtalo en unos segundos");
        const [proyectos, etiquetas, tareas] = await Promise.all([
            this.pedir("GET", "/projects"),
            this.pedir("GET", "/tags"),
            this.pedir("GET", "/tasks?includeDone=true"),
        ]);
        return { proyectos: proyectos ?? [], etiquetas: etiquetas ?? [], tareas: tareas ?? [] };
    }

    crear(cuerpo) {
        return this.pedir("POST", "/tasks", cuerpo);
    }
}

/** El envío: primero muestra lo que se crearía (y lo que ya está o falta); escribe solo al confirmar. */
class Envio extends Modal {
    constructor(app, sp, plan) {
        super(app);
        this.sp = sp;
        this.plan = plan;
    }

    onOpen() {
        const { contentEl } = this;
        const nuevas = this.plan.filter((x) => !x.yaEsta);
        this.setTitle("Enviar a Super Productivity");
        contentEl.createEl("p", {
            text: `Simulación: nada se ha escrito todavía. Se crearían ${nuevas.length} tarea(s) en ${this.sp.base}; las que ya están sin hacer allí se saltan.`,
        });
        const ul = contentEl.createEl("ul", { cls: "super-productivity-plan" });
        for (const x of this.plan) {
            const li = ul.createEl("li", { cls: x.yaEsta ? "super-productivity-ya" : "" });
            li.createSpan({ text: `${x.yaEsta ? "＝ ya está: " : "＋ "}${x.linea}` });
            for (const a of x.avisos) li.createEl("div", { cls: "super-productivity-aviso", text: `⚠️ ${a}` });
        }
        const botones = new Setting(contentEl);
        botones.addButton((b) => b.setButtonText("Cancelar").onClick(() => this.close()));
        if (nuevas.length)
            botones.addButton((b) =>
                b
                    .setButtonText(`Crear ${nuevas.length} tarea(s)`)
                    .setCta()
                    .onClick(async () => {
                        b.setDisabled(true);
                        await this.crear(nuevas);
                        this.close();
                    }),
            );
    }

    async crear(nuevas) {
        let hechas = 0;
        for (const x of nuevas) {
            try {
                await this.sp.crear(x.cuerpo);
                hechas++;
            } catch (e) {
                new Notice(`Super Productivity: «${x.tarea.titulo}»: ${e.message}`, 10000);
                break;
            }
        }
        new Notice(`✅ ${hechas} de ${nuevas.length} tarea(s) creada(s) en Super Productivity.`);
    }

    onClose() {
        this.contentEl.empty();
    }
}

/** Un bloque ```super-productivity```: el mensaje y las líneas en un bloque de código; se repinta al cambiar el vault. */
class Bloque extends MarkdownRenderChild {
    constructor(plugin, el, fuente, ctx) {
        super(el);
        this.plugin = plugin;
        this.fuente = fuente;
        this.ctx = ctx;
        this.turno = 0;
    }

    onload() {
        this.plugin.vivos.add(this);
        this.pintar();
    }

    onunload() {
        this.plugin.vivos.delete(this);
    }

    async pintar() {
        const turno = ++this.turno;
        const o = this.plugin.opciones(n.opcionesDeBloque(this.fuente));
        let partes;
        try {
            const lineas = await this.plugin.lineas(o, this.ctx.sourcePath);
            partes = lineas.length ? [o.mensaje, "```\n" + lineas.join("\n") + "\n```"] : [o.vacio];
        } catch (e) {
            console.error("[super-productivity]", e);
            partes = [`⚠️ Exportar a Super Productivity: ${e.message}`];
        }
        if (turno !== this.turno) return;
        // Se pinta fuera de la página y se cambia de una vez: un refresco que llega a media pintura no mezcla los dos.
        const hijo = this.addChild(new Component());
        const el = createDiv();
        for (const md of partes) await MarkdownRenderer.render(this.plugin.app, md, el.createDiv(), this.ctx.sourcePath, hijo);
        if (turno !== this.turno) return this.removeChild(hijo);
        if (this.hijo) this.removeChild(this.hijo);
        this.hijo = hijo;
        this.containerEl.addClass("super-productivity");
        this.containerEl.replaceChildren(...el.childNodes);
    }
}

class PestanaAjustes extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        const p = this.plugin;
        const a = p.ajustes;
        containerEl.empty();
        containerEl.createEl("p", {
            cls: "setting-item-description",
            text: "Bloques: ```super-productivity``` (las tareas pendientes de la nota) o con «origen: tareas» (las de los diarios de tareas y las notas de tarea). «carpetas-diarios:» y «carpetas-notas:» en el bloque mandan sobre lo de aquí.",
        });
        const texto = (obj, k, nombre, desc = "") =>
            new Setting(containerEl)
                .setName(nombre)
                .setDesc(desc)
                .addText((x) => x.setValue(String(obj[k] ?? "")).onChange(async (v) => ((obj[k] = v.trim()), await p.guardar())));
        const lista = (obj, k, nombre, desc) =>
            new Setting(containerEl)
                .setName(nombre)
                .setDesc(desc)
                .addTextArea((x) => {
                    x.inputEl.rows = 3;
                    x.inputEl.addClass("super-productivity-area");
                    x.setValue((obj[k] ?? []).join("\n")).onChange(async (t) => {
                        obj[k] = t
                            .split("\n")
                            .map((l) => l.trim())
                            .filter(Boolean);
                        await p.guardar();
                    });
                });

        new Setting(containerEl).setName("Campos").setHeading();
        texto(a, "campoTipo", "Campo del tipo");
        texto(a, "campoEstado", "Campo del estado");

        new Setting(containerEl).setName("Diarios de tareas").setHeading();
        lista(a.diarios, "carpetas", "Carpetas", "Una por línea; se exportan sus tareas sin completar. Vacía = todo el vault.");
        texto(a.diarios, "tipo", "Tipo de un diario de tareas");

        new Setting(containerEl).setName("Notas de tarea").setHeading();
        lista(a.notas, "carpetas", "Carpetas", "Una por línea; cada nota de tarea da una línea. Vacía = todo el vault.");
        texto(a.notas, "tipo", "Tipo de una nota de tarea");
        lista(a.notas, "estados", "Estados que se exportan", "Uno por línea.");
        texto(a.notas, "campoProyecto", "Campo del proyecto", "Sale como +proyecto (los espacios, como guiones).");
        texto(a.notas, "campoEstimado", "Campo del estimado", "Sale tal cual (30m, 1h).");
        texto(a.notas, "campoFecha", "Campo de la fecha límite", "Sale como @AAAA-MM-DD y ordena las notas (sin ella, la fecha de creación).");
        texto(a.notas, "prefijo", "Prefijo que se quita del nombre", "Expresión regular (sin mayúsculas).");

        new Setting(containerEl).setName("Textos").setHeading();
        texto(a, "mensaje", "Encima de las líneas", "Markdown.");
        texto(a, "vacio", "Sin nada que exportar", "Markdown.");

        new Setting(containerEl).setName("Super Productivity").setHeading();
        texto(
            a,
            "api",
            "Dirección de la API REST local",
            "La de Super Productivity 18 o posterior (Ajustes → Misceláneo → Local REST API). Solo la usan las órdenes «Enviar…», que muestran antes lo que crearían.",
        );
    }
}
