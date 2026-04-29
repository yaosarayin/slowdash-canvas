// canvas-dialogs.mjs — dialog boxes for the canvas editor
// Author: Yao Yin
// Created: 2026-04-29
//
// All dialogs are built with the native <dialog> element (HTML5) and styled
// via canvas.css.  No external dialog library is required.
//
// Exported:
//   openUploadSVGDialog(onSVGLoaded)   — file picker + paste for SVG upload
//   openAddItemDialog(types, onAdd)    — choose item type + label
//   openOpenCanvasDialog(files, onOpen)— pick an existing layout to open
//   openSaveCanvasDialog(onSave)       — name and save the current layout
//   openSVGEditorDialog(svgFile)       — launch SVG-Edit in an iframe popup
//   buildPropertiesPanel(container)    — returns an object with update(config)/clear()


// ── Utility ─────────────────────────────────────────────────────────────── //

function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') e.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else e.setAttribute(k, v);
    }
    for (const c of children) {
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
    }
    return e;
}

/**
 * Open a <dialog> element centred on screen with the given content.
 * Returns a close function.
 */
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


// ── SVG Upload dialog ────────────────────────────────────────────────────── //

/**
 * Show a dialog that lets the user pick or drag-drop an SVG file.
 * @param {function} onLoaded  Called with (filename, svgText) when done.
 */
export function openUploadSVGDialog(onLoaded) {
    let selectedName = '';
    let selectedText = '';

    const dropZone = el('div', { class: 'sc-drop-zone' },
        '📂  Drop an SVG file here, or click to browse'
    );
    const fileInput = el('input', { type: 'file', accept: '.svg,image/svg+xml', style: { display: 'none' } });
    const feedback  = el('div',   { class: 'sc-upload-feedback' });
    const nameInput = el('input', { type: 'text', class: 'sc-input', placeholder: 'filename (e.g. floor-plan.svg)' });

    const content = el('div', { class: 'sc-dialog-content' },
        dropZone,
        fileInput,
        el('p', {}, 'Filename saved to project config:'),
        nameInput,
        feedback
    );

    // Click to browse
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) return;
        _readSVGFile(file, (name, text) => {
            selectedName = nameInput.value || name;
            nameInput.value = selectedName;
            selectedText = text;
            feedback.textContent = `✓ Loaded: ${name} (${(text.length/1024).toFixed(1)} KB)`;
            feedback.style.color = 'var(--sd-color-text, green)';
        });
    });

    // Drag-drop
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('sc-drop-active'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('sc-drop-active'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('sc-drop-active');
        const file = e.dataTransfer.files[0];
        if (file) {
            _readSVGFile(file, (name, text) => {
                selectedName = nameInput.value || name;
                nameInput.value = selectedName;
                selectedText = text;
                feedback.textContent = `✓ Loaded: ${name}`;
                feedback.style.color = 'green';
            });
        }
    });

    openDialog('Upload SVG Background', content, [
        {
            label: 'Load SVG', primary: true,
            action: () => {
                if (!selectedText) { feedback.textContent = 'No file selected.'; return true; }
                const fname = (nameInput.value || selectedName).replace(/[^a-zA-Z0-9._-]/g, '_');
                onLoaded(fname, selectedText);
                return false; // close
            },
        },
        { label: 'Cancel', action: () => false },
    ]);
}

function _readSVGFile(file, cb) {
    const reader = new FileReader();
    reader.onload = (ev) => cb(file.name, ev.target.result);
    reader.readAsText(file);
}


// ── Add Item dialog ──────────────────────────────────────────────────────── //

/**
 * Show a dialog to choose an item type.
 * @param {object}   typeDescriptors  Map of { type: { label } }.
 * @param {function} onAdd            Called with { type, label } when done.
 */
export function openAddItemDialog(typeDescriptors, onAdd) {
    const select = el('select', { class: 'sc-select' });
    for (const [type, desc] of Object.entries(typeDescriptors)) {
        const opt = el('option', { value: type }, desc.label || type);
        select.appendChild(opt);
    }

    const labelInput = el('input', {
        type: 'text', class: 'sc-input',
        placeholder: 'Label text (can be changed later)',
    });

    const content = el('div', { class: 'sc-dialog-content' },
        el('label', {}, 'Item type:'),
        select,
        el('label', {}, 'Label:'),
        labelInput
    );

    openDialog('Add Item', content, [
        {
            label: 'Add', primary: true,
            action: () => {
                onAdd({ type: select.value, label: labelInput.value || undefined });
                return false;
            },
        },
        { label: 'Cancel', action: () => false },
    ]);
}


// ── Open Canvas dialog ───────────────────────────────────────────────────── //

/**
 * @param {object[]} files   Array of { name, file, mtime } from CanvasAPI.listFiles().
 * @param {function} onOpen  Called with the selected filename.
 */
export function openOpenCanvasDialog(files, onOpen) {
    if (!files.length) {
        alert('No saved canvas layouts found.\nSave a layout first using the 💾 button.');
        return;
    }

    const list = el('div', { class: 'sc-file-list' });
    let chosen = null;

    for (const f of files) {
        const row = el('div', { class: 'sc-file-row' }, f.name.replace(/^slowcanvas-/, '').replace(/\.json$/, ''));
        row.addEventListener('click', () => {
            list.querySelectorAll('.sc-file-row').forEach(r => r.classList.remove('sc-selected'));
            row.classList.add('sc-selected');
            chosen = f.name;
        });
        list.appendChild(row);
    }

    const content = el('div', { class: 'sc-dialog-content' }, list);

    openDialog('Open Canvas', content, [
        {
            label: 'Open', primary: true,
            action: () => {
                if (!chosen) { return true; }
                onOpen(chosen);
                return false;
            },
        },
        { label: 'Cancel', action: () => false },
    ]);
}


// ── Save Canvas dialog ───────────────────────────────────────────────────── //

/**
 * @param {string}   currentName  Pre-fill the name input.
 * @param {function} onSave       Called with the chosen name string.
 */
export function openSaveCanvasDialog(currentName, onSave) {
    const nameInput = el('input', {
        type: 'text', class: 'sc-input',
        value: currentName || '',
        placeholder: 'MyCanvas',
    });
    const titleInput = el('input', {
        type: 'text', class: 'sc-input',
        placeholder: 'Canvas title (optional)',
    });
    const feedback = el('div', { class: 'sc-upload-feedback' });

    const content = el('div', { class: 'sc-dialog-content' },
        el('label', {}, 'Layout name (used in URL):'),
        nameInput,
        el('label', {}, 'Title:'),
        titleInput,
        el('p', { style: { fontSize: '0.85em', color: '#888' } },
            'Saved as slowcanvas-NAME.json in the project config directory.'),
        feedback
    );

    openDialog('Save Canvas', content, [
        {
            label: 'Save', primary: true,
            action: () => {
                const name = nameInput.value.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
                if (!name) {
                    feedback.textContent = 'Please enter a name.';
                    feedback.style.color = 'red';
                    return true;
                }
                onSave(name, titleInput.value.trim());
                return false;
            },
        },
        { label: 'Cancel', action: () => false },
    ]);
}


// ── SVG Editor dialog (SVG-Edit integration) ─────────────────────────────── //

/**
 * Open the SVG-Edit iframe editor (requires SVG-Edit to be installed under lib/svgedit/).
 * Falls back to a helpful message if not installed.
 * @param {string} svgFilename  Filename of the SVG in the config directory.
 */
export function openSVGEditorDialog(svgFilename) {
    // Detect whether SVG-Edit is installed at the expected path
    const editorBase = './slowcanvas/svgedit/editor/index.html';

    // We do a quick HEAD check; if it fails we show instructions instead.
    fetch(editorBase, { method: 'HEAD' })
        .then(r => {
            if (r.ok) {
                _openSVGEditIframe(editorBase, svgFilename);
            } else {
                _showSVGEditorNotInstalled();
            }
        })
        .catch(() => _showSVGEditorNotInstalled());
}

function _openSVGEditIframe(editorBase, svgFilename) {
    const svgUrl = encodeURIComponent(`./api/config/file/${svgFilename}`);
    const editorUrl = `${editorBase}?url=${svgUrl}`;

    const iframe = el('iframe', {
        src: editorUrl,
        style: { width: '100%', height: '70vh', border: 'none', borderRadius: '6px' },
    });
    const note = el('p', { style: { fontSize: '0.85em', color: '#888', margin: '0.4em 0 0' } },
        'Save in SVG-Edit to write back to the project config directory.  ' +
        'Close this window and click "Reload SVG" to see changes.'
    );
    const content = el('div', {}, iframe, note);

    openDialog(`Edit SVG — ${svgFilename}`, content, [
        { label: 'Close', action: () => false },
    ]);
}

function _showSVGEditorNotInstalled() {
    const content = el('div', { class: 'sc-dialog-content' },
        el('p', {}, 'SVG-Edit is not installed.'),
        el('p', {}, 'To install it, run:'),
        el('pre', { style: { background: '#f0f0f0', padding: '0.5em', borderRadius: '4px' } },
            'cd slowdash-canvas/lib/svgedit\nbash download.sh'
        ),
        el('p', {}, 'Then restart slowdash.'),
        el('hr', {}),
        el('p', {}, 'Alternatively, edit your SVG with any external editor (Inkscape, Illustrator, etc.) ' +
            'and re-upload it with the 🖼 Upload SVG button.')
    );
    openDialog('SVG Editor Not Available', content, [
        { label: 'OK', action: () => false },
    ]);
}


// ── Properties Panel ─────────────────────────────────────────────────────── //

/**
 * Build an inline properties panel inside a container element.
 * Returns an object with:
 *   .show(config, onChange)  — populate the panel for the given item config
 *   .clear()                 — show the "no selection" placeholder
 */
export function buildPropertiesPanel(container, { ITEM_REGISTRY, getPropertyFields }) {
    container.innerHTML = '';
    container.className = 'sc-props-panel';

    const header     = el('div', { class: 'sc-props-header' }, 'Properties');
    const body       = el('div', { class: 'sc-props-body' });
    const placeholder = el('div', { class: 'sc-props-placeholder' }, 'Select an item to edit its properties.');

    container.appendChild(header);
    container.appendChild(body);
    body.appendChild(placeholder);

    let _onChangeCb = null;
    let _currentConfig = null;

    function show(config, onChange) {
        _currentConfig = config;
        _onChangeCb    = onChange;
        body.innerHTML = '';

        const fields = getPropertyFields(config.type);
        if (!fields.length) {
            body.appendChild(el('div', { class: 'sc-props-placeholder' }, 'No editable properties.'));
            return;
        }

        const form = el('div', { class: 'sc-props-form' });

        for (const field of fields) {
            const row   = el('div', { class: 'sc-props-row' });
            const label = el('label', { class: 'sc-props-label' }, field.label);
            row.appendChild(label);

            const current = _getPath(config, field.key);

            if (field.type === 'color') {
                const colorInput = el('input', { type: 'color', class: 'sc-input-color',
                    value: current || '#888888' });
                colorInput.addEventListener('input', () => _onChange(field.key, colorInput.value));
                row.appendChild(colorInput);
            } else if (field.type === 'select' && field.options) {
                const sel = el('select', { class: 'sc-select' });
                for (const opt of field.options) {
                    const o = el('option', { value: opt }, opt);
                    if (opt === current) o.selected = true;
                    sel.appendChild(o);
                }
                sel.addEventListener('change', () => _onChange(field.key, sel.value));
                row.appendChild(sel);
            } else if (field.type === 'textarea') {
                const ta = el('textarea', { class: 'sc-textarea',
                    placeholder: field.placeholder || '',
                    rows: 3 });
                ta.value = typeof current === 'object' ? JSON.stringify(current, null, 2) : (current || '');
                ta.addEventListener('change', () => {
                    try {
                        _onChange(field.key, JSON.parse(ta.value));
                    } catch { _onChange(field.key, ta.value); }
                });
                row.appendChild(ta);
            } else if (field.type === 'checkbox') {
                const cb = el('input', { type: 'checkbox', class: 'sc-checkbox' });
                cb.checked = !!current;
                cb.addEventListener('change', () => _onChange(field.key, cb.checked));
                row.appendChild(cb);
            } else {
                // text | number
                const input = el('input', {
                    type: field.type || 'text',
                    class: 'sc-input',
                    placeholder: field.placeholder || '',
                    value: current !== undefined ? current : '',
                });
                input.addEventListener('change', () => {
                    const v = field.type === 'number' ? parseFloat(input.value) : input.value;
                    _onChange(field.key, v);
                });
                row.appendChild(input);
            }

            form.appendChild(row);
        }

        // Delete button at the bottom
        const delBtn = el('button', { class: 'sc-btn sc-btn-danger', style: { marginTop: '12px', width: '100%' } },
            '🗑 Delete Item');
        delBtn.addEventListener('click', () => {
            if (confirm(`Delete item "${config.label || config.id}"?`)) {
                container.dispatchEvent(new CustomEvent('sc-props-delete', {
                    bubbles: true, detail: { id: config.id },
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

    function _onChange(path, value) {
        if (!_currentConfig || !_onChangeCb) return;
        _onChangeCb(path, value);
    }

    return { show, clear };
}


// ── SVG Element Properties Panel ─────────────────────────────────────────── //

/**
 * Build a secondary panel for editing SVG element properties inline
 * (fill, stroke, opacity, text content).
 * Returns { show(svgElement), clear() }.
 */
export function buildSVGElementPanel(container) {
    container.innerHTML = '';
    container.className = 'sc-props-panel';

    const header      = el('div', { class: 'sc-props-header' }, 'SVG Element');
    const body        = el('div', { class: 'sc-props-body' });
    const placeholder = el('div', { class: 'sc-props-placeholder' },
        'Click an element in the background SVG to edit its properties.');

    container.appendChild(header);
    container.appendChild(body);
    body.appendChild(placeholder);

    function show(svgEl) {
        body.innerHTML = '';
        const tag   = svgEl.tagName.toLowerCase();
        const form  = el('div', { class: 'sc-props-form' });

        // Tag info
        form.appendChild(el('div', { class: 'sc-props-row' },
            el('span', { style: { color: '#888', fontFamily: 'monospace' } }, `<${tag}>`)
        ));

        const attr_rows = [
            { attr: 'fill',         label: 'Fill',         type: 'color'  },
            { attr: 'stroke',       label: 'Stroke',       type: 'color'  },
            { attr: 'stroke-width', label: 'Stroke width', type: 'number' },
            { attr: 'opacity',      label: 'Opacity',      type: 'number' },
        ];

        for (const { attr, label, type } of attr_rows) {
            const current = svgEl.getAttribute(attr) || (type === 'color' ? '#000000' : '');
            const row     = el('div', { class: 'sc-props-row' });
            row.appendChild(el('label', { class: 'sc-props-label' }, label));

            const input = el('input', {
                type,
                class: type === 'color' ? 'sc-input-color' : 'sc-input',
                value: current,
            });
            input.addEventListener('input', () => svgEl.setAttribute(attr, input.value));
            row.appendChild(input);
            form.appendChild(row);
        }

        // Text content (for text/tspan elements)
        if (['text', 'tspan'].includes(tag)) {
            const row   = el('div', { class: 'sc-props-row' });
            row.appendChild(el('label', { class: 'sc-props-label' }, 'Text'));
            const ta = el('textarea', { class: 'sc-textarea', rows: 2 });
            ta.value = svgEl.textContent;
            ta.addEventListener('change', () => { svgEl.textContent = ta.value; });
            row.appendChild(ta);
            form.appendChild(row);
        }

        body.appendChild(form);
    }

    function clear() {
        body.innerHTML = '';
        body.appendChild(placeholder);
    }

    return { show, clear };
}


// ── Utility ─────────────────────────────────────────────────────────────── //

function _getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
}
