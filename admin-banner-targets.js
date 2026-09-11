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

// Редактор логотипов категорий и подкатегорий любой глубины. Он живёт в уже
// подключённом admin-скрипте, чтобы не добавлять ещё один статический файл
// и не менять загрузочную цепочку админки.
(() => {
    'use strict';

    let rootCategoriesCache = [];
    let categoriesCache = [];
    let imagesCache = {};
    let artworkLoaded = false;
    let artworkLoading = false;

    const safe = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function flattenCategoryTree(nodes, parents = []) {
        const result = [];
        (nodes || []).forEach(node => {
            if (!node?.id) return;
            const path = [...parents, String(node.name || 'Категория')];
            result.push({ ...node, pathLabel: path.join(' → '), depth: parents.length });
            result.push(...flattenCategoryTree(node.subcategories || [], path));
        });
        return result;
    }

    const DEFAULT_VISUALS = [
        { test: /мерч/i, y: '0%' },
        { test: /колб/i, y: '16.6667%' },
        { test: /смес/i, y: '33.3333%' },
        { test: /кальян/i, y: '50%' },
        { test: /угол/i, y: '66.6667%' },
        { test: /аксессуар/i, y: '83.3333%' },
        { test: /чаш/i, y: '100%' }
    ];

    function artworkStyle() {
        if (document.getElementById('catalog-artwork-admin-style')) return;
        const style = document.createElement('style');
        style.id = 'catalog-artwork-admin-style';
        style.textContent = `
            .catalog-artwork-admin { margin-top:18px; }
            .catalog-artwork-card { background:#fff; border-radius:14px; padding:12px; margin-bottom:10px; box-shadow:0 1px 3px rgba(0,0,0,.05); display:grid; grid-template-columns:112px minmax(0,1fr); gap:12px; align-items:center; }
            .catalog-artwork-preview { width:112px; aspect-ratio:1/1; border-radius:18px; overflow:hidden; background:#fff; background-repeat:no-repeat; background-position:center; box-shadow:0 1px 5px rgba(24,24,28,.08); display:flex; align-items:center; justify-content:center; }
            .catalog-artwork-card.cover { grid-template-columns:150px minmax(0,1fr); }
            .catalog-artwork-card.cover .catalog-artwork-preview { width:150px; aspect-ratio:1.48/1; border-radius:12px; background-color:#272a2f; }
            .catalog-artwork-preview-fallback { display:flex; width:54%; aspect-ratio:1/1; align-items:center; justify-content:center; border-radius:50%; background:linear-gradient(145deg,#f0ecee,#e4dadd); color:#6b2d38; font-size:24px; font-weight:850; letter-spacing:-.04em; }
            .catalog-artwork-name { font-size:14px; font-weight:800; margin-bottom:6px; }
            .catalog-artwork-path { color:#8e8e93; font-size:10.5px; line-height:1.3; margin:-2px 0 5px; }
            .catalog-artwork-state { color:#8e8e93; font-size:11.5px; margin-bottom:9px; }
            .catalog-artwork-actions { display:flex; flex-wrap:wrap; gap:7px; }
            .catalog-artwork-btn { border:0; border-radius:9px; padding:8px 11px; font:inherit; font-size:12px; font-weight:750; cursor:pointer; background:#eaeaed; color:#1c1c1e; }
            .catalog-artwork-btn.primary { background:#1c1c1e; color:#fff; }
            .catalog-artwork-btn.reset { background:#fdf1e2; color:#9a5b0a; }
            .catalog-artwork-btn:disabled { opacity:.55; cursor:default; }
            .catalog-artwork-status { min-height:16px; margin-top:7px; font-size:11.5px; color:#8e8e93; }
            .catalog-artwork-loading { background:#fff; border-radius:14px; padding:28px 14px; text-align:center; color:#8e8e93; font-size:13px; }
            @media (max-width:620px) {
                .catalog-artwork-card { grid-template-columns:88px minmax(0,1fr); gap:10px; }
                .catalog-artwork-preview { width:88px; border-radius:16px; }
                .catalog-artwork-card.cover { grid-template-columns:112px minmax(0,1fr); }
                .catalog-artwork-card.cover .catalog-artwork-preview { width:112px; }
            }
        `;
        document.head.appendChild(style);
    }

    function ensureArtworkUi() {
        artworkStyle();
        const panel = document.getElementById('tab-panel-catalog');
        if (!panel || document.getElementById('catalog-artwork-admin')) return;
        const section = document.createElement('div');
        section.id = 'catalog-artwork-admin';
        section.className = 'catalog-artwork-admin';
        section.innerHTML = `
            <div class="section-heading">Картинки карточек страницы «Каталог»</div>
            <p class="sub" style="margin-top:-6px; margin-bottom:12px;">Отдельные большие обложки верхнеуровневых категорий. Здесь остаётся прежнее управление картинками страницы «Каталог».</p>
            <div id="catalog-cover-list"><div class="catalog-artwork-loading">Откройте раздел «Каталог», чтобы загрузить категории.</div></div>
            <div class="section-heading" style="margin-top:24px;">Логотипы подкатегорий</div>
            <p class="sub" style="margin-top:-6px; margin-bottom:12px;">Логотипы для компактных свайп-плиток внутри товарных категорий. Без логотипа показывается аккуратная заглушка с названием.</p>
            <div id="subcategory-logo-list"><div class="catalog-artwork-loading">Откройте раздел «Каталог», чтобы загрузить подкатегории.</div></div>`;
        panel.appendChild(section);
    }

    function initials(name) {
        return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
            .map(part => part[0]).join('').toLocaleUpperCase('ru') || '?';
    }

    function visualFor(name, index) {
        const found = DEFAULT_VISUALS.find(item => item.test.test(String(name || '')));
        return found?.y || `${Math.max(0, Math.min(6, index)) * (100 / 6)}%`;
    }

    function setLogoFallbackPreview(preview, category) {
        preview.style.backgroundImage = '';
        preview.style.backgroundSize = '';
        preview.innerHTML = `<span class="catalog-artwork-preview-fallback">${safe(initials(category.name))}</span>`;
    }

    function setCoverFallbackPreview(preview, category, index) {
        preview.innerHTML = '';
        preview.style.backgroundImage = `linear-gradient(90deg,rgba(14,15,18,.32),rgba(14,15,18,.02)),url('/assets/category-sprite.jpg?v=20260910b')`;
        preview.style.backgroundSize = '100% 100%, auto 700%';
        preview.style.backgroundPosition = `center, right ${visualFor(category.name, index)}`;
    }

    function setCustomPreview(preview, imageUrl, isCover) {
        preview.innerHTML = '';
        preview.style.backgroundImage = `url("${String(imageUrl || '').replace(/"/g, '%22')}")`;
        preview.style.backgroundSize = isCover ? 'cover' : '76% 76%';
        preview.style.backgroundPosition = 'center';
    }

    function renderArtworkList() {
        ensureArtworkUi();
        renderArtworkGroup('catalog-cover-list', rootCategoriesCache, true);
        renderArtworkGroup('subcategory-logo-list', categoriesCache, false);
    }

    function renderArtworkGroup(listId, source, isCover) {
        const list = document.getElementById(listId);
        if (!list) return;
        if (!source.length) {
            list.innerHTML = `<div class="catalog-artwork-loading">${isCover ? 'Категории' : 'Подкатегории'} пока не найдены.</div>`;
            return;
        }
        list.innerHTML = '';
        source.forEach((category, index) => {
            const id = String(category.id || '');
            const current = String(imagesCache[id] || '');
            const card = document.createElement('div');
            card.className = 'catalog-artwork-card' + (isCover ? ' cover' : '');
            card.innerHTML = `
                <div class="catalog-artwork-preview"></div>
                <div>
                    <div class="catalog-artwork-name">${safe(category.name || 'Категория')}</div>
                    ${!isCover && category.pathLabel ? `<div class="catalog-artwork-path">${safe(category.pathLabel)}</div>` : ''}
                    <div class="catalog-artwork-state">${current ? (isCover ? 'Используется своя картинка' : 'Логотип загружен') : (isCover ? 'Используется стандартная картинка' : 'Показывается заглушка')}</div>
                    <div class="catalog-artwork-actions">
                        <button type="button" class="catalog-artwork-btn primary choose">${isCover ? 'Выбрать фото' : (current ? 'Заменить' : 'Загрузить')}</button>
                        ${current ? `<button type="button" class="catalog-artwork-btn reset">${isCover ? 'Вернуть стандартную' : 'Удалить логотип'}</button>` : ''}
                        <input class="file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
                    </div>
                    <div class="catalog-artwork-status"></div>
                </div>`;

            const preview = card.querySelector('.catalog-artwork-preview');
            if (current) setCustomPreview(preview, current, isCover);
            else if (isCover) setCoverFallbackPreview(preview, category, index);
            else setLogoFallbackPreview(preview, category);

            const fileInput = card.querySelector('.file');
            const choose = card.querySelector('.choose');
            const reset = card.querySelector('.reset');
            const status = card.querySelector('.catalog-artwork-status');
            choose.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                fileInput.value = '';
                if (!file) return;
                choose.disabled = true;
                if (reset) reset.disabled = true;
                status.textContent = 'Подготавливаем и сохраняем…';
                status.style.color = '#8e8e93';
                try {
                    const dataUrl = await compressImage(file, isCover);
                    await saveArtwork(id, dataUrl);
                    imagesCache[id] = dataUrl;
                    renderArtworkList();
                    const fresh = [...document.getElementById(listId).querySelectorAll('.catalog-artwork-card')][index]?.querySelector('.catalog-artwork-status');
                    if (fresh) { fresh.textContent = 'Сохранено ✓'; fresh.style.color = '#1f7a4d'; }
                } catch (e) {
                    status.textContent = 'Ошибка: ' + (e.message || 'не удалось сохранить');
                    status.style.color = '#d9482b';
                } finally {
                    choose.disabled = false;
                    if (reset) reset.disabled = false;
                }
            });
            if (reset) reset.addEventListener('click', async () => {
                reset.disabled = true;
                choose.disabled = true;
                status.textContent = isCover ? 'Возвращаем стандартную…' : 'Удаляем логотип…';
                status.style.color = '#8e8e93';
                try {
                    await saveArtwork(id, '');
                    imagesCache[id] = '';
                    renderArtworkList();
                    const fresh = [...document.getElementById(listId).querySelectorAll('.catalog-artwork-card')][index]?.querySelector('.catalog-artwork-status');
                    if (fresh) { fresh.textContent = isCover ? 'Стандартная картинка возвращена ✓' : 'Логотип удалён ✓'; fresh.style.color = '#1f7a4d'; }
                } catch (e) {
                    status.textContent = 'Ошибка: ' + (e.message || 'не удалось сохранить');
                    status.style.color = '#d9482b';
                } finally {
                    reset.disabled = false;
                    choose.disabled = false;
                }
            });
            list.appendChild(card);
        });
    }

    function compressImage(file, isCover = false) {
        return new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) { reject(new Error('Выберите изображение')); return; }
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
            reader.onload = () => {
                const image = new Image();
                image.onerror = () => reject(new Error('Не удалось открыть изображение'));
                image.onload = () => {
                    const maxSide = isCover ? 900 : 512;
                    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
                    const width = Math.max(1, Math.round(image.naturalWidth * scale));
                    const height = Math.max(1, Math.round(image.naturalHeight * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (isCover) {
                        ctx.fillStyle = '#292b30';
                        ctx.fillRect(0, 0, width, height);
                    } else {
                        ctx.clearRect(0, 0, width, height);
                    }
                    ctx.drawImage(image, 0, 0, width, height);
                    let result = isCover ? canvas.toDataURL('image/jpeg', 0.78) : canvas.toDataURL('image/webp', 0.86);
                    if (result.length > 470000) result = isCover ? canvas.toDataURL('image/jpeg', 0.62) : canvas.toDataURL('image/webp', 0.68);
                    if (result.length > 495000) { reject(new Error('Фото получилось слишком большим. Возьмите изображение меньшего размера.')); return; }
                    resolve(result);
                };
                image.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function saveArtwork(categoryId, imageUrl) {
        const key = sessionStorage.getItem('admin-panel-key') || '';
        if (!key) throw new Error('Нет ключа администратора');
        const response = await fetch(`/api/banners?key=${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ catalogCategoryImage: { categoryId, imageUrl } })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось сохранить');
    }

    async function loadArtwork(force = false) {
        ensureArtworkUi();
        if (artworkLoading || (artworkLoaded && !force)) return;
        artworkLoading = true;
        const coverList = document.getElementById('catalog-cover-list');
        const logoList = document.getElementById('subcategory-logo-list');
        if (coverList) coverList.innerHTML = '<div class="catalog-artwork-loading">Загружаем категории и картинки…</div>';
        if (logoList) logoList.innerHTML = '<div class="catalog-artwork-loading">Загружаем подкатегории и логотипы…</div>';
        try {
            const catalogResponse = await fetch('/api/get-data', { cache: 'no-store' });
            const catalogData = await catalogResponse.json();
            if (!catalogResponse.ok || !Array.isArray(catalogData.categories)) throw new Error(catalogData.error || 'Каталог недоступен');
            rootCategoriesCache = catalogData.categories || [];
            categoriesCache = flattenCategoryTree(rootCategoriesCache).filter(category => category.depth > 0);
            const ids = [...rootCategoriesCache, ...categoriesCache].map(category => String(category.id || '')).filter(Boolean);
            const batches = [];
            for (let i = 0; i < ids.length; i += 30) batches.push(ids.slice(i, i + 30));
            const imageGroups = await Promise.all(batches.map(async batch => {
                const imageResponse = await fetch(`/api/banners?kind=category-images&ids=${encodeURIComponent(batch.join(','))}`, { cache: 'no-store' });
                const imageData = await imageResponse.json();
                if (!imageResponse.ok || !imageData.success) throw new Error(imageData.error || 'Не удалось загрузить логотипы');
                return imageData.images || {};
            }));
            imagesCache = Object.assign({}, ...imageGroups);
            artworkLoaded = true;
            renderArtworkList();
        } catch (e) {
            const errorHtml = `<div class="catalog-artwork-loading" style="color:#d9482b;">${safe(e.message || 'Ошибка загрузки')}</div>`;
            if (coverList) coverList.innerHTML = errorHtml;
            if (logoList) logoList.innerHTML = errorHtml;
        } finally {
            artworkLoading = false;
        }
    }

    const previousSwitchTab = window.switchTab;
    window.switchTab = function adminSwitchTabWithCatalogArtwork(name) {
        const result = typeof previousSwitchTab === 'function' ? previousSwitchTab.apply(this, arguments) : undefined;
        if (name === 'catalog') {
            ensureArtworkUi();
            loadArtwork(false);
        }
        return result;
    };

    artworkStyle();
    setTimeout(ensureArtworkUi, 0);
})();
