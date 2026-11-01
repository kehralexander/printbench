import * as React from 'react'

/**
 * Short facts joined with " · ", each kept on one line: on a phone the line
 * wraps between facts, never inside one ("0.4 mm" / "nozzle").
 */
export function Facts({ items }: { items: readonly string[] }) {
  return items.map((item, index) => (
    <React.Fragment key={index}>
      {index > 0 && ' · '}
      <span className="whitespace-nowrap">{item}</span>
    </React.Fragment>
  ))
}
