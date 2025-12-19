# 项目架构（software-only）

目标：快速交付“可跑可演示”的数字孪生形变监测软件系统（先仿真数据，后续可接真实数据/模型）。

## 分层与职责

1) 模型处理层（tools/model_processor, C++）
- 输入：原始模型（glb/obj/ifc…）
- 输出：轻量化模型 building_lite.glb + 映射表 building_lite.map.json
- 备注：MVP 先原样拷贝 + 生成假的 map.json，后续再接 QEM/裁剪/解析。

2) 算法分析层（algo, Python）
- 输入：时间序列 + 参数
- 输出：风险等级/预测值
- MVP：baseline 规则占位；后续可替换为 LSTM 或异常识别。

3) 业务服务层（backend, Python/FastAPI）
- 提供 REST API：模型/构件列表、时间序列查询、分析调用
- 提供 WebSocket：推送实时数据（MVP：模拟）

4) 应用展示层（frontend, TS/React）
- 模型加载与交互（MVP：先只做列表+图表；后续接 Three.js 模型点击联动）
- 图表展示：时间序列与风险结果

## 推荐接口（MVP 已实现）
- GET  /api/models
- GET  /api/models/{model_id}/elements
- GET  /api/elements/{element_id}/timeseries?metric=disp&n=120
- POST /api/elements/{element_id}/analyze
- WS   /ws/live
