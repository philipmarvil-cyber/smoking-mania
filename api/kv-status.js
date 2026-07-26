// Диагностика: открой этот URL в браузере (например
// https://ваш-домен.vercel.app/api/kv-status), чтобы проверить,
// действительно ли настроено и работает хранилище KV, а не только
// заданы переменные окружения.
import { isKvConfigured, kvGetJson, kvSetJson, kvGetCatalog, isTelegramConfigured } from './_catalog-lib.js';

export default async function handler(req, res) {
    const envConfigured = isKvConfigured();

    let readWriteWorks = false;
    let readWriteError = null;
    if (envConfigured) {
        try {
            const testKey = 'kv-status-check';
            const testValue = { ping: Date.now() };
            const wrote = await kvSetJson(testKey, testValue);
            const readBack = await kvGetJson(testKey);
            readWriteWorks = wrote && !!readBack && readBack.ping === testValue.ping;
        } catch (e) {
            readWriteError = e.message;
        }
    }

    let catalogInfo = null;
    try {
        const catalog = await kvGetCatalog();
        catalogInfo = catalog ? {
            products: Array.isArray(catalog.products) ? catalog.products.length : 0,
            syncedAt: catalog.syncedAt ? new Date(catalog.syncedAt).toISOString() : null
        } : null;
    } catch (e) {
        catalogInfo = { error: e.message };
    }

    let webhookInfo = null;
    try {
        const lastEvent = await kvGetJson('last-webhook-event');
        const lastRefresh = await kvGetJson('last-stock-refresh');
        webhookInfo = {
            lastWebhookEvent: lastEvent ? { ...lastEvent, at: new Date(lastEvent.at).toISOString() } : null,
            lastStockRefresh: lastRefresh ? { ...lastRefresh, at: new Date(lastRefresh.at).toISOString() } : null
        };
    } catch (e) {
        webhookInfo = { error: e.message };
    }

    res.status(200).json({
        envVarsPresent: envConfigured, // заданы ли KV_REST_API_URL/TOKEN (или UPSTASH_* аналоги) в Vercel
        readWriteWorks,               // реально ли получилось записать и прочитать тестовое значение
        readWriteError,
        cachedCatalog: catalogInfo,    // что сейчас лежит в кэше каталога, и когда он последний раз синхронизировался
        telegramBotTokenPresent: isTelegramConfigured(), // нужен для уведомлений о статусе заказа и о поступлении товара
        // lastWebhookEvent — дошло ли вообще от МойСклад последнее событие по заказу,
        // и что в нём было (тип/действие). lastStockRefresh — чем закончилась попытка
        // обновить остатки после этого события (result:false = сработал кулдаун 3 минуты
        // или отчёт не удалось получить; result:true = остатки обновлены).
        ...webhookInfo
    });
}
