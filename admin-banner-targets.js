(() => {
    'use strict';

    let catalogProducts = [];
    let catalogCategories = [];
    let catalogReady = false;
    let catalogError = '';

    const esc = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const norm = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

    function normalizeTarget(b) {
        if (!b) return;
        const allowed = ['none', 'product', 'category', 'external'];
        if (!allowed.includes(b.targetType)) b.targetType = b.buttonLink ? 'external' : 'none';
        b.targetProductId = String(b.targetProductId || '');
        b.targetCategoryId = String(b.targetCategoryId || '');
        b.targetPathIds = Array.isArray(b.targetPathIds) ? b.targetPathIds.map(String) : [];
        b.targetLabel = String(b.targetLabel || '');
        b.targetUrl = String(b.targetUrl || b.buttonLink || '');
    }

    function flattenCategories(nodes, rootId = '', pathIds = [], labels = []) {
        const out = [];
        (nodes || []).forEach(node => {
            if (!node?.id) return;
            const isRoot = !rootId;
            const nextRoot = isRoot ? String(node.id) : rootId;
            const nextPath = isRoot ? [] : [...pathIds, String(node.id)];
            const nextLabels = [...labels, String(node.name || 'Категория')];
            out.push({
                id: String(node.id),
                rootId: nextRoot,
                pathIds: nextPath,
                label: nextLabels.join(' → ')
            });
            out.push(...flattenCategories(node.subcategories || [], nextRoot, nextPath, nextLabels));
        });
        return out;
    }

    function ensureStyles() {
        if (document.getElementById('admin-banner-targets-style')) return;
        const style = document.createElement('style');
        style.id = 'admin-banner-targets-style';
        style.textContent = `
            .banner-target-box { grid-column:1/-1; background:#f7f7f9; border:1px solid #e8e8ec; border-radius:13px; padding:12px; }
            .banner-target-title { display:flex; justify-content:space-between; gap:10px; align-items:center; margin-bottom:9px; }
            .banner-target-title strong { font-size:12.5px; }
            .banner-target-title span { color:#8e8e93; font-size:10.5px; }
            .banner-target-box select, .banner-target-box input { width:100%; box-sizing:border-box; border:1px solid #dedee3; border-radius:10px; background:#fff; padding:10px 11px; font:inherit; font-size:13px; outline:none; }
            .banner-target-body { margin-top:9px; }
            .banner-target-selected { display:flex; gap:8px; align-items:center; justify-content:space-between; background:#fff; border:1px solid #e1e1e6; border-radius:10px; padding:9px 10px; margin-bottom:8px; }
            .banner-target-selected-text { min-width:0; }
            .banner-target-selected-text strong { display:block; font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .banner-target-selected-text span { display:block; font-size:10.5px; color:#8e8e93; margin-top:2px; }
            .banner-target-clear { border:0; border-radius:8px; background:#ededf1; padding:6px 9px; font-size:11px; font-weight:700; cursor:pointer; flex-shrink:0; }
            .banner-target-results { margin-top:6px; max-height:220px; overflow:auto; border-radius:10px; }
            .banner-target-result { width:100%; border:0; border-top:1px solid #eeeeF1; background:#fff; text-align:left; padding:9px 10px; cursor:pointer; }
            .banner-target-result:first-child { border-top:0; }
            .banner-target-result strong { display:block; font-size:12.5px; color:#1c1c1e; }
            .banner-target-result span { display:block; font-size:10.5px; color:#8e8e93; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
            .banner-target-hint { color:#8e8e93; font-size:11px; line-height:1.35; margin-top:7px; }
            .banner-target-error { color:#b33b2e; font-size:11.5px; padding:8px 0; }
        `;
        document.head.appendChild(style);
    }

    function hideLegacyLinkField(card) {
        card.querySelectorAll('.banner-field').forEach(field => {
            const label = field.querySelector('label');
            if (label && label.textContent.trim() === 'Ссылка кнопки') field.style.display = 'none';
        });
    }

    function targetSummary(b) {
        if (b.targetType === 'product') return b.targetLabel || 'Товар не выбран';
        if (b.targetType === 'category') return b.targetLabel || 'Категория не выбрана';
        if (b.targetType === 'external') return b.targetUrl || 'Ссылка не указана';
        return 'Баннер никуда не ведёт';
    }

    function targetTypeLabel(type) {
        return ({ product: 'Товар', category: 'Категория', external: 'Внешняя ссылка', none: 'Без перехода' })[type] || 'Без перехода';
    }

    function renderTargetBody(id) {
        const b = banners.find(x => x.id === id);
        const body = document.getElementById(`banner-target-body-${id}`);
        if (!b || !body) return;
        normalizeTarget(b);

        if (b.targetType === 'none') {
            body.innerHTML = '<div class="banner-target-hint">Нажатие на баннер ничего не делает. Текст кнопки можно оставить пустым.</div>';
            return;
        }

        if (b.targetType === 'external') {
            body.innerHTML = `
                <input type="url" id="banner-target-url-${esc(id)}" value="${esc(b.targetUrl)}" placeholder="https://example.com">
                <div class="banner-target-hint">Весь баннер и кнопка будут открывать эту ссылку.</div>`;
            body.querySelector('input').addEventListener('input', e => {
                b.targetUrl = e.target.value.trim();
                b.buttonLink = b.targetUrl; // обратная совместимость со старыми баннерами
            });
            return;
        }

        const kind = b.targetType;
        const selected = b.targetLabel
            ? `<div class="banner-target-selected"><div class="banner-target-selected-text"><strong>${esc(b.targetLabel)}</strong><span>${kind === 'product' ? 'Выбранный товар' : 'Выбранная категория'}</span></div><button type="button" class="banner-target-clear">Сменить</button></div>`
            : '';
        const placeholder = kind === 'product' ? 'Начните писать название товара…' : 'Начните писать название категории…';
        body.innerHTML = `${selected}<input type="text" class="banner-target-search" placeholder="${placeholder}" autocomplete="off"><div class="banner-target-results"></div>${catalogError ? `<div class="banner-target-error">${esc(catalogError)}</div>` : ''}`;

        const input = body.querySelector('.banner-target-search');
        const clear = body.querySelector('.banner-target-clear');
        if (clear) clear.addEventListener('click', () => {
            b.targetProductId = '';
            b.targetCategoryId = '';
            b.targetPathIds = [];
            b.targetLabel = '';
            renderTargetBody(id);
            setTimeout(() => document.querySelector(`#banner-target-body-${CSS.escape(id)} .banner-target-search`)?.focus(), 0);
        });
        input.addEventListener('input', () => renderTargetResults(id, input.value));
        input.addEventListener('focus', () => renderTargetResults(id, input.value));
    }

    function renderTargetResults(id, query) {
        const b = banners.find(x => x.id === id);
        const resultsEl = document.querySelector(`#banner-target-body-${CSS.escape(id)} .banner-target-results`);
        if (!b || !resultsEl || !catalogReady) return;
        const q = norm(query);
        if (!q) {
            resultsEl.innerHTML = '<div class="banner-target-hint" style="padding:4px 2px;">Введите хотя бы несколько букв.</div>';
            return;
        }

        if (b.targetType === 'product') {
            const found = catalogProducts.filter(p => norm(p.name).includes(q)).slice(0, 15);
            resultsEl.innerHTML = found.length ? found.map((p, i) => {
                const category = catalogCategories.find(c => c.id === String(p.folderId));
                return `<button type="button" class="banner-target-result" data-result-index="${i}"><strong>${esc(p.name)}</strong><span>${esc(category?.label || '')}</span></button>`;
            }).join('') : '<div class="banner-target-hint" style="padding:5px 2px;">Ничего не найдено.</div>';
            resultsEl.querySelectorAll('.banner-target-result').forEach((btn, i) => btn.addEventListener('click', () => {
                const p = found[i];
                if (!p) return;
                b.targetProductId = String(p.id);
                b.targetCategoryId = '';
                b.targetPathIds = [];
                b.targetLabel = String(p.name || 'Товар');
                renderTargetBody(id);
            }));
            return;
        }

        const found = catalogCategories.filter(c => norm(c.label).includes(q)).slice(0, 15);
        resultsEl.innerHTML = found.length ? found.map((c, i) => `<button type="button" class="banner-target-result" data-result-index="${i}"><strong>${esc(c.label)}</strong><span>Категория</span></button>`).join('') : '<div class="banner-target-hint" style="padding:5px 2px;">Ничего не найдено.</div>';
        resultsEl.querySelectorAll('.banner-target-result').forEach((btn, i) => btn.addEventListener('click', () => {
            const c = found[i];
            if (!c) return;
            b.targetProductId = '';
            b.targetCategoryId = c.rootId;
            b.targetPathIds = [...c.pathIds];
            b.targetLabel = c.label;
            renderTargetBody(id);
        }));
    }

    function decorateBannerCard(card, b) {
        normalizeTarget(b);
        hideLegacyLinkField(card);
        const grid = card.querySelector('.banner-form-grid');
        if (!grid || grid.querySelector('.banner-target-box')) return;

        const box = document.createElement('div');
        box.className = 'banner-target-box';
        box.innerHTML = `
            <div class="banner-target-title"><strong>Куда ведёт баннер</strong><span>${esc(targetSummary(b))}</span></div>
            <select class="banner-target-type">
                <option value="none" ${b.targetType === 'none' ? 'selected' : ''}>Никуда</option>
                <option value="product" ${b.targetType === 'product' ? 'selected' : ''}>На товар</option>
                <option value="category" ${b.targetType === 'category' ? 'selected' : ''}>В категорию</option>
                <option value="external" ${b.targetType === 'external' ? 'selected' : ''}>Внешняя ссылка</option>
            </select>
            <div class="banner-target-body" id="banner-target-body-${esc(b.id)}"></div>`;
        grid.appendChild(box);

        box.querySelector('.banner-target-type').addEventListener('change', e => {
            const next = e.target.value;
            b.targetType = next;
            if (next !== 'product') b.targetProductId = '';
            if (next !== 'category') { b.targetCategoryId = ''; b.targetPathIds = []; }
            if (next !== 'external') { b.targetUrl = ''; b.buttonLink = ''; }
            b.targetLabel = '';
            renderTargetBody(b.id);
            box.querySelector('.banner-target-title span').textContent = targetTypeLabel(next);
        });
        renderTargetBody(b.id);
    }

    function decorateAll() {
        ensureStyles();
        const cards = [...document.querySelectorAll('.banner-editor-card')];
        cards.forEach((card, index) => {
            const b = banners[index];
            if (b) decorateBannerCard(card, b);
        });
    }

    const baseRender = window.renderBannersList;
    if (typeof baseRender === 'function') {
        window.renderBannersList = function bannerRenderWithTargets(...args) {
            const result = baseRender.apply(this, args);
            decorateAll();
            return result;
        };
    }

    async function loadCatalog() {
        try {
            const response = await fetch('/api/get-data', { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || !Array.isArray(data.products) || !Array.isArray(data.categories)) throw new Error(data.error || 'Каталог недоступен');
            catalogProducts = data.products || [];
            catalogCategories = flattenCategories(data.categories || []);
            catalogReady = true;
            catalogError = '';
        } catch (e) {
            catalogReady = false;
            catalogError = 'Не удалось загрузить каталог для выбора: ' + (e.message || 'ошибка');
        }
        if (typeof window.renderBannersList === 'function') window.renderBannersList();
    }

    ensureStyles();
    setTimeout(() => {
        decorateAll();
        loadCatalog();
    }, 0);
})();