# 导出干净源码（给你自己用）

本目录把**当前项目**打成一份可分享包：无数据库、无 `.env`、并去掉本工会品牌与桶名等痕迹。

```bash
./export/make-export.sh
```

产物：

- `export/out/lotm-club-platform/` — 可直接分享的目录  
- `export/out/lotm-club-platform-YYYYMMDD.zip` — 压缩包  

接收方应阅读包内 `README.md`（标题为「诡秘之主俱乐部管理平台须知 · 共享版」），自行配置管理员与品牌。

分享前请确认：`export/out/` 内没有你的 `.env`、`data/`。
