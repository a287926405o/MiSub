/**
 * Chain Proxy Service
 * Generates chain proxy configurations for various proxy clients.
 *
 * A chain proxy routes traffic through multiple proxy nodes sequentially:
 *   Node A → Node B → Node C → Destination
 *
 * Supported output formats:
 * - Clash/Mihomo: relay / chain proxy-groups
 * - Sing-Box: Chain outbound
 * - Surge: relay proxy group
 * - Loon: Proxy Chain
 */

/**
 * Build chain proxy-groups for Clash/Mihomo output.
 * @param {Array} chains - Array of chain objects from the store
 * @param {Array} allProxyNames - All available proxy names (to validate chain members exist)
 * @returns {Array} Clash proxy-group configs for chains
 */
export function buildClashChainGroups(chains, allProxyNames = []) {
    if (!Array.isArray(chains) || chains.length === 0) return [];

    const nameSet = new Set(allProxyNames);
    const chainGroups = [];

    for (const chain of chains) {
        if (!chain.enabled) continue;
        const nodeNames = Array.isArray(chain.nodes) ? chain.nodes : [];
        if (nodeNames.length < 2) continue;

        // Filter to only include nodes that actually exist in the proxy list
        const validNodes = nodeNames.filter(name => nameSet.has(name));
        if (validNodes.length < 2) continue;

        // Relay mode: standard relay (A→B→C)
        // Chain mode: sequential connection (for newer Mihomo)
        const groupType = chain.mode === 'chain' ? 'chain' : 'relay';

        chainGroups.push({
            name: chain.name || `Chain-${chain.id?.slice(0, 8) || 'unknown'}`,
            type: groupType,
            proxies: validNodes
        });
    }

    return chainGroups;
}

/**
 * Build chain proxy-groups for Surge output.
 * Surge uses: {name} = relay, {node1}, {node2}, ...
 * @param {Array} chains
 * @param {Array} allProxyNames
 * @returns {Array} Surge relay group config strings
 */
export function buildSurgeChainGroups(chains, allProxyNames = []) {
    if (!Array.isArray(chains) || chains.length === 0) return [];

    const nameSet = new Set(allProxyNames);
    const chainGroups = [];

    for (const chain of chains) {
        if (!chain.enabled) continue;
        const nodeNames = Array.isArray(chain.nodes) ? chain.nodes : [];
        if (nodeNames.length < 2) continue;

        const validNodes = nodeNames.filter(name => nameSet.has(name));
        if (validNodes.length < 2) continue;

        chainGroups.push({
            name: chain.name || `Chain-${chain.id?.slice(0, 8) || 'unknown'}`,
            type: 'relay',
            proxies: validNodes
        });
    }

    return chainGroups;
}

/**
 * Build chain outbounds for Sing-Box output.
 * @param {Array} chains
 * @param {Array} allOutboundTags - All available outbound tags
 * @returns {Array} Sing-Box chain outbound configs
 */
export function buildSingboxChainOutbounds(chains, allOutboundTags = []) {
    if (!Array.isArray(chains) || chains.length === 0) return [];

    const tagSet = new Set(allOutboundTags);
    const chainOutbounds = [];

    for (const chain of chains) {
        if (!chain.enabled) continue;
        const nodeNames = Array.isArray(chain.nodes) ? chain.nodes : [];
        if (nodeNames.length < 2) continue;

        const validNodes = nodeNames.filter(name => tagSet.has(name));
        if (validNodes.length < 2) continue;

        chainOutbounds.push({
            type: 'chain',
            tag: chain.name || `chain-${chain.id?.slice(0, 8) || 'unknown'}`,
            outbounds: validNodes
        });
    }

    return chainOutbounds;
}

/**
 * Build Loon Proxy Chain configurations.
 * Loon format:
 *   [Proxy Chain]
 *   ChainName = NodeA, NodeB, NodeC
 * @param {Array} chains
 * @param {Array} allProxyNames
 * @returns {Array} Loon chain config strings
 */
export function buildLoonChainConfigs(chains, allProxyNames = []) {
    if (!Array.isArray(chains) || chains.length === 0) return [];

    const nameSet = new Set(allProxyNames);
    const chainsConfig = [];

    for (const chain of chains) {
        if (!chain.enabled) continue;
        const nodeNames = Array.isArray(chain.nodes) ? chain.nodes : [];
        if (nodeNames.length < 2) continue;

        const validNodes = nodeNames.filter(name => nameSet.has(name));
        if (validNodes.length < 2) continue;

        chainsConfig.push({
            name: chain.name || `Chain-${chain.id?.slice(0, 8) || 'unknown'}`,
            nodes: validNodes
        });
    }

    return chainsConfig;
}

/**
 * Format chain configs as INI section for Surge/Loon-style outputs.
 * @param {Array} chainConfigs - Output from buildSurgeChainGroups or buildLoonChainConfigs
 * @param {string} format - 'surge' or 'loon'
 * @returns {string} Formatted INI section
 */
export function formatChainIniSection(chainConfigs, format = 'surge') {
    if (!Array.isArray(chainConfigs) || chainConfigs.length === 0) return '';

    const lines = [];
    for (const chain of chainConfigs) {
        if (format === 'loon') {
            // [Proxy Chain] section format
            lines.push(`${chain.name} = ${chain.proxies || chain.nodes?.join(', ')}`);
        } else {
            // Surge relay format
            lines.push(`${chain.name} = relay, ${chain.proxies?.join(', ')}`);
        }
    }

    return lines.join('\n');
}

/**
 * Check if any chains reference a specific node name.
 * Used to prevent name conflicts and validate chain integrity.
 * @param {Array} chains
 * @param {string} nodeName
 * @returns {boolean}
 */
export function isNodeUsedInChain(chains, nodeName) {
    if (!Array.isArray(chains) || !nodeName) return false;
    return chains.some(chain =>
        Array.isArray(chain.nodes) && chain.nodes.includes(nodeName)
    );
}
