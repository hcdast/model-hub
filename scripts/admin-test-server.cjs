const express = require('express');
const path = require('node:path');
const app = express(), root = path.resolve(__dirname, '../dashboard/dist');
const server = app.listen(7332, '127.0.0.1');
app.post('/__isolated_test_shutdown', (_request, response) => { response.end('closed'); server.close(); server.closeAllConnections(); });
app.use(express.static(root));
app.get('*', (_request, response) => response.sendFile(path.join(root, 'index.html')));
