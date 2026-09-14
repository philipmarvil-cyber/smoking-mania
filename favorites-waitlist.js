(() => {
    'use strict';

    // The API already returns cardImg (Vercel Blob), but index.html's applyCatalog
    // currently drops that field while building allProducts. Restore it from the
    // raw catalog cache so cards can use the CDN URL directly instead of waiting
    // on /api/product-image.
    const EAGER_COUNT = 12;
    const PREFETCH_MARGIN = '2400px 0px';
    const CATALOG_CACHE_KEY = 'catalog_cache_v3';
    const BLOB_STALL_FALLBACK_MS = 700;
    const HARD_RECOVERY_MS = 1400;

    function products() {
        try {
            return (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts : [];
        } catch (e) { return []; }
    }

    function hydrateBlobUrlsFromCache() {
        let raw;
        try { raw = JSON.parse(localStorage.getItem(CATALOG_CACHE_KEY) || 'null'); } catch (e) { return 0; }
        if (!raw || !Array.isArray(raw.products)) return 0;
        const byId = new Map(raw.products.map(p => [String(p.id), p]));
        let changed = 0;
        products().forEach(product => {
            const source = byId.get(String(product.id));
            const url = String(source?.cardImg || '');
            if (/^https:\/\//i.test(url) && product.cardImg !== url) {
                product.cardImg = url;
                changed++;
            }
        });
        return changed;
    }

    function productById(id) {
        const key = String(id || '');
        return key ? (products().find(p => String(p.id) === key) || null) : null;
    }

    function blobUrl(product) {
        const value = String(product?.cardImg || '');
        return /^https:\/\//i.test(value) ? value : '';
    }

    function detailUrl(product) {
        const legacy = String(product?.img || '');
        if (legacy) return legacy;
        const count = Number(product?.imageCount) || 0;
        const version = String(product?.imageVersion || '0');
        if (!product?.id || count <= 0 || version === '0') return '';
        return `/api/product-image?id=${encodeURIComponent(product.id)}&v=${encodeURIComponent(version)}`;
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

    function hardRecover(container, product) {
        const fallback = detailUrl(product);
        if (!container || !fallback || container.dataset.hardImageRecovered === '1') return;
        const current = container.querySelector(':scope > img');
        if (current && current.complete && current.naturalWidth > 0) return;

        // Replace the element instead of merely changing src. card-quality.js and
        // this loader can both touch the same <img>; on some Telegram WebViews a
        // request that got stuck before the handlers were replaced stays stuck on
        // that element. A fresh node starts the same proven detail-page request
        // without inheriting the stale network/decoder state.
        container.dataset.hardImageRecovered = '1';
        const fresh = document.createElement('img');
        fresh.alt = '';
        fresh.loading = 'eager';
        fresh.decoding = 'async';
        try { fresh.fetchPriority = 'high'; } catch (e) {}
        fresh.setAttribute('fetchpriority', 'high');
        fresh.onload = () => {
            if (fresh.naturalWidth > 0) container.querySelector(':scope > .no-photo')?.remove();
        };
        fresh.onerror = () => ensurePlaceholder(container);
        if (current) current.replaceWith(fresh);
        else container.prepend(fresh);
        fresh.src = fallback;
    }

    function mountImage(container, forceHigh = false) {
        if (!container?.matches?.('.product-image-container')) return;
        const product = productById(container.dataset.pid);
        if (!product) return;

        // Fast path: direct immutable Blob CDN. Product endpoint is the reliable
        // fallback for stale/missing Blob entries and for requests that never fail
        // explicitly but simply hang inside Telegram WebView.
        const direct = blobUrl(product);
        const fallback = detailUrl(product);
        const primary = direct || fallback;
        if (!primary) return;

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

        let fallbackTried = false;
        let stallTimer = null;
        let hardTimer = null;

        const clearTimers = () => {
            if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
            if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
        };

        const switchToFallback = () => {
            if (fallbackTried || !fallback || fallback === primary) return;
            fallbackTried = true;
            if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
            img.src = fallback;
        };

        img.onload = () => {
            clearTimers();
            if (img.naturalWidth > 0) container.querySelector(':scope > .no-photo')?.remove();
            container.dataset.fastImageMounted = '1';
        };
        img.onerror = () => {
            if (!fallbackTried && fallback && fallback !== primary) {
                switchToFallback();
                return;
            }
            ensurePlaceholder(container);
        };

        const absolute = new URL(primary, location.href).href;
        if (img.src !== absolute || !img.complete || img.naturalWidth === 0) img.src = primary;

        if (direct && fallback && fallback !== primary) {
            stallTimer = setTimeout(() => {
                if (!img.complete || img.naturalWidth === 0) switchToFallback();
            }, BLOB_STALL_FALLBACK_MS);
        }

        // Final guard for the few products that stay blank even after src was
        // switched. This is intentionally slower than the normal CDN path and
        // only affects images that are still actually blank.
        hardTimer = setTimeout(() => {
            const active = container.querySelector(':scope > img');
            if (!active || !active.complete || active.naturalWidth === 0) {
                hardRecover(container, product);
            }
        }, HARD_RECOVERY_MS);
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
        if (typeof current !== 'function' || current.__blobCacheHydratedCards === true) return;
        const wrapped = function renderProductCardsWithHydratedBlob(container, list) {
            hydrateBlobUrlsFromCache();
            const result = current.call(this, container, list);
            scan(container);
            return result;
        };
        wrapped.__blobCacheHydratedCards = true;
        wrapped.__detailImageCards = true;
        wrapped.__fastImageGuard = true;
        wrapped.__directBlobCards = true;
        window.renderProductCardsInto = wrapped;
    }

    function refreshHydration() {
        const changed = hydrateBlobUrlsFromCache();
        if (changed) scan();
    }

    // Cache is available immediately on repeat visits; the fresh /api/get-data
    // response rewrites it shortly afterwards. Re-hydrate after both moments.
    refreshHydration();
    installRendererGuard();
    scan();
    setTimeout(() => { refreshHydration(); installRendererGuard(); scan(); }, 0);
    setTimeout(() => { refreshHydration(); installRendererGuard(); scan(); }, 500);
    setTimeout(() => { refreshHydration(); scan(); }, 1500);

    const mutations = new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
            if (node.nodeType === 1) scan(node);
        }));
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    const core = document.createElement('script');
    core.src = '/favorites-waitlist-core.js?v=20260915img5';
    core.async = false;
    document.head.appendChild(core);
})();
