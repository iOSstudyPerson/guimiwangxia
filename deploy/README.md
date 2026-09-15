# 阿里云 + GitHub 部署指南

**当前线上地址：http://139.224.224.26:8765/**  
仓库：https://github.com/iOSstudyPerson/guimiwangxia  

日常更新（自测 → push → 服务器）见仓库根目录 [README.md](../README.md)。

本项目是「静态前端 + Python `server.py`」，适合阿里云轻量应用服务器 / ECS。

## 一、本机：推到 GitHub

1. 浏览器打开 [https://github.com/new](https://github.com/new)，新建私有仓库（建议 Private），不要勾选自动加 README。
2. 在本机项目目录执行（把 `YOUR_USER` / `wangxia-club` 换成你的）：

```bash
cd ~/Desktop/wangxia-club
git remote add origin https://github.com/YOUR_USER/wangxia-club.git
git push -u origin main
```

若用 SSH：

```bash
git remote add origin git@github.com:YOUR_USER/wangxia-club.git
git push -u origin main
```

**不要**把 `.env`、`data/club.db` 推上去（已在 `.gitignore`）。

---

## 二、阿里云：买机器并放行端口

1. 购买 **轻量应用服务器** 或 ECS（推荐：Ubuntu 22.04，1核2G 起）
2. 控制台 → 防火墙 / 安全组 → 放行 **TCP 8765**（若用 Nginx 反代则放行 80/443）
3. 记下 **公网 IP**，用 SSH 登录：

```bash
ssh root@你的公网IP
```

---

## 三、服务器：首次部署

```bash
export REPO_URL='https://github.com/YOUR_USER/wangxia-club.git'
# 若仓库是私有的，可改用带 token 的 HTTPS，或先配置 deploy key
curl -fsSL -o /tmp/setup.sh https://raw.githubusercontent.com/YOUR_USER/wangxia-club/main/deploy/setup-server.sh
# 更稳妥：先手动 clone 再跑脚本
git clone "$REPO_URL" /opt/wangxia-club
cd /opt/wangxia-club
sudo -E bash deploy/setup-server.sh
```

脚本会：安装 git/python3、clone（若尚未 clone）、生成 `.env`、安装 systemd 服务 `wangxia`。

然后编辑环境变量：

```bash
sudo nano /opt/wangxia-club/.env
```

至少修改：

```bash
ADMIN_USER=王下七武海
ADMIN_PASSWORD=换成足够强的密码
PORT=8765
COS_SECRET_ID=...
COS_SECRET_KEY=...
COS_REGION=ap-shanghai
COS_BUCKET=...
COS_PUBLIC_BASE_URL=...
```

```bash
sudo systemctl restart wangxia
```

浏览器打开：`http://公网IP:8765/`

---

## 四、把本机已有数据迁过去（可选）

本机先停服务或确认库未在写，再上传：

```bash
# 在本机执行
scp data/club.db root@公网IP:/opt/wangxia-club/data/club.db
ssh root@公网IP 'chown www-data:www-data /opt/wangxia-club/data/club.db && systemctl restart wangxia'
```

---

## 五、以后如何更新（像 GitHub 同步）

本机改完代码：

```bash
git add -A
git commit -m "说明这次改动"
git push
```

服务器上：

```bash
sudo bash /opt/wangxia-club/deploy/update.sh
```

即：`git pull` + `systemctl restart wangxia`。  
`.env` 与 `data/club.db` 留在服务器，不会被 pull 覆盖。

---

## 六、常用命令

```bash
sudo systemctl status wangxia
sudo journalctl -u wangxia -f
sudo systemctl restart wangxia
```

---

## 七、（可选）Nginx + 域名 + HTTPS

放行 80/443 后：

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Nginx 反代示例（`/etc/nginx/sites-available/wangxia`）：

```nginx
server {
  listen 80;
  server_name your.domain.com;
  location / {
    proxy_pass http://127.0.0.1:8765;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    client_max_body_size 12m;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/wangxia /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your.domain.com
```
