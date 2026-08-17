(() => {
    'use strict';

    // Карточка появляется сразу с лёгкой миниатюрой, а качественная версия
    // догружается только если карточка действительно попала в/рядом с экраном.
    // Так сохраняем чёткость, но не возвращаем прежнюю массовую загрузку full
    // для десятков/сотен невидимых товаров.
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

    function watchImage(img) {
        if (!img || img.dataset.hqObserved || img.closest('.product-card') === null) return;
        img.dataset.hqObserved = '1';
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
})();
