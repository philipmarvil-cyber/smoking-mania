// Детали одного заказа — состав (что заказали, в каком количестве и по
// какой цене), плюс статус/сумма/дата. Дёргается при тапе на заказ в
// "Мои заказы", где раньше можно было увидеть только номер и статус,
// но не сам список товаров.
import { API, fetchJson, colorToHex } from './_catalog-lib.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ success: false, error: 'Только POST' });
        return;
    }

    try {
        const { id } = req.body || {};
        if (!id) {
            res.status(400).json({ success: false, error: 'Не указан id заказа' });
            return;
        }

        const order = await fetchJson(`${API}/entity/customerorder/${id}?expand=state,positions.assortment`);

        const positions = (order.positions?.rows || []).map(p => ({
            name: p.assortment?.name || 'Товар',
            quantity: p.quantity || 1,
            price: (p.price || 0) / 100
        }));

        res.status(200).json({
            success: true,
            order: {
                id: order.id,
                name: order.name,
                stateName: order.state?.name || 'Оформлен',
                stateColor: colorToHex(order.state?.color),
                moment: (order.moment || '').replace(' ', 'T'),
                sum: (order.sum || 0) / 100,
                description: order.description || '',
                positions
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
}
