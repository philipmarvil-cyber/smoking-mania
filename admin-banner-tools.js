(() => {
    'use strict';

    const esc = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function ensureStyles() {
        if (document.getElementById('admin-banner-tools-style')) return;
        const style = document.createElement('style');
        style.id = 'admin-banner-tools-style';
        style.textContent = `
            .waiting-summary { background:#fff; border-radius:16px; padding:16px; margin:0 0 14px; box-shadow:0 1px 3px rgba(0,0,0,.05); }
            .waiting-summary-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; }
            .waiting-summary-title { font-size:15px; font-weight:800; }
            .waiting-summary-count { font-size:12px; color:#8e8e93; }
            .waiting-person { padding:11px 0; border-top:1px solid #f0f0f2; }
            .waiting-person:first-of-type { border-top:0; padding-top:2px; }
            .waiting-person-name { font-size:13.5px; font-weight:750; margin-bottom:7px; }
            .waiting-chips { display:flex; flex-wrap:wrap; gap:6px; }
            .waiting-chip { background:#fff4df; color:#8a5a00; border:1px solid #f3dfb7; border-radius:999px; padding:6px 9px; font-size:11.5px; font-weight:650; line-height:1.2; }
            .waiting-empty { color:#8e8e93; font-size:13px; padding:4px 0; }

            .banner-editor-card { background:#fff; border-radius:18px; padding:0; margin-bottom:14px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.06); border:1px solid rgba(0,0,0,.035); }
            .banner-editor-head { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid #f0f0f2; }
            .banner-editor-index { width:28px; height:28px; border-radius:9px; background:#1c1c1e; color:#fff; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; }
            .banner-editor-title { min-width:0; flex:1; }
            .banner-editor-title strong { display:block; font-size:13.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .banner-editor-title span { display:block; color:#8e8e93; font-size:11px; margin-top:2px; }
            .banner-order-btn { border:0; background:#ededf1; width:30px; height:30px; border-radius:9px; cursor:pointer; font-size:15px; }
            .banner-enabled { display:flex; align-items:center; gap:5px; font-size:11.5px; color:#636366; white-space:nowrap; }
            .banner-editor-body { padding:14px; }
            .banner-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
            .banner-field { min-width:0; }
            .banner-field.full { grid-column:1 / -1; }
            .banner-field label { display:block; font-size:11.5px; color:#8e8e93; margin:0 0 5px; }
            .banner-field input[type=text], .banner-field input[type=url], .banner-field select, .banner-field input[type=number] { width:100%; border:1px solid #e2e2e7; border-radius:10px; padding:10px 11px; font:inherit; font-size:13px; background:#fff; }
            .banner-field input[type=range] { width:100%; }
            .banner-colors { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
            .banner-color-control { display:flex; align-items:center; gap:7px; border:1px solid #e2e2e7; border-radius:10px; padding:6px 8px; }
            .banner-color-control input[type=color] { width:32px; height:28px; padding:0; border:0; background:none; }
            .banner-color-control span { font-size:11px; color:#636366; }
            .banner-image-row { display:flex; gap:7px; }
            .banner-image-row input { flex:1; min-width:0; }
            .banner-image-row button { border:0; background:#ededf1; border-radius:10px; padding:0 12px; font-weight:700; cursor:pointer; }
            .banner-admin-preview { position:relative; overflow:hidden; border-radius:16px; min-height:170px; margin-top:13px; background-size:cover; background-position:center; display:flex; padding:20px; box-sizing:border-box; isolation:isolate; }
            .banner-admin-preview::before { content:''; position:absolute; inset:0; background:var(--preview-overlay,rgba(0,0,0,.25)); z-index:-1; }
            .banner-admin-preview.dark-text::before { background:var(--preview-overlay-light,rgba(255,255,255,.25)); }
            .banner-admin-preview.center { text-align:center; justify-content:center; }
            .banner-admin-preview .preview-content { align-self:center; width:min(100%,520px); }
            .banner-admin-preview .preview-badge { display:inline-flex; padding:5px 9px; border-radius:999px; background:rgba(255,255,255,.18); border:1px solid rgba(255,255,255,.2); font-size:10.5px; font-weight:800; letter-spacing:.02em; margin-bottom:9px; }
            .banner-admin-preview.dark-text .preview-badge { background:rgba(0,0,0,.06); border-color:rgba(0,0,0,.08); }
            .banner-admin-preview .preview-title { font-size:23px; line-height:1.06; font-weight:850; letter-spacing:-.02em; }
            .banner-admin-preview .preview-sub { font-size:12.5px; line-height:1.35; margin-top:7px; opacity:.86; max-width:92%; }
            .banner-admin-preview.center .preview-sub { margin-left:auto; margin-right:auto; }
            .banner-admin-preview .preview-cta { display:inline-flex; margin-top:12px; padding:8px 13px; border-radius:999px; background:#fff; color:#111; font-size:11.5px; font-weight:800; }
            .banner-admin-preview.dark-text .preview-cta { background:#1c1c1e; color:#fff; }
            .banner-remove-modern { width:100%; margin-top:10px; border:0; background:#fff1ef; color:#b33b2e; border-radius:10px; padding:10px; font-weight:700; cursor:pointer; }
            @media(max-width:650px){ .banner-form-grid{grid-template-columns:1fr;} .banner-field.full{grid-column:auto;} .banner-editor-head{flex-wrap:wrap;} }
        `;
        document.head.appendChild(style);
    }

    function normalizeBanner(b = {}) {
        return {
            ...b,
            enabled: b.enabled !== false,
            badge: String(b.badge || ''),
            textTheme: b.textTheme === 'dark' ? 'dark' : 'light',
            align: b.align === 'center' ? 'center' : 'left',
            height: ['compact', 'regular', 'large'].includes(b.height) ? b.height : 'regular',
            overlay: Number.isFinite(Number(b.overlay)) ? Math.max(0, Math.min(.75, Number(b.overlay))) : .28,
            backgroundPosition: ['left', 'center', 'right'].includes(b.backgroundPosition) ? b.backgroundPosition : 'center'
        };
    }

    window.blankBanner = function modernBlankBanner() {
        return normalizeBanner({
            id: `banner-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text: 'Новый баннер', subtext: '', badge: '',
            color1: '#82394a', color2: '#5a2530', imageUrl: '',
            buttonText: '', buttonLink: ''
        });
    };

    window.moveBanner = function moveBanner(id, direction) {
        const index = banners.findIndex(b => b.id === id);
        if (index < 0) return;
        const next = Math.max(0, Math.min(banners.length - 1, index + direction));
        if (next === index) return;
        const [item] = banners.splice(index, 1);
        banners.splice(next, 0, item);
        renderBannersList();
    };

    window.renderBannerPreview = function modernBannerPreview(id) {
        const raw = banners.find(x => x.id === id);
        const el = document.getElementById(`preview-${id}`);
        if (!raw || !el) return;
        const b = normalizeBanner(raw);
        const overlay = Math.round(b.overlay * 100) / 100;
        const bg = b.imageUrl && !String(b.imageUrl).startsWith('(')
            ? `url('${String(b.imageUrl).replace(/'/g, '%27')}')`
            : `linear-gradient(135deg, ${b.color1 || '#82394a'}, ${b.color2 || '#5a2530'})`;
        el.style.backgroundImage = bg;
        el.style.backgroundPosition = b.backgroundPosition;
        el.style.setProperty('--preview-overlay', `rgba(0,0,0,${overlay})`);
        el.style.setProperty('--preview-overlay-light', `rgba(255,255,255,${Math.min(.62, overlay + .08)})`);
        el.style.color = b.textTheme === 'dark' ? '#171719' : '#fff';
        el.classList.toggle('dark-text', b.textTheme === 'dark');
        el.classList.toggle('center', b.align === 'center');
        el.style.minHeight = b.height === 'compact' ? '135px' : b.height === 'large' ? '215px' : '170px';
        el.innerHTML = `
            <div class="preview-content">
                ${b.badge ? `<div class="preview-badge">${esc(b.badge)}</div>` : ''}
                <div class="preview-title">${esc(b.text || 'Текст баннера')}</div>
                ${b.subtext ? `<div class="preview-sub">${esc(b.subtext)}</div>` : ''}
                ${b.buttonText ? `<div class="preview-cta">${esc(b.buttonText)}</div>` : ''}
            </div>`;
    };

    window.renderBannersList = function modernRenderBannersList() {
        ensureStyles();
        const list = document.getElementById('banners-list');
        if (!list) return;
        if (!banners.length) {
            list.innerHTML = '<p class="sub">Баннеров пока нет — будет использован баннер по умолчанию.</p>';
            return;
        }
        banners = banners.map(normalizeBanner);
        list.innerHTML = banners.map((b, index) => `
            <div class="banner-editor-card">
                <div class="banner-editor-head">
                    <div class="banner-editor-index">${index + 1}</div>
                    <div class="banner-editor-title"><strong>${esc(b.text || 'Без заголовка')}</strong><span>${b.enabled ? 'Показывается на главной' : 'Скрыт'}</span></div>
                    <button class="banner-order-btn" onclick="moveBanner('${esc(b.id)}',-1)" title="Выше">↑</button>
                    <button class="banner-order-btn" onclick="moveBanner('${esc(b.id)}',1)" title="Ниже">↓</button>
                    <label class="banner-enabled"><input type="checkbox" ${b.enabled ? 'checked' : ''} onchange="updateBannerField('${esc(b.id)}','enabled',this.checked);renderBannersList()"> Вкл</label>
                </div>
                <div class="banner-editor-body">
                    <div class="banner-form-grid">
                        <div class="banner-field full"><label>Заголовок</label><input type="text" value="${esc(b.text)}" oninput="updateBannerField('${esc(b.id)}','text',this.value)"></div>
                        <div class="banner-field full"><label>Подзаголовок</label><input type="text" value="${esc(b.subtext)}" oninput="updateBannerField('${esc(b.id)}','subtext',this.value)"></div>
                        <div class="banner-field"><label>Небольшой бейдж сверху</label><input type="text" value="${esc(b.badge)}" placeholder="Например: НОВИНКА" oninput="updateBannerField('${esc(b.id)}','badge',this.value)"></div>
                        <div class="banner-field"><label>Высота</label><select onchange="updateBannerField('${esc(b.id)}','height',this.value)"><option value="compact" ${b.height === 'compact' ? 'selected' : ''}>Компактный</option><option value="regular" ${b.height === 'regular' ? 'selected' : ''}>Обычный</option><option value="large" ${b.height === 'large' ? 'selected' : ''}>Большой</option></select></div>
                        <div class="banner-field"><label>Текст</label><select onchange="updateBannerField('${esc(b.id)}','textTheme',this.value)"><option value="light" ${b.textTheme === 'light' ? 'selected' : ''}>Светлый</option><option value="dark" ${b.textTheme === 'dark' ? 'selected' : ''}>Тёмный</option></select></div>
                        <div class="banner-field"><label>Выравнивание</label><select onchange="updateBannerField('${esc(b.id)}','align',this.value)"><option value="left" ${b.align === 'left' ? 'selected' : ''}>Слева</option><option value="center" ${b.align === 'center' ? 'selected' : ''}>По центру</option></select></div>
                        <div class="banner-field"><label>Позиция картинки</label><select onchange="updateBannerField('${esc(b.id)}','backgroundPosition',this.value)"><option value="left" ${b.backgroundPosition === 'left' ? 'selected' : ''}>Слева</option><option value="center" ${b.backgroundPosition === 'center' ? 'selected' : ''}>По центру</option><option value="right" ${b.backgroundPosition === 'right' ? 'selected' : ''}>Справа</option></select></div>
                        <div class="banner-field"><label>Затемнение / осветление: ${Math.round(b.overlay * 100)}%</label><input type="range" min="0" max="0.75" step="0.05" value="${b.overlay}" oninput="updateBannerField('${esc(b.id)}','overlay',Number(this.value));this.previousElementSibling.textContent='Затемнение / осветление: '+Math.round(this.value*100)+'%'"></div>
                        <div class="banner-field full"><label>Цвета, если картинки нет</label><div class="banner-colors"><div class="banner-color-control"><input type="color" value="${esc(b.color1 || '#82394a')}" oninput="updateBannerField('${esc(b.id)}','color1',this.value)"><span>Первый</span></div><div class="banner-color-control"><input type="color" value="${esc(b.color2 || '#5a2530')}" oninput="updateBannerField('${esc(b.id)}','color2',this.value)"><span>Второй</span></div></div></div>
                        <div class="banner-field full"><label>Картинка-фон</label><div class="banner-image-row"><input type="url" value="${String(b.imageUrl || '').startsWith('data:') ? '' : esc(b.imageUrl)}" placeholder="https://... или загрузите файл" oninput="updateBannerField('${esc(b.id)}','imageUrl',this.value)" id="url-${esc(b.id)}"><button onclick="document.getElementById('file-${esc(b.id)}').click()">Загрузить</button><input type="file" accept="image/*" id="file-${esc(b.id)}" style="display:none" onchange="handleImageUpload('${esc(b.id)}',this.files[0])"></div></div>
                        <div class="banner-field"><label>Текст кнопки</label><input type="text" value="${esc(b.buttonText)}" placeholder="Подробнее" oninput="updateBannerField('${esc(b.id)}','buttonText',this.value)"></div>
                        <div class="banner-field"><label>Ссылка кнопки</label><input type="url" value="${esc(b.buttonLink)}" placeholder="https://..." oninput="updateBannerField('${esc(b.id)}','buttonLink',this.value)"></div>
                    </div>
                    <div class="banner-admin-preview" id="preview-${esc(b.id)}"></div>
                    <button class="banner-remove-modern" onclick="removeBanner('${esc(b.id)}')">Удалить баннер</button>
                </div>
            </div>`).join('');
        banners.forEach(b => renderBannerPreview(b.id));
    };

    async function refreshWaitingSummary() {
        const panel = document.getElementById('tab-panel-notify');
        if (!panel || !sessionStorage.getItem('admin-panel-key')) return;
        let box = document.getElementById('waiting-summary');
        if (!box) {
            box = document.createElement('div');
            box.id = 'waiting-summary';
            box.className = 'waiting-summary';
            const toolbar = panel.querySelector('.toolbar');
            panel.insertBefore(box, toolbar || panel.firstChild);
        }
        box.innerHTML = '<div class="waiting-empty">Загружаем актуальные ожидания…</div>';
        try {
            const key = sessionStorage.getItem('admin-panel-key');
            const res = await fetch(`/api/notify-log?key=${encodeURIComponent(key)}&view=users`, { cache: 'no-store' });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Ошибка');
            const waiting = (data.users || []).filter(u => Number(u.waitingCount) > 0);
            const total = waiting.reduce((sum, u) => sum + Number(u.waitingCount || 0), 0);
            if (!waiting.length) {
                box.innerHTML = '<div class="waiting-summary-head"><div class="waiting-summary-title">Сейчас ждут поступления</div><div class="waiting-summary-count">0</div></div><div class="waiting-empty">Активных ожиданий сейчас нет.</div>';
                return;
            }
            box.innerHTML = `<div class="waiting-summary-head"><div class="waiting-summary-title">Сейчас ждут поступления</div><div class="waiting-summary-count">${waiting.length} чел. · ${total} товаров</div></div>` + waiting.map(user => {
                const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? '@' + user.username : 'ID ' + user.id);
                const chips = (user.waitingItems || []).map(item => `<span class="waiting-chip">${esc(item.productName || item.productId)}</span>`).join('');
                return `<div class="waiting-person"><div class="waiting-person-name">${esc(name)}${user.username && !name.startsWith('@') ? ` · @${esc(user.username)}` : ''}</div><div class="waiting-chips">${chips}</div></div>`;
            }).join('');
        } catch (e) {
            box.innerHTML = `<div class="waiting-empty">Не удалось загрузить ожидания: ${esc(e.message || 'ошибка')}</div>`;
        }
    }

    function init() {
        ensureStyles();
        if (typeof renderBannersList === 'function') renderBannersList();
        const baseLoadEntries = window.loadEntries;
        if (typeof baseLoadEntries === 'function' && !baseLoadEntries.__waitingWrapped) {
            const wrapped = async function(...args) {
                const result = await baseLoadEntries.apply(this, args);
                refreshWaitingSummary();
                return result;
            };
            wrapped.__waitingWrapped = true;
            window.loadEntries = wrapped;
        }
        if (document.getElementById('content-screen')?.style.display !== 'none') refreshWaitingSummary();
    }

    setTimeout(init, 0);
})();