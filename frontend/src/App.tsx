import React, { useEffect, useState } from 'react'
import { analyze, getElements, getModels, getTimeseries, ElementItem, Point } from './api/client'

export default function App() {
  const [modelId, setModelId] = useState<string>('demo_001')
  const [elements, setElements] = useState<ElementItem[]>([])
  const [selected, setSelected] = useState<string>('E1001')
  const [series, setSeries] = useState<Point[]>([])
  const [risk, setRisk] = useState<string>('')

  useEffect(() => {
    getModels().then(ms => {
      const m = ms[0]?.model_id ?? 'demo_001'
      setModelId(m)
      return getElements(m)
    }).then(setElements)
  }, [])

  useEffect(() => {
    getTimeseries(selected).then(r => setSeries(r.series))
    setRisk('')
  }, [selected])

  async function runAnalyze() {
    const r = await analyze(selected)
    setRisk(`${r.risk} (${r.note})`)
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 960, margin: '0 auto' }}>
      <h1>Mayue MVP</h1>
      <p>后端：FastAPI（/api, /ws） | 前端：Vite+React（MVP：列表+时间序列+风险）</p>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ width: 280, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <h3>构件列表</h3>
          <div style={{ fontSize: 12, color: '#666' }}>model_id: {modelId}</div>
          <ul style={{ paddingLeft: 16 }}>
            {elements.map(e => (
              <li key={e.element_id}>
                <button
                  onClick={() => setSelected(e.element_id)}
                  style={{
                    background: e.element_id === selected ? '#eee' : 'transparent',
                    border: '1px solid #ccc',
                    borderRadius: 6,
                    padding: '4px 8px',
                    cursor: 'pointer'
                  }}
                >
                  {e.name} ({e.element_id})
                </button>
              </li>
            ))}
          </ul>
          <button onClick={runAnalyze} style={{ marginTop: 8, padding: '6px 10px' }}>分析（baseline）</button>
          <div style={{ marginTop: 8 }}>风险：<b>{risk || '-'}</b></div>
        </div>

        <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <h3>时间序列（示意）</h3>
          <div style={{ height: 320, overflow: 'auto', background: '#fafafa', borderRadius: 8, padding: 8 }}>
            {series.map((p, idx) => (
              <div key={idx} style={{ fontFamily: 'ui-monospace', fontSize: 12 }}>
                t={p.t}  v={p.v.toFixed(4)}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
            下一步：接入 ECharts 折线图 + Three.js 模型点击联动。
          </div>
        </div>
      </div>
    </div>
  )
}
