(() => {
    'use strict';

    // Hotfix слоя карточек: грузим видимые фото агрессивнее и не оставляем
    // белую карточку, если прямой Blob URL ответил медленно/ошибкой.
    const EAGER_COUNT = 10;
    const PREFETCH_MARGIN = '1800px 0px';
    const DIRECT_FALLBACK_DELAY = 900;

    function products() {
        try {
            return (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts : [];
        } catch (e) {
            return [];
        }
    }

    function productById(id) {
        const key = String(id || '');
        if (!key) return null;
        return products().find(product => String(product.id) === key) || null;
    }

    function directUrl(product) {
        const value = String(product?.cardImg || '');
        return /^https:\/\//i.test(value) ? value : '';
    }

    function fallbackUrl(product) {
        const direct = directUrl(product);
        const legacy = String(product?.img || '');
        if (legacy && legacy !== direct) return legacy;
        const count = Number(product?.imageCount) || 0;
        const version = String(product?.imageVersion || '0');
        if (!product?.id || count <= 0 || version === '0') return '';
        return `/api/product-image?id=${encodeURIComponent(product.id)}&v=${encodeURIComponent(version)}&size=full`;
    }

    function cardIndex(container) {
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

    function ensurePlaceholder(container) {
        let placeholder = container.querySelector(':scope > .no-photo');
        if (!placeholder) {
            placeholder = document.createElement('span');
            placeholder.className = 'no-photo';
            placeholder.textContent = '';
            container.prepend(placeholder);
        }
        return placeholder;
    }

    function mountImage(container, forceHigh = false) {
        if (!container?.matches?.('.product-image-container')) return;
        const product = productById(container.dataset.pid);
        if (!product) return;

        const primary = directUrl(product) || fallbackUrl(product);
        const fallback = fallbackUrl(product);
        if (!primary) return;

        const index = cardIndex(container);
        const high = forceHigh || (index >= 0 && index < EAGER_COUNT);
        let img = container.querySelector(':scope > img');
        if (!img) {
            img = document.createElement('img');
            img.alt = '';
            img.decoding = 'async';
            container.prepend(img);
        }

        const placeholder = ensurePlaceholder(container);
        if (img.complete && img.naturalWidth > 0) placeholder.remove();

        img.loading = high ? 'eager' : 'lazy';
        try { img.fetchPriority = high ? 'high' : 'auto'; } catch (e) {}
        img.setAttribute('fetchpriority', high ? 'high' : 'auto');
        img.decoding = 'async';

        let switchedToFallback = false;
        let timer = null;
        const finish = () => {
            if (timer) clearTimeout(timer);
            if (img.naturalWidth > 0) container.querySelector(':scope > .no-photo')?.remove();
            container.dataset.fastImageMounted = '1';
        };
        const switchToFallback = () => {
            if (switchedToFallback || !fallback || fallback === primary) return;
            switchedToFallback = true;
            img.src = fallback;
        };

        img.onload = finish;
        img.onerror = () => {
            if (!switchedToFallback && fallback && fallback !== primary) {
                switchToFallback();
                return;
            }
            if (timer) clearTimeout(timer);
            ensurePlaceholder(container);
        };

        const absolutePrimary = new URL(primary, location.href).href;
        if (img.src !== absolutePrimary || !img.complete || img.naturalWidth === 0) {
            img.src = primary;
        }

        // Blob CDN обычно отвечает сразу. Если Telegram WebView завис именно на
        // этом запросе, не ждём вечность: через короткий таймаут пробуем старый
        // endpoint изображения. Это закрывает случай «фото то есть, то бело».
        if (directUrl(product) && fallback && fallback !== primary) {
            timer = setTimeout(() => {
                if (!img.complete || img.naturalWidth === 0) switchToFallback();
            }, DIRECT_FALLBACK_DELAY);
        }
    }

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            mountImage(entry.target, true);
        });
    }, { rootMargin: PREFETCH_MARGIN, threshold: 0.01 });

    function watch(container) {
        if (!container?.matches?.('.product-image-container')) return;
        const index = cardIndex(container);
        if (index >= 0 && index < EAGER_COUNT) {
            mountImage(container, true);
            return;
        }
        if (container.dataset.fastImageObserved === '1') return;
        container.dataset.fastImageObserved = '1';
        observer.observe(container);
    }

    function scan(root = document) {
        if (root?.matches?.('.product-image-container')) watch(root);
        root?.querySelectorAll?.('.product-image-container').forEach(watch);
    }

    function installRendererGuard() {
        const current = window.renderProductCardsInto;
        if (typeof current !== 'function' || current.__fastImageGuard === true) return;
        const wrapped = function renderProductCardsFastAndSafe(container, list) {
            const result = current.call(this, container, list);
            scan(container);
            return result;
        };
        wrapped.__fastImageGuard = true;
        // card-quality.js проверяет этот флаг в своих отложенных install-вызовах.
        // Сохраняем его, чтобы он не завернул наш guard ещё раз через 500 мс.
        wrapped.__directBlobCards = true;
        window.renderProductCardsInto = wrapped;
    }

    installRendererGuard();
    scan();
    const mutations = new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === 1) scan(node);
        }));
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    // Сохраняем прежнюю логику «Списка ожидания» отдельным неизменённым файлом.
    const core = document.createElement('script');
    core.src = '/favorites-waitlist-core.js?v=20260915img1';
    core.async = false;
    document.head.appendChild(core);
})();
