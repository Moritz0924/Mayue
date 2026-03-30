# Mayue（马跃）数字孪生形变监测软件 Demo

这是基于《基于数字孪生的建筑结构后期形变监测系统》项目申报书重构后的 **可运行 demo**。当前版本优先补齐项目规划书中的核心能力，前端精细 UI 暂缓，重点完成以下链路：

- **数字孪生**：使用 **Three.js** 提供轻量化三维结构 demo 页面与构件状态联动
- **数据处理**：多源传感数据接入、物理范围校验、质量分过滤、突刺剔除、窗口聚合、64 维特征工程
- **时空对齐**：
  - 空间对齐：Kabsch/最小二乘刚体配准，输出旋转矩阵 `R` 与平移向量 `t`
  - 时间对齐：DTW（动态时间规整）输出对齐路径与偏移成本
- **智能预测**：Python + PyTorch 的 **LSTM（64 输入，128 隐藏层）** 位移趋势预测
- **结构评估**：Python + PyTorch 的 **1D-CNN** 振动健康评估
- **大模型联合决策**：已接入 **Qwen3 / Ollama** 本地化大模型编排，支持工具调用读取位移预测、振动评估、维护历史和实时状态，再生成维护计划
- **兼容性**：保留原有 MVP 路由，同时增强目标层 API

## 当前项目结构

```text
Mayue/
├─ algo/
│  ├─ algos/
│  │  ├─ demo_inference.py        # LSTM / 1D-CNN / 对齐算法推理桥接
│  │  ├─ train_demo_models.py     # 训练并产出 demo 权重
│  │  └─ baseline.py
│  └─ models/
│     ├─ displacement_lstm.pt
│     └─ vibration_cnn.pt
├─ backend/
│  ├─ data/
│  │  ├─ demo/                    # 传感器布局、维护历史
│  │  └─ models/demo_tower/       # 孪生场景与构件映射
│  ├─ public/
│  │  ├─ twin-demo.html           # Three.js demo 页面
│  │  └─ twin-demo.js
│  ├─ src/
│  │  ├─ api/target/              # telemetry / align / predict / evaluate / twin / copilot
│  │  ├─ demo/                    # demo 数据引导与仓储
│  │  ├─ infra/cache/             # 时序 ring buffer
│  │  └─ services/                # Python 桥接、特征工程、Copilot、LLM 运行层
│  └─ .env.example                # LLM 部署环境变量示例
├─ deploy/
│  └─ docker-compose.vllm.example.yml
├─ docs/
│  └─ llm-selection-and-deployment.md
├─ scripts/
│  └─ llm/pull_qwen3.sh
└─ frontend/                      # 仍保留原前端骨架，暂未作为主演示入口
```

## 运行方式

### 方案 A：先跑本地大模型（推荐）

1. 启动 Ollama：

```bash
docker compose up -d ollama
```

2. 拉取推荐模型：

```bash
bash scripts/llm/pull_qwen3.sh
```

3. 启动后端：

```bash
cd backend
cp .env.example .env
npm run build
node dist/index.js
```

默认端口：`8000`

### 方案 B：先不开大模型，直接跑规则引擎回退

```bash
cd backend
MAYUE_LLM_MODE=disabled npm run build
MAYUE_LLM_MODE=disabled node dist/index.js
```

## LLM 环境变量

```bash
# disabled | ollama | openai-compatible
MAYUE_LLM_MODE=ollama
MAYUE_LLM_MODEL=qwen3:30b
MAYUE_LLM_BASE_URL=http://127.0.0.1:11434
MAYUE_LLM_API_KEY=
MAYUE_LLM_THINK=false
MAYUE_LLM_TIMEOUT_MS=45000
MAYUE_LLM_MAX_TOOL_ROUNDS=5
MAYUE_LLM_TEMPERATURE=0.2
```

## 打开 Demo

- 健康检查：`http://localhost:8000/healthz`
- Copilot 状态：`http://localhost:8000/api/copilot/status`
- Three.js 数字孪生：`http://localhost:8000/demo/twin-demo.html`

## 关键接口

```bash
# 模型与构件
curl -s http://localhost:8000/api/models
curl -s http://localhost:8000/api/models/demo_tower/elements

# Copilot LLM 运行状态
curl -s http://localhost:8000/api/copilot/status

# 目标层时序查询
curl -s "http://localhost:8000/api/telemetry/timeseries?element_id=E1008&metric=disp&from_ts_ms=1700000000000&to_ts_ms=1800000000000&limit=20&agg=raw"

# BIM-IoT 空间对齐
curl -s -X POST http://localhost:8000/api/align/spatial \
  -H "Content-Type: application/json" \
  -d '{
    "model_id":"demo_tower",
    "method":"least_squares",
    "pairs":[
      {"coord_local":[-8.05,44.02,0.04],"coord_bim":[-8,44,0]},
      {"coord_local":[8.04,44.01,-0.03],"coord_bim":[8,44,0]},
      {"coord_local":[0.03,40.02,0.02],"coord_bim":[0,40,0]}
    ]
  }'

# LSTM 位移预测
curl -s -X POST http://localhost:8000/api/predict/displacement \
  -H "Content-Type: application/json" \
  -d '{"element_id":"E1008","horizon":12}'

# 1D-CNN 振动评估
curl -s -X POST http://localhost:8000/api/evaluate/vibration \
  -H "Content-Type: application/json" \
  -d '{"element_id":"E1004"}'

# 联合维护计划（已支持 LLM 工具调用 / 无 LLM 时自动回退）
curl -s -X POST http://localhost:8000/api/copilot/maintenance-plan \
  -H "Content-Type: application/json" \
  -d '{"element_id":"E1008","horizon_sec":20}'
```

## 目前做了什么

### 已落地

- 规划书里的 **数字孪生、时空对齐、位移预测、振动评估、预警、维护计划** 关键链路全部打通
- 后端启动时自动注入 demo 遥测数据，`/api/models`、`/api/elements/*`、`/api/telemetry/*` 可直接使用
- `Three.js` demo 可按构件点击查看状态
- Copilot 已支持 **真实 LLM 接入层**：
  - `ollama` 模式：直接对接 `qwen3:30b`
  - `openai-compatible` 模式：可对接 vLLM / SGLang / 云端兼容接口
  - LLM 故障时自动回退到规则引擎，不影响 demo 演示
- 风险下限采用“**算法结果兜底**”：即使 LLM 判断偏保守，最终风险级别也不会低于 LSTM/1D-CNN/规则融合结果

### 仍保留为 demo 的部分

- 数字孪生模型目前为轻量化结构示意，不是正式 BIM/IFC 解析器
- 数据为仿真数据与历史记录样本，不是企业真实楼宇数据
- Web 端 UI 仅保留演示页，业务化页面未细化

## 建议的下一步

1. 用真实 IFC/Revit 导出数据替换 `backend/data/models/demo_tower/scene.json`
2. 将 `copilot` 的工具集合继续扩展到工单、短信、巡检任务系统
3. 把时序缓存替换为 TimescaleDB / InfluxDB
4. 将 Three.js 页面升级为正式运维看板，接入权限系统与工单流
