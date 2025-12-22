import React, { useEffect, useMemo, useState } from 'react'
import { analyze, getElements, getModels, getTimeseries, ElementItem, Point } from './api/client'
import LineChart from './components/LineChart'

export default function App() {
  const [modelId, setModelId] = useState<string>('demo_001')
  const [elements, setElements] = useState<ElementItem[]>([])
  const [selected, setSelected] = useState<string>('E1001')
  const [series, setSeries] = useState<Point[]>([])
  const [analysis, setAnalysis] = useState<{ risk: string; note: string; score: number | null }>({
    risk: '',
    note: '',
    score: null
  })
  const [liveValues, setLiveValues] = useState<Record<string, { t: number; v: number }>>({})

  useEffect(() => {
    getModels().then(ms => {
      const m = ms[0]?.model_id ?? 'demo_001'
      setModelId(m)
      return getElements(m)
    }).then(setElements)
  }, [])

  useEffect(() => {
    getTimeseries(selected).then(r => setSeries(r.series))
    setAnalysis({ risk: '', note: '', score: null })
  }, [selected])

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/live`)

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data)
        if (!msg.element_id) return
        setLiveValues(prev => ({ ...prev, [msg.element_id]: { t: msg.t, v: msg.v } }))
      } catch (e) {
        console.error('ws parse error', e)
      }
    }

    return () => {
      ws.close()
    }
  }, [])

  async function runAnalyze() {
    const r = await analyze(selected)
    setAnalysis({ risk: r.risk, note: r.note, score: r.score ?? null })
  }

  const riskLabel = useMemo(() => {
    if (!analysis.risk) return ''
    if (analysis.score == null) return `${analysis.risk} (${analysis.note})`
    return `${analysis.risk} (${analysis.note}, score=${analysis.score.toFixed(4)})`
  }, [analysis])

  const liveValue = liveValues[selected]

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
          <div style={{ marginTop: 8, fontSize: 13 }}>风险：<b>{riskLabel || '-'}</b></div>
        </div>

        <div style={{ flex: 1, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>时间序列</h3>
              <div style={{ fontSize: 12, color: '#666' }}>element_id: {selected} ｜ metric: disp</div>
            </div>
            <div style={{ padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>实时当前值</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                {liveValue ? liveValue.v.toFixed(3) : '-'}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>
                {liveValue ? new Date(liveValue.t * 1000).toLocaleTimeString() : '等待推送...'}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 10, fontSize: 13, color: '#374151' }}>
            风险结果：<b>{riskLabel || '未计算'}</b>
          </div>

          <div style={{ height: 360, background: '#fafafa', borderRadius: 8, padding: 4 }}>
            <LineChart series={series} riskLabel={analysis.risk ? `${analysis.risk} (${analysis.note})` : undefined} score={analysis.score} />
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: '#555' }}>
            <div>数据点：{series.length}</div>
            <div>最新值：{series.length ? series[series.length - 1].v.toFixed(4) : '-'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
