"""Graph validation: order- and weight-aware DAG cycle breaking and transitive reduction."""

import logging
from typing import Any, Dict, List, Optional, Set, Tuple, Union

logger = logging.getLogger(__name__)


def _normalize_edge_entries(
    raw_entries: Any, default_weight: float = 0.80
) -> List[Dict[str, Any]]:
    """Converts mixed string or dict prerequisite entries into structured edge dicts."""
    if not isinstance(raw_entries, list):
        if isinstance(raw_entries, (str, dict)):
            raw_entries = [raw_entries]
        else:
            return []

    edges: List[Dict[str, Any]] = []
    seen = set()

    for item in raw_entries:
        p_name = ""
        weight = default_weight
        reason = ""

        if isinstance(item, dict):
            p_name = str(item.get("prerequisite") or item.get("topic") or "").strip()
            try:
                weight = float(item.get("weight", default_weight))
            except (ValueError, TypeError):
                weight = default_weight
            reason = str(item.get("reason", "")).strip()
        elif isinstance(item, str):
            p_name = item.strip()

        if not p_name or p_name in seen:
            continue

        seen.add(p_name)
        weight = min(1.0, max(0.0, weight))
        edges.append({
            "prerequisite": p_name,
            "weight": round(weight, 2),
            "reason": reason,
        })

    return edges


def break_cycles(
    graph: Dict[str, Any],
    first_seen_order: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """Detects and breaks directed cycles in the prerequisite graph using order and criticality weights.

    Score for edge (u -> v) where v is a prerequisite of u:
      edge_score = weight + (0.15 if first_seen_order[v] < first_seen_order[u] else -0.15)
    When a cycle is detected, the weakest edge (lowest edge_score) is removed.
    Repeats until the graph is a strict DAG.
    Supports both simple Dict[str, List[str]] and detailed Dict[str, List[Dict]].
    """
    if not graph:
        return {}

    is_simple_input = all(
        isinstance(v, list) and (len(v) == 0 or isinstance(v[0], str))
        for v in graph.values()
    )

    # Establish fallback order map if not provided
    order_map = dict(first_seen_order or {})
    for idx, topic in enumerate(graph.keys()):
        if topic not in order_map:
            order_map[topic] = idx

    # Standardize internal adj to Dict[str, List[Dict[str, Any]]]
    adj: Dict[str, List[Dict[str, Any]]] = {}
    for node, entries in graph.items():
        adj[node] = _normalize_edge_entries(entries)

    def find_directed_cycle() -> Optional[List[str]]:
        visited: Dict[str, int] = {}  # 0=unvisited, 1=visiting, 2=visited
        call_stack: List[str] = []

        def dfs(curr: str) -> Optional[List[str]]:
            visited[curr] = 1
            call_stack.append(curr)

            for edge in adj.get(curr, []):
                nbr = edge["prerequisite"]
                # Skip neighbors that are not in adj (external or leaf nodes)
                if nbr not in adj:
                    continue

                if visited.get(nbr, 0) == 1:
                    # Cycle detected: backtrack from nbr in call_stack
                    idx = call_stack.index(nbr)
                    return call_stack[idx:] + [nbr]

                if visited.get(nbr, 0) == 0:
                    res = dfs(nbr)
                    if res:
                        return res

            call_stack.pop()
            visited[curr] = 2
            return None

        for n in list(adj.keys()):
            if visited.get(n, 0) == 0:
                cycle = dfs(n)
                if cycle:
                    return cycle
        return None

    # Iteratively detect cycles and remove the lowest-scoring edge in each cycle
    while True:
        cycle_nodes = find_directed_cycle()
        if not cycle_nodes:
            break

        # Edges in cycle: (cycle_nodes[i] -> cycle_nodes[i+1])
        cycle_edges = [
            (cycle_nodes[i], cycle_nodes[i + 1])
            for i in range(len(cycle_nodes) - 1)
        ]

        scored_edges = []
        for src, dest in cycle_edges:
            # Locate edge record in adj[src]
            matching_edge = next(
                (e for e in adj.get(src, []) if e["prerequisite"] == dest), None
            )
            weight = matching_edge["weight"] if matching_edge else 0.80
            order_src = order_map.get(src, 999999)
            order_dest = order_map.get(dest, 999999)

            # Bonus if prerequisite appeared earlier in document; penalty if appeared later
            order_bonus = 0.15 if order_dest < order_src else -0.15
            edge_score = weight + order_bonus

            scored_edges.append({
                "src": src,
                "dest": dest,
                "score": edge_score,
                "weight": weight,
                "dest_order": order_dest,
            })

        # Find weakest edge: minimum score, tie-break by lowest weight, then latest dest appearance
        weakest = min(
            scored_edges,
            key=lambda x: (x["score"], x["weight"], -x["dest_order"]),
        )

        src_to_cut = weakest["src"]
        dest_to_cut = weakest["dest"]

        adj[src_to_cut] = [
            e for e in adj[src_to_cut] if e["prerequisite"] != dest_to_cut
        ]
        logger.info(
            "Cycle broken: cut weakest edge %s -> %s (score=%.2f, weight=%.2f)",
            src_to_cut,
            dest_to_cut,
            weakest["score"],
            weakest["weight"],
        )

    if is_simple_input:
        return {
            topic: [e["prerequisite"] for e in edges]
            for topic, edges in adj.items()
        }
    return adj


def remove_transitive_redundancies(
    graph: Dict[str, Any]
) -> Dict[str, Any]:
    """Removes transitive redundant direct prerequisite edges in the DAG.

    If topic T requires B, and B requires A (or any path length >= 2 from T to A),
    and T also directly lists A as a prerequisite, the direct shortcut edge (T -> A) is removed.
    Preserves edge metadata and works for both simple and weighted graphs.
    """
    if not graph:
        return {}

    is_simple_input = all(
        isinstance(v, list) and (len(v) == 0 or isinstance(v[0], str))
        for v in graph.values()
    )

    adj: Dict[str, List[Dict[str, Any]]] = {}
    for node, entries in graph.items():
        adj[node] = _normalize_edge_entries(entries)

    # Helper to find all indirect prerequisites of a topic reachable via length >= 1
    def get_all_reachable(start_node: str) -> Set[str]:
        reachable = set()
        queue = [e["prerequisite"] for e in adj.get(start_node, [])]
        while queue:
            curr = queue.pop(0)
            if curr not in reachable:
                reachable.add(curr)
                queue.extend(e["prerequisite"] for e in adj.get(curr, []))
        return reachable

    reduced: Dict[str, List[Dict[str, Any]]] = {}

    for topic, edge_list in adj.items():
        if len(edge_list) <= 1:
            reduced[topic] = list(edge_list)
            continue

        direct_prereqs = [e["prerequisite"] for e in edge_list]
        indirectly_reachable: Set[str] = set()

        for p in direct_prereqs:
            # Any node reachable from p is an indirect prerequisite of topic
            indirectly_reachable.update(get_all_reachable(p))

        # Filter out direct prerequisite edges that are already reached through an indirect path
        filtered_edges = [
            e for e in edge_list if e["prerequisite"] not in indirectly_reachable
        ]

        # In edge cases where all edges are marked indirect, preserve the single highest weight edge
        reduced[topic] = filtered_edges if filtered_edges else edge_list[:1]

    if is_simple_input:
        return {
            topic: [e["prerequisite"] for e in edges]
            for topic, edges in reduced.items()
        }
    return reduced


def validate_and_sanitize_graph(
    raw_graph: Dict[str, Any],
    known_topics: Union[List[str], List[Dict[str, Any]]],
    first_seen_order: Optional[Dict[str, int]] = None,
    return_details: bool = False,
) -> Union[Dict[str, List[str]], Dict[str, List[Dict[str, Any]]]]:
    """Enforces:

    1. All topics in the graph belong to known_topics.
    2. All prerequisites belong to known_topics.
    3. No self-dependencies (topic != prereq).
    4. No duplicate prerequisites per topic.
    5. Prerequisite count capped at 4.
    6. Cycle breaking via order- and weight-aware weakest edge elimination.
    7. Transitive redundancy reduction.
    8. Criticality ordering: prerequisites sorted in descending order of weight
       (and earlier first_seen_order as tie-breaker).
    """
    # 1. Build canonical topic lookup and order map from known_topics
    topic_lookup: Dict[str, str] = {}
    order_map: Dict[str, int] = dict(first_seen_order or {})

    for idx, item in enumerate(known_topics):
        if isinstance(item, dict):
            t_name = str(item.get("topic", "")).strip()
            t_order = int(item.get("first_seen_order", idx))
        else:
            t_name = str(item).strip()
            t_order = idx

        if t_name:
            topic_lookup[t_name.lower()] = t_name
            if t_name not in order_map:
                order_map[t_name] = t_order

    sanitized_detailed: Dict[str, List[Dict[str, Any]]] = {}
    for t_canonical in topic_lookup.values():
        sanitized_detailed[t_canonical] = []

    # 2. Ingest raw_graph edges
    for raw_topic, prereqs in raw_graph.items():
        topic_canonical = topic_lookup.get(str(raw_topic).strip().lower())
        if not topic_canonical:
            continue

        raw_edges = _normalize_edge_entries(prereqs)
        valid_edges: List[Dict[str, Any]] = []
        seen_dest = set()

        for edge in raw_edges:
            p_name = edge["prerequisite"]
            p_canonical = topic_lookup.get(p_name.lower())
            if (
                p_canonical
                and p_canonical != topic_canonical
                and p_canonical not in seen_dest
            ):
                seen_dest.add(p_canonical)
                valid_edges.append({
                    "prerequisite": p_canonical,
                    "weight": edge["weight"],
                    "reason": edge.get("reason", ""),
                })

        # Cap at 4
        sanitized_detailed[topic_canonical] = valid_edges[:4]

    # 3. Order- and weight-aware cycle breaking
    acyclic_graph = break_cycles(sanitized_detailed, first_seen_order=order_map)

    # 4. Transitive redundancy elimination
    reduced_graph = remove_transitive_redundancies(acyclic_graph)

    # 5. Criticality ordering: sort by weight descending, then earliest first_seen_order
    final_detailed: Dict[str, List[Dict[str, Any]]] = {}
    final_simple: Dict[str, List[str]] = {}

    for topic, edge_list in reduced_graph.items():
        # Sort edges
        sorted_edges = sorted(
            edge_list,
            key=lambda e: (-float(e.get("weight", 0.80)), order_map.get(e["prerequisite"], 999999)),
        )
        final_detailed[topic] = sorted_edges
        final_simple[topic] = [e["prerequisite"] for e in sorted_edges]

    if return_details:
        return final_detailed
    return final_simple


def validate_and_sanitize_graph_with_details(
    raw_graph: Dict[str, Any],
    known_topics: Union[List[str], List[Dict[str, Any]]],
    first_seen_order: Optional[Dict[str, int]] = None,
) -> Tuple[Dict[str, List[str]], Dict[str, List[Dict[str, Any]]]]:
    """Convenience helper returning both simple (List[str]) and detailed (List[Dict]) sanitized graphs."""
    detailed = validate_and_sanitize_graph(
        raw_graph=raw_graph,
        known_topics=known_topics,
        first_seen_order=first_seen_order,
        return_details=True,
    )
    simple = {
        topic: [e["prerequisite"] for e in edges]
        for topic, edges in detailed.items()
    }
    return simple, detailed
