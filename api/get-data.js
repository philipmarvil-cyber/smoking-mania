export default async function handler(req, res) {
    // Разрешаем CORS-запросы
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const MY_SKLAD_TOKEN = "721093829e8e60da05c4c49e14151eaa92017ee9"; 

    try {
        const response = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/product?limit=20", {
            method: "GET",
            headers: {
                // Передаем токен через Authorization Bearer, как требует API МоегоСклада для Node.js
                "Authorization": `Bearer ${MY_SKLAD_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: `Склад ответил статусом ${response.status}` });
        }

        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
