export type Model = { model_id: string; name: string }
export type ElementItem = { element_id: string; name: string }
export type Point = { t: number; v: number }
export type SeriesResp = { element_id: string; metric: string; series: Point[] }
export type AnalyzeResp = { element_id: string; metric: string; risk: 'LOW'|'MEDIUM'|'HIGH'; score: number; note: string }

export async function getModels(): Promise<Model[]> {
  const r = await fetch('/api/models')
  return r.json()
}

export async function getElements(modelId: string): Promise<ElementItem[]> {
  const r = await fetch(`/api/models/${modelId}/elements`)
  return r.json()
}

export async function getTimeseries(elementId: string, metric='disp', n=120): Promise<SeriesResp> {
  const r = await fetch(`/api/elements/${elementId}/timeseries?metric=${metric}&n=${n}`)
  return r.json()
}

export async function analyze(elementId: string, metric='disp'): Promise<AnalyzeResp> {
  const r = await fetch(`/api/elements/${elementId}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metric, horizon: 60 })
  })
  return r.json()
}
