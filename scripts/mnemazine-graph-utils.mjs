import { promises as fs } from 'node:fs'

const VALID_FILE_TYPES = new Set(['code', 'concept', 'document', 'image', 'paper', 'rationale'])
const EDGE_KEY_FIELDS = ['source', 'target', 'relation', 'type', 'label', 'source_file']

export async function readGraph(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

export async function writeGraph(file, graph) {
  await fs.writeFile(file, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
}

export function normalizeNodeId(id) {
  let value = String(id || '')
  while (/^[^:]+::/.test(value)) value = value.replace(/^[^:]+::/, '')
  return value
}

export function normalizeFileType(value) {
  const raw = String(value || '').trim()
  return VALID_FILE_TYPES.has(raw) ? raw : 'concept'
}

function isBlank(value) {
  return value === undefined || value === null || value === ''
}

function mergeNode(existing, incoming) {
  const out = { ...existing }
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'id') continue
    if (isBlank(out[key]) && !isBlank(value)) out[key] = value
  }
  out.file_type = normalizeFileType(out.file_type)
  return out
}

function edgeArrayKey(graph) {
  if (Array.isArray(graph.links)) return 'links'
  if (Array.isArray(graph.edges)) return 'edges'
  return 'links'
}

function normalizeEndpoint(value, idMap) {
  const raw = String(value || '')
  return idMap.get(raw) || normalizeNodeId(raw)
}

function normalizeEdge(edge, idMap) {
  const out = { ...edge }
  if ('source' in out) out.source = normalizeEndpoint(out.source, idMap)
  if ('target' in out) out.target = normalizeEndpoint(out.target, idMap)
  if (Array.isArray(out.nodes)) out.nodes = out.nodes.map(id => normalizeEndpoint(id, idMap))
  return out
}

function edgeKey(edge) {
  const fields = EDGE_KEY_FIELDS.map(field => edge[field] ?? '').join('\u0000')
  const nodes = Array.isArray(edge.nodes) ? edge.nodes.join('\u0000') : ''
  return `${fields}\u0000${nodes}`
}

export function normalizeGraphObject(graph) {
  const sourceNodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const sourceEdgeKey = edgeArrayKey(graph)
  const sourceEdges = Array.isArray(graph[sourceEdgeKey]) ? graph[sourceEdgeKey] : []
  const idMap = new Map()
  const nodesById = new Map()
  const edgesByKey = new Map()
  const stats = {
    stripped_namespaces: 0,
    normalized_file_types: 0,
    merged_duplicate_nodes: 0,
    dropped_duplicate_edges: 0
  }

  for (const node of sourceNodes) {
    const originalId = String(node.id || '')
    const normalizedId = normalizeNodeId(originalId)
    if (normalizedId !== originalId) stats.stripped_namespaces += 1
    idMap.set(originalId, normalizedId)
    const fileType = normalizeFileType(node.file_type)
    if (node.file_type && fileType !== node.file_type) stats.normalized_file_types += 1
    const normalizedNode = { ...node, id: normalizedId, file_type: fileType }
    if (nodesById.has(normalizedId)) {
      stats.merged_duplicate_nodes += 1
      nodesById.set(normalizedId, mergeNode(nodesById.get(normalizedId), normalizedNode))
    } else {
      nodesById.set(normalizedId, normalizedNode)
    }
  }

  for (const edge of sourceEdges) {
    const normalizedEdge = normalizeEdge(edge, idMap)
    const key = edgeKey(normalizedEdge)
    if (edgesByKey.has(key)) {
      stats.dropped_duplicate_edges += 1
      continue
    }
    edgesByKey.set(key, normalizedEdge)
  }

  const normalized = {
    ...graph,
    nodes: [...nodesById.values()],
    [sourceEdgeKey]: [...edgesByKey.values()]
  }
  if (sourceEdgeKey === 'links') delete normalized.edges
  if (sourceEdgeKey === 'edges') delete normalized.links
  return { graph: normalized, stats, edgeKey: sourceEdgeKey }
}

export function mergeGraphObjects(baseGraph, incomingGraph) {
  const base = normalizeGraphObject(baseGraph)
  const incoming = normalizeGraphObject(incomingGraph)
  const outputEdgeKey = base.edgeKey || 'links'
  const nodesById = new Map()
  const edgesByKey = new Map()
  const stats = {
    base: base.stats,
    incoming: incoming.stats,
    merged_duplicate_nodes: 0,
    dropped_duplicate_edges: 0
  }

  for (const node of base.graph.nodes || []) nodesById.set(node.id, node)
  for (const node of incoming.graph.nodes || []) {
    if (nodesById.has(node.id)) {
      stats.merged_duplicate_nodes += 1
      nodesById.set(node.id, mergeNode(nodesById.get(node.id), node))
    } else {
      nodesById.set(node.id, node)
    }
  }

  for (const edge of base.graph[base.edgeKey] || []) edgesByKey.set(edgeKey(edge), edge)
  for (const edge of incoming.graph[incoming.edgeKey] || []) {
    const key = edgeKey(edge)
    if (edgesByKey.has(key)) {
      stats.dropped_duplicate_edges += 1
      continue
    }
    edgesByKey.set(key, edge)
  }

  const graph = {
    ...base.graph,
    nodes: [...nodesById.values()],
    [outputEdgeKey]: [...edgesByKey.values()]
  }
  if (outputEdgeKey === 'links') delete graph.edges
  if (outputEdgeKey === 'edges') delete graph.links
  return { graph, stats }
}

export function graphStats(graph) {
  const edges = Array.isArray(graph.links) ? graph.links : Array.isArray(graph.edges) ? graph.edges : []
  const prefixes = new Map()
  let badFileTypes = 0
  for (const node of graph.nodes || []) {
    const id = String(node.id || '')
    const prefix = id.match(/^([^:]+)::/)?.[1]
    if (prefix) prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1)
    if (node.file_type && !VALID_FILE_TYPES.has(node.file_type)) badFileTypes += 1
  }
  return {
    nodes: Array.isArray(graph.nodes) ? graph.nodes.length : 0,
    edges: edges.length,
    prefixes: [...prefixes.entries()].sort((a, b) => b[1] - a[1]),
    bad_file_types: badFileTypes
  }
}
