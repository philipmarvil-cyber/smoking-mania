(() => {
    'use strict';

    // Catalog cards now use the same image source as the product detail page.
    // cardImg is only a fallback/prewarm source; this avoids intermittent blank
    // cards when Telegram WebView stalls on a direct Blob request.
    const EAGER_COUNT = 12;
    const PREFETCH_MARGIN = '2400px 0px';

    function products() {
        try {
            return (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts : [];
        } catch (e) { return []; }
    }

    function productById(id) {
        const key = String(id || '');
        return key ? (products().find(p => String(p.id) === key) || null) : null;
    }

    function detailUrl(product) {
        const legacy = String(product?.img || '');
        if (legacy) return legacy;
        const count = Number(product?.imageCount) || 0;
        const version = String(product?.imageVersion || '0');
        if (!product?.id || count <= 0 || version === '0') return '';
        return `/api/product-image?id=${encodeURIComponent(product.id)}&v=${encodeURIComponent(version)}&size=full`;
    }

    function blobUrl(product) {
        const value = String(product?.cardImg || '');
        return /^https:\/\//i.test(value) ? value : '';
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

        // Important: exactly the same source that detail view uses first.
        const primary = detailUrl(product);
        const secondary = blobUrl(product);
        const source = primary || secondary;
        if (!source) return;

        const index = cardIndex(container);
        const high = forceHigh || (index >= 0 && index < EAGER_COUNT);
        let img = container.querySelector(':scope > img');
        if (!img) {
            img = document.createElement('img');
            img.alt = '';
            container.prepend(img);
        }

        ensurePlaceholder(container);
        img.loading = high ? 'eager' : 'lazy';
        img.decoding = 'async';
        try { img.fetchPriority = high ? 'high' : 'auto'; } catch (e) {}
        img.setAttribute('fetchpriority', high ? 'high' : 'auto');

        let triedSecondary = false;
        img.onload = () => {
            if (img.naturalWidth > 0) container.querySelector(':scope > .no-photo')?.remove();
            container.dataset.fastImageMounted = '1';
        };
        img.onerror = () => {
            if (!triedSecondary && secondary && secondary !== source) {
                triedSecondary = true;
                img.src = secondary;
                return;
            }
            ensurePlaceholder(container);
        };

        const absolute = new URL(source, location.href).href;
        if (img.src !== absolute || !img.complete || img.naturalWidth === 0) img.src = source;
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
        if (typeof current !== 'function' || current.__detailImageCards === true) return;
        const wrapped = function renderProductCardsWithDetailImages(container, list) {
            const result = current.call(this, container, list);
            scan(container);
            return result;
        };
        wrapped.__detailImageCards = true;
        wrapped.__fastImageGuard = true;
        wrapped.__directBlobCards = true;
        window.renderProductCardsInto = wrapped;
    }

    // Warm the first detail-image sources as soon as product data is available.
    function prewarmFirstImages() {
        products().slice(0, EAGER_COUNT).forEach(product => {
            const src = detailUrl(product);
            if (!src) return;
            const preload = new Image();
            preload.decoding = 'async';
            try { preload.fetchPriority = 'high'; } catch (e) {}
            preload.src = src;
        });
    }

    installRendererGuard();
    scan();
    prewarmFirstImages();
    setTimeout(() => { installRendererGuard(); scan(); prewarmFirstImages(); }, 0);
    setTimeout(() => { installRendererGuard(); scan(); }, 500);

    const mutations = new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === 1) scan(node);
        }));
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    const core = document.createElement('script');
    core.src = '/favorites-waitlist-core.js?v=20260915img2';
    core.async = false;
    document.head.appendChild(core);
})();
