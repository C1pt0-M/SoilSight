# SoilSight

新疆特色作物土壤健康评估与规划 Web 系统，提供地图评估、区域画像、阶段式规划与模拟对比。

## 目录

- [SoilSight](#soilsight)
  - [目录](#目录)
  - [项目概览](#项目概览)
  - [项目背景](#项目背景)
  - [功能清单](#功能清单)
  - [环境要求](#环境要求)
  - [安装说明](#安装说明)
  - [使用方法](#使用方法)
    - [一键启动前后端](#一键启动前后端)
    - [单独启动后端](#单独启动后端)
    - [单独启动前端](#单独启动前端)
    - [运行后访问](#运行后访问)
    - [常见使用流程](#常见使用流程)
  - [常见问题](#常见问题)
    - [1. 前端地图空白](#1-前端地图空白)
    - [2. 后端能启动但评估失败](#2-后端能启动但评估失败)
    - [3. PowerShell 显示中文乱码](#3-powershell-显示中文乱码)
    - [4. `npm run dev` 失败](#4-npm-run-dev-失败)
  - [贡献指南](#贡献指南)
  - [维护者](#维护者)
  - [许可证](#许可证)

## 项目概览

这个仓库解决的是“新疆特色作物土壤质量如何快速评估、解释并给出可执行规划”的问题。你可以直接得到四类结果：

- 地图点击评估：查看地块评分、分项指标和风险解释
- 区域画像：查看全疆及地州/区县层面的统计结果
- 规划工作台：生成三阶段治理建议
- 模拟对比：对比不同推进节奏下的阶段式结果

## 项目背景

项目面向新疆棉花、甜菜、玉米等特色作物场景，目标不是做通用农业展示页，而是把土壤、水分、盐分、地形和作物 profile 口径统一到同一套评估与规划流程里。当前前后端已经收敛为 Windows + PowerShell + conda 的本地运行链路，适合演示、答辩和本地部署。

## 功能清单

- `cotton`、`sugarbeet`、`maize` 三类特色作物 profile 运行时切换
- 地图图层切换：作物评分、耕地、干旱风险、高温风险、土壤/供水分项
- 地块点击评估与抽屉结果展示
- 区县统计与区域画像展示
- 阶段式规划：第一阶段、第二阶段、第三阶段
- 推进节奏切换：`aggressive`、`stable`、`conservative`
- 规划对话与模拟对比

## 环境要求

- Windows PowerShell
- Python `3.11`
- Node.js `18+`
- npm
- conda

## 安装说明

1. 创建并激活 Python 环境。

```powershell
conda create -n soilsight python=3.11 -y
conda activate soilsight
```

2. 安装后端依赖。

```powershell
python -m pip install -r requirements.txt
Copy-Item backend/.env.example backend/.env
```

3. 安装前端依赖并生成前端环境文件。

```powershell
cd frontend
npm install
Copy-Item .env.example .env
cd ..
```

4. 编辑前端环境变量。

- `frontend/.env` 必须填写 `VITE_TIANDITU_KEY`
- `backend/.env` 默认使用 competition mode，可直接运行

## 使用方法

### 一键启动前后端

```powershell
& .\scripts\dev_stack.ps1 start -PythonExe python
```

### 单独启动后端

```powershell
& .\scripts\start_backend.ps1 -PythonExe python
```

说明：

- 默认会自动加载当前仓库内可用的作物 profile
- 仅在需要指定默认作物时再传 `-ScoreProfile`

```powershell
& .\scripts\start_backend.ps1 -PythonExe python -ScoreProfile maize
```

### 单独启动前端

```powershell
& .\scripts\start_frontend.ps1
```

### 运行后访问

- Frontend: `http://127.0.0.1:5173`
- Backend: `http://127.0.0.1:8010`
- Health: `http://127.0.0.1:8010/health`

### 常见使用流程

1. 打开地图页面
2. 切换作物 profile 或图层
3. 点击地块查看评估结果
4. 进入规划工作台生成阶段方案
5. 在模拟页查看阶段式对比结果

## 常见问题

### 1. 前端地图空白

通常是 `frontend/.env` 里的 `VITE_TIANDITU_KEY` 未配置。

### 2. 后端能启动但评估失败

通常是数据文件缺失，当前 GitHub 版仓库要求保留 `data/features/shi_xinjiang/` 下的最小运行栅格和 `data/行政区划/` 下的区划 GeoJSON。

### 3. PowerShell 显示中文乱码

优先用编辑器查看文件。仓库文本文件统一按 `UTF-8` 保存。

### 4. `npm run dev` 失败

先确认已经在 `frontend/` 执行过 `npm install`。

## 贡献指南

当前仓库接受 issue 和 PR，但合并前提是改动符合运行版仓库的边界：

- 优先提交可直接运行的修复
- 不提交 `.env`、密钥和本地缓存
- 不把训练数据、比赛材料和开发文档混入运行仓库
- 提交信息按仓库规范使用中文摘要

提交流程：

```powershell
git status
git add .
git commit -m "fix(map): 修复地图评估结果抽屉状态同步问题"
git push -u origin main
```

## 维护者

- Repository owner: `C1pt0-M`
- Remote: `git@github.com:C1pt0-M/SoilSight.git`

## 许可证

当前仓库未附带单独的 `LICENSE` 文件。按默认版权规则处理，可视为 `All Rights Reserved`，权利归属 `C1pt0-M`。
