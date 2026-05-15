const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const WIKIJS_INTERNAL_URL = process.env.WIKIJS_INTERNAL_URL;

if (!WIKIJS_INTERNAL_URL) {
  console.error('FATAL: WIKIJS_INTERNAL_URL environment variable is required');
  process.exit(1);
}

app.use('/', createProxyMiddleware({
  target: WIKIJS_INTERNAL_URL,
  changeOrigin: true,
  ws: true,
  on: {
    error: (err, req, res) => {
      console.error(`Proxy error for ${req.method} ${req.url}:`, err.message);
      if (!res.headersSent) {
        res.status(502).send('Bad Gateway: unable to reach wiki service');
      }
    },
  },
}));

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}, forwarding to ${WIKIJS_INTERNAL_URL}`);
});
