# Mayue 大模型选型与部署结论

## 1. 项目约束

根据项目申报书，Mayue 不是一个普通对话系统，而是一个“数字孪生 + 预测模型 + 运维维护计划”的决策系统。它对大模型的要求是：

1. **中文能力要强**：维护计划、工单建议、异常解释都要稳定输出中文。
2. **工具调用稳定**：必须能读取位移预测、振动评估、历史工单、当前状态，再做融合决策。
3. **结构化输出可靠**：后端需要 JSON，而不是长篇自由文本。
4. **本地部署可行**：学生项目 demo 优先考虑可控成本、可离线演示、无需长期依赖外部 API Key。
5. **可继续升级**：后续若实验室 GPU 更强，或要切到云端，不能推翻现有后端接口。

## 2. 候选模型判断

### 2.1 GPT-5 / GPT-5 mini

优点：
- 工具调用、结构化输出、复杂指令遵循能力很强。
- 云端 API 成熟，适合正式生产环境。

缺点：
- 需要外部 API 和持续成本。
- 对学生项目 demo 来说，可控性和离线能力不如本地模型。

结论：**适合作为云端增强方案，不适合作为当前 demo 的首选默认部署。**

### 2.2 DeepSeek-V3 / R1 系列

优点：
- 中文推理能力强。
- 适合复杂分析任务。

缺点：
- 满血版部署资源消耗大。
- 工具调用和低门槛本地 demo 落地，综合性不如 Qwen3 30B 方案轻便。

结论：**适合作为高算力实验室方案，不适合作为当前最稳的默认部署。**

### 2.3 Qwen3-30B-A3B-Instruct-2507 / Ollama `qwen3:30b`

优点：
- 中文、多语言、工具调用能力强。
- 30.5B 总参数，但只有 3.3B 激活参数，推理成本明显低于同级 dense 大模型。
- 原生长上下文，适合后续接项目文档、巡检记录、BIM 元数据。
- 同时支持 **Ollama 本地快速部署** 和 **vLLM OpenAI-compatible 服务化部署**。

缺点：
- 绝对上限不如顶级闭源旗舰模型。
- 本地机器仍需要一定内存/显存条件。

结论：**这是当前 Mayue demo 的最佳平衡点，也是默认部署方案。**

## 3. 最终部署策略

### 默认部署

- **模型**：`qwen3:30b`
- **运行方式**：Ollama
- **后端模式**：`MAYUE_LLM_MODE=ollama`

### 更强部署（可选）

- **模型**：`Qwen/Qwen3-30B-A3B-Instruct-2507`
- **运行方式**：vLLM / SGLang
- **后端模式**：`MAYUE_LLM_MODE=openai-compatible`

### 云端增强（可选）

- 将 `MAYUE_LLM_MODE=openai-compatible`
- `MAYUE_LLM_BASE_URL` 指向云端兼容接口
- `MAYUE_LLM_MODEL` 切换到云端可用模型

## 4. 代码里已经做的部署改造

1. 新增 `backend/src/services/llmRuntime.ts`
   - 统一封装 Ollama / OpenAI-compatible 两种模式。
2. 改造 `backend/src/services/copilot.ts`
   - 从“纯规则多代理”升级为“**LLM 工具调用 + 算法兜底**”。
3. 新增 `/api/copilot/status`
   - 可直接查看当前 LLM provider、model、base_url、max_tool_rounds 等状态。
4. 风险控制规则
   - 最终风险等级不会低于 LSTM + 1D-CNN + 规则融合结果，避免大模型把风险说低。

## 5. 推荐部署步骤

### 方案 A：Ollama 本地部署

```bash
docker compose up -d ollama
bash scripts/llm/pull_qwen3.sh
cd backend
cp .env.example .env
npm run build
node dist/index.js
```

### 方案 B：vLLM 服务化部署

参考 `deploy/docker-compose.vllm.example.yml`，启动后设置：

```bash
MAYUE_LLM_MODE=openai-compatible
MAYUE_LLM_BASE_URL=http://127.0.0.1:8001/v1
MAYUE_LLM_MODEL=Qwen/Qwen3-30B-A3B-Instruct-2507
```

## 6. 接口验证

```bash
curl -s http://localhost:8000/api/copilot/status
curl -s -X POST http://localhost:8000/api/copilot/maintenance-plan \
  -H "Content-Type: application/json" \
  -d '{"element_id":"E1008","horizon_sec":20}'
```

如果 LLM 服务不可用，系统会自动退回规则引擎，但接口仍然返回完整维护计划，便于 demo 演示不断链。
