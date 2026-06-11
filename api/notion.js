const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN não configurado' });

  const notionPath = req.query.path;
  if (!notionPath) return res.status(400).json({ error: 'path obrigatório' });

  const body = ['POST', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : null;

  const options = {
    hostname: 'api.notion.com',
    path: `/v1/${notionPath}`,
    method: req.method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode).setHeader('Content-Type', 'application/json').end(data);
    });
  });

  proxyReq.on('error', e => res.status(500).json({ error: e.message }));
  if (body) proxyReq.write(body);
  proxyReq.end();
};
