const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const WIKIJS_INTERNAL_URL = process.env.WIKIJS_INTERNAL_URL;

app.use('/', createProxyMiddleware({
  target: WIKIJS_INTERNAL_URL,
  changeOrigin: true,
}));

app.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}, forwarding to ${WIKIJS_INTERNAL_URL}`);
});
