/**
 * datasets.js
 * Registry of built-in datasets served alongside the demo.
 * Paths are relative to the demo/ directory.
 */

export const DATASETS = [
  {
    id:     'les_miserables',
    label:  'Les Misérables',
    nodes:  '../inputs/les_miserables/nodes.txt',
    edges:  '../inputs/les_miserables/edges.txt',
    nNodes: 77,
    nEdges: 254,
  },
  {
    id:     'neurons_1',
    label:  'Neurons 1',
    nodes:  '../inputs/neurons_1/nodes.txt',
    edges:  '../inputs/neurons_1/edges.txt',
    nNodes: 17,
    nEdges: 240,
  },
  {
    id:     'neurons_8',
    label:  'Neurons 8',
    nodes:  '../inputs/neurons_8/nodes.txt',
    edges:  '../inputs/neurons_8/edges.txt',
    nNodes: 39,
    nEdges: 1128,
  },
  {
    id:     'neurons_2',
    label:  'Neurons 2',
    nodes:  '../inputs/neurons_2/nodes.txt',
    edges:  '../inputs/neurons_2/edges.txt',
    nNodes: 47,
    nEdges: 1790,
  },
  {
    id:     'celegans',
    label:  'C. elegans',
    nodes:  '../inputs/celegans_dataset/nodes.txt',
    edges:  '../inputs/celegans_dataset/edges.txt',
    nNodes: 306,
    nEdges: 2148,
  },
  {
    id:     'us_airlines',
    label:  'US Airlines',
    nodes:  '../inputs/us_airlines/us_airlines_nodes.txt',
    edges:  '../inputs/us_airlines/us_airlines_edges.txt',
    nNodes: 235,
    nEdges: 2101,
  },
  {
    id:     'jazz',
    label:  'Jazz',
    nodes:  '../inputs/jazz/jazz_nodes.txt',
    edges:  '../inputs/jazz/jazz_edges.txt',
    nNodes: 198,
    nEdges: 2742,
  },
  {
    id:     'eurosys',
    label:  'EuroSiS',
    nodes:  '../inputs/EuroSiS_generale_dataset/euroSiS_nodes.txt',
    edges:  '../inputs/EuroSiS_generale_dataset/euroSiS_edges.txt',
    nNodes: 1285,
    nEdges: 7586,
  },
  {
    id:     'ieee_scivis',
    label:  'IEEE SciVis 2023',
    nodes:  '../inputs/IEEE_SciVis_Contest_2023/nodes_sampled.txt',
    edges:  '../inputs/IEEE_SciVis_Contest_2023/edges_sampled.txt',
    nNodes: 5000,
    nEdges: 7222,
  },
{
    id:     'us_migration',
    label:  'US Migration',
    nodes:  '../inputs/us_migration/us_migration_nodes.txt',
    edges:  '../inputs/us_migration/us_migration_edges.txt',
    nNodes: 6517,
    nEdges: 9780,
  },
  {
    id:     'email_eu_core',
    label:  'Email EU Core',
    nodes:  '../inputs/email_eu_core/email_eu_core_nodes.txt',
    edges:  '../inputs/email_eu_core/email_eu_core_edges.txt',
    nNodes: 1005,
    nEdges: 25571,
  },
  // sentinel: always last
  { id: 'custom', label: 'Custom…', nodes: null, edges: null, nNodes: null, nEdges: null },
];

/**
 * Returns { label, cls } compute-effort tier based on edge count.
 * Fast     ≤ 500   edges
 * Moderate ≤ 3000  edges
 * Slow     > 3000  edges
 */
export function complexity(nEdges) {
  if (nEdges == null) return null;
  if (nEdges <= 500)  return { label: 'Fast',     cls: 'badge-small'  };
  if (nEdges <= 3000) return { label: 'Moderate', cls: 'badge-medium' };
  return                     { label: 'Slow',     cls: 'badge-large'  };
}
