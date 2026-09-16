# 王下七武海俱乐部 · 共享版

工会公共网页：任何人打开链接都能看总览 / DKP / 论坛；**成员档案仅管理员登录后可查看与编辑**。

## 线上地址（阿里云）

工会日常入口：

**http://139.224.224.26:8765/**

- 代码仓库：[https://github.com/iOSstudyPerson/guimiwangxia](https://github.com/iOSstudyPerson/guimiwangxia)
- 服务器目录：`/opt/wangxia-club`
- 环境变量（密码 / COS）：服务器上的 `/opt/wangxia-club/.env`（**不要**提交到 Git）
- 数据库：服务器上的 `/opt/wangxia-club/data/club.db`（**不要**提交到 Git）

首次部署与防火墙说明见 **[deploy/README.md](deploy/README.md)**。

---

## 本机先跑起来（自测）

```bash
cd ~/Desktop/wangxia-club   # 或你的项目目录
./start.sh
```

打开 [http://127.0.0.1:8765/](http://127.0.0.1:8765/)

- 访客：不用登录可看总览 / DKP / 论坛；成员档案需管理员登录
- 本机管理员账号见本地 `.env` 的 `ADMIN_USER` / `ADMIN_PASSWORD`
- **改功能时先在本机测通**，再推到云服务器，避免直接弄坏线上

---

## 日常如何更新代码（自测 → GitHub → 云服务器）

### 推荐：一键发布（日常就用这个）

本机自测通过后，在项目根目录执行：

```bash
cd ~/Desktop/wangxia-club
./deploy/ship.sh -m "说明这次改了什么"
```

脚本会打印每步日志，并依次完成：

1. 提交本地改动（有改动时必须带 `-m`）
2. `git push` 到 GitHub `main`
3. SSH 登录云服务器执行 `deploy/update.sh`（`git pull` + 重启服务）
4. 探测线上 `http://139.224.224.26:8765/` 是否可访问

**不会**覆盖服务器上的 `.env` 和 `data/club.db`。

常用变体：

```bash
./deploy/ship.sh                 # 没有未提交改动时，只 push + 更新服务器
./deploy/ship.sh --server-only   # 只更新服务器（GitHub 已推过）
./deploy/ship.sh --push-only     # 只推 GitHub，不碰服务器
./deploy/ship.sh --dry-run -m "试跑"   # 只看将要做什么，不真正执行
```

若 SSH 账号 / IP / 密钥不同，复制配置后修改（此文件已 gitignore，不会进仓库）：

```bash
cp deploy/ship.env.example deploy/ship.local.env
# 编辑 deploy/ship.local.env
```

发布前请确认：本机能 `git push`，且能 SSH 登录 `root@139.224.224.26`。  
发布后请浏览器强制刷新（Cmd+Shift+R）打开：http://139.224.224.26:8765/

若 `ship.sh` 在「更新云服务器」步骤报 `Permission denied`，把 SSH 密码写进本机配置（**勿提交**）：

```bash
cp deploy/ship.env.example deploy/ship.local.env
# 编辑 ship.local.env，填入：
# DEPLOY_SSH_PASSWORD=你的SSH密码
```

`ship.local.env` 已在 `.gitignore` 中，脚本会自动读取并用 expect 登录，**不会**在日志里打印密码。

然后再执行：

```bash
./deploy/ship.sh --server-only
```

### 1. 本机改代码并自测

```bash
cd ~/Desktop/wangxia-club
./start.sh
```

浏览器打开 http://127.0.0.1:8765/ ，确认新功能 / 联赛 / 论坛等正常。

### 2–3. 手动发布（备用；一般直接用上面的 ship.sh）

若一键脚本不可用，再手动执行：

```bash
git status
git add -A
git commit -m "说明这次改了什么"
git push origin main
```

推送时若要密码：Username 填 `iOSstudyPerson`，Password 填 GitHub **Personal Access Token**（不是登录密码）。

然后 SSH 到服务器：

```bash
# 若提示 dubious ownership，先执行一次：
git config --global --add safe.directory /opt/wangxia-club

sudo bash /opt/wangxia-club/deploy/update.sh
```

脚本会：`git pull` + 重启 `wangxia` 服务。  
`.env` 和 `data/club.db` 留在服务器，**不会**被覆盖。

更新后打开线上地址确认：http://139.224.224.26:8765/  
（建议强制刷新或清缓存。）

### 4. 若只改了服务器上的配置

只改密码 / COS 时，编辑后重启即可，不必走 Git：

```bash
sudo nano /opt/wangxia-club/.env
sudo systemctl restart wangxia
```

### 5. 若本机有新数据要覆盖到线上（慎用）

会覆盖服务器现有数据库，先备份：

```bash
# 服务器上备份
ssh root@139.224.224.26 'cp /opt/wangxia-club/data/club.db /opt/wangxia-club/data/club.db.bak-$(date +%F)'

# 本机上传
scp ~/Desktop/wangxia-club/data/club.db root@139.224.224.26:/opt/wangxia-club/data/club.db
ssh root@139.224.224.26 'chown www-data:www-data /opt/wangxia-club/data/club.db && systemctl restart wangxia'
```

---

## 怎么换网址？

当前是 **IP + 端口**：`http://139.224.224.26:8765/`。  
想变成 `https://xxx.com/` 这类短链接，需要：

1. 购买域名  
2. 大陆服务器一般还需 **ICP 备案**  
3. DNS 把域名解析到 `139.224.224.26`  
4. 服务器安装 Nginx，把 80/443 反代到本机 `8765`（可选 HTTPS）

详细命令见 [deploy/README.md](deploy/README.md) 第七节。  
**在未备案 / 未买域名前，继续把上面的 IP 链接发给工会即可**；换域名后只要改 DNS + Nginx，工会改用新域名，代码更新流程不变。

若阿里云更换了公网 IP，需要：

1. 控制台确认新 IP，防火墙仍放行 `8765`（和 `22`）  
2. 把本 README 里的线上地址改成新 IP  
3. 重新通知工会新链接  

---

## 其它上线方式（备选）

### 方案 B：其它云主机手动跑

```bash
export ADMIN_USER='王下七武海'
export ADMIN_PASSWORD='换成更强的密码'
export PORT=8765
python3 server.py
```

### 方案 C：Render 免费托管（海外，国内可能稍慢）

GitHub 连 Render；免费实例会休眠，正式用仍建议阿里云。

### 方案 D：临时公网隧道（仅试用）

```bash
./public.sh
```

链接会变、电脑关机即失效，**不要**当工会日常入口。

---

## 以后想做成微信小程序？

可以，且**不必推倒重来**。小程序主要是微信里的界面壳，共享数据仍要有后端。

### 两条路


| 方案         | 还要不要云服务器             | 说明                                  |
| ---------- | -------------------- | ----------------------------------- |
| **复用当前后端** | **要**（或继续用现有网页那台服务器） | 小程序通过合法域名请求现在的 `/api/`*；成员、考勤逻辑不用重写 |
| **微信云开发**  | 一般**不用**另买 VPS       | 用微信云函数 + 云数据库；要把现有接口迁过去，工作量更大       |


### 建议节奏

1. 先把**网页版**在云服务器上跑稳（方案 A），工会先用起来
2. 再评估要不要做小程序（入口更方便，但有微信认证、备案、域名 HTTPS 等要求）
3. 做小程序时优先 **复用本项目 API**，避免两套数据

纯前端小程序、不接后端 → **没法**工会共用一份名单，不推荐。

---

## 后续更新其他板块的流程

团队编组、联赛分析、论坛分享等，按这个循环即可：

1. **本地开发**
  - 改 `index.html` / `js/` / `css/`，需要接口时改 `server.py`  
  - 运行 `./start.sh`，在 [http://127.0.0.1:8765/](http://127.0.0.1:8765/) 测通
2. **本地确认无误**
  - 管理员登录、访客只读、相关增删改都过一遍  
  - 建议先在「系统设置」导出一份 JSON 备份
3. **发布到服务器**
  - 上传变更的文件（或整包覆盖）  
  - 若只改了前端：覆盖文件后，用户强刷浏览器即可  
  - 若改了 `server.py` 或数据库结构：重启服务，必要时做数据迁移
4. **公网验收**
  - 用服务器固定链接再测一遍总览 / 档案 / 新板块

**不要**直接在公网服务器上边改边试，避免把线上数据改乱。  
临时隧道（方案 C）仅用于演示，正式更新仍以云服务器为准。

---


---

## 论坛分享（原「推荐配置」）

- **免登录**即可发帖、上传图片/视频、浏览
- **他人帖子只能看**；管理员登录后可**删帖**（并尝试删除 COS 附件）
- 媒体存 **腾讯云 COS**

### 发帖限制

| 项 | 限制 |
|----|------|
| 标题 | ≤ 40 字 |
| 正文 | ≤ 5000 字 |
| 图片 | ≤ 5MB × 6 张（jpg/png/webp/gif） |
| 视频 | ≤ 80MB × 1 个（mp4/webm） |
| 频率 | 同 IP 约 5 分钟 1 帖 |

### 配置 COS

```bash
cp .env.example .env
# 编辑 .env，填入 COS_SECRET_ID / COS_SECRET_KEY
```

桶：`wangxia-forum-1488262300`，地域：`ap-shanghai`。  
桶建议公有读私有写，并配置 CORS。启动日志出现 `COS: 已配置` 即可上传。

同一套 `COS_SECRET_ID` / `COS_SECRET_KEY` 也可用于**联赛截图 OCR**（腾讯云文字识别）。若账号已开通 OCR，启动日志会显示 `OCR: 已配置`。也可单独设置 `OCR_SECRET_ID` / `OCR_SECRET_KEY` / `OCR_REGION`。

识别顺序：**腾讯云 OCR（首选）→ 失败/额度用尽后自动切浏览器本地 OCR（Tesseract.js）**，界面会提示「腾讯云 OCR 处理中…」「正在切换浏览器本地 OCR…」。本地 OCR 首次会下载中文模型，稍慢但免费。

## 联赛分析

支持宣战 / 四方 / 终末（猎城、高原模板预留）。个人战绩可手填、从 DKP 导入出席名单，或**截图 OCR / 粘贴文本**导入。

### 计算规则

| 指标 | 公式 |
| --- | --- |
| KDA | `(击杀 + 助攻) / max(死亡, 1)` |
| 参团率 | `(击杀 + 助攻) / max(本俱乐部击杀合计, 1)` |
| 战略分 | `100 × (0.35×玩家伤占比 + 0.25×承伤占比 + 0.25×治疗占比 + 0.15×对怪占比)` |
| 势力合计分 | 该势力下各俱乐部「总分」相加 |

占比均相对**本俱乐部**合计；战略分衡量多维贡献，不是纯输出榜。页面「计算规则」折叠区与此一致。

## 权限说明


| 身份        | 能力                |
| --------- | ----------------- |
| 任何人（有链接）  | 看总览、成员、考勤；论坛发帖/浏览 |
| 管理员（账号密码） | 增删改成员、建活动、点名、删论坛帖、导入备份 |


密码写在服务器环境变量里，不会出现在网页源代码中。

## 备份

侧边栏「系统设置」可导出 / 导入 JSON。数据库文件：`data/club.db`。