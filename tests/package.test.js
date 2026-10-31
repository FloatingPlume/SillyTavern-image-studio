import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { panelTemplate } from '../src/templates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('manifest points to existing extension entry files', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.css, 'style.css');
    assert.ok(fs.existsSync(path.join(root, manifest.js)));
    assert.ok(fs.existsSync(path.join(root, manifest.css)));
    assert.equal(typeof manifest.hooks?.activate, 'string');
});

test('panel template contains the main UI containers', () => {
    const html = panelTemplate();
    for (const id of ['is-panel', 'is-generate', 'is-custom-workflow', 'is-api-list', 'is-history-list', 'is-lightbox', 'is-plugin-mode', 'is-plugin-context', 'is-rewrite-route', 'is-library-ai-scan', 'is-library-scan-scope', 'is-library-prompt', 'is-library-convert', 'is-library-generate', 'is-reference-bar', 'is-reference-file', 'is-img2img-denoise', 'is-load-ipadapter']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
});

test('bundled IPAdapter workflow is valid API-format JSON with a reference placeholder', () => {
    const file = path.join(root, 'workflows', 'ipadapter-plus.json');
    const workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(workflow['5'].class_type, 'LoadImage');
    assert.equal(workflow['5'].inputs.image, '%reference%');
    assert.ok(Object.values(workflow).some(node => node.class_type === 'IPAdapterAdvanced'));
    assert.ok(Object.values(workflow).some(node => node.class_type === 'SaveImage'));
});

test('panel input sizing does not stretch checkboxes to full width', () => {
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    assert.match(css, /#is-panel input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
    assert.match(css, /#is-panel \.is-library-candidate input\[type="checkbox"\]/);
    assert.match(css, /\.is-library-candidate-body\s*\{[^}]*flex:\s*1 1 auto/s);
});
