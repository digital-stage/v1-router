module.exports = {
    apps: [{
        name: "router",
        script: "dist/index.js",

        // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env: {
            NODE_ENV: 'development'
        },
        env_production: {
            NODE_ENV: 'production'
        },
        env_frankfurt: {
            NODE_ENV: 'production'
        },
        env_amsterdam: {
            NODE_ENV: 'production'
        }
    }],

    deploy: {
        production: {
            user: 'node',
            host: 'ocean-node',
            ref: 'origin/master',
            repo: "git@github.com:digital-stage/router.git",
            path: '/node/router',
            env: {
                "NODE_ENV": "production",
                "PORT": "3000",
                "DOMAIN": "www.thepanicure.de",
                "DEBUG": "mediasoup",
                "SSL": true
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
                "PORT": "3000",
                "DOMAIN": "frankfurt.digital-stages.de",
                "DEBUG": "mediasoup"
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
                "DEBUG": "mediasoup"
            },
            'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env amsterdam'
        }
    }
};
