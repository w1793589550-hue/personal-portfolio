import http from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = __dirname;
const envPath = path.join(__dirname, ".env");
const port = Number(process.env.PORT || 4173);
const analyticsPath = path.join(__dirname, "data", "analytics.json");

loadEnv(envPath);

const adminPassword = process.env.ADMIN_PASSWORD || "";
const adminSessionSecret = process.env.ADMIN_SESSION_SECRET || "";
const adminSessionCookieName = "xiao_lu_admin";
const adminSessionTtlMs = Math.max(30 * 60 * 1000, Number(process.env.ADMIN_SESSION_TTL_MS || 12 * 60 * 60 * 1000));
const visitorCookieName = "xiao_lu_visitor";
const smtpConfig = {
  host: process.env.QQ_SMTP_HOST || "smtp.qq.com",
  port: Number(process.env.QQ_SMTP_PORT || 465),
  user: process.env.QQ_SMTP_USER,
  pass: process.env.QQ_SMTP_PASS,
  to: process.env.CONTACT_TO || process.env.QQ_SMTP_USER,
};

const requestCounts = new Map();
let analytics = loadAnalytics();

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/contact") {
      await handleContact(req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/api/admin/status") {
      sendJson(res, 200, { ok: true, adminConfigured: Boolean(adminPassword && adminSessionSecret), adminMode: isAdminRequest(req) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/login") {
      if (!adminPassword || !adminSessionSecret) {
        sendJson(res, 503, { ok: false, message: "管理员环境变量未配置。" });
        return;
      }
      const body = await readJsonBody(req, 10 * 1024);
      if (String(body.password || "") !== adminPassword) {
        sendJson(res, 401, { ok: false, message: "管理员密码不正确。" });
        return;
      }
      const now = Date.now();
      const token = signAdminSession({ role: "admin", iat: now, exp: now + adminSessionTtlMs });
      sendJson(res, 200, { ok: true, adminMode: true }, {
        "Set-Cookie": adminCookie(token, Math.floor(adminSessionTtlMs / 1000)),
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/logout") {
      sendJson(res, 200, { ok: true, adminMode: false }, { "Set-Cookie": clearAdminCookie() });
      return;
    }

    if (req.method === "GET" && req.url === "/api/admin/stats") {
      if (!isAdminRequest(req)) {
        sendJson(res, 401, { ok: false, message: "请先进入管理员模式。" });
        return;
      }
      sendJson(res, 200, { ok: true, stats: buildStatsSummary() });
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { ok: false, message: "Method not allowed" });
  } catch (error) {
    console.error("Request failed:", error.message);
    sendJson(res, 500, { ok: false, message: "服务器暂时无法处理，请稍后再试。" });
  }
});

server.listen(port, () => {
  console.log(`Personal portfolio server: http://localhost:${port}`);
});

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function loadAnalytics() {
  try {
    return JSON.parse(fs.readFileSync(analyticsPath, "utf8"));
  } catch {
    return { visitors: {}, daily: {}, hourly: {}, contacts: { total: 0, unique: {} } };
  }
}

function saveAnalytics() {
  fs.mkdirSync(path.dirname(analyticsPath), { recursive: true });
  fs.writeFileSync(analyticsPath, JSON.stringify(analytics, null, 2), "utf8");
}

function parseCookies(req) {
  const header = String(req.headers.cookie || "");
  return Object.fromEntries(
    header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf("=");
      if (index < 0) return [part, ""];
      return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
    })
  );
}

function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function hourKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:00`;
}

function ensurePeriodStats(container, key) {
  container[key] ||= { views: 0, visitors: {}, contacts: 0 };
  return container[key];
}

function shouldTrackAnalytics(req) {
  if (process.env.ANALYTICS_COUNT_LOCAL === "true") return true;
  const host = String(req.headers.host || "").toLowerCase().split(":")[0].replace(/^\[|\]$/g, "");
  return !["localhost", "127.0.0.1", "::1"].includes(host);
}

function recordVisit(req) {
  const cookies = parseCookies(req);
  let visitorId = cookies[visitorCookieName];
  let setCookie = "";
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(visitorId || "")) {
    visitorId = randomUUID();
    setCookie = `${visitorCookieName}=${encodeURIComponent(visitorId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`;
  }
  const now = new Date();
  const nowIso = now.toISOString();
  analytics.visitors[visitorId] ||= { firstSeen: nowIso, views: 0 };
  analytics.visitors[visitorId].lastSeen = nowIso;
  analytics.visitors[visitorId].views += 1;

  const day = ensurePeriodStats(analytics.daily, dayKey(now));
  const hour = ensurePeriodStats(analytics.hourly, hourKey(now));
  day.views += 1;
  hour.views += 1;
  day.visitors[visitorId] = true;
  hour.visitors[visitorId] = true;
  saveAnalytics();
  return setCookie;
}

function recordContact(contact) {
  const now = new Date();
  const identity = `${contact.email || ""}|${contact.phone || ""}|${contact.name || ""}`.toLowerCase();
  const contactId = createHmac("sha256", "xiao-lu-contact").update(identity).digest("base64url");
  analytics.contacts.total += 1;
  analytics.contacts.unique[contactId] ||= { firstSeen: now.toISOString(), count: 0 };
  analytics.contacts.unique[contactId].lastSeen = now.toISOString();
  analytics.contacts.unique[contactId].count += 1;
  ensurePeriodStats(analytics.daily, dayKey(now)).contacts += 1;
  ensurePeriodStats(analytics.hourly, hourKey(now)).contacts += 1;
  saveAnalytics();
}

function buildStatsSummary() {
  const today = dayKey();
  const daily = Object.entries(analytics.daily)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, value]) => ({
      label: date.slice(5),
      views: value.views || 0,
      visitors: Object.keys(value.visitors || {}).length,
      contacts: value.contacts || 0,
    }));
  const hourly = Object.entries(analytics.hourly)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-24)
    .map(([date, value]) => ({
      label: date.slice(11),
      views: value.views || 0,
      visitors: Object.keys(value.visitors || {}).length,
      contacts: value.contacts || 0,
    }));
  return {
    totals: {
      views: Object.values(analytics.daily).reduce((sum, item) => sum + Number(item.views || 0), 0),
      visitors: Object.keys(analytics.visitors || {}).length,
      contacts: analytics.contacts.total || 0,
      contactPeople: Object.keys(analytics.contacts.unique || {}).length,
      todayViews: analytics.daily[today]?.views || 0,
      todayVisitors: Object.keys(analytics.daily[today]?.visitors || {}).length,
      todayContacts: analytics.daily[today]?.contacts || 0,
    },
    daily,
    hourly,
    updatedAt: new Date().toISOString(),
  };
}

function signAdminSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", adminSessionSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyAdminSession(token, now = Date.now()) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature) return null;
  const expected = createHmac("sha256", adminSessionSecret).update(body).digest("base64url");
  if (signature !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload?.role !== "admin" || Number(payload.exp) <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function isAdminRequest(req) {
  return Boolean(verifyAdminSession(parseCookies(req)[adminSessionCookieName]));
}

function adminCookie(token, maxAgeSeconds) {
  return `${adminSessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

function clearAdminCookie() {
  return `${adminSessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

async function handleContact(req, res) {
  if (!smtpConfig.user || !smtpConfig.pass || !smtpConfig.to) {
    sendJson(res, 500, { ok: false, message: "邮件服务尚未配置完整。" });
    return;
  }

  const ip = req.socket.remoteAddress || "unknown";
  if (!allowRequest(ip)) {
    sendJson(res, 429, { ok: false, message: "提交太频繁了，请稍后再试。" });
    return;
  }

  const body = await readJsonBody(req, 64 * 1024);
  const contact = normalizeContact(body);
  const validation = validateContact(contact);
  if (validation) {
    sendJson(res, 400, { ok: false, message: validation });
    return;
  }

  await sendMail({
    from: smtpConfig.user,
    to: smtpConfig.to,
    replyTo: contact.email,
    subject: `个人网站联系表单：${contact.name}`,
    text: formatContactMail(contact),
  });

  recordContact(contact);
  sendJson(res, 200, { ok: true, message: "已发送，我会尽快回复。" });
}

function allowRequest(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const record = requestCounts.get(ip) || [];
  const recent = record.filter((time) => now - time < windowMs);
  recent.push(now);
  requestCounts.set(ip, recent);
  return recent.length <= 5;
}

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeContact(body) {
  return {
    name: String(body.name || "").trim(),
    gender: String(body.gender || "").trim(),
    phone: String(body.phone || "").trim(),
    email: String(body.email || "").trim(),
    message: String(body.message || "").trim(),
  };
}

function validateContact(contact) {
  if (!contact.name) return "请填写姓名。";
  if (!contact.gender) return "请选择性别。";
  if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) return "请填写有效邮箱。";
  if (contact.name.length > 40) return "姓名太长了。";
  if (contact.phone.length > 30) return "电话太长了。";
  if (contact.message.length > 1500) return "留言太长了。";
  return "";
}

function formatContactMail(contact) {
  return [
    "你收到了来自个人网站的新留言：",
    "",
    `姓名：${contact.name}`,
    `性别：${contact.gender}`,
    `电话：${contact.phone || "未填写"}`,
    `邮箱：${contact.email}`,
    "",
    "留言：",
    contact.message || "未填写",
    "",
    `发送时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
  ].join("\n");
}

function sendMail({ from, to, replyTo, subject, text }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: smtpConfig.host,
        port: smtpConfig.port,
        servername: smtpConfig.host,
        rejectUnauthorized: true,
      },
      async () => {
        try {
          await expect(socket, 220);
          await command(socket, `EHLO ${smtpConfig.host}`, 250);
          await command(socket, "AUTH LOGIN", 334);
          await command(socket, Buffer.from(from).toString("base64"), 334);
          await command(socket, Buffer.from(smtpConfig.pass).toString("base64"), 235);
          await command(socket, `MAIL FROM:<${from}>`, 250);
          await command(socket, `RCPT TO:<${to}>`, 250);
          await command(socket, "DATA", 354);
          socket.write(buildMessage({ from, to, replyTo, subject, text }));
          await expect(socket, 250);
          await command(socket, "QUIT", 221);
          socket.end();
          resolve();
        } catch (error) {
          socket.destroy();
          reject(error);
        }
      }
    );
    socket.setEncoding("utf8");
    socket.setTimeout(15000, () => {
      socket.destroy();
      reject(new Error("SMTP timeout"));
    });
    socket.on("error", reject);
  });
}

function buildMessage({ from, to, replyTo, subject, text }) {
  const headers = [
    `From: =?UTF-8?B?${Buffer.from("小禄个人网站").toString("base64")}?= <${from}>`,
    `To: <${to}>`,
    `Reply-To: <${replyTo}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const encodedBody = Buffer.from(text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${encodedBody}\r\n.\r\n`;
}

function command(socket, line, expectedCode) {
  socket.write(`${line}\r\n`);
  return expect(socket, expectedCode);
}

function expect(socket, expectedCode) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (data) => {
      buffer += data;
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last)) return;
      socket.off("data", onData);
      const code = Number(last.slice(0, 3));
      if (code === expectedCode) {
        resolve(buffer);
      } else {
        reject(new Error(`SMTP expected ${expectedCode}, got ${buffer.trim()}`));
      }
    };
    socket.on("data", onData);
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  if (pathname.includes("\0") || pathname.split("/").some((part) => part.startsWith("."))) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const filePath = path.resolve(publicDir, `.${pathname}`);
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, "Not found");
    return;
  }

  const headers = { "Content-Type": contentType(filePath), "Cache-Control": "no-store" };
  if (
    req.method === "GET"
    && path.extname(filePath).toLowerCase() === ".html"
    && !isAdminRequest(req)
    && shouldTrackAnalytics(req)
  ) {
    const cookie = recordVisit(req);
    if (cookie) headers["Set-Cookie"] = cookie;
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".mp4": "video/mp4",
      ".pdf": "application/pdf",
    }[ext] || "application/octet-stream"
  );
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}
