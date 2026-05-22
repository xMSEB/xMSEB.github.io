import random
from collections import defaultdict

def parse_positions_with_area(file_path):
    node_positions = {}
    area_groups = defaultdict(list)
    with open(file_path, 'r') as f:
        for line in f:
            if line.strip().startswith('#') or not line.strip():
                continue
            parts = line.strip().split()
            node_id = int(parts[0])
            x, y, z = map(float, parts[1:4])
            area = parts[4]
            node_positions[node_id] = (x, y, z, area)
            area_groups[area].append(node_id)
    return node_positions, area_groups

def parse_edges(file_path):
    edges = []
    with open(file_path, 'r') as f:
        for line in f:
            if line.strip().startswith('#') or not line.strip():
                continue
            parts = line.strip().split()
            target_id = int(parts[1]) - 1
            source_id = int(parts[3]) - 1
            weight = float(parts[4])
            edges.append((source_id, target_id, weight))
    return edges

def stratified_sample_nodes(area_groups, sample_ratio=0.1, min_per_group=5):
    sampled_nodes = set()
    for area, nodes in area_groups.items():
        k = max(min_per_group, int(len(nodes) * sample_ratio))
        sampled = random.sample(nodes, min(k, len(nodes)))
        sampled_nodes.update(sampled)
    return sampled_nodes

def remap_node_ids(sampled_nodes):
    """Create a mapping from old node_id to new contiguous ids starting from 0."""
    return {old_id: new_id for new_id, old_id in enumerate(sorted(sampled_nodes))}

def write_nodes_txt(node_positions, sampled_nodes, node_id_map, output_path="nodes.txt"):
    with open(output_path, 'w') as f:
        for old_id in sorted(sampled_nodes):
            new_id = node_id_map[old_id]
            x, y, z, _ = node_positions[old_id]
            f.write(f"{x:.6f} {y:.6f} {z:.6f}\n")

def write_edges_txt(edges, sampled_nodes, node_id_map, output_path="edges.txt"):
    with open(output_path, 'w') as f:
        for source, target, weight in edges:
            if source in sampled_nodes and target in sampled_nodes:
                new_source = node_id_map[source]
                new_target = node_id_map[target]
                f.write(f"{new_source} {new_target} {weight}\n")

# --- Main Usage ---

positions_file = "rank_0_positions.txt"
edges_file = "rank_0_step_1000000_out_network.txt"
sample_ratio = 0.1  # 10% per area


# Load and sample data
node_positions, area_groups = parse_positions_with_area(positions_file)
edges = parse_edges(edges_file)
sampled_nodes = stratified_sample_nodes(area_groups, sample_ratio=sample_ratio)
node_id_map = remap_node_ids(sampled_nodes)


# Write re-indexed output
write_nodes_txt(node_positions, sampled_nodes, node_id_map, "nodes_sampled.txt")
write_edges_txt(edges, sampled_nodes, node_id_map, "edges_sampled.txt")
