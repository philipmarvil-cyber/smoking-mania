(() => {
    'use strict';

    let activeSection = 'favorites';
    let cachedItems = null;
    let requestSerial = 0;

    const style = document.createElement('style');
    style.textContent = `
        #page-favorites .favorites-section-tabs {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            margin: 0 12px 12px;
            padding: 4px;
            border-radius: 16px;
            background: #e5e5ea;
        }
        #page-favorites .favorites-section-tab {
            min-width: 0;
            height: 38px;
            border: 0;
            border-radius: 12px;
            background: transparent;
            color: #6d6d72;
            font: inherit;
            font-size: 13px;
            font-weight: 700;
            white-space: nowrap;
            cursor: pointer;
            -webkit-appearance: none;
            appearance: none;
            -webkit-tap-highlight-color: transparent;
        }
        #page-favorites .favorites-section-tab.active {
            background: #000;
            color: #fff;
        }
        #page-favorites .favorites-section-count {
            display: none;
            min-width: 18px;
            height: 18px;
            margin-left: 4px;
            padding: 0 5px;
            box-sizing: border-box;
            border-radius: 9px;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            line-height: 18px;
            background: rgba(0,0,0,.10);
            color: inherit;
            vertical-align: 1px;
        }
        #page-favorites .favorites-section-tab.active .favorites-section-count {
            background: rgba(255,255,255,.22);
        }
        #favorites-container.favorites-waitlist-mode .notify-btn {
            pointer-events: none;
            opacity: .62;
        }
        #favorites-container .waitlist-loading,
        #favorites-container .waitlist-error,
        #favorites-container .waitlist-empty {
            padding: 34px 18px;
            color: #8e8e93;
            text-align: center;
            font-size: 14px;
            line-height: 1.4;
        }
        #favorites-container .waitlist-missing {
            display: grid;
            gap: 8px;
            padding: 8px 12px 0;
        }
        #favorites-container .waitlist-missing-item {
            padding: 13px 14px;
            border-radius: 14px;
            background: #fff;
            color: #1c1c1e;
            font-size: 13px;
            font-weight: 650;
        }
    `;
    document.head.appendChild(style);

    function getUserId() {
        const fromTelegram = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
        if (fromTelegram) return String(fromTelegram);
        try {
            if (typeof telegramUserId !== 'undefined' && telegramUserId) return String(telegramUserId);
        } catch (e) {}
        return '';
    }

    function getPage() {
        return document.getElementById('page-favorites');
    }

    function getContainer() {
        return document.getElementById('favorites-container');
    }

    function ensureTabs() {
        const page = getPage();
        const container = getContainer();
        if (!page || !container) return null;

        let tabs = page.querySelector('.favorites-section-tabs');
        if (!tabs) {
            tabs = document.createElement('div');
            tabs.className = 'favorites-section-tabs';
            tabs.innerHTML = `
                <button type="button" class="favorites-section-tab" data-favorites-section="favorites">Избранное</button>
                <button type="button" class="favorites-section-tab" data-favorites-section="waitlist">Список ожидания<span class="favorites-section-count"></span></button>
            `;
            container.parentNode.insertBefore(tabs, container);

            tabs.querySelector('[data-favorites-section="favorites"]')?.addEventListener('click', () => {
                if (activeSection === 'favorites') return;
                activeSection = 'favorites';
                syncTabs();
                renderFavoritesSection();
            });
            tabs.querySelector('[data-favorites-section="waitlist"]')?.addEventListener('click', () => {
                activeSection = 'waitlist';
                syncTabs();
                loadWaitlist(true);
            });
        }
        syncTabs();
        return tabs;
    }

    function syncTabs() {
        const tabs = getPage()?.querySelector('.favorites-section-tabs');
        if (!tabs) return;
        tabs.querySelectorAll('.favorites-section-tab').forEach(button => {
            button.classList.toggle('active', button.dataset.favoritesSection === activeSection);
        });
    }

    function updateCount(items) {
        const badge = getPage()?.querySelector('.favorites-section-count');
        if (!badge) return;
        const count = Array.isArray(items) ? items.length : 0;
        badge.textContent = String(count);
        badge.style.display = count ? 'inline-flex' : 'none';
    }

    function renderFavoritesSection() {
        const container = getContainer();
        if (!container) return;
        container.classList.remove('favorites-waitlist-mode');
        try {
            if (typeof renderFavorites === 'function') {
                renderFavorites();
                return;
            }
        } catch (e) {}
        container.innerHTML = '<div class="empty-state">Пока нет избранных товаров</div>';
    }

    function waitingLabelHtml() {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M9.7 21a2 2 0 0 0 4.6 0"/></svg>Ожидаем`;
    }

    function renderWaitlistItems(items) {
        if (activeSection !== 'waitlist') return;
        const container = getContainer();
        if (!container) return;
        container.classList.add('favorites-waitlist-mode');
        updateCount(items);

        if (!items.length) {
            container.innerHTML = '<div class="waitlist-empty">Пока список ожидания пуст.<br>Товары появятся здесь после нажатия «Уведомить».</div>';
            return;
        }

        let products = [];
        try {
            const source = (typeof allProducts !== 'undefined' && Array.isArray(allProducts)) ? allProducts : [];
            const byId = new Map(source.map(product => [String(product.id), product]));
            products = items.map(item => byId.get(String(item.productId))).filter(Boolean);
        } catch (e) {}

        const foundIds = new Set(products.map(product => String(product.id)));
        const missing = items.filter(item => !foundIds.has(String(item.productId)));

        if (products.length && typeof window.renderProductCardsInto === 'function') {
            window.renderProductCardsInto(container, products);
            container.querySelectorAll('.notify-btn').forEach(button => {
                button.disabled = true;
                button.innerHTML = waitingLabelHtml();
            });
        } else {
            container.innerHTML = '';
        }

        if (missing.length) {
            const wrap = document.createElement('div');
            wrap.className = 'waitlist-missing';
            missing.forEach(item => {
                const row = document.createElement('div');
                row.className = 'waitlist-missing-item';
                row.textContent = item.productName || 'Товар';
                wrap.appendChild(row);
            });
            container.appendChild(wrap);
        }
    }

    async function loadWaitlist(force = false) {
        ensureTabs();
        const container = getContainer();
        if (!container) return;

        if (!force && Array.isArray(cachedItems)) {
            updateCount(cachedItems);
            if (activeSection === 'waitlist') renderWaitlistItems(cachedItems);
            return;
        }

        const userId = getUserId();
        if (!userId) {
            cachedItems = [];
            updateCount(cachedItems);
            if (activeSection === 'waitlist') {
                container.classList.add('favorites-waitlist-mode');
                container.innerHTML = '<div class="waitlist-empty">Список ожидания доступен после запуска магазина через Telegram.</div>';
            }
            return;
        }

        const serial = ++requestSerial;
        if (activeSection === 'waitlist') {
            container.classList.add('favorites-waitlist-mode');
            container.innerHTML = '<div class="waitlist-loading">Загружаем список ожидания…</div>';
        }

        try {
            const response = await fetch(`/api/user-waitlist?telegramUserId=${encodeURIComponent(userId)}&t=${Date.now()}`, {
                cache: 'no-store'
            });
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.success || !Array.isArray(data.items)) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
            if (serial !== requestSerial) return;
            cachedItems = data.items;
            updateCount(cachedItems);
            if (activeSection === 'waitlist') renderWaitlistItems(cachedItems);
        } catch (e) {
            if (serial !== requestSerial) return;
            if (activeSection === 'waitlist') {
                container.classList.add('favorites-waitlist-mode');
                container.innerHTML = '<div class="waitlist-error">Не удалось загрузить список ожидания. Попробуйте открыть раздел ещё раз.</div>';
            }
        }
    }

    function enhanceFavoritesPage(refresh = true) {
        if (!ensureTabs()) return;
        syncTabs();
        if (activeSection === 'waitlist') loadWaitlist(refresh);
        else {
            getContainer()?.classList.remove('favorites-waitlist-mode');
            // В фоне обновим только счётчик, не меняя уже отрисованное избранное.
            if (refresh) loadWaitlist(true);
        }
    }

    const previousRenderScreen = window.renderScreen;
    if (typeof previousRenderScreen === 'function') {
        window.renderScreen = function renderScreenWithWaitlist(screen) {
            const result = previousRenderScreen(screen);
            if (screen?.type === 'favorites') {
                setTimeout(() => enhanceFavoritesPage(true), 0);
            }
            return result;
        };
    }

    function install() {
        ensureTabs();
        const current = (() => {
            try { return typeof currentScreen === 'function' ? currentScreen() : null; } catch (e) { return null; }
        })();
        if (current?.type === 'favorites') enhanceFavoritesPage(true);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
})();
