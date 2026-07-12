export default async function handler(req, res) {
    const MY_SKLAD_TOKEN = "721093829e8e60da05c4c49e14151eaa92017ee9"; 

    try {
        // Запрос к API МоегоСклада с правильным заголовком Lognex-Web-Token
        const response = await fetch("https://api.moysklad.ru/api/remap/1.2/entity/product?limit=20", {
            method: "GET",
            headers: {
                "Lognex-Web-Token": MY_SKLAD_TOKEN,
                "Content-Type": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Ошибка Склада: ${response.status}`);
        }

        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}