/**
 * Routing Service
 * Generates routing rule configurations for various proxy clients.
 *
 * This service takes the user-defined routing rules and outbound settings,
 * then generates the appropriate routing configuration for:
 *   - Clash/Mihomo: rules section
 *   - Sing-Box: route section
 *   - Surge: rules section
 *   - Loon: rules section
 *
 * The rules allow traffic to be directed to specific outbounds based on
 * domain, IP, port, protocol, geo-location, etc. - enabling chain proxy
 * effects through intelligent traffic routing.
 */

/**
 * Mapping from routing rule target types to Clash proxy group names.
 */
function resolveClashTarget(targetType, target, customOutbounds = [], chains = [], allProxyNames = []) {
    switch (targetType) {
        case 'direct':
            return 'DIRECT';
        case 'block':
            return 'REJECT';
        case 'dns':
            return 'DNS';
        case 'proxy':
            // Target is a proxy node name
            return allProxyNames.includes(target) ? target : 'Proxy';
        case 'outbound': {
            // Find custom outbound by name or id
            const ob = customOutbounds.find(o => o.id === target || o.name === target);
            if (ob) {
                if (ob.type === 'direct') return 'DIRECT';
                if (ob.type === 'block') return 'REJECT';
                if (ob.type === 'chain') return ob.name || `Chain-${ob.id?.slice(0, 8)}`;
                return ob.name;
            }
            return target;
        }
        case 'chain': {
            // Find chain by id or name
            const chain = chains.find(c => c.id === target || c.name === target);
            return chain ? chain.name : target;
        }
        case 'proxy_group':
            return target || 'Proxy';
        default:
            return 'Proxy';
    }
}

/**
 * Build Clash/Mihomo rules from routing rules.
 * Clash rules format: DOMAIN, DOMAIN-SUFFIX, DOMAIN-KEYWORD, DOMAIN-REGEX,
 * IP-CIDR, SRC-IP-CIDR, GEOIP, DST-PORT, SRC-PORT, PROCESS-NAME, etc.
 *
 * @param {Array} routingRules - User-defined routing rules
 * @param {Array} customOutbounds - Custom outbound definitions
 * @param {Array} chains - Chain proxy definitions
 * @param {Array} allProxyNames - All available proxy node names
 * @returns {Array} Clash rules array (sorted by priority)
 */
export function buildClashRules(routingRules = [], customOutbounds = [], chains = [], allProxyNames = []) {
    if (!Array.isArray(routingRules) || routingRules.length === 0) return [];

    const rules = [];

    // Sort by priority (descending, higher priority first)
    const sortedRules = [...routingRules]
        .filter(r => r.enabled !== false)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
        if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) continue;

        const target = resolveClashTarget(rule.targetType, rule.target, customOutbounds, chains, allProxyNames);
        const isAndMode = rule.matchMode === 'all';

        for (const condition of rule.conditions) {
            if (!condition.field || !condition.value) continue;

            const clashRule = convertConditionToClash(condition, target, isAndMode);
            if (clashRule) {
                rules.push(clashRule);
                // In 'all' mode, only the first condition generates the rule
                // (AND conditions aren't natively supported in Clash without chains)
            }
        }
    }

    return rules;
}

/**
 * Convert a single condition to Clash rule format.
 */
function convertConditionToClash(condition, target, isAndMode) {
    const { field, operator, value, invert } = condition;
    const prefix = invert ? '!' : '';

    switch (field) {
        case 'domain':
            if (operator === 'eq') return `${prefix}DOMAIN,${value},${target}`;
            if (operator === 'suffix') return `${prefix}DOMAIN-SUFFIX,${value},${target}`;
            if (operator === 'keyword') return `${prefix}DOMAIN-KEYWORD,${value},${target}`;
            if (operator === 'regex') return `${prefix}DOMAIN-REGEX,${value},${target}`;
            break;
        case 'domain_suffix':
            return `${prefix}DOMAIN-SUFFIX,${value},${target}`;
        case 'domain_keyword':
            return `${prefix}DOMAIN-KEYWORD,${value},${target}`;
        case 'domain_regex':
            return `${prefix}DOMAIN-REGEX,${value},${target}`;
        case 'ip_cidr':
            if (operator === 'in') return `${prefix}IP-CIDR,${value},${target}`;
            if (operator === 'not_in') return `!${prefix}IP-CIDR,${value},${target}`;
            break;
        case 'ip_cidr_src':
            if (operator === 'in') return `${prefix}SRC-IP-CIDR,${value},${target}`;
            if (operator === 'not_in') return `!${prefix}SRC-IP-CIDR,${value},${target}`;
            break;
        case 'port':
            if (operator === 'eq') return `${prefix}DST-PORT,${value},${target}`;
            if (operator === 'range') return `${prefix}DST-PORT,${value},${target}`;
            if (operator === 'in') return `${prefix}DST-PORT,${value},${target}`;
            break;
        case 'port_src':
            return `${prefix}SRC-PORT,${value},${target}`;
        case 'protocol':
            // Clash uses rule-providers for protocol matching, not direct rules
            // Use a comment to indicate the protocol rule
            return `# PROTOCOL:${value} -> ${target} (Clash does not support native protocol match)`;
        case 'network':
            if (value === 'tcp') return `${prefix}NETWORK,TCP,${target}`;
            if (value === 'udp') return `${prefix}NETWORK,UDP,${target}`;
            break;
        case 'geoip':
            return `${prefix}GEOIP,${value},${target}`;
        case 'geosite':
            return `${prefix}GEOSITE,${value},${target}`;
        case 'process_name':
            return `${prefix}PROCESS-NAME,${value},${target}`;
        default:
            return null;
    }
    return null;
}

/**
 * Build Sing-Box routing rules from routing rules.
 * Sing-Box uses: route.rules[] with format:
 * {
 *   "domain": [...],
 *   "domain_suffix": [...],
 *   "domain_keyword": [...],
 *   "domain_regex": [...],
 *   "ip_cidr": [...],
 *   "source_ip_cidr": [...],
 *   "port": [...],
 *   "source_port": [...],
 *   "protocol": [...],
 *   "network": "tcp"|"udp",
 *   "outbound": "..."
 * }
 *
 * @param {Array} routingRules
 * @param {Array} customOutbounds
 * @param {Array} chains
 * @param {Array} allOutboundTags
 * @returns {Array} Sing-Box route rules
 */
export function buildSingboxRoutingRules(routingRules = [], customOutbounds = [], chains = [], allOutboundTags = []) {
    if (!Array.isArray(routingRules) || routingRules.length === 0) return [];

    const rules = [];
    const sortedRules = [...routingRules]
        .filter(r => r.enabled !== false)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
        if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) continue;

        const target = resolveClashTarget(rule.targetType, rule.target, customOutbounds, chains, allOutboundTags);
        const singboxRule = {};

        // Group conditions by field for Sing-Box format
        const domainList = [];
        const domainSuffixList = [];
        const domainKeywordList = [];
        const domainRegexList = [];
        const ipCidrList = [];
        const sourceIpCidrList = [];
        const portList = [];
        const sourcePortList = [];
        const protocolList = [];
        const invertRules = [];

        for (const condition of rule.conditions) {
            const { field, operator, value, invert } = condition;

            const pushToList = (list) => {
                if (invert) {
                    invertRules.push({ field, value });
                } else {
                    list.push(value);
                }
            };

            switch (field) {
                case 'domain':
                case 'domain_suffix':
                    pushToList(operator === 'suffix' || field === 'domain_suffix' ? domainSuffixList : domainList);
                    break;
                case 'domain_keyword':
                    pushToList(domainKeywordList);
                    break;
                case 'domain_regex':
                    pushToList(domainRegexList);
                    break;
                case 'ip_cidr':
                    pushToList(ipCidrList);
                    break;
                case 'ip_cidr_src':
                    pushToList(sourceIpCidrList);
                    break;
                case 'port':
                    pushToList(portList);
                    break;
                case 'port_src':
                    pushToList(sourcePortList);
                    break;
                case 'protocol':
                    pushToList(protocolList);
                    break;
                case 'geoip':
                    pushToList(ipCidrList); // GeoIP as IP CIDR
                    break;
                case 'geosite':
                    pushToList(domainSuffixList); // GeoSite as domain suffix
                    break;
            }
        }

        if (domainList.length > 0) singboxRule.domain = domainList;
        if (domainSuffixList.length > 0) singboxRule.domain_suffix = domainSuffixList;
        if (domainKeywordList.length > 0) singboxRule.domain_keyword = domainKeywordList;
        if (domainRegexList.length > 0) singboxRule.domain_regex = domainRegexList;
        if (ipCidrList.length > 0) singboxRule.ip_cidr = ipCidrList;
        if (sourceIpCidrList.length > 0) singboxRule.source_ip_cidr = sourceIpCidrList;
        if (portList.length > 0) singboxRule.port = portList;
        if (sourcePortList.length > 0) singboxRule.source_port = sourcePortList;
        if (protocolList.length > 0) singboxRule.protocol = protocolList;
        if (invertRules.length > 0) {
            singboxRule.invert = true;
        }

        singboxRule.outbound = target;

        // Only push if we have at least one condition
        if (Object.keys(singboxRule).length > 1) { // > 1 because outbound is always there
            rules.push(singboxRule);
        }
    }

    return rules;
}

/**
 * Build Surge rules from routing rules.
 * Surge format: DOMAIN, DOMAIN-SUFFIX, DOMAIN-KEYWORD, IP-CIDR, GEOIP, etc.
 *
 * @param {Array} routingRules
 * @param {Array} customOutbounds
 * @param {Array} chains
 * @param {Array} allProxyNames
 * @returns {Array} Surge rule strings
 */
export function buildSurgeRules(routingRules = [], customOutbounds = [], chains = [], allProxyNames = []) {
    // Surge rules format is very similar to Clash
    return buildClashRules(routingRules, customOutbounds, chains, allProxyNames);
}

/**
 * Build Loon rules from routing rules.
 * Loon format is very similar to Surge/Clash.
 *
 * @param {Array} routingRules
 * @param {Array} customOutbounds
 * @param {Array} chains
 * @param {Array} allProxyNames
 * @returns {Array} Loon rule strings
 */
export function buildLoonRules(routingRules = [], customOutbounds = [], chains = [], allProxyNames = []) {
    return buildClashRules(routingRules, customOutbounds, chains, allProxyNames);
}

/**
 * Build custom outbound configurations for Sing-Box.
 * Generates the `outbounds` array in Sing-Box config.
 *
 * @param {Array} customOutbounds - User-defined outbound configurations
 * @returns {Array} Sing-Box outbound config objects
 */
export function buildSingboxCustomOutbounds(customOutbounds = []) {
    if (!Array.isArray(customOutbounds) || customOutbounds.length === 0) return [];

    const outbounds = [];

    for (const ob of customOutbounds) {
        if (!ob.enabled) continue;

        let outbound = null;

        switch (ob.type) {
            case 'direct':
                outbound = {
                    tag: ob.name,
                    type: 'direct'
                };
                break;
            case 'block':
                outbound = {
                    tag: ob.name,
                    type: 'block'
                };
                break;
            case 'dns':
                outbound = {
                    tag: ob.name || 'dns-out',
                    type: 'dns'
                };
                break;
            case 'load_balance':
                outbound = {
                    tag: ob.name,
                    type: 'load-balance',
                    outbounds: Array.isArray(ob.targets) ? ob.targets : [],
                    strategy: ob.strategy || 'random'
                };
                break;
            case 'chain':
                outbound = {
                    tag: ob.name,
                    type: 'chain',
                    outbounds: Array.isArray(ob.targets) ? ob.targets : []
                };
                break;
            case 'wireguard':
                outbound = {
                    tag: ob.name,
                    type: 'wireguard',
                    ...(ob.wireguardConfig || {})
                };
                break;
            case 'custom':
                // Try to parse custom JSON config
                try {
                    const parsed = typeof ob.customConfig === 'string'
                        ? JSON.parse(ob.customConfig)
                        : ob.customConfig;
                    outbound = {
                        tag: ob.name,
                        ...parsed
                    };
                } catch {
                    outbound = null;
                }
                break;
        }

        if (outbound) {
            outbounds.push(outbound);
        }
    }

    return outbounds;
}

/**
 * Build custom proxy-groups for Clash/Mihomo from custom outbounds.
 *
 * @param {Array} customOutbounds
 * @returns {Array} Clash proxy-group configs
 */
export function buildClashCustomProxyGroups(customOutbounds = []) {
    if (!Array.isArray(customOutbounds) || customOutbounds.length === 0) return [];

    const groups = [];

    for (const ob of customOutbounds) {
        if (!ob.enabled) continue;

        switch (ob.type) {
            case 'load_balance':
                groups.push({
                    name: ob.name,
                    type: 'load-balance',
                    proxies: Array.isArray(ob.targets) ? ob.targets : [],
                    url: ob.config?.url || 'http://www.gstatic.com/generate_204',
                    interval: ob.config?.interval || 300
                });
                break;
            case 'chain':
                groups.push({
                    name: ob.name,
                    type: 'relay',
                    proxies: Array.isArray(ob.targets) ? ob.targets : []
                });
                break;
        }
    }

    return groups;
}

/**
 * Get all available outbound target names for the UI.
 * Combines: DIRECT, REJECT, proxy nodes, chains, custom outbounds
 *
 * @param {Array} allProxyNames - All proxy node names
 * @param {Array} customOutbounds - Custom outbound configs
 * @param {Array} chains - Chain proxy configs
 * @returns {Array} Available targets for routing rules
 */
export function getAvailableTargets(allProxyNames = [], customOutbounds = [], chains = []) {
    const targets = [
        { id: 'direct', name: 'DIRECT (直连)', type: 'direct' },
        { id: 'block', name: 'REJECT (拒绝)', type: 'block' },
        { id: 'dns', name: 'DNS', type: 'dns' }
    ];

    // Add proxy nodes
    allProxyNames.forEach(name => {
        targets.push({ id: name, name: `代理节点: ${name}`, type: 'proxy' });
    });

    // Add custom outbounds
    customOutbounds.forEach(ob => {
        targets.push({
            id: ob.id,
            name: `出站: ${ob.name} (${ob.type})`,
            type: 'outbound'
        });
    });

    // Add chains
    chains.forEach(chain => {
        targets.push({
            id: chain.id,
            name: `链式代理: ${chain.name}`,
            type: 'chain'
        });
    });

    return targets;
}
