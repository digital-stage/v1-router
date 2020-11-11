module.exports = {
    apps: [{
        name: "router",
        script: "dist/index.js",

        // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '3G',
    }],

    deploy: {
        production: {
            user: 'node',
            host: 'ocean-fra-node',
            ref: 'origin/master',
            repo: "https://github.com/digital-stage/router.git",
            path: '/node/router',
            env: {
                "NODE_ENV": "production",

                "DOMAIN": "fra.routers.digital-stage.org",
                "PORT": "3000",
                "PUBLIC_PORT": "443",
                "ROOT_PATH": "",
                "USE_IPV6": "true",

                "API_URL": "https://api.digital-stage.org",

                "AUTH_URL": "https://auth.digital-stage.org",
                "EMAIL": "test@digital-stage.org",
                "PASSWORD": "testtesttest",

                "ROUTER_DIST_URL": "wss://routers.digital-stage.org",
                "RTC_MIN_PORT": "40000",
                "RTC_MAX_PORT": "49999",
                "CONNECTIONS_PER_CPU": "5000",
            },
            'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production'
        },
        frankfurt: {
            user: 'tobias',
            host: 'router-fra',
            ref: 'origin/master',
            repo: "https://github.com/digital-stage/router.git",
            path: '/node/router',
            env: {
                "NODE_ENV": "production",
                "DOMAIN": "frankfurt.digital-stages.de",
                "PATH": "",
                "PORT": "3000",
                "RTC_MIN_PORT": "40000",
                "RTC_MAX_PORT": "49999",
                "DEBUG": "router*",
                "PUBLIC_PORT": "443"
            },
            'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env frankfurt'
        },
        amsterdam: {
            user: 'tobias',
            host: 'router-ams',
            ref: 'origin/master',
            repo: "https://github.com/digital-stage/router.git",
            path: '/node/router',
            env: {
                "NODE_ENV": "production",
                "PORT": "3000",
                "DOMAIN": "amsterdam.digital-stages.de",
                "PATH": "",
                "DEBUG": "router*",
                "PUBLIC_PORT": "443",
                "RTC_MIN_PORT": "40000",
                "RTC_MAX_PORT": "49999",
            },
            'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env amsterdam'
        }
    }
};
