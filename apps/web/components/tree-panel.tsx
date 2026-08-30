import type { Tree, TreeRow } from '@/lib/types';
import { CapacityBar, CapacityLegend } from './capacity-bar';

/**
 * Nesting follows `fundingSource`, not channel: a row sits under the parent it
 * was carved from. That is what makes the display a partition rather than a
 * list — the same distinction the engine makes.
 */
function childrenOf(rows: TreeRow[], parent: TreeRow): TreeRow[] {
  const isChild = (r: TreeRow) => r.allocationType !== 'direct';
  if (parent.channel === 'partner_pool') {
    return rows.filter((r) => isChild(r) && r.fundingSource === 'partner_pool');
  }
  if (parent.channel === 'online' && parent.allocationType === 'direct') {
    return rows.filter((r) => isChild(r) && r.fundingSource === 'online');
  }
  return [];
}

function rowLabel(row: TreeRow): string {
  if (row.ownerName) return `${row.channel} · ${row.ownerName}`;
  return row.channel;
}

function Row({
  row,
  rows,
  capacity,
  depth,
  highlighted,
}: {
  row: TreeRow;
  rows: TreeRow[];
  capacity: number;
  depth: number;
  highlighted: Set<number>;
}) {
  const kids = childrenOf(rows, row);
  const diverges = row.rawAvailable !== row.nettedAvailable;

  return (
    <>
      <tr data-depth={depth} data-active={highlighted.has(row.id) || undefined}>
        <th scope="row" style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}>
          <span className="row-name">{rowLabel(row)}</span>
          <span className="row-meta">
            {row.allocationType}
            {row.allocationType !== 'direct' ? ` · from ${row.fundingSource}` : ''}
            {row.ownerIsHidden ? ' · owner hidden' : ''}
          </span>
        </th>
        <td className="num">{row.allocatedSlots}</td>
        <td className="num">{row.soldSlots}</td>
        <td className="num">{row.heldSlots}</td>
        <td className="num">{row.rawAvailable}</td>
        <td className="num" data-diverges={diverges || undefined}>
          {row.nettedAvailable}
          {diverges ? (
            <span className="delta">
              −{row.rawAvailable - row.nettedAvailable}
            </span>
          ) : null}
        </td>
        <td className="bar-cell">
          <CapacityBar row={row} capacity={capacity} />
        </td>
      </tr>
      {kids.map((k) => (
        <Row
          key={k.id}
          row={k}
          rows={rows}
          capacity={capacity}
          depth={depth + 1}
          highlighted={highlighted}
        />
      ))}
    </>
  );
}

export function TreePanel({
  tree,
  highlighted = new Set<number>(),
}: {
  tree: Tree;
  highlighted?: Set<number>;
}) {
  const roots = tree.rows.filter((r) => r.allocationType === 'direct');
  const divergent = tree.rows.filter((r) => r.rawAvailable !== r.nettedAvailable);

  return (
    <section className="panel" aria-labelledby="tree-heading">
      <div className="panel-head">
        <h2 id="tree-heading">Allocation tree</h2>
        <p className="panel-note">
          cabin capacity <span className="num">{tree.cabinCapacity}</span>
        </p>
      </div>

      {divergent.length > 0 ? (
        <p className="finding">
          {divergent.map((r) => (
            <span key={r.id}>
              <strong>{rowLabel(r)}</strong> reports{' '}
              <span className="num">{r.rawAvailable}</span> free, but{' '}
              <span className="num">{r.rawAvailable - r.nettedAvailable}</span> of that
              is already claimed by its children — only{' '}
              <span className="num">{r.nettedAvailable}</span> is real.
            </span>
          ))}
        </p>
      ) : null}

      {tree.violations.length > 0 ? (
        <ul className="violations">
          {tree.violations.map((v, i) => (
            <li key={i}>
              <code>{v.code}</code> {v.detail}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="table-scroll">
        <table className="tree">
          <caption className="visually-hidden">
            Channel allocations, nested under the pool each was carved from
          </caption>
          <thead>
            <tr>
              <th scope="col">channel</th>
              <th scope="col" className="num-col">allocated</th>
              <th scope="col" className="num-col">sold</th>
              <th scope="col" className="num-col">held</th>
              <th scope="col" className="num-col">raw free</th>
              <th scope="col" className="num-col">netted free</th>
              <th scope="col">composition</th>
            </tr>
          </thead>
          <tbody>
            {roots.map((r) => (
              <Row
                key={r.id}
                row={r}
                rows={tree.rows}
                capacity={tree.cabinCapacity}
                depth={0}
                highlighted={highlighted}
              />
            ))}
          </tbody>
        </table>
      </div>
      <CapacityLegend />
    </section>
  );
}
