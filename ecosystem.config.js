/*
 * @Author: huchen huchen@akool.com
 * @Date: 2026-04-06 17:59:25
 * @LastEditors: huchen huchen@akool.com
 * @LastEditTime: 2026-04-16 10:10:11
 * @FilePath: \akool-workspace\model-hub\ecosystem.config.js
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
module.exports = {
  apps: [
    {
      name: 'model-hub-api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        PROCESS_TYPE: 'api',
        PORT: 7000,
      },
    },
    {
      name: 'model-hub-worker',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        PROCESS_TYPE: 'worker',
        PORT: 7001,
      },
    },
    {
      name: 'model-hub-scheduler',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PROCESS_TYPE: 'scheduler',
        PORT: 7002,
      },
    },
    {
      name: 'model-hub-admin-server',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PROCESS_TYPE: 'admin-server',
        PORT: 7003,
      },
    },
  ],
};
