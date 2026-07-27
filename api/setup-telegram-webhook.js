// Разовая настройка: открой этот адрес в браузере ОДИН РАЗ, чтобы сообщить
// Telegram, куда слать апдейты бота (сообщения пользователей). После этого
// Telegram сам будет дёргать /api/telegram-webhook при каждом сообщении.
// Нужно, чтобы бот мог поймать сообщение от админа и запомнить его chat_id
// (см. api/telegram-webhook.js) — без этого шага уведомления о клиентах,
// нажавших "Уведомить", отправлять физически некуда.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req, res) {
    if (!TELEGRAM_BOT_TOKEN) {
        res.status(500).json({ success: false, error: 'Не задана переменная окружения TELEGRAM_BOT_TOKEN' });
        return;
    }
    try {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const webhookUrl = `${protocol}://${host}/api/telegram-webhook`;

        const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message'] })
        });
        const data = await response.json();

        res.status(response.ok ? 200 : 500).json({ success: !!data.ok, webhookUrl, telegram: data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
