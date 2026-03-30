# Mayue Figma 规范包（展厅版）

## 1. 页面框架（Frame）

- 主屏：`1920 x 1080`，命名 `Mayue Exhibition / Main 1920`
- 兼容屏：`1600 x 900`，命名 `Mayue Exhibition / Main 1600`
- 移动检视：`390 x 844`，命名 `Mayue Exhibition / Mobile Preview`

布局建议：

1. 顶部信息带（品牌 + KPI）
2. 中央双列核心区（左：数字孪生，右：双模型诊断）
3. 底部双区（创新链路 + 运维决策）

## 2. 设计 Token

### Color

- `bg/top`: `#F2F7FF`
- `bg/bottom`: `#EDF2F8`
- `panel/base`: `rgba(255,255,255,0.84)`
- `line/default`: `rgba(38,68,112,0.12)`
- `text/primary`: `#142742`
- `text/secondary`: `#4F6486`
- `risk/low`: `#17A1A1`
- `risk/medium`: `#FF8C3A`
- `risk/high`: `#E04C4A`
- `accent/blue`: `#2B7CFF`

### Typography

- 标题（H1）：`Bahnschrift / 30-34 / SemiBold`
- 分区标题（H2）：`Bahnschrift / 20-22 / SemiBold`
- 说明正文：`Aptos / 14-15 / Regular`
- 数值（KPI）：`Bahnschrift / 24-28 / Bold`
- 标签小字：`Aptos / 12 / Medium`

### Spacing & Radius

- 主间距：`8 / 12 / 16 / 20 / 24`
- 卡片圆角：`14 / 18 / 26`
- 主要阴影：`0 18 38 rgba(22,43,77,0.12)`

## 3. 组件库（Components）

- `Top / BrandHeader`
- `Card / KPI`
- `Twin / StageFrame`
- `Twin / ElementTab`
- `Model / DiagnosisCard`
- `Model / TrendChartCard`
- `Decision / ActionItem`
- `Decision / EvidenceItem`
- `Flow / InnovationStep`
- `Alert / AlertChip`
- `Tag / RiskPill`

状态变体：

- `RiskPill`: `low / medium / high`
- `ElementTab`: `default / selected / hover`
- `InnovationStep`: `done / active / idle`
- `AlertChip`: `low / medium / high`

## 4. 原型连线说明

核心交互链路：

1. 点击 `Twin / ElementTab` 或 3D 构件
2. 更新 `Twin / StageFrame` 聚焦信息
3. 同步刷新 `Model / DiagnosisCard`（LSTM + CNN）
4. 更新 `Decision / ActionItem`（Copilot 建议）
5. 更新 `Flow / InnovationStep` 当前活跃状态

原型注释建议：

- “3D 构件点击后，风险标签与维护建议必须同帧更新”
- “高风险时，`RiskPill` 强制切换至 high 状态色”
- “接口异常时，显示 fallback 数据，不出现空态白屏”

## 5. 数据映射（与现有 API 对应）

- 孪生场景：`GET /api/twin/scene`
- 构件详情：`GET /api/twin/elements/:id`
- 位移预测：`POST /api/predict/displacement`
- 振动评估：`POST /api/evaluate/vibration`
- 告警：`GET /api/alerts/recent`
- 运维建议：`POST /api/copilot/maintenance-plan`
- Copilot 状态：`GET /api/copilot/status`

## 6. 交付检查清单

- 1920 主屏视觉完整无裁切
- 1600 下核心信息仍在首屏
- 高风险颜色在浅色背景中可一眼识别
- 组件均有状态变体与命名规范
- 原型链路可完整演示“感知 -> 双模型 -> 决策闭环”

