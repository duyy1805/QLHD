module.exports = {
    apps: [{
        name: "api-z176",
        script: "index.js",
        instances: 1,
        autorestart: true,
        watch: false,
        env: {
            NODE_ENV: "production"
        }
    }]
}
