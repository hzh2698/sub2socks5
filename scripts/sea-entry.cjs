process.env.SUB2SOCKS5_SEA_BOOTSTRAP = '1';

(async () => {
  const mod = await import('../src/server.js');
  await mod.startServer();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
