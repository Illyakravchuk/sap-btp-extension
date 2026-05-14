# SAP BTP Containerized Extension

Прототип контейнеризованого хмарного розширення для екосистеми **SAP Business Technology Platform (SAP BTP)**. 

Проєкт розроблено в межах магістерської дисертації на тему: *«Розробка та розгортання контейнеризованих розширень для SAP Business Technology Platform із використанням Docker і Cloud Foundry»* (Національний технічний університет України «Київський політехнічний інститут імені Ігоря Сікорського»).

## Технологічний стек
* **Backend:** Node.js, Express.js
* **Контейнеризація:** Docker
* **Хмарне середовище:** SAP BTP Cloud Foundry
* **Безпека (Zero Trust):** SAP Authorization and Trust Management (XSUAA), OAuth 2.0
* **База даних:** SAP BTP PostgreSQL (керований сервіс)

## Основний функціонал
1. Збір та моніторинг телеметрії хмарного контейнера (використання пам'яті, навантаження CPU).
2. Виконання обчислювальних бенчмарків (навантажувальне тестування).
3. Автоматичний запис результатів експериментів у реляційну базу даних із використанням динамічного парсингу конфігурацій через `@sap/xsenv`.
4. Блокування неавторизованого доступу до REST API за допомогою валідації JWT-токенів.

## Локальний запуск (через Docker)
```bash
# Збирання Docker-образу
docker build -t sap-btp-extension .

# Запуск контейнера локально
docker run -p 8080:8080 sap-btp-extension
```
## Розгортання в SAP BTP
Проєкт розгортається у середовищі Cloud Foundry за допомогою декларативного маніфесту з автоматичною прив'язкою сервісів (Service Binding):

```bash
cf push
```

## API Configuration

**Base API URL:** 
`https://sap-btp-node-extension.cfapps.us10-001.hana.ondemand.com`

**Приклад повного запиту (Endpoint):**
`{{Base_URL}}/api/system/metrics`