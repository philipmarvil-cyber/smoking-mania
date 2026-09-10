(() => {
    'use strict';

    const legacy = document.createElement('script');
    legacy.src = '/storefront-enhancements-base.js?v=20260910b';
    legacy.async = false;
    document.head.appendChild(legacy);

    const ACCENT = '#6b2d38';
    const MUTED = '#8e8e93';
    const ROOT_TABS = new Set(['shop', 'catalog', 'cart', 'account']);
    let rootTab = 'shop';
    let catalogSearchDebounce = null;

    const CATEGORY_VISUALS = [
        { test: /мерч/i, y: '0%' },
        { test: /колб/i, y: '16.6667%' },
        { test: /смес/i, y: '33.3333%' },
        { test: /кальян/i, y: '50%' },
        { test: /угол/i, y: '66.6667%' },
        { test: /аксессуар/i, y: '83.3333%' },
        { test: /чаш/i, y: '100%' }
    ];

    const style = document.createElement('style');
    style.textContent = `
        #home-categories-container.catalog-moved-away,
        .section-title.catalog-moved-away { display: none !important; }

        .search-bar.catalog-shortcut-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 70px;
            gap: 8px;
            align-items: stretch;
        }
        .search-bar.catalog-shortcut-row input { min-width: 0; height: 46px; margin: 0; }
        .home-catalog-shortcut {
            width: 70px; height: 46px; border: 0; border-radius: 18px;
            background: #eaeaed; color: ${MUTED}; display: flex;
            flex-direction: column; align-items: center; justify-content: center;
            gap: 1px; padding: 0; font: inherit; cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }
        .home-catalog-shortcut:active { transform: scale(.97); }
        .home-catalog-shortcut svg { width: 19px; height: 19px; stroke: currentColor; stroke-width: 2; fill: none; }
        .home-catalog-shortcut span { font-size: 9.5px; line-height: 1; font-weight: 650; }

        .nav-bar .nav-item.nav-catalog-item { color: ${MUTED}; }
        .nav-catalog-item .catalog-nav-icon {
            width: 34px; height: 34px; margin: -7px auto 0; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; color: ${MUTED};
            background: transparent; transition: transform .18s ease, background .18s ease, color .18s ease;
        }
        .nav-catalog-item .catalog-nav-icon svg { width: 23px; height: 23px; margin: 0; fill: none; stroke: currentColor; stroke-width: 2; }
        .nav-catalog-item.active { color: ${ACCENT} !important; font-weight: 600; }
        .nav-catalog-item.active .catalog-nav-icon {
            color: #fff; background: ${ACCENT}; transform: translateY(-4px);
            box-shadow: 0 5px 13px rgba(107,45,56,.28);
        }
        .nav-catalog-item .catalog-nav-label { display: block; margin-top: -1px; }

        #page-catalog.catalog-page {
            background: #f2f2f7; min-height: calc(100vh - 65px); box-sizing: border-box;
            padding: max(84px, calc(var(--tg-content-safe-area-inset-top, 0px) + 18px)) 12px calc(88px + env(safe-area-inset-bottom));
        }
        .catalog-page-title {
            font-size: 30px; line-height: 1.08; font-weight: 800; letter-spacing: -.6px;
            color: #111114; margin: 0 4px 16px;
        }
        .catalog-page-search { position: relative; margin: 0 4px 14px; }
        .catalog-page-search svg {
            position: absolute; left: 15px; top: 50%; width: 20px; height: 20px;
            transform: translateY(-50%); stroke: ${MUTED}; stroke-width: 2; fill: none; pointer-events: none;
        }
        .catalog-page-search input {
            width: 100%; height: 48px; box-sizing: border-box; border: 0; outline: none;
            border-radius: 20px; background: #eaeaed; color: #1c1c1e; font-size: 15px;
            padding: 0 16px 0 45px;
        }
        .catalog-page-search input::placeholder { color: #929299; }

        .catalog-photo-grid {
            display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; padding: 0 4px;
        }
        .catalog-photo-card {
            position: relative; width: 100%; aspect-ratio: 1.48 / 1; overflow: hidden;
            border-radius: 15px; background-color: #272a2f;
            background-image:
                linear-gradient(90deg, rgba(14,15,18,.82) 0%, rgba(14,15,18,.54) 38%, rgba(14,15,18,.14) 72%, rgba(14,15,18,.02) 100%),
                url('/assets/category-sprite.jpg?v=20260910b');
            background-size: 100% 100%, auto 700%;
            background-position: center, right var(--catalog-y);
            background-repeat: no-repeat;
            box-shadow: inset 0 0 0 1px rgba(255,255,255,.035);
            cursor: pointer; -webkit-tap-highlight-color: transparent;
        }
        .catalog-photo-card:active { transform: scale(.985); opacity: .94; }
        .catalog-photo-card-name {
            position: absolute; left: 13px; right: 8px; bottom: 12px; z-index: 1;
            color: #fff; font-size: 16px; font-weight: 760; line-height: 1.08;
            letter-spacing: -.2px; text-shadow: 0 2px 8px rgba(0,0,0,.72);
            overflow-wrap: normal; word-break: normal; hyphens: none;
        }
        #catalog-product-results { padding: 0 4px; }
        .catalog-empty {
            grid-column: 1 / -1; padding: 34px 12px; text-align: center; color: ${MUTED}; font-size: 14px;
        }

        @media (max-width: 360px) {
            #page-catalog.catalog-page { padding-top: max(80px, calc(var(--tg-content-safe-area-inset-top, 0px) + 16px)); }
            .catalog-page-title { font-size: 27px; }
            .catalog-photo-card-name { font-size: 14px; left: 11px; right: 7px; bottom: 10px; }
            .search-bar.catalog-shortcut-row { grid-template-columns: minmax(0, 1fr) 64px; }
            .home-catalog-shortcut { width: 64px; }
        }
    `;
    document.head.appendChild(style);

    function gridIcon() {
        return `<svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" rx="1.4"></rect>
            <rect x="14" y="4" width="6" height="6" rx="1.4"></rect>
            <rect x="4" y="14" width="6" height="6" rx="1.4"></rect>
            <rect x="14" y="14" width="6" height="6" rx="1.4"></rect>
        </svg>`;
    }

    function markExistingNavItems() {
        document.querySelectorAll('.nav-bar .nav-item').forEach(item => {
            if (item.dataset.tab) return;
            const handler = item.getAttribute('onclick') || '';
            const match = handler.match(/switchTab\(['\"]([^'\"]+)['\"]\)/);
            if (match) item.dataset.tab = match[1];
        });
    }

    function ensureCatalogNavItem() {
        const nav = document.querySelector('.nav-bar');
        if (!nav) return null;
        markExistingNavItems();
        let item = nav.querySelector('.nav-catalog-item');
        if (item) return item;
        item = document.createElement('div');
        item.className = 'nav-item nav-catalog-item';
        item.dataset.tab = 'catalog';
        item.innerHTML = `<span class="catalog-nav-icon">${gridIcon()}</span><span class="catalog-nav-label">Каталог</span>`;
        item.addEventListener('click', () => window.switchTab?.('catalog'));
        const cart = nav.querySelector('[data-tab="cart"]');
        if (cart) nav.insertBefore(item, cart); else nav.appendChild(item);
        return item;
    }

    function setNavActive(type) {
        const nav = document.querySelector('.nav-bar');
        if (!nav) return;
        markExistingNavItems();
        nav.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        nav.querySelector(`[data-tab="${type}"]`)?.classList.add('active');
    }

    function moveHomeCategoriesAway() {
        document.getElementById('home-categories-container')?.classList.add('catalog-moved-away');
        const shop = document.getElementById('page-shop') || document;
        const title = Array.from(shop.querySelectorAll('.section-title')).find(el =>
            (el.textContent || '').trim().toLocaleLowerCase('ru') === 'категории'
        );
        title?.classList.add('catalog-moved-away');
    }

    function ensureHomeShortcut() {
        const input = document.getElementById('search-input');
        const bar = input?.closest('.search-bar');
        if (!bar) return;
        bar.classList.add('catalog-shortcut-row');
        if (bar.querySelector('.home-catalog-shortcut')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'home-catalog-shortcut';
        button.setAttribute('aria-label', 'Открыть каталог');
        button.innerHTML = `${gridIcon()}<span>Каталог</span>`;
        button.addEventListener('click', () => window.switchTab?.('catalog'));
        bar.appendChild(button);
    }

    function ensureCatalogPage() {
        let page = document.getElementById('page-catalog');
        if (page) return page;
        page = document.createElement('div');
        page.id = 'page-catalog';
        page.className = 'page catalog-page';
        page.innerHTML = `
            <h1 class="catalog-page-title">Каталог</h1>
            <div class="catalog-page-search">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg>
                <input id="catalog-product-search" type="search" inputmode="search" autocomplete="off" placeholder="Поиск товаров">
            </div>
            <div class="catalog-photo-grid" id="catalog-photo-grid"></div>
            <div class="products-grid" id="catalog-product-results" style="display:none;"></div>`;
        const nav = document.querySelector('.nav-bar');
        if (nav?.parentNode) nav.parentNode.insertBefore(page, nav); else document.body.appendChild(page);
        page.querySelector('#catalog-product-search')?.addEventListener('input', event => handleCatalogProductSearch(event.target.value || ''));
        return page;
    }

    function visualFor(name, index) {
        const visual = CATEGORY_VISUALS.find(item => item.test.test(String(name || '')));
        if (visual) return visual;
        const fallbackIndex = Math.max(0, Math.min(6, index));
        return { y: `${fallbackIndex * (100 / 6)}%` };
    }

    function renderCatalogCards() {
        const page = ensureCatalogPage();
        const grid = page.querySelector('#catalog-photo-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const source = (typeof categories !== 'undefined' && Array.isArray(categories)) ? categories : [];
        if (!source.length) {
            const empty = document.createElement('div');
            empty.className = 'catalog-empty';
            empty.textContent = 'Каталог загружается…';
            grid.appendChild(empty);
            return;
        }
        source.forEach((cat, index) => {
            const card = document.createElement('div');
            card.className = 'catalog-photo-card';
            card.style.setProperty('--catalog-y', visualFor(cat.name, index).y);
            const label = document.createElement('div');
            label.className = 'catalog-photo-card-name';
            label.textContent = cat.name || '';
            card.appendChild(label);
            card.addEventListener('click', () => {
                if (typeof navigateTo === 'function') navigateTo({ type: 'category', categoryId: cat.id });
            });
            grid.appendChild(card);
        });
    }

    function handleCatalogProductSearch(query = '') {
        clearTimeout(catalogSearchDebounce);
        const page = ensureCatalogPage();
        const grid = page.querySelector('#catalog-photo-grid');
        const results = page.querySelector('#catalog-product-results');
        const term = String(query || '').trim();

        if (!term) {
            if (results) {
                results.style.display = 'none';
                results.innerHTML = '';
            }
            if (grid) grid.style.display = '';
            renderCatalogCards();
            return;
        }

        if (grid) grid.style.display = 'none';
        if (results) results.style.display = '';

        catalogSearchDebounce = setTimeout(() => {
            const latestTerm = String(page.querySelector('#catalog-product-search')?.value || '').trim();
            if (!latestTerm) {
                handleCatalogProductSearch('');
                return;
            }

            const source = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts : [];
            const searchFn = typeof window.__smartProductSearch === 'function'
                ? window.__smartProductSearch
                : ((list, value) => {
                    const needle = String(value || '').toLocaleLowerCase('ru');
                    return list.filter(prod => String(prod.name || '').toLocaleLowerCase('ru').includes(needle));
                });
            const renderFn = typeof window.renderProductCardsInto === 'function' ? window.renderProductCardsInto : null;
            if (results && renderFn) renderFn(results, searchFn(source, latestTerm));
        }, 120);
    }

    function renderCatalogScreen(screen) {
        const page = ensureCatalogPage();
        document.querySelectorAll('.page').forEach(item => item.classList.remove('active'));
        page.classList.add('active');
        const search = page.querySelector('#catalog-product-search');
        if (search && document.activeElement !== search) search.value = '';
        handleCatalogProductSearch(search?.value || '');
        setNavActive('catalog');
        const y = Number(screen?.scrollY) || 0;
        window.scrollTo(0, y);
        requestAnimationFrame(() => window.scrollTo(0, y));
        try { window.Telegram?.WebApp?.BackButton?.hide(); } catch (e) {}
        if (typeof ensureDocumentIsScrollable === 'function') {
            ensureDocumentIsScrollable();
            setTimeout(ensureDocumentIsScrollable, 100);
        }
    }

    const originalRenderScreen = window.renderScreen;
    if (typeof originalRenderScreen === 'function') {
        window.renderScreen = function renderScreenWithCatalog(screen) {
            if (screen?.type === 'catalog') {
                rootTab = 'catalog';
                renderCatalogScreen(screen);
                return;
            }
            const result = originalRenderScreen(screen);
            if (ROOT_TABS.has(screen?.type)) rootTab = screen.type;
            if (screen?.type === 'favorites') setNavActive('favorites');
            else if (ROOT_TABS.has(screen?.type)) setNavActive(screen.type);
            else setNavActive(rootTab);
            moveHomeCategoriesAway();
            ensureHomeShortcut();
            return result;
        };
    }

    const originalSwitchTab = window.switchTab;
    if (typeof originalSwitchTab === 'function') {
        window.switchTab = function switchTabWithCatalogState(type) {
            if (ROOT_TABS.has(type)) rootTab = type;
            return originalSwitchTab(type);
        };
    }

    function install() {
        ensureCatalogNavItem();
        ensureCatalogPage();
        moveHomeCategoriesAway();
        ensureHomeShortcut();
        const current = typeof currentScreen === 'function' ? currentScreen() : { type: 'shop' };
        if (current?.type === 'catalog') renderCatalogScreen(current);
        else if (current?.type === 'favorites') setNavActive('favorites');
        else setNavActive(ROOT_TABS.has(current?.type) ? current.type : rootTab);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
})();
