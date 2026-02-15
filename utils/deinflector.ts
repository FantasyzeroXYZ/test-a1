export interface Condition {
    name: string;
    isDictionaryForm: boolean;
    subConditions?: string[];
    // Add optional i18n property to support internationalization data from Yomitan dictionaries.
    i18n?: { language: string; name: string; description?: string }[];
}

export interface TransformRule {
    type: 'suffix' | 'prefix' | 'other';
    isInflected?: RegExp;
    deinflected?: string;
    conditionsIn: string[];
    conditionsOut: string[];
    deinflect?: (term: string) => string;
}

// Add optional i18n property to support internationalization data from Yomitan dictionaries.
export interface TransformGroup {
    name: string;
    description?: string;
    rules: TransformRule[];
    i18n?: { language: string; name: string; description?: string }[];
}

export interface LanguageTransforms {
    language: string;
    conditions: Record<string, Condition>;
    transforms: Record<string, TransformGroup>;
}

export interface DeinflectionResult {
    term: string;
    rules: string[];
    reasons: string[];
    tags: string[]; // Captured from conditions
}

// Helper factory functions to match Yomitan file structure
export const suffixInflection = (suffix: string, deinflected: string, conditionsIn: string[], conditionsOut: string[]): TransformRule => ({
    type: 'suffix',
    isInflected: new RegExp(`${suffix}$`),
    deinflected,
    conditionsIn,
    conditionsOut
});

export const prefixInflection = (prefix: string, deinflected: string, conditionsIn: string[], conditionsOut: string[]): TransformRule => ({
    type: 'prefix',
    isInflected: new RegExp(`^${prefix}`),
    deinflected,
    conditionsIn,
    conditionsOut
});

// Mock environment to parse user uploaded JS files
export const parseTransforms = (fileContent: string): LanguageTransforms | null => {
    try {
        // 1. Strip imports and exports to make it executable in function scope
        let cleanCode = fileContent
            .replace(/import\s+.*?from\s+['"].*?['"];?/g, '')
            .replace(/export\s+const\s+(\w+)\s*=/g, 'return { $1: $1 }; \nconst $1 =')
            .replace(/export\s+default\s+/g, 'return ')
            .replace(/export\s+\{.*?\};?/g, '');

        // 2. Identify the main variable name if possible, or rely on return
        // We inject the helper functions into the scope
        const factory = new Function('suffixInflection', 'prefixInflection', `
            ${cleanCode}
        `);

        const result = factory(suffixInflection, prefixInflection);
        
        // The result might be an object containing the transforms (e.g. { englishTransforms: {...} }) or the object itself
        const keys = Object.keys(result);
        if (keys.length === 1 && result[keys[0]].conditions && result[keys[0]].transforms) {
            return result[keys[0]] as LanguageTransforms;
        } else if (result.conditions && result.transforms) {
            return result as LanguageTransforms;
        }
        
        return null;
    } catch (e) {
        console.error("Failed to parse transforms:", e);
        return null;
    }
};

export class Deinflector {
    private transforms: Record<string, LanguageTransforms> = {};

    public load(lang: string, transforms: LanguageTransforms) {
        this.transforms[lang] = transforms;
    }

    public deinflect(term: string, lang: string): DeinflectionResult[] {
        const langTransforms = this.transforms[lang];
        if (!langTransforms) return [{ term, rules: [], reasons: [], tags: [] }];

        const results: DeinflectionResult[] = [];
        const seen = new Set<string>();

        this.deinflectRecursive(lang, term, [], [], results, seen);
        
        if (!seen.has(term)) {
             results.unshift({ term, rules: [], reasons: [], tags: [] });
        }

        return results;
    }

    private deinflectRecursive(
        lang: string,
        currentTerm: string,
        ruleTrace: string[],
        reasonTrace: string[],
        results: DeinflectionResult[],
        seen: Set<string>,
        previousConditionsIn: string[] = []
    ) {
        const langTransforms = this.transforms[lang];
        if (!langTransforms) return;

        if (!seen.has(currentTerm)) {
            const tags = this.getTagsForTrace(lang, ruleTrace, previousConditionsIn);
            results.push({
                term: currentTerm,
                rules: [...ruleTrace],
                reasons: [...reasonTrace],
                tags
            });
            seen.add(currentTerm);
        }

        if (ruleTrace.length > 4) return;

        for (const [transformName, group] of Object.entries(langTransforms.transforms)) {
            for (const rule of group.rules) {
                if (previousConditionsIn.length > 0) {
                    const compatible = rule.conditionsOut.some(c => previousConditionsIn.includes(c));
                    if (!compatible) continue;
                }

                let newTerm: string | null = null;
                
                if (rule.deinflect) {
                    if (rule.isInflected?.test(currentTerm)) {
                        newTerm = rule.deinflect(currentTerm);
                    }
                } else if (rule.type === 'suffix' && rule.isInflected) {
                    if (rule.isInflected.test(currentTerm)) {
                        newTerm = currentTerm.replace(rule.isInflected, rule.deinflected || '');
                    }
                } else if (rule.type === 'prefix' && rule.isInflected) {
                    if (rule.isInflected.test(currentTerm)) {
                        newTerm = currentTerm.replace(rule.isInflected, rule.deinflected || '');
                    }
                }

                if (newTerm && newTerm !== currentTerm && newTerm.length > 0) {
                    this.deinflectRecursive(
                        lang,
                        newTerm,
                        [...ruleTrace, transformName],
                        [...reasonTrace, group.description || transformName],
                        results,
                        seen,
                        rule.conditionsIn
                    );
                }
            }
        }
    }

    private getTagsForTrace(lang: string, ruleTrace: string[], currentConditions: string[]): string[] {
        const langTransforms = this.transforms[lang];
        if (!langTransforms) return [];
        return currentConditions.map(c => langTransforms.conditions[c]?.name || c);
    }
}

export const deinflector = new Deinflector();
