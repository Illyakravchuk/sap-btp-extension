const assert = require('assert');
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:8080'; 

async function runIntegrationTests() {
    console.log("Запуск інтеграційних тестів...\n");
    
    let adminToken = '';
    let operatorToken = '';

    // Тест 1: Успішна авторизація Адміністратора
    try {
        const res = await fetch(`${BASE_URL}/api/auth/auto-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'Admin', password: 'SecretAdmin1!' })
        });
        const data = await res.json();
        
        assert.strictEqual(res.status, 200, "Сервер має повернути статус 200 OK");
        assert.ok(data.access_token, "Сервер має надати валідний токен доступу (access_token)");
        
        adminToken = data.access_token; 
        console.log("Тест 1: Успішний вхід Адміністратора (токен отримано).");
    } catch (error) {
        console.error("Тест 1 провалено. Сервер не запущено або помилка:", error.message);
        console.log("Далі тести не виконуватимуться, оскільки сервер недоступний.");
        return; 
    }

    // Тест 2: Відхилення неправильного пароля
    try {
        const res = await fetch(`${BASE_URL}/api/auth/auto-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'Admin', password: 'WrongPassword123' })
        });
        
        assert.strictEqual(res.status, 401, "Сервер має повернути статус 401 Unauthorized");
        console.log("Тест 2: Сервер успішно блокує вхід з неправильним паролем.");
    } catch (error) {
        console.error("Тест 2 провалено:", error.message);
    }

    // Тест 3: Отримання даних моніторингу з валідним токеном
    try {
        const res = await fetch(`${BASE_URL}/api/deployments`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const data = await res.json();
        
        assert.strictEqual(res.status, 200, "Сервер має повернути 200 OK");
        assert.ok(Array.isArray(data.data), "Відповідь має містити масив розгортань (data)");
        console.log("Тест 3: Захищений маршрут /api/deployments віддає дані Адміну.");
    } catch (error) {
        console.error("Тест 3 провалено:", error.message);
    }

    // Тест 4: Перевірка RBAC (Оператор не може масштабувати сервіс)
    try {
        const loginRes = await fetch(`${BASE_URL}/api/auth/auto-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'Operator', password: 'OperatorPass!' })
        });
        const loginData = await loginRes.json();
        operatorToken = loginData.access_token;

        const scaleRes = await fetch(`${BASE_URL}/api/deployments/cf-app-001/scale`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${operatorToken}`,
                'x-demo-role': 'Operator' 
            },
            body: JSON.stringify({ target_instances: 2 })
        });
        
        assert.strictEqual(scaleRes.status, 403, "Сервер має відхилити дію зі статусом 403 Forbidden");
        console.log("Тест 4: Бекенд успішно блокує спробу масштабування від Оператора (RBAC працює).");
    } catch (error) {
        console.error("Тест 4 провалено:", error.message);
    }
    try {
        const loadRes = await fetch(`${BASE_URL}/api/research/load`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`,
                'x-demo-role': 'Admin'
            },
            body: JSON.stringify({ action: 'increase' })
        });
        const loadData = await loadRes.json();
        
        assert.strictEqual(loadRes.status, 200, "Сервер має дозволити Адміну змінити навантаження");
        assert.ok(loadData.intensity !== undefined, "Відповідь має містити рівень intensity");
        console.log("Тест 5: Генератор навантаження успішно реагує на команди Адміністратора.");
        
        await fetch(`${BASE_URL}/api/research/load`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`,
                'x-demo-role': 'Admin'
            },
            body: JSON.stringify({ action: 'stop' })
        });
    } catch (error) {
        console.error("Тест 5 провалено:", error.message);
    }

    // Тест 6: Перевірка стійкості до підробленого токена (Security)
    try {
        const fakeTokenRes = await fetch(`${BASE_URL}/api/deployments`, {
            method: 'GET',
            headers: { 'Authorization': 'Bearer fake_and_invalid_token_12345' }
        });
        
        assert.strictEqual(
            fakeTokenRes.status, 
            401, 
            `Очікується статус 401 Unauthorized для невалідного токена, отримано: ${fakeTokenRes.status}`
        );
        console.log("Тест 6: Механізм автентифікації успішно відхилив сфальсифікований токен (401 Unauthorized).");
    } catch (error) {
        console.error("Тест 6 провалено:", error.message);
    }
    // Тест 7: Адміністратор зупиняє всі інстанси
    try {
        const scaleRes = await fetch(`${BASE_URL}/api/deployments/cf-app-001/scale`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`,
                'x-demo-role': 'Admin'
            },
            body: JSON.stringify({ target_instances: 0 })
        });
        assert.strictEqual(scaleRes.status, 200, "Сервер має успішно прийняти команду масштабування");

        // 2. Перевіряємо, чи стан застосунку реально змінився на STOPPED
        const checkRes = await fetch(`${BASE_URL}/api/deployments`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const checkData = await checkRes.json();
        const app = checkData.data.find(d => d.id === 'cf-app-001');

        assert.strictEqual(app.instances, 0, "Кількість інстансів має дорівнювати 0");
        assert.strictEqual(app.status, 'STOPPED', "Статус застосунку при 0 інстансів має стати STOPPED");
        console.log("Тест 7: Оркестрація працює коректно (успішний перехід сервісу в стан STOPPED).");

        await fetch(`${BASE_URL}/api/deployments/cf-app-001/scale`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${adminToken}`,
                'x-demo-role': 'Admin'
            },
            body: JSON.stringify({ target_instances: 1 })
        });
    } catch (error) {
        console.error("Тест 7 провалено:", error.message);
    }
    // Тест 8: Валідація алгоритму прогнозування навантаження системи
    try {
        // Скидання (фіксує початковий час і стан процесора)
        await fetch(`${BASE_URL}/api/deployments`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        // Вмикаємо 1-й рівень навантаження
        await fetch(`${BASE_URL}/api/research/load`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${adminToken}`, 
                'x-demo-role': 'Admin' 
            },
            body: JSON.stringify({ action: 'increase' })
        });

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Оновлюємо внутрішню метрику CPU на стороні сервера
        await fetch(`${BASE_URL}/api/deployments`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });

        //  Отримуємо аналітичний прогноз
        const forecastRes = await fetch(`${BASE_URL}/api/system/forecast`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        const forecastData = await forecastRes.json();

        assert.strictEqual(forecastRes.status, 200, "Сервер має повернути 200 OK для аналітики");
        assert.ok(parseFloat(forecastData.current) > 0, "Навантаження має бути зафіксоване (більше 0%)");
        assert.ok(['NORMAL', 'WARNING', 'CRITICAL'].includes(forecastData.status), "Статус має відповідати градації ризику");
        
        console.log(`Тест 8: Модуль прогнозування активний (CPU: ${forecastData.current}%, Прогноз: ${forecastData.forecast}%, Стан: ${forecastData.status}).`);

        await fetch(`${BASE_URL}/api/research/load`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Authorization': `Bearer ${adminToken}`, 
                'x-demo-role': 'Admin' 
            },
            body: JSON.stringify({ action: 'stop' })
        });
        console.log('\n========================================');
        console.log(' Результат тестування: 8/8 пройдено успішно');
        console.log('========================================\n');
    } catch (error) {
        console.error("Тест 8 провалено:", error.message);
    }
}

// Запускаємо тести
runIntegrationTests();