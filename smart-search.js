(() => {
    'use strict';

    const SYNONYMS = {
        'жижа': ['жидкость'],
        'жижка': ['жидкость'],
        'жидкости': ['жидкость'],
        'угли': ['уголь'],
        'угольки': ['уголь'],
        'сиги': ['сигареты'],
        'сигарета': ['сигареты'],
        'сигарет': ['сигареты'],
        'одноразка': ['одноразовый'],
        'одноразки': ['одноразовый'],
        'электронка': ['электронный'],
        'электронки': ['электронный'],
        'кальянка': ['кальян'],
        'табачка': ['табак'],
        'синий': ['blue', 'синие'],
        'синие': ['blue', 'синий'],
        'blue': ['синий', 'синие'],
        'голд': ['gold', 'золотой'],
        'золотой': ['gold', 'голд'],
        'mint': ['мята', 'мятный'],
        'мята': ['mint', 'мятный'],
        'мятный': ['mint', 'мята']
    };

    const BRAND_ALIASES = {
        'дарксайд': 'darkside',
        'дарк сайд': 'darkside',
        'мастхэв': 'musthave',
        'маст хэв': 'musthave',
        'мустхэв': 'musthave',
        'блэкберн': 'blackburn',
        'блекберн': 'blackburn',
        'трофимов': 'trofimoff',
        'трофимофф': 'trofimoff',
        'дуфт': 'duft',
        'спектрум': 'spectrum'
    };

    const RU_TO_EN_KEYS = {
        'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']',
        'ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':"'",
        'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.'
    };
    const EN_TO_RU_KEYS = Object.fromEntries(Object.entries(RU_TO_EN_KEYS).map(([ru, en]) => [en, ru]));

    const RU_LATIN = {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y',
        'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f',
        'х':'h','ц':'c','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'
    };

    const productIndexCache = new WeakMap();
    let homeDebounce = null;
    let categoryDebounce = null;

    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^a-zа-я0-9]+/gi, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function swapKeyboardLayout(value) {
        return [...String(value || '').toLowerCase()]
            .map(ch => RU_TO_EN_KEYS[ch] ?? EN_TO_RU_KEYS[ch] ?? ch)
            .join('');
    }

    function transliterateRu(value) {
        return [...String(value || '').toLowerCase()]
            .map(ch => RU_LATIN[ch] ?? ch)
            .join('');
    }

    function tokenGroups(value) {
        return normalize(value).split(' ').filter(Boolean).map(token => {
            const synonyms = SYNONYMS[token] || [];
            return [...new Set([token, ...synonyms])];
        });
    }

    function applyBrandAliases(value) {
        let result = normalize(value);
        for (const [from, to] of Object.entries(BRAND_ALIASES)) {
            if (result.includes(from)) result = result.split(from).join(to);
        }
        return normalize(result);
    }

    function queryVariants(value) {
        const normalized = normalize(value);
        if (!normalized) return [];
        const branded = applyBrandAliases(normalized);
        const swapped = normalize(swapKeyboardLayout(value));
        const swappedBranded = applyBrandAliases(swapped);
        const latin = normalize(transliterateRu(normalized));
        const brandedLatin = normalize(transliterateRu(branded));
        const swappedLatin = normalize(transliterateRu(swapped));
        return [...new Set([normalized, branded, swapped, swappedBranded, latin, brandedLatin, swappedLatin].filter(Boolean))];
    }

    function boundedDamerauLevenshtein(a, b, maxDistance = 2) {
        if (a === b) return 0;
        if (!a || !b) return Math.max(a.length, b.length);
        if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

        const prevPrev = new Array(b.length + 1).fill(0);
        let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
        let curr = new Array(b.length + 1).fill(0);

        for (let i = 1; i <= a.length; i++) {
            curr[0] = i;
            let rowMin = curr[0];
            for (let j = 1; j <= b.length; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                let value = Math.min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + cost
                );
                if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                    value = Math.min(value, prevPrev[j - 2] + 1);
                }
                curr[j] = value;
                rowMin = Math.min(rowMin, value);
            }
            if (rowMin > maxDistance) return maxDistance + 1;
            for (let j = 0; j <= b.length; j++) prevPrev[j] = prev[j];
            const temp = prev;
            prev = curr;
            curr = temp;
        }
        return prev[b.length];
    }

    function getProductIndex(prod) {
        const cached = productIndexCache.get(prod);
        if (cached) return cached;

        const name = normalize(prod.name);
        const description = normalize(prod.description);
        const nameLatin = normalize(transliterateRu(name));
        const descriptionLatin = normalize(transliterateRu(description));
        const index = {
            name,
            description,
            nameLatin,
            descriptionLatin,
            nameTokens: name.split(' ').filter(Boolean),
            descriptionTokens: description.split(' ').filter(Boolean),
            nameLatinTokens: nameLatin.split(' ').filter(Boolean),
            descriptionLatinTokens: descriptionLatin.split(' ').filter(Boolean)
        };
        productIndexCache.set(prod, index);
        return index;
    }

    function commonPrefixLength(a, b) {
        const limit = Math.min(a.length, b.length);
        let i = 0;
        while (i < limit && a[i] === b[i]) i++;
        return i;
    }

    function scoreToken(rawToken, index) {
        if (!rawToken) return 0;
        const latinToken = normalize(transliterateRu(rawToken));
        let best = 0;

        const scoreAgainst = (token, candidate, weight) => {
            if (!candidate) return;
            if (candidate === token) best = Math.max(best, 120 * weight);
            else if (candidate.startsWith(token)) best = Math.max(best, 105 * weight);
            else if (candidate.includes(token)) best = Math.max(best, 88 * weight);
            else if (token.length >= 4 && candidate.length >= 4) {
                const prefix = commonPrefixLength(token, candidate);
                const minLength = Math.min(token.length, candidate.length);
                if (prefix >= 4 && prefix / minLength >= 0.65) {
                    best = Math.max(best, 72 * weight);
                }
                const maxDistance = Math.max(token.length, candidate.length) >= 8 ? 2 : 1;
                const distance = boundedDamerauLevenshtein(token, candidate, maxDistance);
                if (distance <= maxDistance) best = Math.max(best, (78 - distance * 14) * weight);
            }
        };

        index.nameTokens.forEach(t => scoreAgainst(rawToken, t, 1));
        index.descriptionTokens.forEach(t => scoreAgainst(rawToken, t, 0.28));
        if (latinToken) {
            index.nameLatinTokens.forEach(t => scoreAgainst(latinToken, t, 0.92));
            index.descriptionLatinTokens.forEach(t => scoreAgainst(latinToken, t, 0.24));
        }
        return best;
    }

    function scoreProduct(prod, rawQuery) {
        const index = getProductIndex(prod);
        const variants = queryVariants(rawQuery);
        if (!variants.length) return 0;

        let bestScore = 0;
        for (const variant of variants) {
            const query = normalize(variant);
            if (!query) continue;
            const queryLatin = normalize(transliterateRu(query));

            let score = 0;
            if (index.name === query) score = Math.max(score, 1000);
            if (index.name.startsWith(query)) score = Math.max(score, 900);
            if (index.name.includes(query)) score = Math.max(score, 800);
            if (queryLatin && index.nameLatin === queryLatin) score = Math.max(score, 920);
            if (queryLatin && index.nameLatin.startsWith(queryLatin)) score = Math.max(score, 840);
            if (queryLatin && index.nameLatin.includes(queryLatin)) score = Math.max(score, 760);
            if (index.description.includes(query)) score = Math.max(score, 250);
            if (queryLatin && index.descriptionLatin.includes(queryLatin)) score = Math.max(score, 225);

            const groups = tokenGroups(query);
            if (groups.length) {
                const scores = groups.map(group => Math.max(...group.map(token => scoreToken(token, index))));
                const matched = scores.filter(v => v >= 28);
                const required = groups.length === 1 ? 1 : Math.ceil(groups.length * 0.75);
                if (matched.length >= required) {
                    const average = matched.reduce((a, b) => a + b, 0) / matched.length;
                    const coverage = matched.length / groups.length;
                    score = Math.max(score, 420 + average * 2.4 + coverage * 120);
                }
            }
            bestScore = Math.max(bestScore, score);
        }
        return bestScore;
    }

    function searchProducts(source, query) {
        const term = String(query || '').trim();
        if (!term) return source;
        return source
            .map((prod, originalIndex) => ({ prod, originalIndex, score: scoreProduct(prod, term) }))
            .filter(item => item.score >= 430)
            .sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex)
            .map(item => item.prod);
    }

    window.handleHomeSearch = function handleHomeSearchSmart() {
        clearTimeout(homeDebounce);
        const input = document.getElementById('search-input');
        const term = (input?.value || '').trim();
        const browseEl = document.getElementById('home-browse');
        const resultsEl = document.getElementById('home-search-results');
        if (!term) {
            browseEl.style.display = '';
            resultsEl.style.display = 'none';
            return;
        }
        browseEl.style.display = 'none';
        resultsEl.style.display = '';
        homeDebounce = setTimeout(() => {
            const latestTerm = (document.getElementById('search-input')?.value || '').trim();
            if (!latestTerm) return;
            renderProductCardsInto(
                document.getElementById('products-container'),
                searchProducts(allProducts, latestTerm)
            );
        }, 120);
    };

    window.handleCategorySearch = function handleCategorySearchSmart() {
        clearTimeout(categoryDebounce);
        const input = document.getElementById('category-search-input');
        const term = (input?.value || '').trim();
        const container = document.getElementById('category-products-container');
        if (!term) {
            renderProductCardsInto(container, categoryPageDefaultList);
            return;
        }
        categoryDebounce = setTimeout(() => {
            const latestTerm = (document.getElementById('category-search-input')?.value || '').trim();
            if (!latestTerm) {
                renderProductCardsInto(container, categoryPageDefaultList);
                return;
            }
            renderProductCardsInto(
                container,
                searchProducts(categoryPageDefaultList, latestTerm)
            );
        }, 180);
    };

    function sortProductsFreshFirst(source) {
        return (source || [])
            .map((prod, originalIndex) => ({ prod, originalIndex }))
            .sort((a, b) => {
                const aNew = !!a.prod.isNew;
                const bNew = !!b.prod.isNew;
                if (aNew !== bNew) return aNew ? -1 : 1;
                if (aNew && bNew) {
                    const byFreshness = (Number(b.prod.firstSeenAt) || 0) - (Number(a.prod.firstSeenAt) || 0);
                    if (byFreshness) return byFreshness;
                }
                return a.originalIndex - b.originalIndex;
            })
            .map(item => item.prod);
    }

    // applyCatalog intentionally keeps the storefront object compact and used to
    // discard the exact first-seen timestamp. Preserve it after the normal mapping
    // so categories can put the freshest NEW items first without touching search relevance.
    const originalApplyCatalog = typeof window.applyCatalog === 'function' ? window.applyCatalog : null;
    if (originalApplyCatalog) {
        window.applyCatalog = function applyCatalogWithFreshness(data) {
            originalApplyCatalog(data);
            const rawById = new Map((data?.products || []).map(prod => [prod.id, prod]));
            allProducts.forEach(prod => {
                prod.firstSeenAt = Number(rawById.get(prod.id)?.firstSeenAt) || 0;
            });
            // The original applyCatalog renders once before firstSeenAt is copied.
            // Redraw the current screen once so the user immediately gets correct ordering.
            if (typeof currentScreen === 'function' && typeof renderScreen === 'function') {
                renderScreen(currentScreen());
            }
        };
    }

    const originalRenderProductCardsInto = typeof window.renderProductCardsInto === 'function'
        ? window.renderProductCardsInto
        : null;
    if (originalRenderProductCardsInto) {
        window.renderProductCardsInto = function renderProductCardsWithFreshness(container, list) {
            const id = container?.id || '';
            const categorySearchActive = id === 'category-products-container' &&
                !!document.getElementById('category-search-input')?.value?.trim();
            const shouldSortFresh = id === 'home-newest-container' ||
                id === 'newest-products-container' ||
                (id === 'category-products-container' && !categorySearchActive);
            return originalRenderProductCardsInto(
                container,
                shouldSortFresh ? sortProductsFreshFirst(list) : list
            );
        };
    }

    // Exposed only for smoke tests in CI / browser console diagnostics.
    window.__smartProductSearch = searchProducts;
    window.__sortProductsFreshFirst = sortProductsFreshFirst;
})();
