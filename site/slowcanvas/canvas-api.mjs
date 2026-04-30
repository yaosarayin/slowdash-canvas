// canvas-api.mjs — REST client for the slowdash backend
// Author: Yao Yin
//
// Wraps the existing slowdash API endpoints. No custom backend is required.
//
// Canvas layouts are saved as `slowdash-NAME.json` so the existing
// slowdash.html viewer can load them as a single canvas-panel page (slowdash.mjs
// auto-wraps any document containing { view_box, items } as a canvas panel).
//
// Save flow:
//   POST /api/config/file/FILENAME            — server returns 202 if file exists.
//   POST /api/config/file/FILENAME?overwrite=yes — forced overwrite on 202.


export class CanvasAPI {

    // ── Project ──────────────────────────────────────────────────────────── //

    static async getProjectConfig() {
        const resp = await fetch('./api/config');
        if (!resp.ok) throw new Error(`Config fetch failed: ${resp.status}`);
        return resp.json();
    }


    // ── File helpers ─────────────────────────────────────────────────────── //

    static async listFiles(prefix = '') {
        const resp = await fetch('./api/config/filelist');
        if (!resp.ok) return [];
        const files = await resp.json();
        return prefix ? files.filter(f => f.name.startsWith(prefix)) : files;
    }

    static async loadJSON(filename) {
        const resp = await fetch(`./api/config/file/${filename}`);
        if (!resp.ok) throw new Error(`Cannot load ${filename}: HTTP ${resp.status}`);
        return resp.json();
    }

    static async loadText(filename) {
        const resp = await fetch(`./api/config/file/${filename}`);
        if (!resp.ok) throw new Error(`Cannot load ${filename}: HTTP ${resp.status}`);
        return resp.text();
    }

    static async saveFile(filename, content, contentType = 'application/json; charset=utf-8') {
        const body = (typeof content === 'string') ? content : JSON.stringify(content, null, 2);

        let resp = await fetch(`./api/config/file/${filename}`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body,
        });

        if (resp.status === 202) {
            resp = await fetch(`./api/config/file/${filename}?overwrite=yes`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body,
            });
        }

        if (!resp.ok) throw new Error(`Cannot save ${filename}: HTTP ${resp.status}`);
        return true;
    }

    /** Save a canvas layout — uses the slowdash- prefix so slowdash.html can render it. */
    static async saveCanvasLayout(name, layout) {
        return CanvasAPI.saveFile(`slowdash-${name}.json`, layout);
    }

    /** Load a canvas layout by name or by full filename. */
    static async loadCanvasLayout(nameOrFile) {
        const filename = nameOrFile.endsWith('.json') ? nameOrFile : `slowdash-${nameOrFile}.json`;
        return CanvasAPI.loadJSON(filename);
    }

    /** Upload an SVG file (used as a canvas background image). */
    static async uploadSVG(filename, svgContent) {
        return CanvasAPI.saveFile(filename, svgContent, 'image/svg+xml; charset=utf-8');
    }


    // ── Data ─────────────────────────────────────────────────────────────── //

    static async listChannels() {
        const resp = await fetch('./api/channels');
        if (!resp.ok) return [];
        return resp.json();
    }

    static async getData(channels, length = 60, to = 0) {
        const channelStr = Array.isArray(channels) ? channels.join(',') : channels;
        let url = `./api/data/${channelStr}?length=${length}`;
        if (to > 0) url += `&to=${to}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return resp.json();
    }


    // ── Control ──────────────────────────────────────────────────────────── //

    static async sendCommand(action, params = {}) {
        const resp = await fetch('./api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ [action]: true, ...params }),
        });
        if (!resp.ok) throw new Error(`Command "${action}" failed: HTTP ${resp.status}`);
        return resp.json().catch(() => true);
    }
}
