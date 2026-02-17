const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage
const fakeLinks = {}; // { linkId: { id, url, created, clicks: [] } }

// Generate a new fake link
app.post('/api/links', (req, res) => {
  const id = uuidv4().replace(/-/g, '').substring(0, 10);
  const baseUrl = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const fakeUrl = `${protocol}://${baseUrl}/track/${id}`;
  
  fakeLinks[id] = {
    id,
    url: fakeUrl,
    created: new Date().toISOString(),
    clicks: []
  };
  
  res.json({ success: true, link: fakeLinks[id] });
});

// Get all links
app.get('/api/links', (req, res) => {
  const links = Object.values(fakeLinks).sort(
    (a, b) => new Date(b.created) - new Date(a.created)
  );
  res.json(links);
});

// Get specific link with clicks
app.get('/api/links/:id', (req, res) => {
  const link = fakeLinks[req.params.id];
  if (!link) return res.status(404).json({ error: 'Not found' });
  res.json(link);
});

// Track click — this is the URL someone visits
app.get('/track/:id', (req, res) => {
  const link = fakeLinks[req.params.id];
  
  if (!link) {
    return res.status(404).send('Link not found');
  }

  // Gather visitor info
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket.remoteAddress ||
    'Unknown';

  const ua = req.headers['user-agent'] || 'Unknown';
  const referer = req.headers['referer'] || req.headers['referrer'] || 'Direct';
  const language = req.headers['accept-language']?.split(',')[0] || 'Unknown';

  // Parse User-Agent
  const browser = parseUA(ua);
  const os = parseOS(ua);
  const device = parseDevice(ua);

  const click = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ip,
    userAgent: ua,
    browser,
    os,
    device,
    referer,
    language,
    screenInfo: 'N/A (server-side)',
    timezone: req.headers['x-timezone'] || 'Unknown',
    country: req.headers['cf-ipcountry'] || 'Unknown',
  };

  link.clicks.push(click);

  // Serve a page that collects client-side info and sends it back
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redirecting...</title>
  <style>
    body { background: #000; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .loader { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 2px solid #333; border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { color: #666; font-size: 13px; }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Loading...</p>
  </div>
  <script>
    (async () => {
      const data = {
        clickId: "${click.id}",
        linkId: "${req.params.id}",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: window.screen.width + 'x' + window.screen.height,
        colorDepth: window.screen.colorDepth,
        pixelRatio: window.devicePixelRatio,
        platform: navigator.platform,
        languages: navigator.languages ? navigator.languages.join(', ') : navigator.language,
        cookiesEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack,
        touchPoints: navigator.maxTouchPoints,
        memory: navigator.deviceMemory || 'N/A',
        cores: navigator.hardwareConcurrency || 'N/A',
        connectionType: navigator.connection ? navigator.connection.effectiveType : 'N/A',
      };

      try {
        await fetch('/api/click-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } catch(e) {}

      // Just stay on this page for demo
      document.querySelector('p').textContent = '✓ Tracked! You can close this tab.';
      document.querySelector('.spinner').style.display = 'none';
    })();
  </script>
</body>
</html>`);
});

// Update click with client-side data
app.post('/api/click-update', (req, res) => {
  const { linkId, clickId, ...clientData } = req.body;
  const link = fakeLinks[linkId];
  if (!link) return res.json({ ok: false });
  
  const click = link.clicks.find(c => c.id === clickId);
  if (click) {
    click.timezone = clientData.timezone || click.timezone;
    click.screen = clientData.screen;
    click.colorDepth = clientData.colorDepth;
    click.pixelRatio = clientData.pixelRatio;
    click.platform = clientData.platform;
    click.languages = clientData.languages;
    click.cookiesEnabled = clientData.cookiesEnabled;
    click.doNotTrack = clientData.doNotTrack;
    click.touchPoints = clientData.touchPoints;
    click.memory = clientData.memory;
    click.cores = clientData.cores;
    click.connectionType = clientData.connectionType;
  }
  
  res.json({ ok: true });
});

// Helper: parse browser from UA
function parseUA(ua) {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/MSIE|Trident/.test(ua)) return 'Internet Explorer';
  return 'Unknown';
}

function parseOS(ua) {
  if (!ua) return 'Unknown';
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows NT 6/.test(ua)) return 'Windows Vista/7/8';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function parseDevice(ua) {
  if (!ua) return 'Unknown';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua) && /Mobile/.test(ua)) return 'Android Phone';
  if (/Android/.test(ua)) return 'Android Tablet';
  return 'Desktop';
}

app.listen(PORT, () => {
  console.log(`🚀 URL Tracker running on port ${PORT}`);
});
