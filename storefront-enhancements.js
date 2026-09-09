(() => {
    'use strict';

    const CATEGORY_VISUALS = [
        { test: /мерч/i, y: '0%' },
        { test: /колб/i, y: '16.6667%' },
        { test: /смес/i, y: '33.3333%' },
        { test: /кальян/i, y: '50%' },
        { test: /угол/i, y: '66.6667%' },
        { test: /аксессуар/i, y: '83.3333%' },
        { test: /чаш/i, y: '100%' }
    ];

    const categoryStyle = document.createElement('style');
    categoryStyle.textContent = `
        .category-tile.category-photo {
            position: relative;
            overflow: hidden;
            justify-content: flex-end;
            align-items: flex-start;
            background-image:
                linear-gradient(90deg, rgba(10,11,13,.58) 0%, rgba(10,11,13,.28) 48%, rgba(10,11,13,.05) 100%),
                url('/assets/category-sprite.jpg?v=20260909b');
            background-size: 100% 100%, 100% 700%;
            background-position: center, center var(--category-y);
            background-repeat: no-repeat;
            padding: 10px 11px;
        }
        .category-tile.category-photo .category-tile-icon { display: none; }
        .category-tile.category-photo .category-tile-name {
            position: relative;
            z-index: 1;
            max-width: 82%;
            color: #fff;
            font-size: 12px;
            font-weight: 750;
            line-height: 1.08;
            letter-spacing: -.15px;
            text-shadow: 0 1px 5px rgba(0,0,0,.72);
        }
        .category-tile.category-photo:active { opacity: .9; transform: scale(.985); }
    `;
    document.head.appendChild(categoryStyle);

    const originalCreateCategoryTile = window.createCategoryTile;
    if (typeof originalCreateCategoryTile === 'function') {
        window.createCategoryTile = function createCategoryTileWithPhoto(name, onClick) {
            const tile = originalCreateCategoryTile(name, onClick);
            const visual = CATEGORY_VISUALS.find(item => item.test.test(String(name || '')));
            if (visual) {
                tile.classList.add('category-photo');
                tile.style.setProperty('--category-y', visual.y);
            }
            return tile;
        };
    }

    const legacy = document.createElement('script');
    legacy.src = '/storefront-enhancements-base.js?v=20260909b';
    legacy.async = false;
    document.head.appendChild(legacy);
})();
