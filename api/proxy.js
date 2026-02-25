export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Only allow Yahoo Finance URLs
  const allowed = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com', 'news.google.com'];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!allowed.some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(15000),
    });

    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', contentType);
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Proxy fetch failed', message: err.message });
  }
}
