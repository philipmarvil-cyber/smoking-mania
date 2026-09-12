(() => {
    'use strict';

    // Все пользовательские экраны держим на той же компактной верхней
    // геометрии, что и главная: одинаковая высота шапки и safe-area отступы.
    const telegramPlatform = String(window.Telegram?.WebApp?.platform || '').toLowerCase();
    const userAgent = String(navigator.userAgent || '');
    const isIOS = telegramPlatform === 'ios' || /iPhone|iPad|iPod/i.test(userAgent);
    const isAndroid = telegramPlatform === 'android' || /Android/i.test(userAgent);
    const isMobileWebView = isIOS || isAndroid;
    document.documentElement.classList.toggle('tg-ios', isIOS);
    document.documentElement.classList.toggle('tg-android', isAndroid);
    document.documentElement.classList.toggle('tg-mobile', isMobileWebView);

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

        /* Telegram WebView на iPhone/Android: меньше композиционных работ при drill-down. */
        .tg-mobile #page-category .subcat-logo-card,
        .tg-mobile #page-category .subcat-logo-media {
            transition: none !important;
        }
        .tg-mobile #page-category .subcat-logo-card:active {
            transform: none !important;
        }
        .tg-mobile #page-category .product-card {
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

    // Частые быстрые тапы раньше успевали запустить несколько тяжёлых рендеров
    // подряд. На мобильном WebView принимаем максимум один action примерно за
    // один короткий UI-такт; лишние двойные тапы гасим до штатного onclick.
    let categoryTapLockedUntil = 0;
    let categoryImageEpoch = 0;

    if (isMobileWebView) {
        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            const chip = target?.closest('#page-category .subcat-logo-card');
            const allButton = target?.closest('#page-category #subcat-all-button');
            if (!chip && !allButton) return;

            const now = performance.now();
            if (now < categoryTapLockedUntil) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            categoryTapLockedUntil = now + 170;
            categoryImageEpoch++;

            // Для листовых плиток и «Все товары» достаточно штатного обработчика;
            // throttle выше не даёт запустить его несколько раз подряд.
            if (!chip || !chip.querySelector('.subcat-logo-arrow')) return;

            // Вложенная ветка: не прогоняем общий renderScreen. Он трогает все
            // страницы, nav и несколько раз восстанавливает scroll — на iOS и
            // Android это особенно дорого при серии быстрых кликов.
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

    // Sharp-first: в товарной сетке больше не показываем miniature вообще.
    // Карточка сразу получает одну резкую 640px WebP-версию из Vercel Image
    // Optimization. Это одновременно убирает «мыло» и двойную загрузку
    // miniature -> HQ. Повторные открытия берутся из versioned CDN/browser cache.
    const CARD_IMAGE_WIDTH = 640;
    const CARD_IMAGE_QUALITY = 82;
    const SHARP_EAGER_COUNT = isMobileWebView ? 4 : 8;
    const SHARP_PREFETCH_MARGIN = isMobileWebView ? '420px 0px' : '800px 0px';

    function getProductById(pid) {
        if (!pid || typeof allProducts === 'undefined') return null;
        return allProducts.find(prod => String(prod.id) === String(pid)) || null;
    }

    function getProductForContainer(container) {
        return getProductById(container?.dataset?.pid);
    }

    function getBaseImageUrl(prod) {
        if (!prod?.id) return '';
        if (prod.img) return prod.img;
        const count = Number(prod.imageCount) || 0;
        const version = String(prod.imageVersion || '0');
        if (count <= 0 || version === '0') return '';
        return `/api/product-image?id=${encodeURIComponent(prod.id)}&v=${encodeURIComponent(version)}`;
    }

    function getFullUrl(prod) {
        const base = getBaseImageUrl(prod);
        if (!base) return '';
        if (/[?&]size=full(?:&|$)/.test(base)) return base;
        return `${base}${base.includes('?') ? '&' : '?'}size=full`;
    }

    function getSharpCardUrl(prod) {
        const source = getFullUrl(prod);
        if (!source) return '';
        const absoluteSource = new URL(source, location.origin).href;
        return `/_vercel/image?url=${encodeURIComponent(absoluteSource)}&w=${CARD_IMAGE_WIDTH}&q=${CARD_IMAGE_QUALITY}`;
    }

    // На мобильном начинаем те же первые sharp-запросы уже при касании по бренду.
    // Когда карточки появятся после клика, браузер переиспользует активные запросы.
    const sharpTapPreloads = new Map();
    const sharpTapFolders = new Set();

    function prewarmTappedCategory(folderId) {
        const key = String(folderId || '');
        if (!key || sharpTapFolders.has(key)) return;
        if (typeof allProducts === 'undefined' || !Array.isArray(allProducts)) return;
        const products = allProducts
            .filter(prod => String(prod.folderId || '') === key && getSharpCardUrl(prod))
            .sort((a, b) => Number(!!a.outOfStock) - Number(!!b.outOfStock))
            .slice(0, 4);
        if (!products.length) return;
        sharpTapFolders.add(key);
        products.forEach(prod => {
            const url = getSharpCardUrl(prod);
            if (!url || sharpTapPreloads.has(url)) return;
            const preload = new Image();
            preload.decoding = 'async';
            try { preload.fetchPriority = 'high'; } catch (e) {}
            preload.setAttribute('fetchpriority', 'high');
            sharpTapPreloads.set(url, preload);
            const cleanup = () => setTimeout(() => sharpTapPreloads.delete(url), 30000);
            preload.addEventListener('load', cleanup, { once: true });
            preload.addEventListener('error', cleanup, { once: true });
            preload.src = url;
        });
    }

    if (isMobileWebView) {
        document.addEventListener('pointerdown', event => {
            const target = event.target instanceof Element ? event.target : null;
            const chip = target?.closest('#page-category .subcat-logo-card');
            const folderId = String(chip?.dataset?.categoryLogoId || '');
            if (folderId) prewarmTappedCategory(folderId);
        }, { capture: true, passive: true });
    }

    function getCardIndexFromContainer(container) {
        const card = container?.closest('.product-card');
        const parent = card?.parentElement;
        if (!card || !parent) return -1;
        let index = 0;
        for (const child of parent.children) {
            if (!child.classList?.contains('product-card')) continue;
            if (child === card) return index;
            index++;
        }
        return -1;
    }

    function mountSharpImage(container) {
        if (!container || container.dataset.sharpMounted === '1') return;
        const prod = getProductForContainer(container);
        const sharpUrl = getSharpCardUrl(prod);
        if (!sharpUrl) return;

        container.dataset.sharpMounted = '1';
        const oldImg = container.querySelector(':scope > img');
        const placeholder = container.querySelector(':scope > .no-photo');
        const img = oldImg || document.createElement('img');
        const index = getCardIndexFromContainer(container);

        img.decoding = 'async';
        img.alt = '';
        if (index >= 0 && index < SHARP_EAGER_COUNT) {
            img.loading = 'eager';
            const priority = index < 4 ? 'high' : 'auto';
            try { img.fetchPriority = priority; } catch (e) {}
            img.setAttribute('fetchpriority', priority);
        } else {
            img.loading = 'lazy';
            try { img.fetchPriority = 'auto'; } catch (e) {}
            img.setAttribute('fetchpriority', 'auto');
        }

        if (placeholder) placeholder.remove();
        if (!oldImg) container.prepend(img);
        const absolute = new URL(sharpUrl, location.href).href;
        const fullFallback = getFullUrl(prod);

        // В index.html всё ещё есть старый отложенный upgrade: после рендера
        // он ждёт idle/300ms, затем снова читает data-full-src и раньше начинал
        // второй запрос на огромный full. Из-за гонки sharp успевал появиться,
        // затем src менялся, картинка исчезала и загружалась повторно.
        // MutationObserver выполняется раньше этого callback, поэтому отдаём
        // legacy-upgrader тот же sharp URL: второго скачивания/переключения нет.
        if (img.dataset.fullSrc) img.dataset.fullSrc = sharpUrl;

        img.onerror = () => {
            if (img.dataset.fullFallbackTried === '1' || !fullFallback) return;
            img.dataset.fullFallbackTried = '1';
            img.src = fullFallback;
        };
        if (img.src !== absolute) img.src = sharpUrl;
        img.dataset.imageQuality = 'sharp';
    }

    const sharpObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            sharpObserver.unobserve(entry.target);
            mountSharpImage(entry.target);
        });
    }, { rootMargin: SHARP_PREFETCH_MARGIN, threshold: 0.01 });

    function watchContainer(container) {
        if (!container?.matches?.('.product-image-container')) return;
        if (container.dataset.sharpObserved === '1') return;
        const prod = getProductForContainer(container);
        const sharpUrl = getSharpCardUrl(prod);
        if (!sharpUrl) return;

        // Важно: legacy-upgrader из index.html планируется синхронно сразу после
        // создания карточки, а фактически запускается позже через idle/timeout.
        // Раньше для НЕвидимых карточек мы переписывали data-full-src только когда
        // они доходили до IntersectionObserver, и за это время старый callback уже
        // начинал качать огромный full из МойСклад. Это забивало канал и делало
        // часть следующих sharp-картинок медленными. Переписываем URL сразу для
        // каждой карточки: legacy-код, если успеет запуститься, скачает тот же 640px
        // WebP, а не второй тяжёлый оригинал.
        const legacyImg = container.querySelector(':scope > img');
        if (legacyImg?.dataset.fullSrc) legacyImg.dataset.fullSrc = sharpUrl;

        container.dataset.sharpObserved = '1';

        const index = getCardIndexFromContainer(container);
        if (index >= 0 && index < SHARP_EAGER_COUNT) {
            mountSharpImage(container);
        } else {
            sharpObserver.observe(container);
        }
    }

    function scan(root = document) {
        if (root.matches?.('.product-image-container')) watchContainer(root);
        root.querySelectorAll?.('.product-image-container').forEach(watchContainer);
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
    waitlistScript.src = '/favorites-waitlist.js?v=20260911cdn1';
    waitlistScript.async = false;
    document.head.appendChild(waitlistScript);
})();