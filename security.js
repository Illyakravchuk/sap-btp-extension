const passport = require('passport');
const { XssecPassportStrategy, XsuaaService } = require('@sap/xssec'); 
const xsenv = require('@sap/xsenv'); 

let isAuthEnabled = false;

// Ініціалізує стратегію безпеки: шукає сервіс XSUAA, якщо немає, то вмикає локальний режим
const configureSecurity = (app) => {
    try {
        const services = xsenv.getServices({ uaa: { name: 'xsuaa-auth' } });
        
        const xsuaaService = new XsuaaService(services.uaa);
        passport.use('JWT', new XssecPassportStrategy(xsuaaService));
        
        app.use(passport.initialize());
        isAuthEnabled = true;
        console.log("XSUAA Security: Enabled (SAP Cloud Mode)");
    } catch (err) {
        console.log("XSUAA Security: Вмикається локальний режим для локального сервера.");
    }
};

// Middleware автентифікації: валідація реального JWT (SAP) або перевірка mock-токена
const requireAuth = (req, res, next) => {
    // 1. Хмарний режим перевірка JWT
    if (isAuthEnabled) {
        return passport.authenticate('JWT', { session: false })(req, res, next);
    }
    
    // 2. Локальний режим 
    const authHeader = req.headers['authorization'];
    if (!authHeader || authHeader !== 'Bearer local-server-mock-token') {
        return res.status(401).json({ error: "Unauthorized: Недійсний або відсутній токен (Локальний режим)" });
    }
    
    return next(); 
};

// Middleware для рольової моделі (RBAC)
const requireRole = (role) => (req, res, next) => {
    if (!isAuthEnabled) return next(); 
    
    const demoRole = req.headers['x-demo-role'];
    if (demoRole) {
        if (demoRole === 'Admin' || demoRole === role) return next();
        return res.status(403).json({ error: `Помилка доступу: Вимагається роль ${role}. Ваша поточна роль: ${demoRole}` });
    }
    
    if (req.authInfo && req.authInfo.checkLocalScope(role)) return next();
    
    return res.status(403).json({ error: `Forbidden: Requires ${role} privilege` });
};

const getAuthStatus = () => isAuthEnabled;

module.exports = { configureSecurity, requireAuth, requireRole, getAuthStatus };