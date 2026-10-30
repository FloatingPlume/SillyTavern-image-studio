import { get, saveSoon } from './store.js';
import { job } from './jobs.js';
import { escapeHtml, imagePathToUrl, truncate } from './util.js';

let initialized = false;
let callbacks = {};
let dragging = null;

function catSvg() {
    // 20x20 pixel cat: black body, yellow eyes, pink nose, curled tail.
    return `<svg class="is-cat-svg" viewBox="0 0 20 20" width="38" height="38" aria-hidden="true" shape-rendering="crispEdges">
        <path fill="#050505" d="M4 3h2v1h1v2H4zM12 3h2v1h1v2h-3z"/>
        <path fill="#050505" d="M4 6h1v3H3V7h1zM15 6h1v3h-1V7h-1V6zM5 6h10v7h-1v1h-1v1H7v-1H6v-1H5z"/>
        <path fill="#050505" d="M6 13h8v1H6zM7 14h6v1H7zM8 15h4v2H8zM6 16h2v1H6zM12 16h2v1h-2zM14 13h2v1h-2zM16 12h1v1h-1zM17 10h1v2h-1zM18 9h1v1h-1z"/>
        <path fill="#f3d25a" d="M7 8h2v1H7zM11 8h2v1h-2z"/>
        <path fill="#f08a9a" d="M9 10h2v1H9z"/>
        <path fill="#242424" d="M4 7h1v1H4zM15 7h1v1h-1z"/>
    </svg>`;
}

function ensureDom() {
    if (document.getElementById('is-cat-fab')) return;
    const fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'is-cat-fab';
    fab.className = 'is-cat-fab';
    fab.title = '画坊后台 · 点击展开';
    fab.innerHTML = `${catSvg()}<span id="is-cat-badge" class="is-cat-badge" hidden></span>`;
    document.body.appendChild(fab);

    const win = document.createElement('div');
    win.id = 'is-cat-window';
    win.className = 'is-cat-window';
    win.hidden = true;
    win.innerHTML = `
        <div class="is-cat-window-head" id="is-cat-drag">
            <div class="is-cat-title">${catSvg()}<span>画坊后台</span></div>
            <div class="is-cat-head-actions">
                <button type="button" class="is-link" id="is-cat-open-panel">打开画坊</button>
                <button type="button" class="is-icon-button" id="is-cat-close" title="收起"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div class="is-cat-body">
            <div id="is-cat-job" class="is-cat-job" hidden>
                <div class="is-cat-job-top"><span id="is-cat-status">生成中</span><span id="is-cat-percent" class="is-hint"></span></div>
                <div class="is-progress"><div id="is-cat-progress"></div></div>
                <div class="is-cat-job-actions">
                    <button type="button" class="is-link" id="is-cat-cancel">停止</button>
                </div>
            </div>
            <div class="is-cat-results-head"><span>最近生成</span><button type="button" class="is-link" id="is-cat-history">全部记录</button></div>
            <div id="is-cat-results" class="is-cat-results"></div>
        </div>`;
    document.body.appendChild(win);

    const fabNode = document.getElementById('is-cat-fab');
    fabNode.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const windowNode = document.getElementById('is-cat-window');
        if (!windowNode) return;
        windowNode.hidden = !windowNode.hidden;
        if (!windowNode.hidden) renderCat();
    });
    document.getElementById('is-cat-close')?.addEventListener('click', event => {
        event.preventDefault();
        document.getElementById('is-cat-window').hidden = true;
    });
    document.getElementById('is-cat-open-panel')?.addEventListener('click', event => {
        event.preventDefault();
        document.getElementById('is-cat-window').hidden = true;
        callbacks.openPanel?.();
    });
    document.getElementById('is-cat-history')?.addEventListener('click', event => {
        event.preventDefault();
        document.getElementById('is-cat-window').hidden = true;
        callbacks.openHistory?.();
    });
    document.getElementById('is-cat-cancel')?.addEventListener('click', event => {
        event.preventDefault();
        callbacks.cancel?.();
    });

    const head = document.getElementById('is-cat-drag');
    head?.addEventListener('pointerdown', startDrag);
    window.addEventListener('resize', clampWindow);
}

function startDrag(event) {
    if (event.target.closest('button')) return;
    const windowNode = document.getElementById('is-cat-window');
    if (!windowNode) return;
    const rect = windowNode.getBoundingClientRect();
    dragging = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
    };
    windowNode.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', stopDrag, { once: true });
    event.preventDefault();
}

function moveDrag(event) {
    if (!dragging) return;
    const windowNode = document.getElementById('is-cat-window');
    if (!windowNode) return;
    placeWindow(event.clientX - dragging.offsetX, event.clientY - dragging.offsetY);
}

function stopDrag() {
    dragging = null;
    window.removeEventListener('pointermove', moveDrag);
    const windowNode = document.getElementById('is-cat-window');
    if (windowNode) {
        const settings = get();
        settings.ui.catPosition = { left: windowNode.offsetLeft, top: windowNode.offsetTop };
        saveSoon();
    }
}

function placeWindow(left, top) {
    const windowNode = document.getElementById('is-cat-window');
    if (!windowNode) return;
    const maxLeft = Math.max(8, window.innerWidth - windowNode.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - windowNode.offsetHeight - 8);
    windowNode.style.left = `${Math.min(Math.max(8, left), maxLeft)}px`;
    windowNode.style.top = `${Math.min(Math.max(8, top), maxTop)}px`;
    windowNode.style.right = 'auto';
    windowNode.style.bottom = 'auto';
}

function clampWindow() {
    const windowNode = document.getElementById('is-cat-window');
    if (!windowNode || windowNode.hidden) return;
    if (windowNode.style.left) placeWindow(windowNode.offsetLeft, windowNode.offsetTop);
}

function renderResults() {
    const node = document.getElementById('is-cat-results');
    if (!node) return;
    const history = (get().history || []).filter(entry => entry.path).slice(0, 8);
    node.innerHTML = history.length
        ? history.map((entry, index) => `<button type="button" class="is-cat-thumb" data-cat-index="${index}" title="${escapeHtml(truncate(entry.positive || '生成结果', 100))}"><img src="${escapeHtml(imagePathToUrl(entry.path))}" alt="最近生成" loading="lazy" /></button>`).join('')
        : '<div class="is-hint">还没有生成记录</div>';
    node.querySelectorAll('[data-cat-index]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            const entry = history[Number(button.dataset.catIndex)];
            if (entry) callbacks.openLightbox?.(entry);
        });
    });
}

export function initFloatingCat(options = {}) {
    if (initialized) return;
    initialized = true;
    callbacks = options;
    ensureDom();
    renderCat();
}

export function renderCat() {
    if (!initialized) return;
    const settings = get();
    const windowNode = document.getElementById('is-cat-window');
    const fab = document.getElementById('is-cat-fab');
    const badge = document.getElementById('is-cat-badge');
    if (!windowNode || !fab) return;

    if (!windowNode.style.left && settings.ui?.catPosition) {
        placeWindow(settings.ui.catPosition.left, settings.ui.catPosition.top);
    }

    const active = job.active;
    fab.classList.toggle('is-active', active);
    if (badge) {
        badge.hidden = !active;
        badge.textContent = active ? `${Math.round(job.progress || 0)}%` : '';
    }
    const jobNode = document.getElementById('is-cat-job');
    if (jobNode) {
        jobNode.hidden = !active;
        if (active) {
            setText('is-cat-status', job.statusText || '生成中');
            setText('is-cat-percent', `${Math.round(job.progress || 0)}%`);
            const bar = document.getElementById('is-cat-progress');
            if (bar) bar.style.width = `${job.progress || 0}%`;
        }
    }
    renderResults();
}

function setText(id, text) {
    const node = document.getElementById(id);
    if (node) node.textContent = text ?? '';
}
