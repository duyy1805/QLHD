module.exports = {
    apps: [{
        name: "qlhd-api",
        script: "index.js",
        instances: 1,
        autorestart: true,
        watch: false,
        env: {
            NODE_ENV: "production"
        }
    }]
}
