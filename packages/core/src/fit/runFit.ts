import { createFitReport } from "./fitReport.js";
import {
  createFitRuleRegistry,
  runFitRules
} from "./rules.js";
import type { FitReport } from "./fitReport.js";
import type { FitRule, FitRuleRegistry } from "./rules.js";
import type { ResolvedProject } from "../project/resolveParts.js";
import type { Profile } from "../schema/profile.schema.js";
import type { ExclusiveRuleOptions } from "../ruleOptions.js";

export type RunFitOptions = ExclusiveRuleOptions<FitRuleRegistry, FitRule>;

export function runFit(
  project: ResolvedProject,
  profile: Profile,
  options: RunFitOptions = {}
): FitReport {
  const registry = options.registry ?? createFitRuleRegistry(options.rules);

  return createFitReport({
    measurements: runFitRules(project, profile, registry)
  });
}
