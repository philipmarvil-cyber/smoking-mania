(() => {
    'use strict';

    // Главная страница: убираем кнопку техподдержки из шапки и делаем
    // верх компактнее. Остальные экраны используют прежнюю высоту .header.
    const telegramPlatform = String(window.Telegram?.WebApp?.platform || '').toLowerCase();
    const isIOS = telegramPlatform === 'ios' || /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    document.documentElement.classList.toggle('tg-ios', isIOS);

    const homeLayoutStyle = document.createElement('style');
    homeLayoutStyle.textContent = `
        #page-shop .header {
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

    // На главной оставляем лёгкие миниатюры и дозагрузку full рядом с экраном.
    // В категориях и результатах поиска сразу используем versioned full-URL,
    // иначе WebView успевает показать старую кэшированную miniature,
    // а через 1–2 секунды резко подменяет её на актуальное изображение.
    const MAX_CONCURRENT = 2;
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
                    }, 220);
                }
            } else if (img._hqTimer) {
                clearTimeout(img._hqTimer);
                img._hqTimer = null;
            }
        });
    }, { rootMargin: '220px 0px', threshold: 0.01 });

    function shouldUseFreshFullImmediately(img) {
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