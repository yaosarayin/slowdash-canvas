// canvas-api.mjs — REST client for the slowdash backend
// Author: Yao Yin
// Created: 2026-04-29
//
// Wraps the existing slowdash API endpoints.  No custom backend is required;
// every call goes through the standard /api/* routes already provided by slowdash.
//
// Upload/save flow:
//   1. POST /api/config/file/FILENAME        — first attempt (no overwrite flag)
//      Returns 202 if the file already exists.
//   2. POST /api/config/file/FILENAME?overwrite=yes  — forced overwrite on 202.


export class CanvasAPI {

    // ── Project ──────────────────────────────────────────────────────────── //

    /** Fetch the project-level config (title, style, datasources, etc.). */
    static async getProjectConfig() {
        const resp = await fetch('./api/config');
        if (!resp.ok) throw new Error(`Config fetch failed: ${resp.status}`);
        return resp.json();
    }


    // ── File helpers ─────────────────────────────────────────────────────── //

    /**
     * List files in the project config directory.
     * @param {string} prefix  Optional filename prefix filter (e.g. 'slowcanvas-').
     */
    static async listFiles(prefix = '') {
        const resp = await fetch('./api/config/filelist');
        if (!resp.ok) return [];
        const files = await resp.json();
        return prefix ? files.filter(f => f.name.startsWith(prefix)) : files;
    }

    /**
     * Fetch a config file as parsed JSON.
     * @param {string} filename  E.g. 'slowcanvas-Foo.json'
     */
    static async loadJSON(filename) {
        const resp = await fetch(`./api/config/file/${filename}`);
        if (!resp.ok) throw new Error(`Cannot load ${filename}: HTTP ${resp.status}`);
        return resp.json();
    }

    /**
     * Fetch a config file as raw text (e.g. for SVG content).
     * @param {string} filename  E.g. 'svg-FloorPlan.svg'
     */
    static async loadText(filename) {
        const resp = await fetch(`./api/config/file/${filename}`);
        if (!resp.ok) throw new Error(`Cannot load ${filename}: HTTP ${resp.status}`);
        return resp.text();
    }

    /**
     * Save content to a config file, overwriting if it already exists.
     * @param {string} filename      Destination filename in the config directory.
     * @param {string|object} content  String or object (serialised to JSON).
     * @param {string} contentType   MIME type for the request.
     */
    static async saveFile(filename, content, contentType = 'application/json; charset=utf-8') {
        const body = (typeof content === 'string') ? content : JSON.stringify(content, null, 2);

        // First attempt — server returns 202 when the file exists and overwrite is not set.
        let resp = await fetch(`./api/config/file/${filename}`, {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body,
        });

        if (resp.status === 202) {
            // File exists — retry with overwrite flag.
            resp = await fetch(`./api/config/file/${filename}?overwrite=yes`, {
                method: 'POST',
                headers: { 'Content-Type': contentType },
                body,
            });
        }

        if (!resp.ok) throw new Error(`Cannot save ${filename}: HTTP ${resp.status}`);
        return true;
    }

    /**
     * Save a canvas layout object as JSON.
     * @param {string} name    Layout name (without prefix/ext), e.g. 'FloorPlan'.
     * @param {object} layout  The canvas layout document.
     */
    static async saveCanvasLayout(name, layout) {
        return CanvasAPI.saveFile(`slowcanvas-${name}.json`, layout);
    }

    /**
     * Load a canvas layout by name.
     * @param {string} nameOrFile  Layout name ('FloorPlan') or full filename ('slowcanvas-FloorPlan.json').
     */
    static async loadCanvasLayout(nameOrFile) {
        const filename = nameOrFile.endsWith('.json') ? nameOrFile : `slowcanvas-${nameOrFile}.json`;
        return CanvasAPI.loadJSON(filename);
    }

    /**
     * Upload an SVG file to the project config directory.
     * @param {string} filename   Destination filename, e.g. 'svg-FloorPlan.svg'.
     * @param {string} svgContent  Raw SVG text.
     */
    static async uploadSVG(filename, svgContent) {
        return CanvasAPI.saveFile(filename, svgContent, 'image/svg+xml; charset=utf-8');
    }


    // ── Data ─────────────────────────────────────────────────────────────── //

    /** List all available data channels. */
    static async listChannels() {
        const resp = await fetch('./api/channels');
        if (!resp.ok) return [];
        return resp.json();
    }

    /**
     * Fetch the most recent data for one or more channels.
     * @param {string|string[]} channels  Channel name or array of names.
     * @param {number} length             Time window in seconds (default 60).
     * @param {number} to                 End timestamp (0 = now).
     */
    static async getData(channels, length = 60, to = 0) {
        const channelStr = Array.isArray(channels) ? channels.join(',') : channels;
        let url = `./api/data/${channelStr}?length=${length}`;
        if (to > 0) url += `&to=${to}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return resp.json();
    }


    // ── Control ──────────────────────────────────────────────────────────── //

    /**
     * Send a control command to a slowdash user module / task.
     * @param {string} action  Command name.
     * @param {object} params  Command parameters.
     */
    static async sendCommand(action, params = {}) {
        const resp = await fetch('./api/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ action, ...params }),
        });
        if (!resp.ok) {
            throw new Error(`Command "${action}" failed: HTTP ${resp.status}`);
        }
        return resp.json().catch(() => true);
    }
}
