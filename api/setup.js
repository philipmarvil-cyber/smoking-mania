// Разовая настройка вебхуков — объединённый файл (раньше было два отдельных
// api/setup-order-webhook.js и api/setup-telegram-webhook.js, но план Vercel
// Hobby разрешает не больше 12 serverless-функций, а с учётом остальных
// эндпоинтов их стало больше — пришлось объединить, поведение не изменилось).
//
// Открой один раз (а также ещё раз после будущих обновлений):
//   /api/setup                — настроит и вебхук заказов МойСклад, и Telegram
//   /api/setup?type=order     — только вебхук заказов МойСклад
//   /api/setup?type=telegram  — только Telegram webhook
import { API, fetchJson } from './_catalog-lib.js';

const ORDER_ACTIONS = ['CREATE', 'UPDATE', 'DELETE'];
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function setupOrderWebhook(host, protocol) {
    const webhookUrl = `${protocol}://${host}/api/order-webhook`;
    const existing = await fetchJson(`${API}/entity/webhook?limit=100`);
    const existingRows = existing?.rows || [];

    const results = [];
    for (const action of ORDER_ACTIONS) {
        const already = existingRows.find(w =>
            w.url === webhookUrl && w.entityType === 'customerorder' && w.action === action
        );
        if (already) {
            // enabled:false означает, что МойСклад сам отключил доставку
            // (обычно после серии неудачных попыток) — подписка формально
            // существует, но реально ничего не присылает. Пробуем включить
            // обратно тем же запросом.
            if (already.enabled === false) {
                try {
                    await fetchJson(`${API}/entity/webhook/${already.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ enabled: true })
                    });
                    results.push({ action, alreadyExists: true, wasDisabled: true, reEnabled: true, id: already.id });
                } catch (e) {
                    results.push({ action, alreadyExists: true, wasDisabled: true, reEnabled: false, error: e.message, id: already.id });
                }
            } else {
                results.push({ action, alreadyExists: true, enabled: already.enabled, id: already.id });
            }
            continue;
        }
        const created = await fetchJson(`${API}/entity/webhook`, {
            method: 'POST',
            body: JSON.stringify({ url: webhookUrl, action, entityType: 'customerorder' })
        });
        results.push({ action, created: true, enabled: created.enabled, id: created.id });
    }

    return { webhookUrl, results };
}

async function setupTelegramWebhook(host, protocol) {
    if (!TELEGRAM_BOT_TOKEN) {
        return { error: 'Не задана переменная окружения TELEGRAM_BOT_TOKEN' };
    }
    const webhookUrl = `${protocol}://${host}/api/telegram-webhook`;
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] })
    });
    const data = await response.json();
    return { webhookUrl, ok: !!data.ok, telegram: data };
}

export default async function handler(req, res) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const type = req.query?.type;

    try {
        const out = { success: true };
        if (!type || type === 'order') {
            out.order = await setupOrderWebhook(host, protocol);
        }
        if (!type || type === 'telegram') {
            out.telegram = await setupTelegramWebhook(host, protocol);
        }
        res.status(200).json(out);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
