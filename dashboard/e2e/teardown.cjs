module.exports = async () => { try { await fetch('http://127.0.0.1:7332/__isolated_test_shutdown', { method: 'POST' }); } catch {} };
