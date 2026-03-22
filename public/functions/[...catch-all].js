// Catch-all route: intercepts root and index requests
// to inject auth-aware JavaScript into the static HTML.
export async function onRequestGet(context) {
  const cookieHeader = context.request.headers.get('Cookie');
  const match = cookieHeader?.split(';').find((c) => c.trim().startsWith('session_id='));
  const sessionId = match ? match.split('=')[1]?.trim() : null;

  // Fetch the static HTML from upstream (the Pages static assets)
  const staticUrl = new URL(context.request.url);
  // If it's the root, try to fetch index.html
  if (staticUrl.pathname === '/' || staticUrl.pathname === '/index.html') {
    staticUrl.pathname = '/index.html';
  }

  let html = '';
  try {
    const res = await fetch(staticUrl.toString(), {
      headers: { ...Object.fromEntries(context.request.headers) },
    });
    if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
      html = await res.text();
    }
  } catch {}

  if (!html) {
    // No static HTML found, serve a minimal auth-aware shell
    html = getDefaultHtml();
  }

  // Inject auth script before </body>
  const authScript = getAuthScript(sessionId);
  if (html.includes('</body>')) {
    html = html.replace('</body>', authScript + '</body>');
  } else {
    html += authScript;
  }

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function getAuthScript(sessionId) {
  return `<script>
(function() {
  var loginBtn = document.getElementById('login-btn');
  var logoutBtn = document.getElementById('logout-btn');
  var userInfo = document.getElementById('user-info');
  var authGate = document.getElementById('auth-gate');
  var uploadZone = document.getElementById('upload-zone');

  fetch('/auth/user', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.user) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) { logoutBtn.style.display = ''; logoutBtn.style.display = 'inline-block'; }
        if (userInfo) {
          userInfo.innerHTML = '<img src="' + (d.user.image || '') + '" style="width:32px;height:32px;border-radius:50%;vertical-align:middle;margin-right:8px"><span>' + (d.user.name || d.user.email) + '</span>';
          userInfo.style.display = '';
        }
        if (authGate) authGate.style.display = 'none';
        if (uploadZone) uploadZone.style.display = '';
      } else {
        if (loginBtn) loginBtn.style.display = '';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (userInfo) userInfo.style.display = 'none';
        if (authGate) authGate.style.display = '';
        if (uploadZone) uploadZone.style.display = 'none';
      }
    })
    .catch(function() {
      if (loginBtn) loginBtn.style.display = '';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (authGate) authGate.style.display = '';
      if (uploadZone) uploadZone.style.display = 'none';
    });
})();
</script>`;
}

function getDefaultHtml() {
  return `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="UTF-8"><title>BG Remover</title></head>
<body>
<header style="text-align:center;padding:40px;background:#fff;border-bottom:1px solid #e5e7eb">
  <h1>🪄 BG Remover</h1>
</header>
<main style="max-width:512px;margin:0 auto;padding:48px 24px">
  <div id="auth-gate" style="text-align:center;padding:48px 0">
    <div style="font-size:64px;margin-bottom:16px">🔐</div>
    <h2 style="font-size:24px;font-weight:700;margin-bottom:8px">需要登录</h2>
    <p style="color:#6b7280;margin-bottom:24px">登录后即可使用图片背景移除功能</p>
    <button id="login-btn" onclick="location.href='/auth/login'" style="padding:12px 32px;background:#4f46e5;color:#fff;border:none;border-radius:12px;font-weight:600;cursor:pointer">使用 Google 登录</button>
  </div>
</main>
</body></html>`;
}
