// canvas-dialogs.mjs — dialog boxes and side panels for the canvas editor
// Author: Yao Yin
//
// Native <dialog> + plain CSS. No external dialog library.
//
// Exports:
//   openOpenCanvasDialog(files, onOpen)
//   openSaveCanvasDialog(currentName, onSave)
//   openCanvasSizeDialog(currentBounds, onApply)
//   openImageDialog(api, onPicked)
//   buildPropertiesPanel(container, { getPropertyFields })
//   buildCanvasInspector(container, editor)


// ── Generic helpers ─────────────────────────────────────────────────── //

function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else e.setAttribute(k, v);
    }
    for (const c of children) {
        if (c == null) continue;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
    }
    return e;
}

function openDialog(title, content, buttons = []) {
    const dlg = el('dialog', { class: 'sc-dialog' });
    dlg.appendChild(el('h3', { class: 'sc-dialog-title' }, title));
    dlg.appendChild(content);

    const btnRow = el('div', { class: 'sc-dialog-buttons' });
    for (const { label, primary, action } of buttons) {
        const btn = el('button', { class: primary ? 'sc-btn sc-btn-primary' : 'sc-btn' }, label);
        btn.addEventListener('click', () => {
            const keep = action();
            if (!keep) { dlg.close(); dlg.remove(); }
        });
        btnRow.appendChild(btn);
    }
    dlg.appendChild(btnRow);
    document.body.appendChild(dlg);
    dlg.showModal();

    const close = () => { dlg.close(); dlg.remove(); };
    dlg.addEventListener('cancel', close);
    return close;
}


// ── Open / Save ─────────────────────────────────────────────────────── //

export function openOpenCanvasDialog(files, onOpen) {
    if (!files.length) {
        alert('No saved canvas layouts found.\nSave a layout first using the Save button.');
        return;
    }

    const list = el('div', { class: 'sc-file-list' });
    let chosen = null;

    for (const f of files) {
        const display = String(f.name)
            .replace(/^slowdash-/, '')
            .replace(/\.json$/, '');
        const row = el('div', { class: 'sc-file-row' }, display);
        row.addEventListener('click', () => {
            list.querySelectorAll('.sc-file-row').forEach(r => r.classList.remove('sc-selected'));
            row.classList.add('sc-selected');
            chosen = f.name;
        });
        row.addEventListener('dblclick', () => {
            chosen = f.name;
            onOpen(chosen);
            const dlg = list.closest('dialog');
            if (dlg) { dlg.close(); dlg.remove(); }
        });
        list.appendChild(row);
    }

    const content = el('div', { class: 'sc-dialog-content' }, list);

    openDialog('Open Canvas', content, [
        {
            label: 'Open', primary: true,
            action: () => { if (!chosen) return true; onOpen(chosen); return false; },
        },
        { label: 'Cancel', action: () => false },
    ]);
}

export function openSaveCanvasDialog(currentName, onSave) {
    const nameInput  = el('input', { type: 'text', class: 'sc-input',
        value: currentName || '', placeholder: 'MyCanvas' });
    const titleInput = el('input', { type: 'text', class: 'sc-input',
        placeholder: 'Canvas title (optional)' });
    const feedback   = el('div',   { class: 'sc-upload-feedback' });

    const content = el('div', { class: 'sc-dialog-content' },
        el('label', {}, 'Layout name (used in URL):'), nameInput,
        el('label', {}, 'Title:'),                     titleInput,
        el('p', { style: { fontSize: '0.85em', color: '#888' } },
            'Saved as slowdash-NAME.json so it can be viewed by slowdash.html.'),
        feedback
    );

    openDialog('Save Canvas', content, [
        {
            label: 'Save', primary: true,
            action: () => {
                const name = nameInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
                if (!name) { feedback.textContent = 'Please enter a name.'; feedback.style.color = 'red'; return true; }
                onSave(name, titleInput.value.trim());
                return false;
            },
        },
        { label: 'Cancel', action: () => false },
    ]);
}


// ── Canvas size dialog ──────────────────────────────────────────────── //

export function openCanvasSizeDialog(current, onApply) {
    const wInput = el('input', { type: 'number', class: 'sc-input', value: current.width  || 1024, min: 50 });
    const hInput = el('input', { type: 'number', class: 'sc-input', value: current.height || 768,  min: 50 });
    const presets = [
        { label: '1024 × 768 (default)', w: 1024, h: 768 },
        { label: '1280 × 720 (HD)',      w: 1280, h: 720 },
        { label: '1920 × 1080 (FHD)',    w: 1920, h: 1080 },
        { label: '800 × 600',            w: 800,  h: 600 },
        { label: '640 × 480',            w: 640,  h: 480 },
    ];
    const presetSel = el('select', { class: 'sc-select' });
    presetSel.appendChild(el('option', { value: '' }, 'Choose preset…'));
    for (const p of presets) {
        const o = el('option', { value: `${p.w}x${p.h}` }, p.label);
        presetSel.appendChild(o);
    }
    presetSel.addEventListener('change', () => {
        const v = presetSel.value;
        if (!v) return;
        const [w, h] = v.split('x').map(Number);
        wInput.value = w; hInput.value = h;
    });

    const content = el('div', { class: 'sc-dialog-content' },
        el('label', {}, 'Preset:'),  presetSel,
        el('label', {}, 'Width:'),   wInput,
        el('label', {}, 'Height:'),  hInput,
    );

    openDialog('Canvas Size', content, [
        {
            label: 'Apply', primary: true,
            action: () => {
                const w = parseFloat(wInput.value);
                const h = parseFloat(hInput.value);
                if (!Number.isFinite(w) || !Number.isFinite(h) || w < 50 || h < 50) return true;
                onApply({ width: w, height: h });
                return false;
            },
        },
        { label: 'Cancel', action: () => false },
    ]);
}


// ── Image picker / SVG uploader ─────────────────────────────────────── //

/**
 * Pick an image source for an Image item: either upload a new SVG file (which
 * gets stored in the project config dir as an `svg-NAME.svg` file) or type
 * the filename of one that already lives there.
 *
 * Only SVG files are accepted — anything else is rejected with a clear message
 * since the canvas only renders inline SVG safely.
 *
 * @param {object}   api        CanvasAPI namespace (passed in to avoid a circular import).
 * @param {function} onPicked   Called with the chosen filename (string) when done.
 */
export function openImageDialog(api, onPicked) {
    let pickedFile  = null;
    let pickedText  = null;

    const drop = el('div', { class: 'sc-drop-zone' },
        'Drop an SVG file here, or click to browse.'
    );
    const fileInput = el('input', { type: 'file', accept: '.svg,image/svg+xml',
        style: { display: 'none' } });
    const feedback  = el('div', { class: 'sc-upload-feedback' });
    const nameInput = el('input', { type: 'text', class: 'sc-input',
        placeholder: 'svg-FloorPlan.svg' });

    const note = el('p', { style: { fontSize: '0.85em', color: '#777', margin: 0 } },
        'Only .svg files are accepted. Uploaded files are saved into the project ',
        'config directory and can be referenced by name later.');

    const content = el('div', { class: 'sc-dialog-content' },
        drop, fileInput,
        el('label', {}, 'Or use an existing file:'),
        nameInput,
        note,
        feedback
    );

    function isSvg(file) {
        if (!file) return false;
        const ok = (file.type === 'image/svg+xml') || /\.svg$/i.test(file.name);
        return ok;
    }

    function consumeFile(file) {
        if (!isSvg(file)) {
            pickedFile = pickedText = null;
            feedback.textContent = `Rejected: "${file?.name || 'unknown'}" is not an SVG. Only .svg files are accepted.`;
            feedback.style.color = '#c0392b';
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            pickedFile = file;
            pickedText = ev.target.result;
            const proposed = (nameInput.value.trim() || _suggestSvgName(file.name));
            nameInput.value = proposed;
            feedback.textContent = `Loaded "${file.name}" (${(pickedText.length / 1024).toFixed(1)} KB) — will save as "${proposed}".`;
            feedback.style.color = '#2ecc71';
        };
        reader.onerror = () => {
            feedback.textContent = `Could not read "${file.name}".`;
            feedback.style.color = '#c0392b';
        };
        reader.readAsText(file);
    }

    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => consumeFile(fileInput.files[0]));

    drop.addEventListener('dragover', (e) => {
        e.preventDefault();
        drop.classList.add('sc-drop-active');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('sc-drop-active'));
    drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('sc-drop-active');
        consumeFile(e.dataTransfer.files[0]);
    });

    openDialog('Add Image', content, [
        {
            label: 'Add', primary: true,
            action: async () => {
                const typed = nameInput.value.trim();

                // Path 1: file picked → upload + use that filename.
                if (pickedFile && pickedText) {
                    const filename = (typed || _suggestSvgName(pickedFile.name))
                        .replace(/[^a-zA-Z0-9._-]/g, '_');
                    if (!/\.svg$/i.test(filename)) {
                        feedback.textContent = 'Filename must end in .svg.';
                        feedback.style.color = '#c0392b';
                        return true;
                    }
                    try {
                        await api.uploadSVG(filename, pickedText);
                    } catch (e) {
                        feedback.textContent = `Upload failed: ${e.message}`;
                        feedback.style.color = '#c0392b';
                        return true;
                    }
                    onPicked(filename);
                    return false;
                }

                // Path 2: only a filename typed — reference an existing file.
                if (typed) {
                    if (!/\.svg$/i.test(typed)) {
                        feedback.textContent = 'Only .svg files are supported.';
                        feedback.style.color = '#c0392b';
                        return true;
                    }
                    onPicked(typed);
                    return false;
                }

                feedback.textContent = 'Drop an SVG file or type an existing filename.';
                feedback.style.color = '#c0392b';
                return true;
            },
        },
        { label: 'Cancel', action: () => false },
    ]);
}

function _suggestSvgName(originalName) {
    const base = (originalName || 'image.svg').replace(/\.svg$/i, '');
    return 'svg-' + base.replace(/[^a-zA-Z0-9._-]/g, '_') + '.svg';
}


// ── Properties panel (per-item) ─────────────────────────────────────── //

export function buildPropertiesPanel(container, { getPropertyFields }) {
    container.innerHTML = '';
    container.classList.add('sc-props-panel');

    const header      = el('div', { class: 'sc-props-header' }, 'Item Properties');
    const body        = el('div', { class: 'sc-props-body' });
    const placeholder = el('div', { class: 'sc-props-placeholder' },
        'Select an item to edit its properties.');

    container.appendChild(header);
    container.appendChild(body);
    body.appendChild(placeholder);

    let _currentConfig = null;
    let _onChange      = null;

    function show(config, onChange) {
        _currentConfig = config;
        _onChange      = onChange;
        body.innerHTML = '';

        const fields = getPropertyFields(config.type) || [];
        if (!fields.length) {
            body.appendChild(el('div', { class: 'sc-props-placeholder' },
                'No editable properties for this type.'));
            return;
        }

        const form = el('div', { class: 'sc-props-form' });

        // Type label at the top
        form.appendChild(el('div', { class: 'sc-props-row' },
            el('span', { style: { color: '#888', fontFamily: 'monospace', fontSize: '0.85em' } },
                config.type)
        ));

        for (const field of fields) {
            const row   = el('div', { class: 'sc-props-row' });
            row.appendChild(el('label', { class: 'sc-props-label' }, field.label));

            const current = _getPath(config, field.key);

            if (field.type === 'color') {
                const input = el('input', { type: 'color', class: 'sc-input-color',
                    value: _toHex(current) || '#888888' });
                input.addEventListener('input', () => emit(field.key, input.value));
                row.appendChild(input);
            } else if (field.type === 'select' && field.options) {
                const sel = el('select', { class: 'sc-select' });
                sel.appendChild(el('option', { value: '' }, '—'));
                for (const opt of field.options) {
                    const o = el('option', { value: opt }, opt);
                    if (opt === current) o.selected = true;
                    sel.appendChild(o);
                }
                sel.addEventListener('change', () => emit(field.key, sel.value));
                row.appendChild(sel);
            } else if (field.type === 'textarea') {
                const ta = el('textarea', { class: 'sc-textarea', rows: 3,
                    placeholder: field.placeholder || '' });
                ta.value = (current && typeof current === 'object')
                    ? JSON.stringify(current, null, 2) : (current ?? '');
                ta.addEventListener('change', () => {
                    try { emit(field.key, JSON.parse(ta.value)); }
                    catch { emit(field.key, ta.value); }
                });
                row.appendChild(ta);
            } else if (field.type === 'checkbox') {
                const cb = el('input', { type: 'checkbox' });
                cb.checked = !!current;
                cb.addEventListener('change', () => emit(field.key, cb.checked));
                row.appendChild(cb);
            } else {
                const input = el('input', {
                    type: field.type || 'text',
                    class: 'sc-input',
                    placeholder: field.placeholder || '',
                });
                if (current !== undefined && current !== null) input.value = current;
                input.addEventListener('change', () => {
                    const v = (field.type === 'number') ? parseFloat(input.value) : input.value;
                    emit(field.key, v);
                });
                row.appendChild(input);
            }
            form.appendChild(row);
        }

        const delBtn = el('button', { class: 'sc-btn sc-btn-danger',
            style: { marginTop: '12px', width: '100%' } }, 'Delete item');
        delBtn.addEventListener('click', () => {
            if (confirm('Delete this item?')) {
                container.dispatchEvent(new CustomEvent('sc-props-delete', {
                    bubbles: true, detail: { _id: config._id },
                }));
            }
        });
        form.appendChild(delBtn);
        body.appendChild(form);
    }

    function clear() {
        _currentConfig = null;
        body.innerHTML = '';
        body.appendChild(placeholder);
    }

    function emit(path, value) {
        if (!_currentConfig || !_onChange) return;
        _onChange(path, value);
    }

    return { show, clear };
}


// ── Canvas inspector (size + grid) ──────────────────────────────────── //

export function buildCanvasInspector(container, editor) {
    container.innerHTML = '';
    container.classList.add('sc-props-panel');

    const header = el('div', { class: 'sc-props-header' }, 'Canvas');
    const body   = el('div', { class: 'sc-props-body' });
    container.appendChild(header);
    container.appendChild(body);

    const form = el('div', { class: 'sc-props-form' });

    const wInput = _numberRow(form, 'Canvas width',  editor.canvas.width,
        v => editor.setCanvasBounds({ width:  v }));
    const hInput = _numberRow(form, 'Canvas height', editor.canvas.height,
        v => editor.setCanvasBounds({ height: v }));

    const xInput = _numberRow(form, 'Canvas X', editor.canvas.x,
        v => editor.setCanvasBounds({ x: v }));
    const yInput = _numberRow(form, 'Canvas Y', editor.canvas.y,
        v => editor.setCanvasBounds({ y: v }));

    // Grid step
    const gInput = _numberRow(form, 'Grid step', editor.options.grid,
        v => editor.setGridSize(v));

    // Snap toggle
    const snapRow = el('div', { class: 'sc-props-row' });
    snapRow.appendChild(el('label', { class: 'sc-props-label' }, 'Snap to grid'));
    const snapCb  = el('input', { type: 'checkbox' });
    snapCb.checked = !!editor.options.snap;
    snapCb.addEventListener('change', () => editor.setSnap(snapCb.checked));
    snapRow.appendChild(snapCb);
    form.appendChild(snapRow);

    // Show-grid toggle
    const showRow = el('div', { class: 'sc-props-row' });
    showRow.appendChild(el('label', { class: 'sc-props-label' }, 'Show grid'));
    const showCb  = el('input', { type: 'checkbox' });
    showCb.checked = !!editor.options.showGrid;
    showCb.addEventListener('change', () => editor.setShowGrid(showCb.checked));
    showRow.appendChild(showCb);
    form.appendChild(showRow);

    body.appendChild(form);

    // Keep inputs in sync if the editor changes the canvas via dragging
    editor.container.addEventListener('sc-canvas-resize', (e) => {
        const c = e.detail || editor.canvas;
        wInput.value = Math.round(c.width);
        hInput.value = Math.round(c.height);
        xInput.value = Math.round(c.x);
        yInput.value = Math.round(c.y);
    });

    return {
        refresh() {
            wInput.value = Math.round(editor.canvas.width);
            hInput.value = Math.round(editor.canvas.height);
            xInput.value = Math.round(editor.canvas.x);
            yInput.value = Math.round(editor.canvas.y);
            gInput.value = editor.options.grid;
            snapCb.checked = !!editor.options.snap;
            showCb.checked = !!editor.options.showGrid;
        },
    };
}

function _numberRow(parent, label, initial, onChange) {
    const row = el('div', { class: 'sc-props-row' });
    row.appendChild(el('label', { class: 'sc-props-label' }, label));
    const input = el('input', { type: 'number', class: 'sc-input', step: 'any' });
    input.value = Math.round(initial ?? 0);
    input.addEventListener('change', () => {
        const n = parseFloat(input.value);
        if (Number.isFinite(n)) onChange(n);
    });
    row.appendChild(input);
    parent.appendChild(row);
    return input;
}


// ── Path helpers ────────────────────────────────────────────────────── //

function _getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}

/** Best-effort conversion to "#rrggbb" so <input type=color> stays legal. */
function _toHex(v) {
    if (!v || typeof v !== 'string') return '';
    const s = v.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        return '#' + s.slice(1).split('').map(c => c + c).join('').toLowerCase();
    }
    return '';
}
