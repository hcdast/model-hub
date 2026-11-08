const express = require('express');
const path = require('node:path');
const app = express();
const isAdmin = process.argv.includes('--admin');
const root = path.resolve(__dirname, isAdmin ? '../output/creation-dashboard-dist' : '../output/creation-portal-dist');
const server = app.listen(isAdmin ? 7334 : 7333, '127.0.0.1');
app.post('/__isolated_test_shutdown', (_request, response) => { response.end('closed'); server.close(); server.closeAllConnections(); });
app.use(express.static(root));
app.get('*', (_request, response) => response.sendFile(path.join(root, 'index.html')));
