/**
 * Conditional Branching for Katas
 *
 * Phase 9: if/else support in Kata DSL
 *
 * Enables runtime decision-making based on:
 * - Previous skill output
 * - Task variables
 * - Environment state
 *
 * Example:
 *   phase check_risk
 *   run skill risk.assess
 *   if risk_level == "high"
 *     next escalate
 *   else
 *     next approve
 */

export type ConditionOperator =
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "in"
  | "not_in"
  | "contains"
  | "starts_with"
  | "ends_with";

export interface Condition {
  variable: string; // Path: "risk_level", "user.role", "results.chunk1"
  operator: ConditionOperator;
  value: any; // Compare against
}

/**
 * Logical combination of conditions
 */
export interface ConditionGroup {
  type: "AND" | "OR";
  conditions: (Condition | ConditionGroup)[];
}

/**
 * Branch definition
 */
export interface ConditionalBranch {
  condition: Condition | ConditionGroup;
  next: string; // Next phase name
}

/**
 * Conditional phase action
 */
export interface ConditionalPhaseAction {
  type: "conditional";
  branches: ConditionalBranch[];
  defaultNext: string; // If no condition matches
}

/**
 * Evaluate a single condition
 */
export function evaluateCondition(
  condition: Condition,
  variables: Record<string, any>
): boolean {
  const value = getVariableValue(variables, condition.variable);

  switch (condition.operator) {
    case "==":
      return value === condition.value;

    case "!=":
      return value !== condition.value;

    case ">":
      return value > condition.value;

    case ">=":
      return value >= condition.value;

    case "<":
      return value < condition.value;

    case "<=":
      return value <= condition.value;

    case "in":
      // value in array
      return Array.isArray(condition.value) && condition.value.includes(value);

    case "not_in":
      // value not in array
      return !Array.isArray(condition.value) || !condition.value.includes(value);

    case "contains":
      // value contains substring or element
      if (typeof value === "string") {
        return value.includes(String(condition.value));
      }
      if (Array.isArray(value)) {
        return value.includes(condition.value);
      }
      return false;

    case "starts_with":
      return String(value).startsWith(String(condition.value));

    case "ends_with":
      return String(value).endsWith(String(condition.value));

    default:
      return false;
  }
}

/**
 * Evaluate a condition group (AND/OR)
 */
export function evaluateConditionGroup(
  group: ConditionGroup,
  variables: Record<string, any>
): boolean {
  const results = group.conditions.map((cond) => {
    if ("type" in cond) {
      // It's a ConditionGroup
      return evaluateConditionGroup(cond as ConditionGroup, variables);
    }
    // It's a Condition
    return evaluateCondition(cond as Condition, variables);
  });

  if (group.type === "AND") {
    return results.every((r) => r);
  } else {
    return results.some((r) => r);
  }
}

/**
 * Evaluate conditional phase and determine next phase
 */
export function evaluateConditionalBranch(
  action: ConditionalPhaseAction,
  variables: Record<string, any>
): string {
  for (const branch of action.branches) {
    let matches = false;

    if ("type" in branch.condition) {
      // ConditionGroup
      matches = evaluateConditionGroup(branch.condition as ConditionGroup, variables);
    } else {
      // Condition
      matches = evaluateCondition(branch.condition as Condition, variables);
    }

    if (matches) {
      return branch.next;
    }
  }

  // No branch matched, use default
  return action.defaultNext;
}

/**
 * Get nested variable value using dot notation
 */
function getVariableValue(variables: Record<string, any>, path: string): any {
  const parts = path.split(".");
  let current = variables;

  for (const part of parts) {
    if (current && typeof current === "object") {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Helper: Create simple condition
 */
export function createCondition(
  variable: string,
  operator: ConditionOperator,
  value: any
): Condition {
  return { variable, operator, value };
}

/**
 * Helper: Create AND group
 */
export function createAndGroup(
  conditions: (Condition | ConditionGroup)[]
): ConditionGroup {
  return { type: "AND", conditions };
}

/**
 * Helper: Create OR group
 */
export function createOrGroup(
  conditions: (Condition | ConditionGroup)[]
): ConditionGroup {
  return { type: "OR", conditions };
}

/**
 * Condition DSL parser (used by KataParser Phase 9)
 */
export class ConditionParser {
  /**
   * Parse condition string: "variable operator value"
   * Example: "risk_level == high", "score >= 80"
   */
  static parseCondition(input: string): Condition {
    const operators: ConditionOperator[] = [
      "starts_with",
      "ends_with",
      "contains",
      "not_in",
      "!=",
      ">=",
      "<=",
      "==",
      ">",
      "<",
      "in",
    ];

    let matched: { operator: ConditionOperator; index: number } | null = null;

    // Find first operator in input
    for (const op of operators) {
      const idx = input.indexOf(` ${op} `);
      if (idx >= 0 && (matched === null || idx < matched.index)) {
        matched = { operator: op, index: idx };
      }
    }

    if (!matched) {
      throw new Error(`Invalid condition: ${input}`);
    }

    const variable = input.substring(0, matched.index).trim();
    const valueStr = input
      .substring(matched.index + matched.operator.length + 2)
      .trim();
    const value = this.parseValue(valueStr);

    return { variable, operator: matched.operator, value };
  }

  /**
   * Parse value: string, number, array, boolean
   */
  private static parseValue(valueStr: string): any {
    // Boolean
    if (valueStr === "true") return true;
    if (valueStr === "false") return false;

    // Null
    if (valueStr === "null") return null;

    // Number
    if (/^-?\d+(\.\d+)?$/.test(valueStr)) {
      return Number(valueStr);
    }

    // Array: [1, 2, 3] or ["a", "b", "c"]
    if (valueStr.startsWith("[") && valueStr.endsWith("]")) {
      const elements = valueStr
        .slice(1, -1)
        .split(",")
        .map((e) => this.parseValue(e.trim()));
      return elements;
    }

    // String (quoted)
    if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
      return valueStr.slice(1, -1);
    }

    // Unquoted string
    return valueStr;
  }
}
