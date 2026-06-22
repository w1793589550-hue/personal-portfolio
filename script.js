const shell = document.querySelector(".smooth-shell");
const progress = document.querySelector(".scroll-progress");
const sections = [...document.querySelectorAll("[data-section]")];
const navLinks = [...document.querySelectorAll(".nav a")];
const reveals = [...document.querySelectorAll(".reveal")];
const heroIdentity = document.querySelector(".hero-identity");

function shellScrolls() {
  return window.getComputedStyle(shell).overflowY !== "visible" && shell.scrollHeight > shell.clientHeight + 4;
}

function scrollTopValue() {
  return shellScrolls() ? shell.scrollTop : window.scrollY;
}

function scrollMaxValue() {
  if (shellScrolls()) return shell.scrollHeight - shell.clientHeight;
  return document.documentElement.scrollHeight - window.innerHeight;
}

function setProgress() {
  const max = scrollMaxValue();
  const value = max > 0 ? (scrollTopValue() / max) * 100 : 0;
  progress.style.width = `${value}%`;
}

function targetTop(target) {
  if (shellScrolls()) return target.offsetTop;
  return target.getBoundingClientRect().top + window.scrollY;
}

function scrollToTarget(target) {
  const top = Math.max(0, targetTop(target) - 8);
  if (shellScrolls()) {
    shell.scrollTo({ top, behavior: "smooth" });
  } else {
    window.scrollTo({ top, behavior: "smooth" });
  }
}

function syncActiveNav() {
  const currentTop = scrollTopValue() + 180;
  let active = sections[0];
  sections.forEach((section) => {
    const top = shellScrolls() ? section.offsetTop : section.getBoundingClientRect().top + window.scrollY;
    if (top <= currentTop) active = section;
  });
  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${active.id}`);
  });
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("is-visible");
    });
  },
  { root: shellScrolls() ? shell : null, threshold: 0.16 }
);

reveals.forEach((item) => revealObserver.observe(item));

function onScroll() {
  setProgress();
  syncActiveNav();
}

shell.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
onScroll();

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    scrollToTarget(target);
  });
});

if (heroIdentity) {
  heroIdentity.addEventListener("pointermove", (event) => {
    const rect = heroIdentity.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    heroIdentity.querySelectorAll(".identity-thumbs img").forEach((item, index) => {
      const depth = (index + 1) * 6;
      item.style.translate = `${x * depth}px ${y * depth}px`;
    });
  });

  heroIdentity.addEventListener("pointerleave", () => {
    heroIdentity.querySelectorAll(".identity-thumbs img").forEach((item) => {
      item.style.translate = "";
    });
  });
}

const contactForm = document.querySelector(".contact-form");
const formStatus = document.querySelector(".form-status");
const adminEntry = document.querySelector("#adminEntry");
const adminDialog = document.querySelector("#adminDialog");
const adminCancel = document.querySelector("#adminCancel");
const adminPassword = document.querySelector("#adminPassword");
const adminLogin = document.querySelector("#adminLogin");
const adminLoginStatus = document.querySelector("#adminLoginStatus");
const adminPanel = document.querySelector("#adminPanel");
const adminRefresh = document.querySelector("#adminRefresh");
const adminLogout = document.querySelector("#adminLogout");
const adminServerMessage =
  "后台服务没有连接。请双击 D:\\cc_text\\personal-portfolio\\启动个人网站.cmd，或在 D:\\cc_text\\personal-portfolio 运行 npm start 后访问 http://localhost:4173。";

if (contactForm) {
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!contactForm.reportValidity()) return;

    const submitButton = contactForm.querySelector('button[type="submit"]');
    const formData = new FormData(contactForm);
    const payload = Object.fromEntries(formData.entries());

    setFormStatus("正在发送，请稍等...", "");
    submitButton.disabled = true;

    try {
      if (window.location.protocol === "file:") {
        throw new Error("请通过本地服务器打开网站后再提交表单。");
      }

      const response = await fetch(contactForm.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.message || "发送失败，请稍后再试。");
      }

      contactForm.reset();
      setFormStatus(result.message || "已发送，我会尽快回复。", "success");
    } catch (error) {
      setFormStatus(error.message || "发送失败，请直接通过邮箱联系我。", "error");
    } finally {
      submitButton.disabled = false;
    }
  });
}

function setFormStatus(message, type) {
  if (!formStatus) return;
  formStatus.textContent = message;
  formStatus.classList.remove("success", "error");
  if (type) formStatus.classList.add(type);
}

document.querySelectorAll(".contact-form input, .contact-form textarea, .contact-form select").forEach((field) => {
  field.addEventListener("invalid", () => field.classList.add("is-invalid"));
  field.addEventListener("input", () => field.classList.remove("is-invalid"));
});

adminEntry?.addEventListener("click", async () => {
  const status = await fetchAdminStatus();
  if (status.adminMode) {
    await showAdminPanel();
    return;
  }
  adminPassword.value = "";
  setAdminStatus(status.needsServer ? adminServerMessage : "", status.needsServer ? "error" : "");
  if (typeof adminDialog.showModal === "function") adminDialog.showModal();
  else adminDialog.setAttribute("open", "");
  adminPassword.focus();
});

adminCancel?.addEventListener("click", () => adminDialog?.close());
adminLogin?.addEventListener("click", loginAdmin);
adminPassword?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loginAdmin();
});
adminRefresh?.addEventListener("click", showAdminPanel);
adminLogout?.addEventListener("click", async () => {
  if (!requiresLocalServer()) {
    await fetch("/api/admin/logout", { method: "POST" });
  }
  adminPanel.hidden = true;
  adminEntry?.classList.remove("active");
});

checkAdminOnLoad();

async function checkAdminOnLoad() {
  const status = await fetchAdminStatus();
  if (status.adminMode) showAdminPanel();
}

async function fetchAdminStatus() {
  if (requiresLocalServer()) return { ok: false, adminMode: false, needsServer: true };
  try {
    const response = await fetch("/api/admin/status");
    return response.json();
  } catch {
    return { ok: false, adminMode: false };
  }
}

async function loginAdmin() {
  const password = adminPassword?.value || "";
  if (!password.trim()) {
    setAdminStatus("请输入管理员密码。", "error");
    return;
  }
  adminLogin.disabled = true;
  setAdminStatus("正在验证...", "");
  try {
    if (requiresLocalServer()) throw new Error(adminServerMessage);
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.message || "管理员登录失败。");
    adminDialog?.close();
    await showAdminPanel();
  } catch (error) {
    setAdminStatus(error.message || "管理员登录失败。", "error");
  } finally {
    adminLogin.disabled = false;
  }
}

async function showAdminPanel() {
  if (requiresLocalServer()) {
    setAdminStatus(adminServerMessage, "error");
    return;
  }
  const response = await fetch("/api/admin/stats");
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    adminPanel.hidden = true;
    adminEntry?.classList.remove("active");
    return;
  }
  renderAdminStats(result.stats);
  adminPanel.hidden = false;
  adminEntry?.classList.add("active");
}

function requiresLocalServer() {
  return window.location.protocol === "file:";
}

function setAdminStatus(message, type) {
  if (!adminLoginStatus) return;
  adminLoginStatus.textContent = message;
  adminLoginStatus.classList.remove("success", "error");
  if (type) adminLoginStatus.classList.add(type);
}

function renderAdminStats(stats) {
  const totals = stats?.totals || {};
  document.querySelector("#statVisitors").textContent = totals.visitors || 0;
  document.querySelector("#statViews").textContent = totals.views || 0;
  document.querySelector("#statContactPeople").textContent = totals.contactPeople || 0;
  document.querySelector("#statTodayVisitors").textContent = `今日 ${totals.todayVisitors || 0}`;
  document.querySelector("#statTodayViews").textContent = `今日 ${totals.todayViews || 0}`;
  document.querySelector("#statContacts").textContent = `提交 ${totals.contacts || 0} 次`;
  renderBars(document.querySelector("#dailyBars"), stats?.daily || []);
  renderBars(document.querySelector("#hourlyBars"), stats?.hourly || []);
}

function renderBars(container, points) {
  if (!container) return;
  const max = Math.max(1, ...points.map((point) => Number(point.views || 0)));
  container.replaceChildren();
  for (const point of points) {
    const bar = document.createElement("span");
    bar.className = "admin-bar";
    bar.style.height = `${Math.max(8, (Number(point.views || 0) / max) * 120)}px`;
    bar.dataset.label = point.label;
    bar.title = `${point.label}: 浏览量 ${point.views}，浏览人数 ${point.visitors}，联系 ${point.contacts}`;
    container.append(bar);
  }
}
