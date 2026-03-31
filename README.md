# SoilSight

新疆特色作物土壤质量评估与规划建议项目。当前主工作流已经切到原生 Windows，推荐使用 PowerShell + conda `soilsight` 环境开发和演示。

## 当前范围

- 后端会一次性加载已存在的数据 profile，目前支持 `general`、`cotton`、`sugarbeet`、`maize`
- 前端可在运行时切换当前作物 profile，不需要为不同作物重启后端
- 点击评估、模型信息、规划生成都会按当前 profile 走对应数据口径
- 规划 session 会绑定 `score_profile_id`，仿真时继续沿用生成规划时的作物 profile

## 环境准备

```powershell
conda create -n soilsight python=3.11 -y
conda activate soilsight
python -m pip install -r requirements.txt
Copy-Item backend/.env.example backend/.env
cd frontend
npm install
Copy-Item .env.example .env
cd ..
```

说明：

- 前端至少需要在 `frontend/.env` 中填写 `VITE_TIANDITU_KEY`
- 后端默认可直接使用 `backend/.env.example` 里的 competition mode 配置启动；如需真实 LLM，再自行补充密钥

## 启动

1. 一键启动前后端

```powershell
& .\scripts\dev_stack.ps1 start -PythonExe python
```

2. 单独启动后端

```powershell
& .\scripts\start_backend.ps1 -PythonExe python
```

说明：日常启动不需要显式写 `-ScoreProfile cotton`。`-ScoreProfile` 现在只决定“请求未显式传 profile 时的默认值”；只要对应栅格存在，后端仍会同时加载所有可用作物 profile，前端再按用户选择切换。仅在需要强制默认作物时才传，例如 `-ScoreProfile sugarbeet`。

3. 单独启动前端

```powershell
& .\scripts\start_frontend.ps1
```

说明：如果已经 `conda activate soilsight`，请直接在当前 PowerShell 里用 `& .\scripts\...` 调脚本，不要再额外套一层 `powershell -File`，否则子进程可能回到 base conda 环境。

## 验证

```powershell
curl http://127.0.0.1:8010/health
python scripts\check_plan_api_contract.py --base-url http://127.0.0.1:8010 --profile cotton
python scripts\check_plan_api_contract.py --base-url http://127.0.0.1:8010 --profile sugarbeet
python scripts\check_plan_api_contract.py --base-url http://127.0.0.1:8010 --profile maize
```

`/health` 会返回 `available_score_profiles`，前端据此展示可切换的作物列表。

## 目录

- `backend/`: Python API、评估逻辑、规划与仿真
- `frontend/`: React + Vite 前端界面
- `scripts/`: 运行所需的 Windows 启动脚本
- `data/`: 运行所需的最小特征栅格与静态资源

## GitHub 发布

如果当前目录还不是 Git 仓库，可以这样初始化并绑定远端：

```powershell
git init
git branch -M main
git remote add origin git@github.com:C1pt0-M/SoilSight.git
```

当前根目录 `.gitignore` 已按“最小可运行仓库”整理，默认会忽略这些不该上传的内容：

- `.env`、密钥、真实凭据
- `node_modules/`、`frontend/dist/`、`tmp/`
- `docs/`、内部规范与开发文档
- `backend/tests/`、`frontend/tests/`、前端测试文件
- `data/raw/`、原始遥感数据、训练中间产物
- `frontend/public/overlays/_cotton_tmp/`
- 运行期会变化的 `ai_plan_sessions*.json`

如果你的目标是“上传到 GitHub 后还能直接跑起来”，直接按你们的 Git 规范执行即可：

```powershell
git status
git add .
git commit -m "chore(repo): 初始化 GitHub 可运行仓库"
git push -u origin main
```

说明：

- 当前 GitHub 版仓库只保留“能运行”的内容，不包含开发文档、测试、数据管线和比赛材料
- `git add .` 现在会保留前后端源码、启动脚本、最小运行栅格、行政区划和当前前端必要 overlay
- 不会把 900MB 级训练数据、`.env` 和本地缓存一起推上去
- `git commit` 建议按仓库规范使用中文摘要，例如 `feat(map): 完善阶段式模拟对比`
