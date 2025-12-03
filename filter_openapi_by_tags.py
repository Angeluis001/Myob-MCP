import json
import re
import argparse
from pathlib import Path
from typing import Any, Dict, Set, List, Callable

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "REDBACK_TEST_API.json"
DST = ROOT / "REDBACK_TEST_API_short.json"

# Tags requested by the user (case-insensitive). Some are category-like and should match prefixes.
REQUESTED_TAGS_RAW = [
    "StockItem",
]

# Normalize and build matching strategy
SYNONYMS: Dict[str, Set[str]] = {
    # allow warehouse to also include ItemWarehouse
    "warehouse": {"warehouse", "itemwarehouse"},
    # handle misspelling
    "oportunity": {"opportunity"},
}

def _flatten_args(values: List[str] | None) -> List[str]:
    if not values:
        return []
    out: List[str] = []
    for v in values:
        if v is None:
            continue
        parts = [p.strip() for p in v.split(",") if p.strip()]
        out.extend(parts)
    return out


def build_tag_sets(raw_tags: List[str]) -> tuple[Set[str], Set[str]]:
    """Build sets for exact and prefix tag matching.

    Rules:
    - Exact match by default (case-insensitive).
    - To explicitly request prefix matching, append a trailing '*' to the tag
      (e.g., 'sales*' will match 'SalesOrder', 'SalesInvoice', etc.).
    - Synonyms expand into exact matches only.
    This prevents accidental inclusion like 'Salesperson' when only 'Sales' is requested.
    """
    equal: Set[str] = set()
    prefix: Set[str] = set()
    for t in raw_tags:
        if not t:
            continue
        tagged = t.strip()
        k = tagged.lower()
        # Explicit prefix via wildcard
        if k.endswith("*"):
            base = k[:-1].strip()
            if base:
                prefix.add(base)
            continue
        # Synonyms expand as exact
        if k in SYNONYMS:
            for s in SYNONYMS[k]:
                equal.add(s)
        else:
            equal.add(k)
    return equal, prefix


def make_tag_matcher(include_equal: Set[str], include_prefix: Set[str],
                     exclude_equal: Set[str], exclude_prefix: Set[str]) -> Callable[[str], bool]:
    def _matches(tag: str) -> bool:
        tl = tag.lower()
        # Exclusions take precedence
        if tl in exclude_equal:
            return False
        for p in exclude_prefix:
            if tl.startswith(p):
                return False
        # Must match includes
        if tl in include_equal:
            return True
        for p in include_prefix:
            if tl.startswith(p):
                return True
        return False
    return _matches


def collect_refs(obj: Any, refs: Set[str]) -> None:
    if isinstance(obj, dict):
        if "$ref" in obj and isinstance(obj["$ref"], str):
            refs.add(obj["$ref"])
        for v in obj.values():
            collect_refs(v, refs)
    elif isinstance(obj, list):
        for v in obj:
            collect_refs(v, refs)


def prune_components(components: Dict[str, Any], root: Dict[str, Any]) -> Dict[str, Any]:
    # Collect initial refs from paths
    needed_refs: Set[str] = set()
    collect_refs({"paths": root.get("paths", {})}, needed_refs)

    # Traverse transitively to collect all referenced component objects
    processed: Set[str] = set()
    queue: List[str] = list(needed_refs)

    def resolve_component(ref: str) -> Any:
        # Only handle local component refs like #/components/schemas/X
        if not ref.startswith("#/components/"):
            return None
        parts = ref.split("/")
        if len(parts) < 4:
            return None
        sect = parts[2]  # e.g., schemas, parameters, responses
        name = "/".join(parts[3:])  # in case names contain slashes
        comp_section = components.get(sect, {})
        return comp_section.get(name)

    while queue:
        ref = queue.pop()
        if ref in processed:
            continue
        processed.add(ref)
        node = resolve_component(ref)
        if node is None:
            continue
        new_refs: Set[str] = set()
        collect_refs(node, new_refs)
        for nr in new_refs:
            if nr not in processed:
                queue.append(nr)

    # Build pruned components dict including only referenced items
    pruned: Dict[str, Any] = {}
    for sect, items in components.items():
        if not isinstance(items, dict):
            # keep non-dict sections as-is
            pruned[sect] = items
            continue
        kept_items: Dict[str, Any] = {}
        for name, value in items.items():
            local_ref = f"#/components/{sect}/{name}"
            if local_ref in processed:
                kept_items[name] = value
        if kept_items:
            pruned[sect] = kept_items
    return pruned


def _schema_ref_lookup(spec: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    comps = spec.get("components", {}).get("schemas", {})
    return {f"#/components/schemas/{name}": schema for name, schema in comps.items()}


def _merge_allOf(parts: List[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    props: Dict[str, Any] = {}
    required: List[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        p = part.get("properties")
        if isinstance(p, dict):
            props.update(p)
        req = part.get("required")
        if isinstance(req, list):
            for r in req:
                if r not in required:
                    required.append(r)
        for k, v in part.items():
            if k in ("properties", "required"):
                continue
            result[k] = v
    if props:
        result["properties"] = props
    if required:
        result["required"] = required
    return result


def _inline_schema(schema: Any, ref_index: Dict[str, Dict[str, Any]]) -> Any:
    if not isinstance(schema, dict):
        return schema
    # Resolve $ref
    if "$ref" in schema and isinstance(schema["$ref"], str):
        target = ref_index.get(schema["$ref"])
        if target is None:
            return dict(schema)  # leave unresolved external refs intact
        return _inline_schema(dict(target), ref_index)
    # Merge allOf
    if "allOf" in schema and isinstance(schema["allOf"], list):
        merged = _merge_allOf([_inline_schema(x, ref_index) for x in schema["allOf"]])
        return _inline_schema(merged, ref_index)
    # Recurse known containers
    out: Dict[str, Any] = {}
    for k, v in schema.items():
        if k == "properties" and isinstance(v, dict):
            np: Dict[str, Any] = {}
            for pk, pv in v.items():
                np[pk] = _inline_schema(pv, ref_index)
            out[k] = np
        elif k in ("items", "additionalProperties"):
            out[k] = _inline_schema(v, ref_index)
        elif k in ("oneOf", "anyOf", "allOf"):
            if isinstance(v, list):
                out[k] = [_inline_schema(x, ref_index) for x in v]
            else:
                out[k] = v
        else:
            out[k] = v
    return out


def inline_paths_schemas(spec: Dict[str, Any]) -> Dict[str, Any]:
    new_spec = json.loads(json.dumps(spec))  # deep copy
    ref_index = _schema_ref_lookup(new_spec)
    for path, item in list(new_spec.get("paths", {}).items()):
        if not isinstance(item, dict):
            continue
        for method, op in list(item.items()):
            if not isinstance(op, dict):
                continue
            # Parameters
            params = op.get("parameters")
            if isinstance(params, list):
                for p in params:
                    if isinstance(p, dict) and "schema" in p:
                        p["schema"] = _inline_schema(p["schema"], ref_index)
            # Request body
            rb = op.get("requestBody")
            if isinstance(rb, dict):
                content = rb.get("content")
                if isinstance(content, dict):
                    for _ct, media in content.items():
                        if isinstance(media, dict) and "schema" in media:
                            media["schema"] = _inline_schema(media["schema"], ref_index)
            # Responses
            responses = op.get("responses")
            if isinstance(responses, dict):
                for _code, resp in responses.items():
                    if not isinstance(resp, dict):
                        continue
                    content = resp.get("content")
                    if isinstance(content, dict):
                        for _ct, media in content.items():
                            if isinstance(media, dict) and "schema" in media:
                                media["schema"] = _inline_schema(media["schema"], ref_index)
    return new_spec


def main() -> None:
    parser = argparse.ArgumentParser(description="Filter OpenAPI spec by operation tags.")
    parser.add_argument(
        "-i", "--include", action="append", metavar="TAG[,TAG...]",
        help="Tags to include. Repeat or use comma-separated. Overrides the default include set.")
    parser.add_argument(
        "-x", "--exclude", action="append", metavar="TAG[,TAG...]",
        help="Tags to exclude. Repeat or use comma-separated. Applied after include matching.")
    parser.add_argument(
        "--no-inline-paths", action="store_true",
        help="Do not inline $ref/allOf in request/response schemas (by default, schemas are inlined to avoid missing $defs).",
    )
    args = parser.parse_args()

    with SRC.open("r", encoding="utf-8") as f:
        spec = json.load(f)

    include_raw = _flatten_args(args.include) if args.include else REQUESTED_TAGS_RAW
    exclude_raw = _flatten_args(args.exclude)

    inc_equal, inc_prefix = build_tag_sets(include_raw)
    exc_equal, exc_prefix = build_tag_sets(exclude_raw)
    tag_matches = make_tag_matcher(inc_equal, inc_prefix, exc_equal, exc_prefix)

    paths = spec.get("paths", {})
    new_paths: Dict[str, Any] = {}
    used_tag_names: Set[str] = set()

    for path, ops in paths.items():
        # ops is a dict of methods (get, post, etc.) or sometimes nested path endpoints
        kept_ops: Dict[str, Any] = {}
        for method, op_obj in ops.items():
            if not isinstance(op_obj, dict):
                continue
            tags = op_obj.get("tags", [])
            if any(tag_matches(t) for t in tags):
                kept_ops[method] = op_obj
                for t in tags:
                    if tag_matches(t):
                        used_tag_names.add(t)
        if kept_ops:
            new_paths[path] = kept_ops

    # Prepare new spec skeleton
    new_spec: Dict[str, Any] = {
        "openapi": spec.get("openapi", "3.0.1"),
        "info": spec.get("info", {}),
        "servers": spec.get("servers", []),
        "paths": new_paths,
    }

    # Carry over and prune 'tags' definitions if present
    if isinstance(spec.get("tags"), list):
        kept_tags = []
        for t in spec["tags"]:
            name = t.get("name") if isinstance(t, dict) else None
            if isinstance(name, str) and tag_matches(name):
                kept_tags.append(t)
        if kept_tags:
            new_spec["tags"] = kept_tags

    # Prune components based on what is referenced by the kept paths
    components = spec.get("components", {})
    pruned_components = prune_components(components, new_spec)
    if pruned_components:
        new_spec["components"] = pruned_components

    # Inline path-level schemas to avoid downstream $defs/$ref issues
    if not args.no_inline_paths:
        new_spec = inline_paths_schemas(new_spec)
        # After inlining, we can prune components again to remove unreferenced ones
        components2 = spec.get("components", {})
        pruned2 = prune_components(components2, new_spec)
        if pruned2:
            new_spec["components"] = pruned2

    # Write result
    with DST.open("w", encoding="utf-8") as f:
        json.dump(new_spec, f, ensure_ascii=False, indent=2)

    print(
        "Wrote filtered spec with "
        f"{len(new_paths)} paths to {DST}\n"
        f"Included tags (equal): {sorted(inc_equal)}; prefixes: {sorted(inc_prefix)}\n"
        f"Excluded tags (equal): {sorted(exc_equal)}; prefixes: {sorted(exc_prefix)}"
    )


if __name__ == "__main__":
    main()
