(() => {
    'use strict';

    let usersCache = [];
    let usersLoaded = false;
    let userFilter = 'all';

    const esc = value => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    function adminAccessKey() {
        return sessionStorage.getItem('admin-panel-key') || '';
    }

    function formatDate(ts, withTime = true) {
        if (!ts) return '—';
        const date = new Date(ts);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleString('ru-RU', withTime
            ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    const money = value => `${Math.round(Number(value) || 0).toLocaleString('ru-RU')} ₽`;

    function displayName(user) {
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
        return name || (user.username ? `@${user.username}` : `Telegram ID ${user.id}`);
    }

    function initials(user) {
        const text = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'U';
        return text.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    }

    function injectStyles() {
        if (document.getElementById('admin-enhancements-style')) return;
        const style = document.createElement('style');
        style.id = 'admin-enhancements-style';
        style.textContent = `
            .wrap { max-width: 980px !important; }
            .admin-overview { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:0 0 16px; }
            .admin-stat { background:#fff; border-radius:14px; padding:14px 16px; box-shadow:0 1px 3px rgba(0,0,0,.05); }
            .admin-stat-value { font-size:22px; line-height:1; font-weight:800; margin-bottom:6px; }
            .admin-stat-label { color:#8e8e93; font-size:11.5px; line-height:1.2; }
            .tabs { position:sticky; top:0; z-index:20; overflow-x:auto; scrollbar-width:none; }
            .tabs::-webkit-scrollbar { display:none; }
            .tab-btn { min-width:120px; white-space:nowrap; }
            .users-toolbar { display:flex; gap:10px; margin-bottom:12px; }
            .users-search { flex:1; min-width:0; background:#fff; border:1px solid #e3e3e8; border-radius:12px; padding:11px 13px; font-size:14px; outline:none; }
            .users-refresh { border:0; border-radius:12px; background:#1c1c1e; color:#fff; padding:0 16px; font-weight:700; cursor:pointer; }
            .users-filters { display:flex; gap:7px; margin-bottom:12px; overflow-x:auto; scrollbar-width:none; }
            .users-filter { border:0; border-radius:999px; padding:8px 13px; background:#e9e9ed; color:#636366; font-size:12.5px; font-weight:700; cursor:pointer; white-space:nowrap; }
            .users-filter.active { background:#1c1c1e; color:#fff; }
            .users-meta { color:#8e8e93; font-size:12.5px; margin:0 2px 10px; }
            .user-row { background:#fff; border-radius:15px; padding:13px 14px; margin-bottom:9px; display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:12px; align-items:center; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.045); transition:transform .08s ease; }
            .user-row:active { transform:scale(.992); }
            .user-avatar { width:44px; height:44px; border-radius:50%; background:#1c1c1e center/cover no-repeat; color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:800; flex-shrink:0; }
            .user-name { font-size:14.5px; font-weight:750; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .user-sub { color:#8e8e93; font-size:11.8px; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .user-right { text-align:right; }
            .user-orders-count { font-size:13px; font-weight:750; }
            .user-spent { color:#2f8f4e; font-size:11.8px; margin-top:3px; font-weight:650; }
            .user-waiting { color:#9a6400; font-size:11.5px; margin-top:4px; font-weight:700; }
            .waiting-detail-card { background:#fff8eb; border:1px solid #f4e1bb; border-radius:15px; padding:14px; margin-bottom:12px; }
            .waiting-detail-title { font-size:14px; font-weight:800; margin-bottom:9px; }
            .waiting-detail-item { background:#fff; border-radius:10px; padding:9px 10px; font-size:12.5px; font-weight:650; margin-top:6px; }
            .waiting-detail-item small { display:block; color:#9a9a9e; font-weight:500; margin-top:3px; }
            .user-empty { background:#fff; border-radius:15px; padding:38px 18px; color:#8e8e93; text-align:center; }
            .user-drawer-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.28); z-index:9998; display:flex; justify-content:flex-end; }
            .user-drawer { width:min(520px,100%); height:100%; background:#f4f4f6; overflow-y:auto; padding:20px 16px 50px; box-shadow:-10px 0 30px rgba(0,0,0,.12); animation:drawerIn .2s ease-out; }
            @keyframes drawerIn { from { transform:translateX(18px); opacity:.5; } to { transform:none; opacity:1; } }
            .drawer-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
            .drawer-title { font-size:18px; font-weight:800; }
            .drawer-close { width:34px; height:34px; border:0; border-radius:50%; background:#e2e2e7; font-size:18px; cursor:pointer; }
            .profile-card, .order-history-card { background:#fff; border-radius:16px; padding:16px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,.04); }
            .profile-top { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
            .profile-top .user-avatar { width:54px; height:54px; }
            .profile-name { font-size:17px; font-weight:800; }
            .profile-username { color:#8e8e93; font-size:13px; margin-top:3px; }
            .profile-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
            .profile-cell { background:#f7f7f9; border-radius:11px; padding:10px 11px; min-width:0; }
            .profile-cell-label { color:#9a9a9e; font-size:10.5px; margin-bottom:3px; }
            .profile-cell-value { font-size:13px; font-weight:700; overflow-wrap:anywhere; }
            .orders-heading { font-size:14px; font-weight:800; margin:4px 2px 9px; }
            .purchase-order { background:#fff; border-radius:15px; margin-bottom:9px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04); }
            .purchase-order-head { padding:13px 14px; display:flex; justify-content:space-between; gap:12px; cursor:pointer; }
            .purchase-order-name { font-size:13.5px; font-weight:800; }
            .purchase-order-date { color:#8e8e93; font-size:11.5px; margin-top:3px; }
            .purchase-order-sum { font-size:14px; font-weight:800; text-align:right; }
            .purchase-order-status { font-size:10.5px; color:#8e8e93; margin-top:3px; text-align:right; }
            .purchase-items { border-top:1px solid #efeff2; padding:8px 14px 11px; }
            .purchase-item { display:flex; justify-content:space-between; gap:12px; padding:5px 0; font-size:12.5px; }
            .purchase-item span:last-child { white-space:nowrap; font-weight:650; }
            .drawer-loading { background:#fff; border-radius:16px; padding:34px 18px; text-align:center; color:#8e8e93; }
            @media (max-width:720px) {
                .admin-overview { grid-template-columns:repeat(2,minmax(0,1fr)); }
                .wrap { padding-top:18px !important; }
                .user-row { grid-template-columns:auto minmax(0,1fr); }
                .user-right { grid-column:2; text-align:left; display:flex; gap:8px; align-items:center; }
                .user-spent { margin-top:0; }
            }
        `;
        document.head.appendChild(style);
    }

    function ensureUi() {
        injectStyles();
        const h1 = document.querySelector('.wrap > h1');
        const sub = document.querySelector('.wrap > .sub');
        if (h1) h1.textContent = 'SMOKING MANIA — Админ';
        if (sub) sub.textContent = 'Пользователи, заказы, уведомления, баннеры и каталог в одном месте';

        const content = document.getElementById('content-screen');
        const tabs = content?.querySelector('.tabs');
        if (!content || !tabs) return;

        if (!document.getElementById('admin-overview')) {
            const overview = document.createElement('div');
            overview.id = 'admin-overview';
            overview.className = 'admin-overview';
            overview.innerHTML = `
                <div class="admin-stat"><div class="admin-stat-value" id="stat-users">—</div><div class="admin-stat-label">Пользователей</div></div>
                <div class="admin-stat"><div class="admin-stat-value" id="stat-buyers">—</div><div class="admin-stat-label">Покупателей</div></div>
                <div class="admin-stat"><div class="admin-stat-value" id="stat-orders">—</div><div class="admin-stat-label">Заказов в истории</div></div>
                <div class="admin-stat"><div class="admin-stat-value" id="stat-waiting">—</div><div class="admin-stat-label">Ждут поступления</div></div>
            `;
            tabs.parentNode.insertBefore(overview, tabs);
        }

        if (!document.getElementById('tab-btn-users')) {
            const btn = document.createElement('button');
            btn.className = 'tab-btn';
            btn.id = 'tab-btn-users';
            btn.textContent = 'Пользователи';
            btn.onclick = () => window.switchTab('users');
            tabs.insertBefore(btn, tabs.firstChild);
        }

        if (!document.getElementById('tab-panel-users')) {
            const panel = document.createElement('div');
            panel.className = 'tab-panel';
            panel.id = 'tab-panel-users';
            panel.innerHTML = `
                <div class="section-heading">Пользователи</div>
                <p class="sub" style="margin-top:-6px;">Все известные пользователи Telegram. Нажмите на человека, чтобы увидеть его данные и покупки.</p>
                <div class="users-toolbar">
                    <input class="users-search" id="users-search" placeholder="Имя, @username, телефон или Telegram ID">
                    <button class="users-refresh" id="users-refresh">Обновить</button>
                </div>
                <div class="users-filters">
                    <button class="users-filter active" data-filter="all">Все</button>
                    <button class="users-filter" data-filter="buyers">Покупатели</button>
                    <button class="users-filter" data-filter="without-orders">Без заказов</button>
                </div>
                <div class="users-meta" id="users-meta"></div>
                <div id="users-list"><div class="user-empty">Откройте раздел, чтобы загрузить пользователей</div></div>
            `;
            tabs.parentNode.insertBefore(panel, document.getElementById('tab-panel-notify'));
            panel.querySelector('#users-search').addEventListener('input', renderUsers);
            panel.querySelector('#users-refresh').addEventListener('click', () => loadUsers(true));
            panel.querySelectorAll('.users-filter').forEach(btn => btn.addEventListener('click', () => {
                userFilter = btn.dataset.filter;
                panel.querySelectorAll('.users-filter').forEach(x => x.classList.toggle('active', x === btn));
                renderUsers();
            }));
        }
    }

    const baseSwitchTab = window.switchTab;
    window.switchTab = function enhancedAdminSwitchTab(name) {
        ensureUi();
        const usersPanel = document.getElementById('tab-panel-users');
        const usersButton = document.getElementById('tab-btn-users');
        if (name === 'users') {
            document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            usersPanel?.classList.add('active');
            usersButton?.classList.add('active');
            loadUsers(false);
            return;
        }
        usersPanel?.classList.remove('active');
        usersButton?.classList.remove('active');
        if (typeof baseSwitchTab === 'function') baseSwitchTab(name);
    };

    function updateStats(stats = {}) {
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('stat-users', Number(stats.totalUsers || 0).toLocaleString('ru-RU'));
        set('stat-buyers', Number(stats.buyers || 0).toLocaleString('ru-RU'));
        set('stat-orders', Number(stats.totalOrders || 0).toLocaleString('ru-RU'));
        set('stat-waiting', Number(stats.waitingUsers || 0).toLocaleString('ru-RU'));
    }

    async function loadUsers(force) {
        ensureUi();
        if (usersLoaded && !force) { renderUsers(); return; }
        const list = document.getElementById('users-list');
        const refresh = document.getElementById('users-refresh');
        if (list) list.innerHTML = '<div class="user-empty">Загружаем пользователей…</div>';
        if (refresh) refresh.disabled = true;
        try {
            const key = adminAccessKey();
            if (!key) throw new Error('Нет ключа администратора');
            const response = await fetch(`/api/notify-log?key=${encodeURIComponent(key)}&view=users`, { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось загрузить пользователей');
            usersCache = Array.isArray(data.users) ? data.users : [];
            usersLoaded = true;
            updateStats(data.stats || {});
            renderUsers();
        } catch (e) {
            if (list) list.innerHTML = `<div class="user-empty">${esc(e.message || 'Ошибка загрузки')}</div>`;
        } finally {
            if (refresh) refresh.disabled = false;
        }
    }

    function renderUsers() {
        const list = document.getElementById('users-list');
        const meta = document.getElementById('users-meta');
        const input = document.getElementById('users-search');
        if (!list) return;
        const query = String(input?.value || '').trim().toLowerCase().replace(/^@/, '');
        const visible = usersCache.filter(user => {
            const orders = Number(user.totalOrders) || 0;
            if (userFilter === 'buyers' && orders <= 0) return false;
            if (userFilter === 'without-orders' && orders > 0) return false;
            if (!query) return true;
            const haystack = [user.firstName, user.lastName, user.username, user.phone, user.id].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(query);
        });
        if (meta) meta.textContent = `Показано ${visible.length} из ${usersCache.length}`;
        if (!visible.length) {
            list.innerHTML = '<div class="user-empty">Ничего не найдено</div>';
            return;
        }
        list.innerHTML = visible.map(user => {
            const photoStyle = user.photoUrl ? `style="background-image:url('${esc(user.photoUrl).replace(/'/g, '%27')}')"` : '';
            const sub = [user.username ? `@${user.username}` : '', user.phone || '', user.id ? `ID ${user.id}` : ''].filter(Boolean).join(' · ');
            const orderCount = Number(user.totalOrders) || 0;
            return `
                <div class="user-row" data-user-id="${esc(user.id)}">
                    <div class="user-avatar" ${photoStyle}>${user.photoUrl ? '' : esc(initials(user))}</div>
                    <div>
                        <div class="user-name">${esc(displayName(user))}</div>
                        <div class="user-sub">${esc(sub)}</div>
                        <div class="user-sub">Последний визит: ${esc(formatDate(user.lastSeenAt || user.firstSeenAt))}</div>
                    </div>
                    <div class="user-right">
                        <div class="user-orders-count">${orderCount} ${orderCount === 1 ? 'заказ' : 'заказов'}</div>
                        <div class="user-spent">${Number(user.totalSpent) > 0 ? money(user.totalSpent) : (orderCount ? 'сумма по клику' : 'без покупок')}</div>
                        ${Number(user.waitingCount) > 0 ? `<div class="user-waiting">Ждёт: ${Number(user.waitingCount)} тов.</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        list.querySelectorAll('.user-row').forEach(row => row.addEventListener('click', () => openUser(row.dataset.userId)));
    }

    function closeDrawer() {
        document.getElementById('user-drawer-backdrop')?.remove();
        document.body.style.overflow = '';
    }

    async function openUser(id) {
        closeDrawer();
        const backdrop = document.createElement('div');
        backdrop.className = 'user-drawer-backdrop';
        backdrop.id = 'user-drawer-backdrop';
        backdrop.innerHTML = `
            <aside class="user-drawer" role="dialog" aria-modal="true">
                <div class="drawer-head"><div class="drawer-title">Пользователь</div><button class="drawer-close" aria-label="Закрыть">×</button></div>
                <div id="user-drawer-content"><div class="drawer-loading">Загружаем профиль и покупки…</div></div>
            </aside>
        `;
        document.body.appendChild(backdrop);
        document.body.style.overflow = 'hidden';
        backdrop.querySelector('.drawer-close').onclick = closeDrawer;
        backdrop.addEventListener('click', e => { if (e.target === backdrop) closeDrawer(); });

        try {
            const key = adminAccessKey();
            const response = await fetch(`/api/notify-log?key=${encodeURIComponent(key)}&view=user&userId=${encodeURIComponent(id)}`, { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Не удалось загрузить пользователя');
            renderUserDetail(data.profile || {}, data.orders || [], data.waitingItems || []);
        } catch (e) {
            const content = document.getElementById('user-drawer-content');
            if (content) content.innerHTML = `<div class="drawer-loading">${esc(e.message || 'Ошибка загрузки')}</div>`;
        }
    }

    function renderUserDetail(profile, orders, waitingItems = []) {
        const content = document.getElementById('user-drawer-content');
        if (!content) return;
        const photoStyle = profile.photoUrl ? `style="background-image:url('${esc(profile.photoUrl).replace(/'/g, '%27')}')"` : '';
        const totalSpent = orders.length ? orders.reduce((sum, order) => sum + (Number(order.sum) || 0), 0) : Number(profile.totalSpent) || 0;
        const waitingHtml = waitingItems.length ? waitingItems.map(item => `
            <div class="waiting-detail-item">${esc(item.productName || item.productId)}<small>Нажал «Уведомить»: ${esc(formatDate(item.at))}</small></div>
        `).join('') : '<div class="waiting-empty">Сейчас ничего не ожидает.</div>';
        const ordersHtml = orders.length ? orders.map((order, orderIndex) => {
            const positions = Array.isArray(order.positions) ? order.positions : [];
            const positionsHtml = positions.length ? positions.map(item => `
                <div class="purchase-item">
                    <span>${esc(item.name)} × ${Number(item.quantity) || 1}</span>
                    <span>${money((Number(item.price) || 0) * (Number(item.quantity) || 1))}</span>
                </div>
            `).join('') : '<div class="purchase-item"><span>Состав заказа недоступен</span></div>';
            return `
                <div class="purchase-order">
                    <div class="purchase-order-head" data-order-toggle="${orderIndex}">
                        <div><div class="purchase-order-name">Заказ №${esc(order.name || order.id)}</div><div class="purchase-order-date">${esc(formatDate(order.moment))}</div></div>
                        <div><div class="purchase-order-sum">${money(order.sum)}</div><div class="purchase-order-status">${esc(order.stateName || 'Оформлен')}</div></div>
                    </div>
                    <div class="purchase-items" id="purchase-items-${orderIndex}" style="${orderIndex === 0 ? '' : 'display:none;'}">${positionsHtml}</div>
                </div>
            `;
        }).join('') : '<div class="user-empty">Заказов пока нет</div>';

        content.innerHTML = `
            <div class="profile-card">
                <div class="profile-top">
                    <div class="user-avatar" ${photoStyle}>${profile.photoUrl ? '' : esc(initials(profile))}</div>
                    <div><div class="profile-name">${esc(displayName(profile))}</div><div class="profile-username">${profile.username ? '@' + esc(profile.username) : 'Telegram ID ' + esc(profile.id)}</div></div>
                </div>
                <div class="profile-grid">
                    <div class="profile-cell"><div class="profile-cell-label">Телефон</div><div class="profile-cell-value">${esc(profile.phone || '—')}</div></div>
                    <div class="profile-cell"><div class="profile-cell-label">Telegram ID</div><div class="profile-cell-value">${esc(profile.id || '—')}</div></div>
                    <div class="profile-cell"><div class="profile-cell-label">Первый визит</div><div class="profile-cell-value">${esc(formatDate(profile.firstSeenAt))}</div></div>
                    <div class="profile-cell"><div class="profile-cell-label">Последний визит</div><div class="profile-cell-value">${esc(formatDate(profile.lastSeenAt || profile.firstSeenAt))}</div></div>
                    <div class="profile-cell"><div class="profile-cell-label">Заказов</div><div class="profile-cell-value">${orders.length || Number(profile.totalOrders) || 0}</div></div>
                    <div class="profile-cell"><div class="profile-cell-label">Куплено на сумму</div><div class="profile-cell-value">${money(totalSpent)}</div></div>
                </div>
            </div>
            <div class="waiting-detail-card"><div class="waiting-detail-title">Ожидает поступления · ${waitingItems.length}</div>${waitingHtml}</div>
            <div class="orders-heading">История покупок</div>
            ${ordersHtml}
        `;
        content.querySelectorAll('[data-order-toggle]').forEach(head => head.addEventListener('click', () => {
            const body = document.getElementById(`purchase-items-${head.dataset.orderToggle}`);
            if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
        }));
    }

    ensureUi();

    // После успешного ввода ключа существующий код просто показывает content-screen.
    // Следим за этим без вмешательства в его авторизацию и подгружаем сводку.
    const contentScreen = document.getElementById('content-screen');
    if (contentScreen) {
        const observer = new MutationObserver(() => {
            if (contentScreen.style.display !== 'none' && adminAccessKey()) loadUsers(false);
        });
        observer.observe(contentScreen, { attributes: true, attributeFilter: ['style'] });
        if (contentScreen.style.display !== 'none' && adminAccessKey()) loadUsers(false);
    }
})();
