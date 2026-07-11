import type { Connector } from "./part.schema.js";

export function resolveJoinedConnectorToleranceMm(
  left: Connector,
  right: Connector
): number | undefined {
  const leftTolerance = left.tolerance_mm;
  const rightTolerance = right.tolerance_mm;

  if (leftTolerance === undefined && rightTolerance === undefined) {
    return undefined;
  }

  // 設計判断: 明示的な 0 は「厳密一致が必須」を意味し、反対側の緩い tolerance で
  // 打ち消されてはならない。
  if (leftTolerance === 0 || rightTolerance === 0) {
    return 0;
  }

  return Math.max(leftTolerance ?? 0, rightTolerance ?? 0);
}
