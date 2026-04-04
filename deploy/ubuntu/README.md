# SoilSight Ubuntu 22.04 部署说明（无域名、同机已有项目）

适用场景：
- 服务器公网 IP：`8.145.44.230`
- 已有其他项目在同一台机器运行
- SoilSight 不抢占现有项目端口，改用 `8082`

部署后访问地址：
- `http://8.145.44.230:8082`

## 1. 目录约定

以下示例统一使用：
- 项目目录：`/opt/soilsight`
- Python venv：`/opt/soilsight/.venv`
- 后端监听：`127.0.0.1:8010`
- Nginx 暴露：`0.0.0.0:8082`

你可以替换为自己的路径，但要同步修改 service/nginx 配置。

## 2. 安装系统依赖

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip nginx nodejs npm
```

如果你希望使用更新版本 Node.js，建议用 nvm 安装 Node 18+。

## 3. 准备项目与依赖

```bash
cd /opt
sudo mkdir -p /opt/soilsight
sudo chown -R $USER:$USER /opt/soilsight

# 将代码放到 /opt/soilsight（git clone 或上传）
cd /opt/soilsight

python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

编辑 `frontend/.env`，至少配置：

```env
VITE_TIANDITU_KEY=你的天地图Key
VITE_API_TIMEOUT_MS=80000
VITE_PLAN_API_TIMEOUT_MS=90000
```

构建前端静态文件：

```bash
cd /opt/soilsight/frontend
npm install
npm run build
```

## 4. 安装 systemd（后端）

```bash
sudo cp /opt/soilsight/deploy/ubuntu/soilsight-backend.service /etc/systemd/system/soilsight-backend.service
sudo systemctl daemon-reload
sudo systemctl enable soilsight-backend
sudo systemctl restart soilsight-backend
sudo systemctl status soilsight-backend --no-pager
```

查看日志：

```bash
sudo journalctl -u soilsight-backend -f
```

## 5. 安装 Nginx（前端 + API 反向代理）

```bash
sudo cp /opt/soilsight/deploy/ubuntu/nginx-soilsight-8082.conf /etc/nginx/sites-available/soilsight-8082
sudo ln -sf /etc/nginx/sites-available/soilsight-8082 /etc/nginx/sites-enabled/soilsight-8082
sudo nginx -t
sudo systemctl reload nginx
```

如果开启了 UFW，放通 8082：

```bash
sudo ufw allow 8082/tcp
sudo ufw reload
```

## 6. 验证

服务器本机验证：

```bash
curl http://127.0.0.1:8010/health
curl http://127.0.0.1:8082/health
```

外网验证：

```bash
curl http://8.145.44.230:8082/health
```

浏览器访问：

- `http://8.145.44.230:8082`

## 7. 常见问题

1. 页面打开但地图空白：
- 检查 `frontend/.env` 的 `VITE_TIANDITU_KEY` 是否有效。

2. 页面能打开但 API 报错：
- 检查后端服务：`systemctl status soilsight-backend`
- 检查 Nginx 反代：`nginx -t` 与 `/var/log/nginx/error.log`

3. 想和现有项目共用 80 端口：
- 当前仓库默认按根路径 `/` 访问资源（例如 `/overlays/...`、`/api/...`）。
- 若要挂到子路径（如 `/soilsight/`），需要额外做前端路径前缀改造。
