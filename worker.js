const SESSION_COOKIE_NAME = "session_id";

// 讀 Cookie
function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((v) => v.trim());
  for (const part of parts) {
    if (part.startsWith(name + "=")) {
      return decodeURIComponent(part.substring(name.length + 1));
    }
  }
  return null;
}

// 產生 session id
function randomId(len = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  const array = new Uint8Array(len);
  crypto.getRandomValues(array);
  for (const b of array) s += chars[b % chars.length];
  return s;
}

// SHA-256
async function sha256(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 驗證登入
async function requireUser(request, env) {
  const sid = getCookie(request, SESSION_COOKIE_NAME);
  if (!sid) return null;

  const now = new Date().toISOString();
  return await env.DB.prepare(
    `SELECT u.id, u.username
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(sid, now)
    .first();
}

// -------------- HTML UI -----------------
function htmlPage(loggedIn, username) {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>賴媒體 社群發布工具</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>
<link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet"/>
</head>

<body class="bg-light">

<nav class="navbar navbar-dark bg-dark px-3">
  <span class="navbar-brand">賴媒體 社群發布工具</span>
  ${
    loggedIn
      ? `<div class="text-white">Hi, ${username} <button id="logoutBtn" class="btn btn-outline-light btn-sm ms-3">登出</button></div>`
      : ""
  }
</nav>

<div class="container py-4">

${
  loggedIn
    ? `
  <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
    <div>
      <h5 class="mb-0">最新新聞</h5>
      <div id="lastRefresh" class="small text-muted"></div>
    </div>
    <button id="refreshBtn" class="btn btn-secondary btn-sm">🔄 手動重整</button>
  </div>
  <div id="rssList" class="row gy-3"></div>
  `
    : `
  <div class="row justify-content-center mt-5">
    <div class="col-md-4">
      <div class="card shadow-sm">
        <div class="card-body">
          <h5 class="card-title">登入</h5>
          <input id="username" class="form-control mb-2" placeholder="帳號">
          <input id="password" type="password" class="form-control mb-3" placeholder="密碼">
          <button id="loginBtn" class="btn btn-primary w-100">登入</button>
          <div id="loginError" class="text-danger mt-2 small"></div>
        </div>
      </div>
    </div>
  </div>`
}
</div>


<!-- Telegram Modal -->
<div class="modal fade" id="tgModal">
  <div class="modal-dialog modal-lg modal-dialog-centered">
  <div class="modal-content">

    <div class="modal-header">
      <h5 class="modal-title">發送到 Telegram</h5>
      <button class="btn-close" data-bs-dismiss="modal"></button>
    </div>

    <div class="modal-body">
      <div class="row">

        <div class="col-4">
          <img id="tgImage" class="img-fluid border rounded w-100 mb-2">
          <label class="form-label small">圖片 URL (可更改)</label>
          <input id="tgImageUrl" class="form-control form-control-sm">
        </div>

        <div class="col-8">
          <label class="form-label">標題</label>
          <input id="tgTitle" class="form-control mb-2" readonly>

          <label class="form-label">連結</label>
          <input id="tgLink" class="form-control mb-2" readonly>

          <div class="d-flex justify-content-between mb-1">
            <label class="form-label mb-0">要送出的文字 (Markdown)</label>
            <button id="tgIntroBtn" class="btn btn-outline-secondary btn-sm">＋ 新增導言</button>
          </div>

          <textarea id="tgText" rows="5" class="form-control"></textarea>
        </div>

      </div>
    </div>

    <div class="modal-footer">
      <span id="tgStatus" class="text-secondary small me-auto"></span>
      <button class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
      <button id="tgSendBtn" class="btn btn-primary">🚀 發送</button>
    </div>

  </div>
  </div>
</div>


<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script>
const loggedIn = ${loggedIn ? "true" : "false"};

if (!loggedIn) {
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");
  const loginError = document.getElementById("loginError");

  loginBtn.onclick = async () => {
    const username = usernameInput.value;
    const password = passwordInput.value;
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      location.reload();
    } else {
      loginError.textContent = "登入失敗，請確認帳密";
    }
  };
} else {
  const logoutBtn = document.getElementById("logoutBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const rssList = document.getElementById("rssList");
  const lastRefreshEl = document.getElementById("lastRefresh");

  logoutBtn.onclick = async () => {
    await fetch("/api/logout", { method: "POST" });
    location.reload();
  };

  function updateLastRefresh() {
    if (!lastRefreshEl) return;
    const now = new Date();
    const str = now.toLocaleString("zh-TW", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    lastRefreshEl.textContent = "最後更新：" + str;
  }

  async function loadRss() {
    const res = await fetch("/api/rss-proxy");
    if (!res.ok) {
      rssList.innerHTML = "<div class='text-danger'>RSS 載入失敗</div>";
      return;
    }
    const xmlText = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "text/xml");
    const items = Array.from(xml.getElementsByTagName("item"));
    rssList.innerHTML = "";
    for (const item of items) {
      const titleEl = item.getElementsByTagName("title")[0];
      const linkEl = item.getElementsByTagName("link")[0];
      const descEl = item.getElementsByTagName("description")[0];

      const title = (titleEl?.textContent || "").trim();
      const linkRaw = (linkEl?.textContent || "").trim();
      const description = (descEl?.textContent || "").trim();

      // 長網址轉短網址
      let shortLink = linkRaw;
      try {
        const u = new URL(linkRaw);
        const sn = u.searchParams.get("new_sn");
        if (sn && u.hostname === "lai-media.net") {
          shortLink = u.origin + "/" + sn;
        }
      } catch (e) {
        // 非合法網址就用原本
      }

      let img = "";
      const mediaContent =
        item.getElementsByTagName("media:content")[0] ||
        item.getElementsByTagName("media")[0];
      if (mediaContent && mediaContent.getAttribute) {
        const u = mediaContent.getAttribute("url");
        if (u) img = u;
      }
      if (!img) {
        const contentEncoded =
          item.getElementsByTagName("content:encoded")[0];
        if (contentEncoded && contentEncoded.textContent) {
          const tmp = document.createElement("div");
          tmp.innerHTML = contentEncoded.textContent;
          const imgEl = tmp.querySelector("img");
          if (imgEl && imgEl.src) img = imgEl.src;
        }
      }

      const col = document.createElement("div");
      col.className = "col-12 col-md-6 col-lg-4";

      const thumbHtml = img
        ? '<img src="' + img + '" class="card-img-top" style="height:170px;object-fit:cover;" />'
        : "";

      const safeTitle = title.replace(/"/g, "&quot;");
      const safeLinkTitle = shortLink.replace(/"/g, "&quot;");

      const cardHtml =
        '<div class="card shadow-sm h-100">' +
          thumbHtml +
          '<div class="card-body d-flex flex-column">' +
            '<h6 class="card-title text-truncate" title="' + safeTitle + '">' + title + '</h6>' +
            '<p class="card-text small text-muted text-truncate" title="' + safeLinkTitle + '">' + shortLink + '</p>' +
            '<div class="mt-auto d-flex justify-content-between align-items-center">' +
              '<div class="btn-group" role="group">' +
                // ✅ Facebook 開啟（可點）
                '<button class="btn btn-sm btn-outline-primary btn-fb" title="發送到 Facebook">' +
                  '<i class="bi bi-facebook"></i>' +
                '</button>' +
                // 其他社群先佔位（停用灰色）
                '<button class="btn btn-sm btn-outline-secondary" disabled title="X / Twitter 待開發">' +
                  '<i class="bi bi-twitter-x"></i>' +
                '</button>' +
                '<button class="btn btn-sm btn-outline-secondary" disabled title="Instagram 待開發">' +
                  '<i class="bi bi-instagram"></i>' +
                '</button>' +
              '</div>' +
              '<button class="btn btn-sm btn-outline-primary btn-tg">' +
                '<i class="bi bi-telegram"></i> Telegram' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

      col.innerHTML = cardHtml;

      const btnTg = col.querySelector(".btn-tg");
      btnTg.addEventListener("click", function () {
        openTgModal({ title, link: shortLink, img, description });
      });

      const btnFb = col.querySelector(".btn-fb");
      btnFb.addEventListener("click", function () {
        // 組 FB 貼文＆留言內容給你確認
        const postText =
          "【" + title + "】\\n\\n" +
          "#新聞連結在留言處\\n" +
          "#LINE社群招生中歡迎加入";

        const commentText = title + "\\n" + shortLink;

        const preview =
          "即將發送到 Facebook：\\n\\n" +
          "貼文內容：\\n" + postText + "\\n\\n" +
          "留言內容：\\n" + commentText + "\\n\\n" +
          "確定要發送嗎？";

        const ok = window.confirm(preview);
        if (!ok) return;

        sendToFacebook({
          title: title,
          link: shortLink,
          img: img
        });
      });

      rssList.appendChild(col);
    }

    // 更新「最後更新時間」（台灣時間＝瀏覽器時間）
    updateLastRefresh();
  }

  refreshBtn.onclick = loadRss;
  loadRss();                         // 初次載入
  setInterval(loadRss, 60 * 1000);   // 每分鐘抓一次 RSS

  // 每 5 分鐘整頁重整一次
  setInterval(function () {
    location.reload();
  }, 5 * 60 * 1000);

  // ===== Telegram Modal 控制 =====
  const tgModalEl = document.getElementById("tgModal");
  const tgModal = new bootstrap.Modal(tgModalEl);
  const tgImage = document.getElementById("tgImage");
  const tgImageUrl = document.getElementById("tgImageUrl");
  const tgTitle = document.getElementById("tgTitle");
  const tgLink = document.getElementById("tgLink");
  const tgText = document.getElementById("tgText");
  const tgIntroBtn = document.getElementById("tgIntroBtn");
  const tgSendBtn = document.getElementById("tgSendBtn");
  const tgStatus = document.getElementById("tgStatus");

  let currentPayload = null;

  function openTgModal({ title, link, img, description }) {
    currentPayload = { title, link, img, description };

    tgTitle.value = title;
    tgLink.value = link;

    if (img) {
      tgImage.src = img;
      tgImage.style.display = "block";
      tgImageUrl.value = img;
    } else {
      tgImage.src = "";
      tgImage.style.display = "none";
      tgImageUrl.value = "";
    }

    // 預設：標題 + 短網址（沒有導言）
    tgText.value = title + "\\n" + link;
    tgStatus.textContent = "";
    tgModal.show();
  }

  // 改圖片 URL 預覽
  tgImageUrl.addEventListener("input", () => {
    const url = tgImageUrl.value.trim();
    if (url) {
      tgImage.src = url;
      tgImage.style.display = "block";
    } else {
      tgImage.src = "";
      tgImage.style.display = "none";
    }
  });

  // 新增導言：使用 description，純文字
  tgIntroBtn.addEventListener("click", () => {
    if (!currentPayload) return;
    let intro = (currentPayload.description || "").trim();
    if (!intro) {
      tgStatus.textContent = "這則 RSS 沒有 description 可以當導言";
      return;
    }

    const title = currentPayload.title || "";
    const link = currentPayload.link || "";

    // 有按新增導言：
    // 標題
    //
    // 導言（原文多行）
    //
    // 短網址
    tgText.value = title + "\\n\\n" + intro + "\\n\\n" + link;
    tgStatus.textContent = "";
  });

  tgSendBtn.addEventListener("click", async () => {
    if (!currentPayload) return;

    // 二次確認，避免誤發
    const ok = window.confirm("確定要發送到 Telegram？");
    if (!ok) {
      return;
    }

    tgSendBtn.disabled = true;
    tgStatus.textContent = "發送中...";

    const body = {
      text: tgText.value,
      imageUrl: tgImageUrl.value || currentPayload.img || "",
    };

    const res = await fetch("/api/publish/telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      tgStatus.textContent = "已送出 ✅";
      setTimeout(() => tgModal.hide(), 700);
    } else {
      tgStatus.textContent = "發送失敗";
    }

    tgSendBtn.disabled = false;
  });

  // ===== Facebook 發送（呼叫後端 API） =====
  async function sendToFacebook(payload) {
    const res = await fetch("/api/publish/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        link: payload.link,
        imageUrl: payload.img || ""
      }),
    });

    if (res.ok) {
      alert("已送出到 Facebook");
    } else {
      const data = await res.json().catch(() => ({}));
      alert("Facebook 發送失敗\\n" + (data.error || ""));
    }
  }
}
</script>

</body>
</html>`;
}

// ================== API ==================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Login
    if (url.pathname === "/api/login" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const username = body.username || "";
      const password = body.password || "";
      const hash = await sha256(password);

      const user = await env.DB.prepare(
        "SELECT id, username FROM users WHERE username = ? AND password_hash = ?"
      )
        .bind(username, hash)
        .first();

      if (!user) {
        return new Response(JSON.stringify({ error: "帳號或密碼錯誤" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const sid = randomId(40);
      const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

      await env.DB.prepare(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
      )
        .bind(sid, user.id, expires)
        .run();

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            `${SESSION_COOKIE_NAME}=` +
            encodeURIComponent(sid) +
            "; Path=/; HttpOnly; SameSite=Lax",
        },
      });
    }

    // Logout
    if (url.pathname === "/api/logout" && request.method === "POST") {
      const sid = getCookie(request, SESSION_COOKIE_NAME);
      if (sid) {
        await env.DB.prepare("DELETE FROM sessions WHERE id = ?")
          .bind(sid)
          .run();
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    // RSS Proxy
    if (url.pathname === "/api/rss-proxy") {
      const user = await requireUser(request, env);
      if (!user) return new Response("Unauthorized", { status: 401 });

      const rssRes = await fetch(env.RSS_URL);
      const text = await rssRes.text();
      return new Response(text, {
        status: 200,
        headers: {
          "Content-Type":
            rssRes.headers.get("Content-Type") || "application/rss+xml",
        },
      });
    }

    // Telegram 發送
    if (url.pathname === "/api/publish/telegram" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ error: "未登入" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await request.json().catch(() => ({}));
      const text = body.text || "";
      const imageUrl = body.imageUrl || "";
      const chatId = env.TELEGRAM_CHAT_ID;

      let method = "sendMessage";
      let payload = {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      };

      if (imageUrl) {
        method = "sendPhoto";
        payload = {
          chat_id: chatId,
          photo: imageUrl,
          caption: text,
          parse_mode: "Markdown",
        };
      }

      const tgRes = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!tgRes.ok) {
        const errText = await tgRes.text();
        return new Response(
          JSON.stringify({ error: "Telegram API 錯誤", detail: errText }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 📌 Facebook 發送
    if (url.pathname === "/api/publish/facebook" && request.method === "POST") {
      const user = await requireUser(request, env);
      if (!user) {
        return new Response(JSON.stringify({ error: "未登入" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = await request.json().catch(() => ({}));
      const title = body.title || "";
      const link = body.link || "";
      const imageUrl = body.imageUrl || "";

      const pageId = env.FB_PAGE_ID;
      const accessToken = env.FB_PAGE_ACCESS_TOKEN;

      if (!pageId || !accessToken) {
        return new Response(
          JSON.stringify({ error: "尚未設定 FB_PAGE_ID / FB_PAGE_ACCESS_TOKEN" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const postText =
        "【" + title + "】\n\n" +
        "#新聞連結在留言處\n" +
        "#LINE社群招生中歡迎加入";

      const commentText = title + "\n" + link;

      let postId = null;

      try {
        if (imageUrl) {
          // 有圖片：先發 photo 貼文
          const params = new URLSearchParams();
          params.set("url", imageUrl);
          params.set("caption", postText);
          params.set("access_token", accessToken);

          const fbRes = await fetch(
            "https://graph.facebook.com/v18.0/" + pageId + "/photos",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params.toString(),
            }
          );

          const data = await fbRes.json().catch(() => ({}));
          if (!fbRes.ok) {
            return new Response(
              JSON.stringify({
                error: "Facebook 貼文失敗",
                detail: data.error || data,
              }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }

          postId = data.post_id || data.id || null;
        } else {
          // 沒有圖片：用文字貼文
          const params = new URLSearchParams();
          params.set("message", postText);
          params.set("access_token", accessToken);

          const fbRes = await fetch(
            "https://graph.facebook.com/v18.0/" + pageId + "/feed",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: params.toString(),
            }
          );

          const data = await fbRes.json().catch(() => ({}));
          if (!fbRes.ok) {
            return new Response(
              JSON.stringify({
                error: "Facebook 貼文失敗",
                detail: data.error || data,
              }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }

          postId = data.id || null;
        }

        // 在剛剛那則貼文底下留言「標題 + 短網址」
        if (postId && commentText) {
          const cParams = new URLSearchParams();
          cParams.set("message", commentText);
          cParams.set("access_token", accessToken);

          const cRes = await fetch(
            "https://graph.facebook.com/v18.0/" + postId + "/comments",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: cParams.toString(),
            }
          );

          const cData = await cRes.json().catch(() => ({}));
          if (!cRes.ok) {
            return new Response(
              JSON.stringify({
                error: "Facebook 留言失敗",
                detail: cData.error || cData,
              }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            );
          }
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(
          JSON.stringify({ error: "Facebook 發送例外錯誤", detail: String(e) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // 其他：回主畫面
    const user = await requireUser(request, env);
    const html = htmlPage(!!user, user?.username || "");
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};

// const SESSION_COOKIE_NAME = "session_id";

// // 讀 Cookie
// function getCookie(request, name) {
//   const cookie = request.headers.get("Cookie") || "";
//   const parts = cookie.split(";").map((v) => v.trim());
//   for (const part of parts) {
//     if (part.startsWith(name + "=")) {
//       return decodeURIComponent(part.substring(name.length + 1));
//     }
//   }
//   return null;
// }

// // 產生 session id
// function randomId(len = 32) {
//   const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
//   let s = "";
//   const array = new Uint8Array(len);
//   crypto.getRandomValues(array);
//   for (const b of array) s += chars[b % chars.length];
//   return s;
// }

// // SHA-256
// async function sha256(text) {
//   const enc = new TextEncoder();
//   const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
//   return Array.from(new Uint8Array(buf))
//     .map((b) => b.toString(16).padStart(2, "0"))
//     .join("");
// }

// // 驗證登入
// async function requireUser(request, env) {
//   const sid = getCookie(request, SESSION_COOKIE_NAME);
//   if (!sid) return null;

//   const now = new Date().toISOString();
//   return await env.DB.prepare(
//     `SELECT u.id, u.username
//      FROM sessions s
//      JOIN users u ON u.id = s.user_id
//      WHERE s.id = ? AND s.expires_at > ?`
//   )
//     .bind(sid, now)
//     .first();
// }

// // -------------- HTML UI -----------------
// function htmlPage(loggedIn, username) {
//   return `<!DOCTYPE html>
// <html lang="zh-Hant">
// <head>
// <meta charset="utf-8" />
// <title>賴媒體 社群發布工具</title>
// <meta name="viewport" content="width=device-width,initial-scale=1" />
// <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet"/>
// <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css" rel="stylesheet"/>
// </head>

// <body class="bg-light">

// <nav class="navbar navbar-dark bg-dark px-3">
//   <span class="navbar-brand">賴媒體 社群發布工具</span>
//   ${
//     loggedIn
//       ? `<div class="text-white">Hi, ${username} <button id="logoutBtn" class="btn btn-outline-light btn-sm ms-3">登出</button></div>`
//       : ""
//   }
// </nav>

// <div class="container py-4">

// ${
//   loggedIn
//     ? `
//   <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
//     <div>
//       <h5 class="mb-0">最新新聞</h5>
//       <div id="lastRefresh" class="small text-muted"></div>
//     </div>
//     <button id="refreshBtn" class="btn btn-secondary btn-sm">🔄 手動重整</button>
//   </div>
//   <div id="rssList" class="row gy-3"></div>
//   `
//     : `
//   <div class="row justify-content-center mt-5">
//     <div class="col-md-4">
//       <div class="card shadow-sm">
//         <div class="card-body">
//           <h5 class="card-title">登入</h5>
//           <input id="username" class="form-control mb-2" placeholder="帳號">
//           <input id="password" type="password" class="form-control mb-3" placeholder="密碼">
//           <button id="loginBtn" class="btn btn-primary w-100">登入</button>
//           <div id="loginError" class="text-danger mt-2 small"></div>
//         </div>
//       </div>
//     </div>
//   </div>`
// }
// </div>


// <!-- Telegram Modal -->
// <div class="modal fade" id="tgModal">
//   <div class="modal-dialog modal-lg modal-dialog-centered">
//   <div class="modal-content">

//     <div class="modal-header">
//       <h5 class="modal-title">發送到 Telegram</h5>
//       <button class="btn-close" data-bs-dismiss="modal"></button>
//     </div>

//     <div class="modal-body">
//       <div class="row">

//         <div class="col-4">
//           <img id="tgImage" class="img-fluid border rounded w-100 mb-2">
//           <label class="form-label small">圖片 URL (可更改)</label>
//           <input id="tgImageUrl" class="form-control form-control-sm">
//         </div>

//         <div class="col-8">
//           <label class="form-label">標題</label>
//           <input id="tgTitle" class="form-control mb-2" readonly>

//           <label class="form-label">連結</label>
//           <input id="tgLink" class="form-control mb-2" readonly>

//           <div class="d-flex justify-content-between mb-1">
//             <label class="form-label mb-0">要送出的文字 (Markdown)</label>
//             <button id="tgIntroBtn" class="btn btn-outline-secondary btn-sm">＋ 新增導言</button>
//           </div>

//           <textarea id="tgText" rows="5" class="form-control"></textarea>
//         </div>

//       </div>
//     </div>

//     <div class="modal-footer">
//       <span id="tgStatus" class="text-secondary small me-auto"></span>
//       <button class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
//       <button id="tgSendBtn" class="btn btn-primary">🚀 發送</button>
//     </div>

//   </div>
//   </div>
// </div>


// <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
// <script>
// const loggedIn = ${loggedIn ? "true" : "false"};

// if (!loggedIn) {
//   const usernameInput = document.getElementById("username");
//   const passwordInput = document.getElementById("password");
//   const loginBtn = document.getElementById("loginBtn");
//   const loginError = document.getElementById("loginError");

//   loginBtn.onclick = async () => {
//     const username = usernameInput.value;
//     const password = passwordInput.value;
//     const res = await fetch("/api/login", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ username, password }),
//     });
//     if (res.ok) {
//       location.reload();
//     } else {
//       loginError.textContent = "登入失敗，請確認帳密";
//     }
//   };
// } else {
//   const logoutBtn = document.getElementById("logoutBtn");
//   const refreshBtn = document.getElementById("refreshBtn");
//   const rssList = document.getElementById("rssList");
//   const lastRefreshEl = document.getElementById("lastRefresh");

//   logoutBtn.onclick = async () => {
//     await fetch("/api/logout", { method: "POST" });
//     location.reload();
//   };

//   function updateLastRefresh() {
//     if (!lastRefreshEl) return;
//     const now = new Date();
//     const str = now.toLocaleString("zh-TW", {
//       hour12: false,
//       hour: "2-digit",
//       minute: "2-digit",
//       second: "2-digit",
//     });
//     lastRefreshEl.textContent = "最後更新：" + str;
//   }

//   async function loadRss() {
//     const res = await fetch("/api/rss-proxy");
//     if (!res.ok) {
//       rssList.innerHTML = "<div class='text-danger'>RSS 載入失敗</div>";
//       return;
//     }
//     const xmlText = await res.text();
//     const parser = new DOMParser();
//     const xml = parser.parseFromString(xmlText, "text/xml");
//     const items = Array.from(xml.getElementsByTagName("item"));
//     rssList.innerHTML = "";
//     for (const item of items) {
//       const titleEl = item.getElementsByTagName("title")[0];
//       const linkEl = item.getElementsByTagName("link")[0];
//       const descEl = item.getElementsByTagName("description")[0];

//       const title = (titleEl?.textContent || "").trim();
//       const linkRaw = (linkEl?.textContent || "").trim();
//       const description = (descEl?.textContent || "").trim();

//       // 長網址轉短網址
//       let shortLink = linkRaw;
//       try {
//         const u = new URL(linkRaw);
//         const sn = u.searchParams.get("new_sn");
//         if (sn && u.hostname === "lai-media.net") {
//           shortLink = u.origin + "/" + sn;
//         }
//       } catch (e) {
//         // 非合法網址就用原本
//       }

//       let img = "";
//       const mediaContent =
//         item.getElementsByTagName("media:content")[0] ||
//         item.getElementsByTagName("media")[0];
//       if (mediaContent && mediaContent.getAttribute) {
//         const u = mediaContent.getAttribute("url");
//         if (u) img = u;
//       }
//       if (!img) {
//         const contentEncoded =
//           item.getElementsByTagName("content:encoded")[0];
//         if (contentEncoded && contentEncoded.textContent) {
//           const tmp = document.createElement("div");
//           tmp.innerHTML = contentEncoded.textContent;
//           const imgEl = tmp.querySelector("img");
//           if (imgEl && imgEl.src) img = imgEl.src;
//         }
//       }

//       const col = document.createElement("div");
//       col.className = "col-12 col-md-6 col-lg-4";

//       const thumbHtml = img
//         ? '<img src="' + img + '" class="card-img-top" style="height:170px;object-fit:cover;" />'
//         : "";

//       const safeTitle = title.replace(/"/g, "&quot;");
//       const safeLinkTitle = shortLink.replace(/"/g, "&quot;");

//       const cardHtml =
//         '<div class="card shadow-sm h-100">' +
//           thumbHtml +
//           '<div class="card-body d-flex flex-column">' +
//             '<h6 class="card-title text-truncate" title="' + safeTitle + '">' + title + '</h6>' +
//             '<p class="card-text small text-muted text-truncate" title="' + safeLinkTitle + '">' + shortLink + '</p>' +
//             '<div class="mt-auto d-flex justify-content-between align-items-center">' +
//               '<div class="btn-group" role="group">' +
//                 '<button class="btn btn-sm btn-outline-secondary" disabled title="Facebook 待開發">' +
//                   '<i class="bi bi-facebook"></i>' +
//                 '</button>' +
//                 '<button class="btn btn-sm btn-outline-secondary" disabled title="X / Twitter 待開發">' +
//                   '<i class="bi bi-twitter-x"></i>' +
//                 '</button>' +
//                 '<button class="btn btn-sm btn-outline-secondary" disabled title="Instagram 待開發">' +
//                   '<i class="bi bi-instagram"></i>' +
//                 '</button>' +
//               '</div>' +
//               '<button class="btn btn-sm btn-outline-primary btn-tg">' +
//                 '<i class="bi bi-telegram"></i> Telegram' +
//               '</button>' +
//             '</div>' +
//           '</div>' +
//         '</div>';

//       col.innerHTML = cardHtml;

//       const btnTg = col.querySelector(".btn-tg");
//       btnTg.addEventListener("click", function () {
//         openTgModal({ title, link: shortLink, img, description });
//       });

//       rssList.appendChild(col);
//     }

//     // 更新「最後更新時間」（台灣時間＝瀏覽器時間）
//     updateLastRefresh();
//   }

//   refreshBtn.onclick = loadRss;
//   loadRss();                         // 初次載入
//   setInterval(loadRss, 60 * 1000);   // 每分鐘抓一次 RSS

//   // 每 5 分鐘整頁重整一次
//   setInterval(function () {
//     location.reload();
//   }, 5 * 60 * 1000);

//   // ===== Telegram Modal 控制 =====
//   const tgModalEl = document.getElementById("tgModal");
//   const tgModal = new bootstrap.Modal(tgModalEl);
//   const tgImage = document.getElementById("tgImage");
//   const tgImageUrl = document.getElementById("tgImageUrl");
//   const tgTitle = document.getElementById("tgTitle");
//   const tgLink = document.getElementById("tgLink");
//   const tgText = document.getElementById("tgText");
//   const tgIntroBtn = document.getElementById("tgIntroBtn");
//   const tgSendBtn = document.getElementById("tgSendBtn");
//   const tgStatus = document.getElementById("tgStatus");

//   let currentPayload = null;

//   function openTgModal({ title, link, img, description }) {
//     currentPayload = { title, link, img, description };

//     tgTitle.value = title;
//     tgLink.value = link;

//     if (img) {
//       tgImage.src = img;
//       tgImage.style.display = "block";
//       tgImageUrl.value = img;
//     } else {
//       tgImage.src = "";
//       tgImage.style.display = "none";
//       tgImageUrl.value = "";
//     }

//     // 預設：標題 + 短網址（沒有導言）
//     tgText.value = title + "\\n" + link;
//     tgStatus.textContent = "";
//     tgModal.show();
//   }

//   // 改圖片 URL 預覽
//   tgImageUrl.addEventListener("input", () => {
//     const url = tgImageUrl.value.trim();
//     if (url) {
//       tgImage.src = url;
//       tgImage.style.display = "block";
//     } else {
//       tgImage.src = "";
//       tgImage.style.display = "none";
//     }
//   });

//   // 新增導言：使用 description，純文字，不自動加 ">"
//   tgIntroBtn.addEventListener("click", () => {
//     if (!currentPayload) return;
//     let intro = (currentPayload.description || "").trim();
//     if (!intro) {
//       tgStatus.textContent = "這則 RSS 沒有 description 可以當導言";
//       return;
//     }

//     const title = currentPayload.title || "";
//     const link = currentPayload.link || "";

//     // 有按新增導言：
//     // 標題
//     //
//     // 導言（原文多行）
//     //
//     // 短網址
//     tgText.value = title + "\\n\\n" + intro + "\\n\\n" + link;
//     tgStatus.textContent = "";
//   });

//   tgSendBtn.addEventListener("click", async () => {
//     if (!currentPayload) return;

//     // 二次確認，避免誤發
//     const ok = window.confirm("確定要發送到 Telegram？");
//     if (!ok) {
//       return;
//     }

//     tgSendBtn.disabled = true;
//     tgStatus.textContent = "發送中...";

//     const body = {
//       text: tgText.value,
//       imageUrl: tgImageUrl.value || currentPayload.img || "",
//     };

//     const res = await fetch("/api/publish/telegram", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(body),
//     });

//     if (res.ok) {
//       tgStatus.textContent = "已送出 ✅";
//       setTimeout(() => tgModal.hide(), 700);
//     } else {
//       tgStatus.textContent = "發送失敗";
//     }

//     tgSendBtn.disabled = false;
//   });
// }
// </script>

// </body>
// </html>`;
// }

// // ================== API ==================
// export default {
//   async fetch(request, env) {
//     const url = new URL(request.url);

//     // Login
//     if (url.pathname === "/api/login" && request.method === "POST") {
//       const body = await request.json().catch(() => ({}));
//       const username = body.username || "";
//       const password = body.password || "";
//       const hash = await sha256(password);

//       const user = await env.DB.prepare(
//         "SELECT id, username FROM users WHERE username = ? AND password_hash = ?"
//       )
//         .bind(username, hash)
//         .first();

//       if (!user) {
//         return new Response(JSON.stringify({ error: "帳號或密碼錯誤" }), {
//           status: 401,
//           headers: { "Content-Type": "application/json" },
//         });
//       }

//       const sid = randomId(40);
//       const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

//       await env.DB.prepare(
//         "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
//       )
//         .bind(sid, user.id, expires)
//         .run();

//       return new Response(JSON.stringify({ ok: true }), {
//         status: 200,
//         headers: {
//           "Content-Type": "application/json",
//           "Set-Cookie":
//             `${SESSION_COOKIE_NAME}=` +
//             encodeURIComponent(sid) +
//             "; Path=/; HttpOnly; SameSite=Lax",
//         },
//       });
//     }

//     // Logout
//     if (url.pathname === "/api/logout" && request.method === "POST") {
//       const sid = getCookie(request, SESSION_COOKIE_NAME);
//       if (sid) {
//         await env.DB.prepare("DELETE FROM sessions WHERE id = ?")
//           .bind(sid)
//           .run();
//       }
//       return new Response(JSON.stringify({ ok: true }), {
//         status: 200,
//         headers: {
//           "Content-Type": "application/json",
//           "Set-Cookie":
//             `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
//         },
//       });
//     }

//     // RSS Proxy
//     if (url.pathname === "/api/rss-proxy") {
//       const user = await requireUser(request, env);
//       if (!user) return new Response("Unauthorized", { status: 401 });

//       const rssRes = await fetch(env.RSS_URL);
//       const text = await rssRes.text();
//       return new Response(text, {
//         status: 200,
//         headers: {
//           "Content-Type":
//             rssRes.headers.get("Content-Type") || "application/rss+xml",
//         },
//       });
//     }

//     // Telegram 發送
//     if (url.pathname === "/api/publish/telegram" && request.method === "POST") {
//       const user = await requireUser(request, env);
//       if (!user) {
//         return new Response(JSON.stringify({ error: "未登入" }), {
//           status: 401,
//           headers: { "Content-Type": "application/json" },
//         });
//       }

//       const body = await request.json().catch(() => ({}));
//       const text = body.text || "";
//       const imageUrl = body.imageUrl || "";
//       const chatId = env.TELEGRAM_CHAT_ID;

//       let method = "sendMessage";
//       let payload = {
//         chat_id: chatId,
//         text,
//         parse_mode: "Markdown",
//       };

//       if (imageUrl) {
//         method = "sendPhoto";
//         payload = {
//           chat_id: chatId,
//           photo: imageUrl,
//           caption: text,
//           parse_mode: "Markdown",
//         };
//       }

//       const tgRes = await fetch(
//         `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
//         {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           body: JSON.stringify(payload),
//         }
//       );

//       if (!tgRes.ok) {
//         const errText = await tgRes.text();
//         return new Response(
//           JSON.stringify({ error: "Telegram API 錯誤", detail: errText }),
//           {
//             status: 500,
//             headers: { "Content-Type": "application/json" },
//           }
//         );
//       }

//       return new Response(JSON.stringify({ ok: true }), {
//         status: 200,
//         headers: { "Content-Type": "application/json" },
//       });
//     }

//     // 其他：回主畫面
//     const user = await requireUser(request, env);
//     const html = htmlPage(!!user, user?.username || "");
//     return new Response(html, {
//       status: 200,
//       headers: { "Content-Type": "text/html; charset=utf-8" },
//     });
//   },
// };
