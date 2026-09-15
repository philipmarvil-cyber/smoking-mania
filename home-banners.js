(() => {
    'use strict';

    // Fast bootstrap for category artwork. The previous implementation only
    // learned category-logo URLs after the category DOM was already on screen,
    // so users saw the letter fallback for a moment and then the real logo.
    // Category artwork is essentially static, so keep the resolved URL map in
    // localStorage, warm the images at app startup, and paint cached artwork
    // synchronously on every category render.
    const CACHE_KEY = 'category_artwork_static_v2';
    const artwork = {};
    const resolvedIds = new Set();
    const warmedUrls = new Set();
    let refreshStarted = false;
    let refreshFinished = false;
    let observer = null;

    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
        if (cached && typeof cached === 'object' && !Array.isArray(cached)) {
            Object.entries(cached).forEach(([id, url]) => {
                artwork[String(id)] = typeof url === 'string' ? url : '';
                resolvedIds.add(String(id));
            });
        }
    } catch (e) {}

    function warmUrl(value) {
        const url = String(value || '');
        if (!/^https:\/\//i.test(url) || warmedUrls.has(url)) return;
        warmedUrls.add(url);
        try {
            const image = new Image();
            image.decoding = 'async';
            image.loading = 'eager';
            try { image.fetchPriority = 'high'; } catch (e) {}
            image.src = url;
        } catch (e) {}
    }

    Object.values(artwork).forEach(warmUrl);

    function saveCache() {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(artwork)); } catch (e) {}
    }

    function categoryTree() {
        try {
            return (typeof categories !== 'undefined' && Array.isArray(categories)) ? categories : [];
        } catch (e) {
            return [];
        }
    }

    function collectCategoryIds(nodes, out = []) {
        (nodes || []).forEach(node => {
            const id = String(node?.id || '');
            if (id) out.push(id);
            collectCategoryIds(node?.subcategories || [], out);
        });
        return out;
    }

    function applyFastArtwork() {
        // Large category covers on the main Catalog screen.
        const roots = categoryTree();
        const grid = document.getElementById('catalog-photo-grid');
        if (grid && roots.length) {
            [...grid.querySelectorAll('.catalog-photo-card')].forEach((card, index) => {
                const category = roots[index];
                if (!category) return;
                const id = String(category.id || '');
                if (!resolvedIds.has(id)) return;
                const url = String(artwork[id] || '');
                if (!url) return;
                warmUrl(url);
                if (card.dataset.artworkUrl === url) return;
                const escaped = url.replace(/"/g, '%22');
                card.style.backgroundImage = `linear-gradient(90deg,rgba(14,15,18,.74) 0%,rgba(14,15,18,.42) 38%,rgba(14,15,18,.10) 72%,rgba(14,15,18,.02) 100%),url("${escaped}")`;
                card.style.backgroundSize = '100% 100%, cover';
                card.style.backgroundPosition = 'center, center';
                card.style.backgroundRepeat = 'no-repeat';
                card.dataset.artworkUrl = url;
            });
        }

        // Subcategory logo tiles. If we already know a custom logo exists, do
        // not show the initials even for a single frame: set the real image and
        // hide the fallback immediately. The URL was warmed during app startup,
        // so on repeat visits it is normally already decoded/cached.
        document.querySelectorAll('.subcat-logo-card[data-category-logo-id]').forEach(card => {
            const id = String(card.dataset.categoryLogoId || '');
            const image = card.querySelector('.subcat-logo-media img');
            const fallback = card.querySelector('.subcat-logo-fallback');
            if (!image || !fallback || !id) return;

            if (!resolvedIds.has(id)) {
                // Artwork state has not arrived yet. Keep the neutral white tile
                // rather than flashing initials that may disappear milliseconds later.
                image.hidden = true;
                fallback.hidden = true;
                return;
            }

            const url = String(artwork[id] || '');
            if (!url) {
                image.hidden = true;
                image.removeAttribute('src');
                delete image.dataset.artworkUrl;
                fallback.hidden = false;
                return;
            }

            warmUrl(url);
            if (image.getAttribute('src') !== url) image.src = url;
            image.dataset.artworkUrl = url;
            image.loading = 'eager';
            image.decoding = 'async';
            try { image.fetchPriority = 'high'; } catch (e) {}
            image.setAttribute('fetchpriority', 'high');
            image.hidden = false;
            fallback.hidden = true;
        });
    }

    async function refreshArtworkManifest() {
        if (refreshStarted) return;
        const ids = [...new Set(collectCategoryIds(categoryTree()).filter(Boolean))];
        if (!ids.length) return;
        refreshStarted = true;

        try {
            const batches = [];
            for (let i = 0; i < ids.length; i += 30) batches.push(ids.slice(i, i + 30));
            const groups = await Promise.all(batches.map(async batch => {
                const stable = [...batch].sort();
                const response = await fetch(`/api/banners?kind=category-images&ids=${encodeURIComponent(stable.join(','))}`);
                const data = await response.json();
                if (!response.ok || !data?.success) throw new Error(data?.error || 'category artwork unavailable');
                return { ids: stable, images: data.images || {} };
            }));

            groups.forEach(group => {
                group.ids.forEach(id => {
                    const url = String(group.images[id] || '');
                    artwork[id] = url;
                    resolvedIds.add(id);
                    warmUrl(url);
                });
            });
            saveCache();
            refreshFinished = true;
            applyFastArtwork();
        } catch (e) {
            // Keep the previous static cache. A transient API failure must not
            // make already-cached category logos disappear.
        }
    }

    function startManifestAsSoonAsCatalogExists() {
        let attempts = 0;
        const tick = () => {
            attempts += 1;
            if (categoryTree().length) {
                refreshArtworkManifest();
                applyFastArtwork();
                return;
            }
            if (attempts < 120) setTimeout(tick, 50);
        };
        tick();
    }

    // Warm cached artwork immediately, while the age gate / home screen is still
    // visible, before the user has a chance to drill into a category.
    startManifestAsSoonAsCatalogExists();

    function installFastObserver() {
        if (observer) return;
        observer = new MutationObserver(() => applyFastArtwork());
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'hidden', 'data-artwork-url']
        });
        applyFastArtwork();
        refreshArtworkManifest();

        const previousLoader = window.__loadCategoryArtwork;
        window.__loadCategoryArtwork = function instantCategoryArtworkLoader() {
            applyFastArtwork();
            refreshArtworkManifest();
            if (typeof previousLoader === 'function') previousLoader();
        };
    }

    // Preserve the existing banner/category-artwork implementation as the core
    // and layer the instant static cache on top of it. The fast observer is
    // registered AFTER the core observer, so if the legacy code briefly tries
    // to restore initials while its own request is pending, this layer corrects
    // the DOM in the same microtask, before the browser paints a frame.
    const core = document.createElement('script');
    core.src = '/home-banners-core.js?v=20260915catstatic1';
    core.async = false;
    core.onload = installFastObserver;
    core.onerror = installFastObserver;
    document.head.appendChild(core);
})();
