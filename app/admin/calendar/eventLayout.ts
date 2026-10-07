/** Visual intervals are in minutes from the column's midnight. */
export interface LayoutEvent { id: string; start: number; end: number }
export interface EventLane { lane: number; lanes: number; start: number; end: number }

/** Stable interval partitioning; minimum visual height participates in collisions. */
export function assignEventLanes(events: LayoutEvent[], minimumMinutes = 15): Map<string, EventLane> {
  const sorted = events.filter(event => Number.isFinite(event.start) && Number.isFinite(event.end) && event.end > event.start)
    .map(event => ({ ...event, end: Math.max(event.end, event.start + minimumMinutes) }))
    .sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id))
  const result = new Map<string, EventLane>()
  let cluster: Array<LayoutEvent & { lane: number }> = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    for (const event of cluster) result.set(event.id, { lane: event.lane, lanes: laneEnds.length, start: event.start, end: event.end })
    cluster = []; laneEnds = []; clusterEnd = -Infinity
  }
  for (const event of sorted) {
    if (event.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex(end => end <= event.start)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = event.end
    cluster.push({ ...event, lane })
    clusterEnd = Math.max(clusterEnd, event.end)
  }
  flush()
  return result
}
