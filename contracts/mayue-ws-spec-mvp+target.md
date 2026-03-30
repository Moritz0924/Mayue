# Mayue WebSocket Spec (MVP + Target)

## MVP (兼容前端，不改客户端)
### WS /ws/live
- 服务器主动推送（默认广播）
- 消息格式（legacy，时间戳为秒）：
```json
{ "element_id":"E1001", "metric":"disp", "t":1700000000, "v":1.23 }
```

## Target (可选升级：订阅机制 + 统一 envelope)
### WS /ws/stream
客户端连接后可发送订阅请求：
```json
{ "op":"subscribe", "topics":["telemetry.live","alerts"], "filter":{"element_id":["E1001"]} }
```

服务端推送：
```json
{ "topic":"telemetry.live", "data":{...}, "server_ts_ms":1700000000456 }
```

建议 topics：
- telemetry.live
- alerts
