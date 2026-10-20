/**
 * Model usage cost for display: cents, the way the workspace header shows it. Sub-cent amounts read
 * "<$0.01" rather than four decimal places of noise.
 */
export function formatUsageCost(cost: number): string {
  if (cost === 0) return '$0'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
