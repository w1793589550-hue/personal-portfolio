# 小禄个人网站

个人作品集网站，包含作品展示、个人介绍、联系表单、邮件通知和管理员统计。

## 本地启动

双击 `启动个人网站.cmd`，或执行：

```powershell
npm start
```

默认访问：

```text
http://127.0.0.1:4173
```

## 环境变量

复制 `.env.example` 为 `.env`，填写：

```text
ADMIN_PASSWORD=管理员密码
ADMIN_SESSION_SECRET=长随机字符串
QQ_SMTP_USER=QQ邮箱
QQ_SMTP_PASS=QQ邮箱SMTP授权码
CONTACT_TO=收件邮箱
```

`.env` 不要提交到 GitHub。

## Render 部署

本项目已包含 `render.yaml`。部署到 Render 时，Environment 里需要配置：

```text
ADMIN_PASSWORD=管理员密码
ADMIN_SESSION_SECRET=长随机字符串
QQ_SMTP_USER=QQ邮箱
QQ_SMTP_PASS=QQ邮箱SMTP授权码
CONTACT_TO=收件邮箱
```

Render 会自动提供 `PORT`，无需手动填写。
