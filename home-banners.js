(() => {
    'use strict';

    const AUTOPLAY_MS = 5000;

    const esc = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function normalizeBanner(b = {}) {
        const allowedTargetTypes = ['none', 'product', 'category', 'external'];
        const targetType = allowedTargetTypes.includes(b.targetType)
            ? b.targetType
            : (b.buttonLink ? 'external' : 'none');
        return {
            ...b,
            enabled: b.enabled !== false,
            badge: String(b.badge || ''),
            textTheme: b.textTheme === 'dark' ? 'dark' : 'light',
            align: b.align === 'center' ? 'center' : 'left',
            height: ['compact', 'regular', 'large'].includes(b.height) ? b.height : 'regular',
            overlay: Number.isFinite(Number(b.overlay)) ? Math.max(0, Math.min(.75, Number(b.overlay))) : .28,
            backgroundPosition: ['left', 'center', 'right'].includes(b.backgroundPosition) ? b.backgroundPosition : 'center',
            targetType,
            targetProductId: String(b.targetProductId || ''),
            targetCategoryId: String(b.targetCategoryId || ''),
            targetPathIds: Array.isArray(b.targetPathIds) ? b.targetPathIds.map(String) : [],
            targetLabel: String(b.targetLabel || ''),
            targetUrl: String(b.targetUrl || b.buttonLink || '')
        };
    }

    function injectStyles() {
        if (document.getElementById('home-banners-modern-style')) return;
        const style = document.createElement('style');
        style.id = 'home-banners-modern-style';
        style.textContent = `
            /* Каждый слайд занимает ровно 100% viewport: карточка имеет
               ширину calc(100% - 12px) и по 6px margin с каждой стороны. */
            .banners-viewport {
                padding:12px 0 14px !important;
                margin:0 6px !important;
                overflow:hidden !important;
                box-sizing:border-box !important;
            }
            .banners-strip {
                align-items:stretch;
                width:100% !important;
                gap:0 !important;
            }
            .banner.hero-banner {
                flex:0 0 calc(100% - 12px) !important;
                width:calc(100% - 12px) !important;
                min-width:calc(100% - 12px) !important;
                margin:0 6px !important;
                box-sizing:border-box !important;
                border-radius:20px !important;
                padding:0 !important;
                min-height:176px;
                position:relative;
                overflow:hidden;
                background-size:cover !important;
                background-position:center;
                isolation:isolate;
                display:flex;
                box-shadow:0 7px 20px rgba(45,28,31,.10);
                border:1px solid rgba(255,255,255,.14);
            }
            .banner.hero-banner.clickable { cursor:pointer; }
            .banner.hero-banner.clickable:active { transform:scale(.996); }
            .banner.hero-banner::before { content:''; position:absolute; inset:0; z-index:-1; background:var(--hero-overlay,rgba(0,0,0,.28)); }
            .banner.hero-banner.dark-text::before { background:var(--hero-overlay-light,rgba(255,255,255,.34)); }
            .hero-banner.compact { min-height:138px; }
            .hero-banner.large { min-height:222px; }
            .hero-banner-content { width:100%; align-self:center; padding:22px 20px; box-sizing:border-box; }
            .hero-banner.center .hero-banner-content { text-align:center; }
            .hero-banner-badge { display:inline-flex; align-items:center; padding:5px 9px; border-radius:999px; background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.22); backdrop-filter:blur(7px); font-size:10.5px; font-weight:850; letter-spacing:.035em; margin-bottom:9px; }
            .hero-banner.dark-text .hero-banner-badge { background:rgba(0,0,0,.06); border-color:rgba(0,0,0,.08); }
            .hero-banner h3 { margin:0; max-width:88%; font-size:24px; line-height:1.04; font-weight:850; letter-spacing:-.025em; text-wrap:balance; }
            .hero-banner.center h3 { margin-left:auto; margin-right:auto; }
            .hero-banner .banner-sub { margin-top:7px; max-width:82%; font-size:12.8px; line-height:1.38; opacity:.9; }
            .hero-banner.center .banner-sub { margin-left:auto; margin-right:auto; }
            .hero-banner .banner-cta { display:inline-flex; align-items:center; gap:6px; margin-top:13px; padding:9px 14px; border-radius:999px; border:0; background:#fff; color:#171719; font-size:12px; line-height:1; font-weight:800; box-shadow:0 3px 10px rgba(0,0,0,.1); }
            .hero-banner.dark-text .banner-cta { background:#1c1c1e; color:#fff; }
            .hero-banner .banner-cta::after { content:'→'; font-size:13px; opacity:.75; }
            .banners-dots { margin:-5px 0 6px !important; gap:5px !important; }
            .banners-dot { width:5px !important; height:5px !important; background:#c7c7cc !important; }
            .banners-dot.active { width:18px !important; background:#5b2e36 !important; border-radius:4px !important; }
            @media (max-width:390px) {
                .banner.hero-banner { min-height:166px; }
                .hero-banner.compact { min-height:132px; }
                .hero-banner.large { min-height:208px; }
                .hero-banner-content { padding:19px 17px; }
                .hero-banner h3 { font-size:21px; max-width:94%; }
                .hero-banner .banner-sub { max-width:92%; }
            }
        `;
        document.head.appendChild(style);
    }

    function backgroundStyle(b) {
        if (b.imageUrl) {
            return `background-image:url('${String(b.imageUrl).replace(/'/g, '%27')}');background-position:${b.backgroundPosition};`;
        }
        return `background-image:linear-gradient(135deg,${b.color1 || '#82394a'},${b.color2 || '#5a2530'});background-position:center;`;
    }

    function bannerHasTarget(b) {
        if (b.targetType === 'product') return !!b.targetProductId;
        if (b.targetType === 'category') return !!b.targetCategoryId;
        if (b.targetType === 'external') return !!b.targetUrl;
        return false;
    }

    function showUnavailable(message) {
        try {
            if (window.Telegram?.WebApp?.showAlert) window.Telegram.WebApp.showAlert(message);
        } catch (e) {}
    }

    function openBannerTarget(b) {
        if (!b || !bannerHasTarget(b)) return;

        if (b.targetType === 'product') {
            const exists = Array.isArray(allProducts) && allProducts.some(product => String(product.id) === b.targetProductId);
            if (!exists) {
                showUnavailable('Этот товар сейчас недоступен в каталоге.');
                return;
            }
            if (typeof navigateTo === 'function') navigateTo({ type: 'detail', productId: b.targetProductId });
            return;
        }

        if (b.targetType === 'category') {
            const rootExists = Array.isArray(categories) && categories.some(category => String(category.id) === b.targetCategoryId);
            if (!rootExists) {
                showUnavailable('Эта категория сейчас недоступна.');
                return;
            }
            if (typeof navigateTo === 'function') {
                navigateTo({
                    type: 'category',
                    categoryId: b.targetCategoryId,
                    pathIds: Array.isArray(b.targetPathIds) ? [...b.targetPathIds] : [],
                    subFolderIds: null
                });
            }
            return;
        }

        if (b.targetType === 'external') {
            const url = String(b.targetUrl || '').trim();
            if (!/^https?:\/\//i.test(url)) return;
            try {
                if (window.Telegram?.WebApp?.openLink) window.Telegram.WebApp.openLink(url);
                else window.open(url, '_blank');
            } catch (e) {
                window.open(url, '_blank');
            }
        }
    }

    function configureAutoplay(viewport) {
        if (!viewport) return;

        const clearTimer = () => {
            if (viewport._bannerAutoplayTimer) {
                clearTimeout(viewport._bannerAutoplayTimer);
                viewport._bannerAutoplayTimer = null;
            }
        };

        const schedule = () => {
            clearTimer();
            const state = viewport._carouselState;
            if (!state || Number(state.count) < 2 || document.hidden) return;

            viewport._bannerAutoplayTimer = setTimeout(() => {
                const liveState = viewport._carouselState;
                if (!liveState || Number(liveState.count) < 2 || document.hidden) {
                    schedule();
                    return;
                }
                liveState.goTo((liveState.index + 1) % liveState.count);
                schedule();
            }, AUTOPLAY_MS);
        };

        if (!viewport.dataset.bannerAutoplayBound) {
            viewport.dataset.bannerAutoplayBound = '1';
            viewport.addEventListener('touchstart', clearTimer, { passive: true });
            viewport.addEventListener('touchend', schedule, { passive: true });
            viewport.addEventListener('touchcancel', schedule, { passive: true });
            viewport.addEventListener('click', schedule, { passive: true });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) clearTimer();
                else schedule();
            });
        }

        viewport._bannerAutoplaySchedule = schedule;
        schedule();
    }

    function bindBannerTarget(element, banner) {
        if (!element || !bannerHasTarget(banner)) return;
        element.classList.add('clickable');

        let startX = 0;
        let startY = 0;
        let dragged = false;
        element.addEventListener('touchstart', e => {
            const touch = e.touches?.[0];
            if (!touch) return;
            startX = touch.clientX;
            startY = touch.clientY;
            dragged = false;
        }, { passive: true });
        element.addEventListener('touchmove', e => {
            const touch = e.touches?.[0];
            if (!touch) return;
            if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) dragged = true;
        }, { passive: true });
        element.addEventListener('click', e => {
            if (dragged) {
                dragged = false;
                e.preventDefault();
                return;
            }
            if (e.target.closest('.banner-cta')) return;
            openBannerTarget(banner);
        });

        const button = element.querySelector('.banner-cta');
        if (button) {
            button.addEventListener('click', e => {
                e.stopPropagation();
                if (dragged) { dragged = false; return; }
                openBannerTarget(banner);
            });
        }
    }

    function renderModernBanners(input) {
        injectStyles();
        const viewport = document.getElementById('banners-viewport');
        const strip = document.getElementById('banners-strip');
        const dotsWrap = document.getElementById('banners-dots');
        if (!viewport || !strip) return;

        const banners = (Array.isArray(input) ? input : []).map(normalizeBanner).filter(b => b.enabled !== false);
        if (!banners.length) {
            if (viewport._bannerAutoplayTimer) clearTimeout(viewport._bannerAutoplayTimer);
            viewport.style.display = 'none';
            if (dotsWrap) dotsWrap.innerHTML = '';
            return;
        }
        viewport.style.display = '';

        strip.innerHTML = banners.map(b => {
            const dark = b.textTheme === 'dark';
            const overlay = Math.round(b.overlay * 100) / 100;
            const style = `${backgroundStyle(b)}--hero-overlay:rgba(0,0,0,${overlay});--hero-overlay-light:rgba(255,255,255,${Math.min(.64, overlay + .08)});color:${dark ? '#171719' : '#fff'};`;
            return `
                <div class="banner hero-banner ${dark ? 'dark-text' : ''} ${b.align === 'center' ? 'center' : ''} ${b.height === 'compact' ? 'compact' : b.height === 'large' ? 'large' : ''}" style="${style}">
                    <div class="hero-banner-content">
                        ${b.badge ? `<div class="hero-banner-badge">${esc(b.badge)}</div>` : ''}
                        <h3>${esc(b.text || '')}</h3>
                        ${b.subtext ? `<div class="banner-sub">${esc(b.subtext)}</div>` : ''}
                        ${b.buttonText ? `<button class="banner-cta" type="button">${esc(b.buttonText)}</button>` : ''}
                    </div>
                </div>`;
        }).join('');

        [...strip.querySelectorAll('.hero-banner')].forEach((element, index) => bindBannerTarget(element, banners[index]));

        if (dotsWrap) {
            dotsWrap.innerHTML = banners.length > 1
                ? banners.map((_, i) => `<div class="banners-dot${i === 0 ? ' active' : ''}" data-index="${i}"></div>`).join('')
                : '';
        }
        if (typeof setupBannerCarousel === 'function') {
            setupBannerCarousel(viewport, strip, banners.length, dotsWrap);
            configureAutoplay(viewport);
        }
    }

    window.renderBanners = renderModernBanners;
    injectStyles();
    fetch('/api/banners', { cache: 'no-store' })
        .then(r => r.json())
        .then(data => { if (data?.success) renderModernBanners(data.banners || []); })
        .catch(() => {});
})();