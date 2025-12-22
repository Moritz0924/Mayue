import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Point } from '../api/client'

declare global {
  interface Window {
    echarts?: any
  }
}

const ECHARTS_CDN = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js'

type LineChartProps = {
  series: Point[]
  riskLabel?: string
  score?: number | null
}

async function loadEchartsScript(): Promise<any> {
  if (window.echarts) {
    return window.echarts
  }

  const existing = document.querySelector(`script[src="${ECHARTS_CDN}"]`)
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.echarts))
      existing.addEventListener('error', () => reject(new Error('echarts load error')))
    })
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = ECHARTS_CDN
    script.async = true
    script.onload = () => resolve(window.echarts)
    script.onerror = () => reject(new Error('echarts load error'))
    document.body.appendChild(script)
  })
}

export default function LineChart({ series, riskLabel, score }: LineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const [loadError, setLoadError] = useState<string>('')

  const titleText = useMemo(() => {
    if (!riskLabel) return '风险：-'
    if (score == null) return `风险：${riskLabel}`
    return `风险：${riskLabel} ｜ score=${score.toFixed(4)}`
  }, [riskLabel, score])

  useEffect(() => {
    let disposed = false

    loadEchartsScript()
      .then((echartsLib) => {
        if (disposed || !containerRef.current) return
        chartRef.current = echartsLib.init(containerRef.current)
        chartRef.current.setOption({ title: { text: titleText } })
      })
      .catch(() => {
        if (!disposed) setLoadError('无法加载 ECharts（网络受限？）')
      })

    return () => {
      disposed = true
      if (chartRef.current) {
        chartRef.current.dispose()
        chartRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || loadError) return
    const data = series.map((p) => [p.t * 1000, p.v])
    chartRef.current.setOption({
      title: { text: titleText, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => String(value) },
      grid: { left: 40, right: 20, top: 40, bottom: 40 },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', scale: true },
      series: [
        {
          name: 'v',
          type: 'line',
          showSymbol: false,
          data,
          lineStyle: { width: 2 },
        },
      ],
    })
  }, [series, loadError, titleText])

  if (loadError) {
    return <div style={{ color: '#b91c1c', padding: 12, background: '#fef2f2' }}>{loadError}</div>
  }

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
