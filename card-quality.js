(() => {
    'use strict';

    // Все пользовательские экраны держим на той же компактной верхней
    // геометрии, что и главная: одинаковая высота шапки и safe-area отступы.
    const telegramPlatform = String(window.Telegram?.WebApp?.platform || '').toLowerCase();
    const isIOS = telegramPlatform === 'ios' || /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    document.documentElement.classList.toggle('tg-ios', isIOS);

    const homeLayoutStyle = document.createElement('style');
    homeLayoutStyle.textContent = `
        .page .header {
            min-height: calc(108px + env(safe-area-inset-top)) !important;
            padding-top: calc(env(safe-area-inset-top) + 8px) !important;
            padding-bottom: 12px !important;
        }
        #page-shop .search-bar.catalog-shortcut-row input,
        #page-shop .home-catalog-shortcut {
            -webkit-appearance: none !important;
            appearance: none !important;
            background: #9e9ea0 !important;
            background-color: #9e9ea0 !important;
            background-image: none !important;
            border: 0 !important;
            box-shadow: none !important;
            color: #ffffff !important;
            opacity: 1 !important;
        }
        #page-shop .search-bar.catalog-shortcut-row input {
            -webkit-text-fill-color: #ffffff !important;
        }
        #page-shop .search-bar.catalog-shortcut-row input::placeholder {
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            opacity: .88 !important;
        }
        #page-shop .search-bar.catalog-shortcut-row input::-webkit-search-decoration,
        #page-shop .search-bar.catalog-shortcut-row input::-webkit-search-cancel-button,
        #page-shop .search-bar.catalog-shortcut-row input::-webkit-search-results-button,
        #page-shop .search-bar.catalog-shortcut-row input::-webkit-search-results-decoration {
            -webkit-appearance: none;
            appearance: none;
        }
        #page-shop .home-catalog-shortcut svg,
        #page-shop .home-catalog-shortcut span {
            color: #ffffff !important;
        }

        .tg-ios #page-shop .search-bar.catalog-shortcut-row input,
        .tg-ios #page-shop .home-catalog-shortcut {
            background: #e4e4e9 !important;
            background-color: #e4e4e9 !important;
            color: #1c1c1e !important;
        }
        .tg-ios #page-shop .search-bar.catalog-shortcut-row input {
            -webkit-text-fill-color: #1c1c1e !important;
        }
        .tg-ios #page-shop .search-bar.catalog-shortcut-row input::placeholder {
            color: #1c1c1e !important;
            -webkit-text-fill-color: #1c1c1e !important;
            opacity: .72 !important;
        }
        .tg-ios #page-shop .home-catalog-shortcut svg,
        .tg-ios #page-shop .home-catalog-shortcut span {
            color: #1c1c1e !important;
        }

        /* Каталог без .header: начинаем контент на той же высоте, что и главная. */
        #page-catalog.catalog-page {
            padding-top: calc(108px + env(safe-area-inset-top)) !important;
        }
        #page-catalog .catalog-page-title,
        #page-catalog .catalog-page-search > svg {
            display: none !important;
        }
        #page-catalog .catalog-page-search {
            margin: 0 4px 14px !important;
        }
        #page-catalog .catalog-page-search input {
            -webkit-appearance: none !important;
            appearance: none !important;
            width: 100% !important;
            height: 46px !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 15px !important;
            border: 0 !important;
            border-radius: 20px !important;
            outline: none !important;
            box-shadow: none !important;
            background: #9e9ea0 !important;
            background-color: #9e9ea0 !important;
            background-image: none !important;
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            font-size: 15px !important;
            opacity: 1 !important;
        }
        #page-catalog .catalog-page-search input::placeholder {
            color: #ffffff !important;
            -webkit-text-fill-color: #ffffff !important;
            opacity: .88 !important;
        }
        #page-catalog .catalog-page-search input::-webkit-search-decoration,
        #page-catalog .catalog-page-search input::-webkit-search-cancel-button,
        #page-catalog .catalog-page-search input::-webkit-search-results-button,
        #page-catalog .catalog-page-search input::-webkit-search-results-decoration {
            -webkit-appearance: none !important;
            appearance: none !important;
        }
        .tg-ios #page-catalog .catalog-page-search input {
            background: #e4e4e9 !important;
            background-color: #e4e4e9 !important;
            color: #1c1c1e !important;
            -webkit-text-fill-color: #1c1c1e !important;
        }
        .tg-ios #page-catalog .catalog-page-search input::placeholder {
            color: #1c1c1e !important;
            -webkit-text-fill-color: #1c1c1e !important;
            opacity: .72 !important;
        }

        /* Названия категорий: уменьшенная стеклянная капсула в стиле «Новый Бренд». */
        #page-catalog .catalog-photo-card-name {
            right: auto !important;
            width: auto !important;
            max-width: calc(100% - 26px) !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            box-sizing: border-box !important;
            min-height: 16px !important;
            padding: 1px 7px 2px !important;
            border-radius: 999px !important;
            color: #ffffff !important;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif !important;
            font-size: 11px !important;
            line-height: 13px !important;
            font-weight: 600 !important;
            letter-spacing: 0 !important;
            white-space: nowrap !important;
            text-wrap: nowrap !important;
            background: rgba(175, 184, 184, .22) !important;
            border: .5px solid rgba(255,255,255,.34) !important;
            -webkit-backdrop-filter: blur(10px) saturate(145%) !important;
            backdrop-filter: blur(10px) saturate(145%) !important;
            box-shadow:
                inset 0 .5px 0 rgba(255,255,255,.18),
                inset 0 -.5px 0 rgba(255,255,255,.06),
                0 1px 4px rgba(0,0,0,.08) !important;
            text-shadow: 0 .5px 1px rgba(0,0,0,.14) !important;
        }
        @media (max-width: 360px) {
            #page-catalog .catalog-photo-card-name {
                font-size: 10px !important;
                line-height: 12px !important;
                min-height: 15px !important;
                left: 11px !important;
                right: auto !important;
                bottom: 10px !important;
                max-width: calc(100% - 22px) !important;
                padding: 1px 6px 2px !important;
            }
        }

        /* iOS WebView: убираем лишние анимации/перерисовки именно в drill-down категорий. */
        .tg-ios #page-category .subcat-logo-card,
        .tg-ios #page-category .subcat-logo-media {
            transition: none !important;
        }
        .tg-ios #page-category .subcat-logo-card:active {
            transform: none !important;
        }
        .tg-ios #page-category .product-card {
            contain: paint;
        }

        .nav-bar,
        .nav-bar .nav-item,
        .nav-bar .nav-item * {
            -webkit-tap-highlight-color: transparent !important;
            -webkit-touch-callout: none !important;
        }
        .nav-bar .nav-item {
            -webkit-user-select: none !important;
            user-select: none !important;
            touch-action: manipulation;
            outline: none !important;
        }
        .nav-bar .nav-item:focus,
        .nav-bar .nav-item:focus-visible {
            outline: none !important;
            box-shadow: none !important;
        }

        .nav-bar .nav-item.active {
            color: #000000 !important;
        }
        .nav-bar .nav-item.active:not(.nav-catalog-item) svg {
            color: #000000 !important;
            fill: currentColor !important;
            stroke: currentColor !important;
        }
        .nav-bar .nav-item.nav-catalog-item.active {
            color: #000000 !important;
        }
        .nav-bar .nav-catalog-item.active .catalog-nav-icon {
            background: #000000 !important;
        }
        .nav-bar .nav-catalog-item.active .catalog-nav-icon svg {
            color: #ffffff !important;
            stroke: #ffffff !important;
            fill: none !important;
        }
    `;
    document.head.appendChild(homeLayoutStyle);

    function removeSupportButton() {
        document.querySelector('#page-shop .support-header-btn')?.remove();
    }
    removeSupportButton();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', removeSupportButton, { once: true });
    }

    // На iPhone переход между ветками дерева не должен прогонять весь общий
    // renderScreen: он трогает все страницы, nav, scroll restoration и трижды
    // пересчитывает layout. Остаёмся в том же category-screen и меняем только
    // pathIds — goBack уже умеет подниматься по этому пути на уровень назад.
    if (isIOS) {
        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            const chip = target?.closest('#page-category .subcat-logo-card');
            if (!chip || !chip.querySelector('.subcat-logo-arrow')) return;

            const screen = typeof window.currentScreen === 'function' ? window.currentScreen() : null;
            if (!screen || screen.type !== 'category') return;
            if (typeof categories === 'undefined' || !Array.isArray(categories)) return;

            const root = categories.find(cat => cat.id === screen.categoryId);
            if (!root) return;
            let node = root;
            for (const id of (screen.pathIds || [])) {
                const next = (node.subcategories || []).find(sub => sub.id === id);
                if (!next) break;
                node = next;
            }

            const rawId = String(chip.dataset.categoryLogoId || '');
            const child = (node.subcategories || []).find(sub => String(sub.id) === rawId);
            if (!child || !(child.subcategories || []).length) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            chip.classList.add('active');

            requestAnimationFrame(() => {
                screen.pathIds = [...(screen.pathIds || []), child.id];
                screen.subFolderIds = null;
                if (typeof window.renderCategoryScreen === 'function') {
                    window.renderCategoryScreen(screen);
                    window.scrollTo(0, 1);
                }
            });
        }, true);
    }

    // На главной оставляем лёгкие миниатюры и дозагрузку full рядом с экраном.
    // На iOS в категориях тоже грузим full лениво: мгновенный апгрейд 20+ фото
    // одновременно был одним из главных источников фризов при смене подкатегории.
    const MAX_CONCURRENT = isIOS ? 1 : 2;
    const HQ_DELAY = isIOS ? 120 : 220;
    const HQ_ROOT_MARGIN = isIOS ? '90px 0px' : '220px 0px';
    const queue = [];
    let active = 0;

    function getProductForImage(img) {
        const pid = img.closest('.product-image-container')?.dataset.pid;
        if (!pid || typeof allProducts === 'undefined') return null;
        return allProducts.find(prod => String(prod.id) === String(pid)) || null;
    }

    function getFullUrl(prod) {
        if (!prod?.img) return '';
        if (/[?&]size=full(?:&|$)/.test(prod.img)) return prod.img;
        return `${prod.img}${prod.img.includes('?') ? '&' : '?'}size=full`;
    }

    function pump() {
        while (active < MAX_CONCURRENT && queue.length) {
            const img = queue.shift();
            if (!img || !document.contains(img) || img.dataset.hqState !== 'queued') continue;

            const prod = getProductForImage(img);
            const fullUrl = getFullUrl(prod);
            if (!fullUrl || img.src === new URL(fullUrl, location.href).href) {
                img.dataset.hqState = 'done';
                continue;
            }

            active++;
            img.dataset.hqState = 'loading';
            const preload = new Image();
            preload.decoding = 'async';
            preload.onload = () => {
                if (document.contains(img)) {
                    img.src = fullUrl;
                    img.dataset.hqState = 'done';
                    img.classList.add('hq-ready');
                }
                active--;
                pump();
            };
            preload.onerror = () => {
                img.dataset.hqState = 'failed';
                active--;
                pump();
            };
            preload.src = fullUrl;
        }
    }

    function enqueue(img) {
        if (!img || img.dataset.hqState) return;
        img.dataset.hqState = 'queued';
        queue.push(img);
        pump();
    }

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const img = entry.target;
            if (entry.isIntersecting) {
                // Если карточку просто быстро проскроллили, full даже не стартует.
                if (!img._hqTimer && !img.dataset.hqState) {
                    img._hqTimer = setTimeout(() => {
                        img._hqTimer = null;
                        observer.unobserve(img);
                        enqueue(img);
                    }, HQ_DELAY);
                }
            } else if (img._hqTimer) {
                clearTimeout(img._hqTimer);
                img._hqTimer = null;
            }
        });
    }, { rootMargin: HQ_ROOT_MARGIN, threshold: 0.01 });

    function shouldUseFreshFullImmediately(img) {
        if (isIOS && img.closest('#page-category')) return false;
        return !!img.closest('#page-category, #catalog-product-results, #home-search-results, #favorites-container.favorites-waitlist-mode');
    }

    function watchImage(img) {
        if (!img || img.dataset.hqObserved || img.closest('.product-card') === null) return;
        img.dataset.hqObserved = '1';

        if (shouldUseFreshFullImmediately(img)) {
            const prod = getProductForImage(img);
            const fullUrl = getFullUrl(prod);
            if (fullUrl) {
                const absoluteFullUrl = new URL(fullUrl, location.href).href;
                if (img.src !== absoluteFullUrl) img.src = fullUrl;
                img.dataset.hqState = 'done';
                img.classList.add('hq-ready');
                return;
            }
        }

        observer.observe(img);
    }

    function scan(root = document) {
        if (root.matches?.('.product-card .product-image-container img')) watchImage(root);
        root.querySelectorAll?.('.product-card .product-image-container img').forEach(watchImage);
    }

    scan();

    const mutations = new MutationObserver(records => {
        records.forEach(record => {
            record.addedNodes.forEach(node => {
                if (node.nodeType === 1) scan(node);
            });
        });
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    // Дополнительный раздел «Список ожидания» внутри избранного. Загружаем
    // отдельным маленьким скриптом, чтобы не трогать основной index.html.
    const waitlistScript = document.createElement('script');
    waitlistScript.src = '/favorites-waitlist.js?v=20260910a';
    waitlistScript.async = false;
    document.head.appendChild(waitlistScript);
})();