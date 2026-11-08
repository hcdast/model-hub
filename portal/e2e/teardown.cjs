module.exports = async () => {
  await Promise.all([7333, 7334].map(port => fetch(`http://127.0.0.1:${port}/__isolated_test_shutdown`, { method: 'POST' }).catch(() => {})));
};
