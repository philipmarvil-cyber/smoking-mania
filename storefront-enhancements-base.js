(() => {
    'use strict';

    // Избранное открывается поверх текущего места. Поэтому Telegram Back
    // возвращает в исходную категорию/товар и восстанавливает scrollY.
    const originalSwitchTab = window.switchTab;
    if (typeof originalSwitchTab === 'function') {
        window.switchTab = function switchTabPreservingFavorites(type) {
            if (type === 'favorites' && typeof navigateTo === 'function' && typeof currentScreen === 'function') {
                const current = currentScreen();
                if (current?.type === 'favorites') return;
                navigateTo({ type: 'favorites' });
                return;
            }
            return originalSwitchTab(type);
        };
    }

    const style = document.createElement('style');
    style.textContent = `
        .product-card.out-of-stock .product-image-container {
            background: #ededf0;
            border-radius: 14px;
            overflow: hidden;
        }
        .product-card.out-of-stock .product-image-container img,
        .product-main-img.out-of-stock .product-gallery-slide img,
        .product-main-img.out-of-stock > img {
            mix-blend-mode: multiply;
            filter: grayscale(.18) saturate(.72);
            opacity: .84;
        }
        .product-main-img.out-of-stock,
        .product-main-img.out-of-stock .product-gallery-slide {
            background: #ededf0;
        }
        .product-card.out-of-stock {
            box-shadow: none;
            border: 1px solid rgba(60,60,67,.07);
        }
        .product-gallery-viewport {
            width: 100%;
            overflow: hidden;
            border-radius: 14px;
            touch-action: pan-y;
            position: relative;
        }
        .product-gallery-track {
            display: flex;
            width: 100%;
            will-change: transform;
            transition: transform .28s cubic-bezier(.22,.61,.36,1);
        }
        .product-gallery-slide {
            flex: 0 0 100%;
            width: 100%;
            height: 300px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #fff;
        }
        .product-gallery-slide img {
            width: 100%;
            max-width: 100%;
            height: 100% !important;
            max-height: 100%;
            object-fit: contain;
            opacity: 1;
            transition: opacity .18s ease;
        }
        .product-gallery-slide img.gallery-pending { opacity: .15; }
        .product-gallery-dots {
            position: absolute;
            left: 50%;
            bottom: 9px;
            transform: translateX(-50%);
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px 8px;
            border-radius: 12px;
            background: rgba(255,255,255,.86);
            backdrop-filter: blur(8px);
            z-index: 3;
        }
        .product-gallery-dot {
            width: 5px;
            height: 5px;
            border-radius: 50%;
            background: #c7c7cc;
            transition: width .2s ease, background .2s ease;
        }
        .product-gallery-dot.active {
            width: 15px;
            border-radius: 4px;
            background: #1c1c1e;
        }
        .product-main-img .fav-toggle,
        .product-main-img .new-badge { z-index: 5; }
    `;
    document.head.appendChild(style);

    function galleryVersion(prod) {
        if (prod.imageVersion && prod.imageVersion !== '0') return String(prod.imageVersion);
        try {
            return new URL(prod.img || '', window.location.origin).searchParams.get('v') || '0';
        } catch (e) {
            return '0';
        }
    }

    function detailImageUrl(prod, index) {
        const v = encodeURIComponent(galleryVersion(prod));
        return `/api/product-image?id=${encodeURIComponent(prod.id)}&index=${index}&v=${v}&size=full`;
    }

    function enhanceGallery(prod, detailId, forcedCount = null) {
        const main = document.querySelector('.product-main-img');
        const firstImg = main?.querySelector('#detail-main-img');
        const count = forcedCount === null
            ? Math.max(prod.img ? 1 : 0, Number(prod.imageCount) || 0)
            : Math.max(1, Number(forcedCount) || 1);
        if (!main || !firstImg || count <= 1 || main.querySelector('.product-gallery-viewport')) return;

        const viewport = document.createElement('div');
        viewport.className = 'product-gallery-viewport';
        const track = document.createElement('div');
        track.className = 'product-gallery-track';
        viewport.appendChild(track);

        const images = [];
        for (let i = 0; i < count; i++) {
            const slide = document.createElement('div');
            slide.className = 'product-gallery-slide';
            let img;
            if (i === 0) {
                img = firstImg;
            } else {
                img = document.createElement('img');
                img.alt = prod.name || '';
                img.decoding = 'async';
                img.className = 'gallery-pending';
            }
            slide.appendChild(img);
            track.appendChild(slide);
            images.push(img);
        }

        const dots = document.createElement('div');
        dots.className = 'product-gallery-dots';
        dots.innerHTML = Array.from({ length: count }, (_, i) =>
            `<span class="product-gallery-dot${i === 0 ? ' active' : ''}" data-i="${i}"></span>`
        ).join('');
        viewport.appendChild(dots);
        main.insertBefore(viewport, main.firstChild);

        let index = 0;
        let width = viewport.clientWidth || 1;
        let startX = 0;
        let startY = 0;
        let dragX = 0;
        let axis = null;
        // Первый full уже загружает штатная страница товара.
        const requested = new Set([0]);

        function loadFull(i) {
            if (i < 0 || i >= count || requested.has(i)) return;
            requested.add(i);
            const target = images[i];
            const url = detailImageUrl(prod, i);
            const preload = new Image();
            preload.onload = () => {
                if (typeof currentScreen === 'function') {
                    const screen = currentScreen();
                    if (screen?.type !== 'detail' || screen.productId !== detailId) return;
                }
                target.src = url;
                target.classList.remove('gallery-pending');
            };
            preload.onerror = () => target.classList.remove('gallery-pending');
            preload.src = url;
        }

        function apply(animate = true) {
            track.style.transition = animate ? 'transform .28s cubic-bezier(.22,.61,.36,1)' : 'none';
            track.style.transform = `translateX(${-(index * width) + dragX}px)`;
            dots.querySelectorAll('.product-gallery-dot').forEach((dot, i) => dot.classList.toggle('active', i === index));
        }

        function goTo(next) {
            index = Math.max(0, Math.min(count - 1, next));
            dragX = 0;
            apply(true);
            loadFull(index);
            const warmNext = () => loadFull(index + 1);
            if ('requestIdleCallback' in window) requestIdleCallback(warmNext, { timeout: 1000 });
            else setTimeout(warmNext, 350);
        }

        const warmSecond = () => loadFull(1);
        if ('requestIdleCallback' in window) requestIdleCallback(warmSecond, { timeout: 1400 });
        else setTimeout(warmSecond, 500);

        viewport.addEventListener('touchstart', e => {
            const t = e.touches[0];
            width = viewport.clientWidth || 1;
            startX = t.clientX;
            startY = t.clientY;
            dragX = 0;
            axis = null;
        }, { passive: true });

        viewport.addEventListener('touchmove', e => {
            const t = e.touches[0];
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            if (!axis && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            if (axis !== 'x') return;
            e.preventDefault();
            const atEdge = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
            dragX = atEdge ? dx * .3 : dx;
            apply(false);
        }, { passive: false });

        viewport.addEventListener('touchend', () => {
            if (axis !== 'x') return;
            const threshold = width * .14;
            if (dragX < -threshold) goTo(index + 1);
            else if (dragX > threshold) goTo(index - 1);
            else goTo(index);
        });

        dots.addEventListener('click', e => {
            const dot = e.target.closest('.product-gallery-dot');
            if (dot) goTo(Number(dot.dataset.i));
        });
    }

    function discoverGallery(prod, id) {
        if (!prod?.img) return;
        const knownCount = Number(prod.imageCount) || 0;
        if (knownCount > 1) {
            enhanceGallery(prod, id, knownCount);
            return;
        }

        // Старый localStorage/KV мог быть создан до появления imageCount.
        // В таком случае не запускаем тяжёлый full-sync всего каталога: узнаём
        // число фото только для реально открытого товара. Сервер делит этот
        // 7-дневный cache с product-image.js, поэтому обычно это вообще 0
        // дополнительных запросов к МойСклад после загрузки первого full-фото.
        if (prod.imageVersion && prod.imageVersion !== '0') return;
        const v = encodeURIComponent(galleryVersion(prod));
        fetch(`/api/product-images?id=${encodeURIComponent(prod.id)}&v=${v}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data?.success || Number(data.count) <= 1) return;
                if (typeof currentScreen === 'function') {
                    const screen = currentScreen();
                    if (screen?.type !== 'detail' || screen.productId !== id) return;
                }
                prod.imageCount = Number(data.count);
                enhanceGallery(prod, id, prod.imageCount);
            })
            .catch(() => {});
    }

    const originalRenderProductDetail = window.renderProductDetail;
    if (typeof originalRenderProductDetail === 'function') {
        window.renderProductDetail = function renderProductDetailWithGallery(id) {
            originalRenderProductDetail(id);
            const prod = allProducts.find(p => p.id === id);
            if (prod) discoverGallery(prod, id);
        };
    }

    // Реестр пользователей для админ-панели. Не трогаем МойСклад: это один
    // маленький POST в KV максимум раз в 6 часов с данного устройства.
    function touchTelegramUserForAdmin() {
        const webApp = window.Telegram?.WebApp;
        const user = webApp?.initDataUnsafe?.user;
        if (!user?.id) return;
        const storageKey = `admin_user_touch_v1:${user.id}`;
        const now = Date.now();
        const last = Number(localStorage.getItem(storageKey)) || 0;
        if (now - last < 6 * 60 * 60 * 1000) return;
        localStorage.setItem(storageKey, String(now));
        fetch('/api/orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'touch-user',
                user: {
                    id: user.id,
                    firstName: user.first_name || '',
                    lastName: user.last_name || '',
                    username: user.username || '',
                    photoUrl: user.photo_url || ''
                }
            })
        }).then(response => {
            if (!response.ok) localStorage.removeItem(storageKey);
        }).catch(() => localStorage.removeItem(storageKey));
    }
    setTimeout(touchTelegramUserForAdmin, 250);

})();
