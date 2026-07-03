import type { ResolvedProject } from "../project/resolveParts.js";
import { createCheckReport } from "./checkReport.js";
import type { CheckReport } from "./checkReport.js";
import {
  createCompatibilityRuleRegistry,
  runCompatibilityRules
} from "./rules.js";
import type { CompatibilityRule, CompatibilityRuleRegistry } from "./rules.js";
import type { ExclusiveRuleOptions } from "../ruleOptions.js";

export type RunChecksOptions = ExclusiveRuleOptions<
  CompatibilityRuleRegistry,
  CompatibilityRule
>;

export function runChecks(
  resolvedProject: ResolvedProject,
  options: RunChecksOptions = {}
): CheckReport {
  const registry =
    options.registry ?? createCompatibilityRuleRegistry(options.rules);

  return createCheckReport({
    compatibility: runCompatibilityRules(resolvedProject, registry)
  });
}
