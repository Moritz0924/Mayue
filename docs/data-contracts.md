# 数据契约（MVP）

## 1) 模型映射文件 building_lite.map.json
```json
{
  "model_id": "demo_001",
  "elements": [
    { "element_id": "E1001", "name": "Column-1F-A" },
    { "element_id": "E1002", "name": "Beam-1F-01" }
  ]
}
```

## 2) 时间序列接口返回
```json
{
  "element_id": "E1001",
  "metric": "disp",
  "series": [
    { "t": 1700000000, "v": 0.12 },
    { "t": 1700000001, "v": 0.11 }
  ]
}
```

## 3) 分析接口返回
```json
{
  "element_id": "E1001",
  "metric": "disp",
  "risk": "LOW|MEDIUM|HIGH",
  "note": "baseline"
}
```
