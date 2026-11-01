// esbuild.config.mjs — empaqueta src/ en main.js (formato de complemento de Obsidian). `--vigilar` recompila al guardar.
import esbuild from "esbuild";

const vigilar = process.argv.includes("--vigilar");
const contexto = await esbuild.context({
    entryPoints: ["src/main.js"],
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    outfile: "main.js",
    minify: !vigilar,
    sourcemap: vigilar ? "inline" : false,
    logLevel: "info",
    banner: { js: "/* Exportar a Super Productivity — https://github.com/achalmed/obsidian-super-productivity (MIT). */" },
});
if (vigilar) await contexto.watch();
else {
    await contexto.rebuild();
    await contexto.dispose();
}
