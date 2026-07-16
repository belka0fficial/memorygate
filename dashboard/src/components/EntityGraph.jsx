import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { Plus, Minus, RotateCcw, Search } from 'lucide-react';
import { entityTypeColor, ENTITY_TYPE_COLORS } from './EntityTypeBadge';

const IMPORTANCE_RADIUS = { critical: 20, high: 15, normal: 10, low: 7 };

function radiusFor(level) {
  return IMPORTANCE_RADIUS[level] ?? IMPORTANCE_RADIUS.normal;
}

export default function EntityGraph({ entities, edges, selectedId, onSelect }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const zoomRef = useRef(null);
  const [visibleTypes, setVisibleTypes] = useState(() => new Set(Object.keys(ENTITY_TYPE_COLORS)));
  const [query, setQuery] = useState('');

  const filteredEntities = useMemo(
    () => entities.filter((e) => visibleTypes.has(e.entity_type)),
    [entities, visibleTypes],
  );

  useEffect(() => {
    const container = containerRef.current;
    const svgEl = svgRef.current;
    if (!container || !svgEl) return undefined;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    const svg = d3.select(svgEl).attr('viewBox', [0, 0, width, height]).attr('width', width).attr('height', height);
    svg.selectAll('*').remove();

    if (filteredEntities.length === 0) return undefined;

    const g = svg.append('g');

    const zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    zoomRef.current = { svg, zoom };

    const nodes = filteredEntities.map((e) => ({ ...e }));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const links = edges
      .filter((e) => nodeIds.has(e.from_entity_id) && nodeIds.has(e.to_entity_id))
      .map((e) => ({ ...e, source: e.from_entity_id, target: e.to_entity_id }));

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance(110).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius((d) => radiusFor(d.importance_level) + 24));

    const linkGroup = g.append('g');
    const link = linkGroup.selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#333333')
      .attr('stroke-width', (d) => 1 + (d.strength ?? 0.5) * 3)
      .attr('stroke-dasharray', (d) => (d.direction === 'bidirectional' ? '4,3' : null))
      .style('cursor', 'pointer')
      .on('mouseenter', function () { d3.select(this).attr('stroke', '#3B82F6'); })
      .on('mouseleave', function () { d3.select(this).attr('stroke', '#333333'); });

    link.append('title').text((d) => d.relationship_type);

    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(dragBehavior(simulation))
      .on('click', (_event, d) => onSelect(d));

    node.append('circle')
      .attr('r', (d) => radiusFor(d.importance_level))
      .attr('fill', (d) => entityTypeColor(d.entity_type))
      .attr('fill-opacity', 0.9)
      .attr('stroke', (d) => (d.id === selectedId ? '#ededed' : 'transparent'))
      .attr('stroke-width', 2);

    node.append('text')
      .text((d) => d.name)
      .attr('text-anchor', 'middle')
      .attr('y', (d) => radiusFor(d.importance_level) + 14)
      .attr('font-size', 11)
      .attr('fill', '#888888');

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [filteredEntities, edges, selectedId, onSelect]);

  useEffect(() => {
    if (!zoomRef.current) return;
    const { svg } = zoomRef.current;
    const lower = query.trim().toLowerCase();
    svg.selectAll('g > g').each(function (d) {
      if (!d?.name) return;
      const matches = lower && d.name.toLowerCase().includes(lower);
      d3.select(this).select('circle').attr('opacity', !lower || matches ? 1 : 0.15);
      d3.select(this).select('text').attr('opacity', !lower || matches ? 1 : 0.15).attr('fill', matches ? '#3B82F6' : '#888888');
    });
  }, [query]);

  const zoomBy = (factor) => {
    if (!zoomRef.current) return;
    const { svg, zoom } = zoomRef.current;
    svg.transition().duration(200).call(zoom.scaleBy, factor);
  };

  const resetZoom = () => {
    if (!zoomRef.current) return;
    const { svg, zoom } = zoomRef.current;
    svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
  };

  const toggleType = (type) => {
    setVisibleTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  return (
    <div ref={containerRef} className="relative h-[600px] w-full overflow-hidden rounded-lg border border-border bg-surface">
      <svg ref={svgRef} className="h-full w-full" />

      {entities.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted">No entities to graph.</div>
      )}

      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          <button onClick={() => zoomBy(1.3)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-text"><Plus size={14} /></button>
          <button onClick={() => zoomBy(0.75)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-text"><Minus size={14} /></button>
          <button onClick={resetZoom} className="rounded-md p-1.5 text-muted transition-colors hover:bg-white/[0.06] hover:text-text"><RotateCcw size={13} /></button>
        </div>

        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Highlight node…"
            className="w-40 rounded-lg border border-border bg-surface py-1.5 pl-7 pr-2 text-xs text-text placeholder:text-muted/70 outline-none focus-visible:border-accent"
          />
        </div>

        <div className="rounded-lg border border-border bg-surface p-2">
          {Object.keys(ENTITY_TYPE_COLORS).map((type) => (
            <label key={type} className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={visibleTypes.has(type)}
                onChange={() => toggleType(type)}
                className="h-3 w-3 accent-accent"
              />
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: entityTypeColor(type) }} />
              {type}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function dragBehavior(simulation) {
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }
  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }
  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
  return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended);
}
