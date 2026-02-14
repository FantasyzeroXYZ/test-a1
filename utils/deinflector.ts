
import { japaneseTransforms, Rule } from './japaneseDeinflectionRules';

export interface DeinflectionResult {
    term: string;
    rules: string[];
    reasons: string[];
}

export class Deinflector {
    private rules: Record<string, Rule[]>;

    constructor() {
        this.rules = {};
        // Flatten the rules from the transform object
        for (const [key, group] of Object.entries(japaneseTransforms.transforms)) {
            this.rules[key] = group.rules;
        }
    }

    public deinflect(term: string): DeinflectionResult[] {
        const results: DeinflectionResult[] = [];
        this.deinflectRecursive(term, [], [], results);
        return results;
    }

    private deinflectRecursive(
        term: string, 
        ruleTrace: string[], 
        reasonTrace: string[], 
        results: DeinflectionResult[]
    ) {
        // Base case: add current term as a candidate
        results.push({
            term,
            rules: [...ruleTrace],
            reasons: [...reasonTrace]
        });

        // Limit recursion depth to prevent infinite loops or excessive processing
        if (ruleTrace.length > 5) return;

        for (const [groupName, rules] of Object.entries(this.rules)) {
            for (const rule of rules) {
                if (term.endsWith(rule.suffixIn)) {
                    // Check if the stripped term is valid (simple heuristic: not empty)
                    if (term.length > rule.suffixIn.length) {
                        const root = term.substring(0, term.length - rule.suffixIn.length) + rule.suffixOut;
                        
                        // Prevent cycles (e.g. A -> B -> A) although rare with length reduction
                        // Simple optimization: only proceed if length reduces or stays same (some rules might expand, handle carefully)
                        // Most deinflections reduce length or swap suffixes.
                        
                        this.deinflectRecursive(
                            root, 
                            [...ruleTrace, groupName], 
                            [...reasonTrace, groupName], 
                            results
                        );
                    }
                }
            }
        }
    }
}

const instance = new Deinflector();
export const deinflect = (term: string) => instance.deinflect(term);
