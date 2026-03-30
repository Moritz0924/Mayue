# Mayue 现状分析与本次补强结果

## 1. 原始仓库框架分析

原始 Mayue 仓库本质上是 **“接口先行 + 分层骨架已搭好，但核心算法仍占位”** 的状态：

- `backend/src/app/*`
  - 负责 HTTP 启动、WebSocket 绑定、配置加载
- `backend/src/api/mvp/*`
  - 兼容旧版 MVP 前端的接口
- `backend/src/api/target/*`
  - 目标层接口草案，包含 telemetry / align / predict / evaluate / alerts / integration
- `backend/src/infra/*`
  - 内存事件总线、时序 ring buffer
- `backend/src/core/*`
  - 模型存储与 baseline 分析
- `algo/*`
  - 只有 baseline 占位脚本，未形成真正模型链路
- `frontend/*`
  - 只有最小化 React 壳，未落地数字孪生
- `contracts/*` / `docs/*`
  - 契约、架构文档相对完整，是这套工程最成熟的部分

### 优点

1. 分层是清晰的，后续扩展很方便。
2. MVP 与 Target API 的边界已经分出来了。
3. WebSocket、告警、遥测缓存的思路是对的。

### 核心缺口

1. **没有实际 demo 数据闭环**：`/api/models` 可跑，但没有可演示的完整模型数据与构件场景。
2. **空间/时间对齐是 stub**：原始实现只有简化平移和近邻匹配，不符合规划书对最小二乘 + DTW 的要求。
3. **预测是 stub**：原始 `/predict/displacement` 只是对最后值做线性外推，不是 LSTM。
4. **振动评估是 stub**：原始 `/evaluate/vibration` 只是 RMS 规则，不是 1D-CNN。
5. **没有大模型联合/运维决策链**：只能分析单接口，不能形成维护计划。
6. **没有真正的数字孪生前台**：Three.js 场景未落地。
7. **数据处理不贴规划书**：缺少多源数据、质量过滤、异常剔除、64 维特征工程。

## 2. 本次改造后的架构

```text
Sensor / Simulator
      │
      ▼
/api/telemetry/ingest
      │
      ├─ 质量分过滤 / 物理范围校验 / 突刺剔除
      ├─ RingBuffer 时序缓存
      └─ WebSocket 广播
      │
      ▼
64 维特征工程（disp/vib/temp/hum/wind/strain/stress/settlement）
      │
      ├─ /api/align/spatial    -> Python Kabsch 最小二乘刚体配准
      ├─ /api/align/temporal   -> Python DTW 时间对齐
      ├─ /api/predict/displacement -> Python LSTM(64,128)
      ├─ /api/evaluate/vibration   -> Python 1D-CNN
      └─ /api/copilot/maintenance-plan -> 离线多代理联合决策
      │
      ▼
/api/twin/scene + /demo/twin-demo.html (Three.js)
```

## 3. 本次补强内容

### 数据层

- 新增 `backend/data/models/demo_tower/*`
- 新增 `backend/data/demo/sensor_layout.json`
- 新增 `backend/data/demo/maintenance_history.json`
- 后端启动自动生成 demo 遥测数据并灌入缓存

### 算法层

- `algo/algos/train_demo_models.py`
  - 训练 demo LSTM 与 1D-CNN 权重
- `algo/algos/demo_inference.py`
  - 统一提供：预测 / 评估 / 空间对齐 / 时间对齐
- `algo/models/*.pt`
  - 已产出 demo 权重

### 业务层

- 目标层接口升级为真实可跑版本
- 新增联合维护计划 `copilot` 路由
- 新增数字孪生场景接口 `twin` 路由

### 展示层

- 新增 `backend/public/twin-demo.html`
- 使用 Three.js 按构件加载场景、颜色映射风险、支持点击查看状态

## 4. 对项目规划书的映射

| 规划书要求 | 本次实现 |
|---|---|
| BIM-IoT 时空对齐 | `align/spatial` + `align/temporal` |
| 64 维输入、128 隐藏层 LSTM | 已实现 demo LSTM |
| 1D-CNN 振动识别 | 已实现 demo 1D-CNN |
| 多源异构数据处理 | 8 类指标特征工程 + ingest 过滤链 |
| 数字孪生 | Three.js 轻量化场景 demo |
| 预警与维护计划 | `copilot/maintenance-plan` |
| 开放接口 | 保留原 contract 并新增 twin/copilot |

## 5. 当前仍然是 demo 的部分

- Three.js 场景是轻量化结构示意，不是正式 IFC 解析结果
- 历史数据仍为仿真数据，不是企业实测全量数据
- 大模型联合当前为 **离线多代理编排演示**，不是在线 LLM 服务
- 工单系统、权限、日志审计等企业级能力尚未接入
