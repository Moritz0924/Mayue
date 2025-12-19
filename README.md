# Mayue（马跃）数字孪生形变监测软件

本仓库为“基于数字孪生的建筑结构后期形变监测系统”的 **software-only** 实现骨架：
- **tools/model_processor（C++）**：模型轻量化与元素映射输出（MVP：占位版）
- **algo（Python）**：算法模块（MVP：baseline，占位→可替换LSTM/异常识别）
- **backend（Python/FastAPI）**：API + WebSocket（MVP：模拟数据）
- **frontend（TS/React/Vite）**：前端可视化骨架（MVP：拉取数据并展示）

## 快速开始

### 后端
```bash
cd backend
python -m venv .venv
# mac/linux
source .venv/bin/activate
# windows
# .venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload --port 8000
```
打开： http://localhost:8000/docs

### 前端
```bash
cd frontend
npm i
npm run dev
```

### C++ 模型处理工具（占位版）
```bash
cd tools/model_processor
cmake -S . -B build
cmake --build build
./build/model_processor <input.glb> <output_dir>
```

## 文档
- `docs/architecture.md`：架构与模块边界
- `docs/data-contracts.md`：模型/构件ID/时间序列契约
