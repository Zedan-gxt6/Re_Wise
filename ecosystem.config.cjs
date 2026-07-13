module.exports = {
  apps: [
    {
      name: "rewise",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
