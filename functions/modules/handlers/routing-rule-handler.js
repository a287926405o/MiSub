/**
 * Routing Rules Handler
 * CRUD operations for routing rules.
 *
 * In 3x-ui / Xray-core style, routing rules determine which outbound
 * traffic goes to based on various conditions:
 *   - Domain matching (full, regex, wildcard)
 *   - IP matching (CIDR, geoip)
 *   - Port matching
 *   - Protocol matching
 *   - Network type (tcp/udp)
 *   - Source IP / inbound tag
 *
 * Each routing rule has:
 *   - A set of conditions (match any / match all)
 *   - A target outbound (direct, block, proxy node, chain, custom outbound)
 *   - An optional rule set / group for organization
 */

import { StorageFactory } from '../../storage-adapter.js';
import { KV_KEY_ROUTING_RULES } from '../config.js';
import { createJsonResponse, createErrorResponse, readJsonWithLimit, JSON_BODY_LIMITS } from '../utils.js';
import { authMiddleware } from '../auth-middleware.js';

/** Supported match fields for routing rules */
export const RULE_FIELDS = [
    'domain',          // Domain match (full)
    'domain_suffix',   // Domain suffix match
    'domain_keyword',  // Domain contains keyword
    'domain_regex',    // Domain regex match
    'ip_cidr',         // Destination IP CIDR
    'ip_cidr_src',     // Source IP CIDR
    'port',            // Destination port
    'port_src',        // Source port
    'protocol',        // Protocol (http, tls, etc.)
    'network',         // Network type (tcp, udp)
    'source',          // Source inbound tag
    'geoip',           // GeoIP country code
    'geosite',         // GeoSite category
    'process_name',    // Process name (OS only)
    'package_name',    // Android package name
    'match_type'       // Match type: and/or
];

/** Match operators per field type */
const FIELD_OPERATORS = {
    domain: ['eq', 'suffix', 'keyword', 'regex'],
    domain_suffix: ['eq', 'suffix'],
    domain_keyword: ['eq', 'keyword'],
    domain_regex: ['eq', 'regex'],
    ip_cidr: ['in', 'not_in'],
    ip_cidr_src: ['in', 'not_in'],
    port: ['eq', 'range', 'in', 'not_in'],
    port_src: ['eq', 'range', 'in', 'not_in'],
    protocol: ['eq', 'in', 'not_in'],
    network: ['eq'],
    source: ['eq'],
    geoip: ['in', 'not_in'],
    geosite: ['in', 'not_in'],
    process_name: ['eq', 'keyword'],
    package_name: ['eq'],
    match_type: ['eq']
};

/** Valid target types for routing rules */
export const RULE_TARGET_TYPES = [
    'direct',      // Route directly
    'block',       // Block traffic
    'dns',         // Route to DNS
    'proxy',       // Route to a specific proxy node
    'outbound',    // Route to a custom outbound (by ID or name)
    'chain',       // Route to a chain proxy
    'proxy_group'  // Route to a proxy group in the generated config
];

/**
 * Normalize a routing rule object.
 */
function normalizeRoutingRule(rule = {}) {
    return {
        id: rule.id || '',
        name: rule.name || '',
        description: rule.description || '',
        enabled: rule.enabled !== false,
        // Match logic
        matchMode: rule.matchMode || 'any', // 'any' | 'all'
        conditions: Array.isArray(rule.conditions) ? rule.conditions : [],
        // Route target
        targetType: rule.targetType || 'direct',
        target: rule.target || '', // Outbound name, node name, chain name, etc.
        // Advanced: rule sets / grouping
        ruleSetId: rule.ruleSetId || '',
        // Metadata
        priority: rule.priority || 0,
        createdAt: rule.createdAt || new Date().toISOString(),
        updatedAt: rule.updatedAt || new Date().toISOString()
    };
}

/**
 * Normalize a condition entry.
 */
function normalizeCondition(cond = {}) {
    return {
        field: cond.field || 'domain',
        operator: cond.operator || 'eq',
        value: cond.value || '',
        invert: cond.invert === true
    };
}

/**
 * Validate a single condition.
 */
function validateCondition(cond) {
    const errors = [];
    if (!cond.field || !RULE_FIELDS.includes(cond.field)) {
        errors.push(`Invalid field: ${cond.field}. Must be one of: ${RULE_FIELDS.join(', ')}`);
    }
    if (cond.field !== 'match_type') {
        const validOps = FIELD_OPERATORS[cond.field] || ['eq'];
        if (!cond.operator || !validOps.includes(cond.operator)) {
            errors.push(`Invalid operator "${cond.operator}" for field "${cond.field}". Valid: ${validOps.join(', ')}`);
        }
    }
    if (!cond.value || (typeof cond.value === 'string' && !cond.value.trim())) {
        errors.push('Condition value is required');
    }
    return errors;
}

/**
 * Validate routing rule data.
 */
function validateRoutingRule(rule) {
    const errors = [];
    if (!rule.name || typeof rule.name !== 'string' || !rule.name.trim()) {
        errors.push('Rule name is required');
    }
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
        errors.push('At least one condition is required');
    } else {
        rule.conditions.forEach((cond, i) => {
            const condErrors = validateCondition(normalizeCondition(cond));
            condErrors.forEach(e => errors.push(`Condition[${i}]: ${e}`));
        });
    }
    if (!rule.targetType || !RULE_TARGET_TYPES.includes(rule.targetType)) {
        errors.push(`Target type must be one of: ${RULE_TARGET_TYPES.join(', ')}`);
    }
    if (rule.matchMode && !['any', 'all'].includes(rule.matchMode)) {
        errors.push('Match mode must be "any" or "all"');
    }
    return errors;
}

/**
 * List all routing rules.
 */
export async function handleRoutingRulesList(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }
        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];
        // Sort by priority descending by default
        rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        return createJsonResponse({ success: true, data: rules });
    } catch (error) {
        console.error('[RoutingRuleHandler] List error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Create a new routing rule.
 */
export async function handleRoutingRuleCreate(request, env) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) {
            return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);
        }

        const errors = validateRoutingRule(body);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];

        const newRule = normalizeRoutingRule({
            ...body,
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });

        rules.push(newRule);
        await storage.put(KV_KEY_ROUTING_RULES, JSON.stringify(rules));

        return createJsonResponse({ success: true, data: newRule, message: 'Routing rule created' }, 201);
    } catch (error) {
        console.error('[RoutingRuleHandler] Create error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Update an existing routing rule.
 */
export async function handleRoutingRuleUpdate(request, env, ruleId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!ruleId) {
        return createJsonResponse({ success: false, message: 'Rule ID is required' }, 400);
    }
    try {
        const body = await readJsonWithLimit(request, JSON_BODY_LIMITS.DEFAULT);
        if (!body) {
            return createJsonResponse({ success: false, message: 'Invalid JSON body' }, 400);
        }

        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];
        const index = rules.findIndex(r => r.id === ruleId);

        if (index === -1) {
            return createJsonResponse({ success: false, message: 'Routing rule not found' }, 404);
        }

        const updated = { ...rules[index], ...body, id: ruleId, updatedAt: new Date().toISOString() };
        const errors = validateRoutingRule(updated);
        if (errors.length > 0) {
            return createJsonResponse({ success: false, message: 'Validation failed', errors }, 400);
        }

        rules[index] = normalizeRoutingRule(updated);
        await storage.put(KV_KEY_ROUTING_RULES, JSON.stringify(rules));

        return createJsonResponse({ success: true, data: rules[index], message: 'Routing rule updated' });
    } catch (error) {
        console.error('[RoutingRuleHandler] Update error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Delete a routing rule.
 */
export async function handleRoutingRuleDelete(request, env, ruleId) {
    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }
    if (!ruleId) {
        return createJsonResponse({ success: false, message: 'Rule ID is required' }, 400);
    }
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) {
            return createJsonResponse({ success: false, message: 'Storage not available' }, 500);
        }

        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        const rules = raw ? JSON.parse(raw) : [];
        const index = rules.findIndex(r => r.id === ruleId);

        if (index === -1) {
            return createJsonResponse({ success: false, message: 'Routing rule not found' }, 404);
        }

        rules.splice(index, 1);
        await storage.put(KV_KEY_ROUTING_RULES, JSON.stringify(rules));

        return createJsonResponse({ success: true, message: 'Routing rule deleted' });
    } catch (error) {
        console.error('[RoutingRuleHandler] Delete error:', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * Helper: get all routing rules as array.
 */
export async function getRoutingRulesData(env) {
    try {
        const storage = StorageFactory.resolveKV(env);
        if (!storage) return [];
        const raw = await storage.get(KV_KEY_ROUTING_RULES);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}
