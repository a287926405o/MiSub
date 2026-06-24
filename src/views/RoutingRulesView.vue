<script setup>
import { ref, computed, onMounted } from 'vue';
import { useDataStore } from '../stores/useDataStore.js';
import { storeToRefs } from 'pinia';
import { useEditorStore } from '../stores/editor.js';
import { api } from '../lib/http.js';
import { useToastStore } from '../stores/toast';
import { extractNodeName } from '../lib/utils.js';

const dataStore = useDataStore();
const editorStore = useEditorStore();
const toastStore = useToastStore();
const { showToast } = toastStore;
const { routingRules, outbounds, chains } = storeToRefs(dataStore);

const SOURCE_TYPES = [
  { value: 'node', label: '节点路由', desc: '指定某个代理节点走此出站（链式代理）' },
  { value: 'domain', label: '域名匹配', desc: '完整域名匹配' },
  { value: 'domain_suffix', label: '域名后缀', desc: '域名后缀匹配，如 .example.com' },
  { value: 'domain_keyword', label: '域名关键字', desc: '域名包含关键字' },
  { value: 'ip_cidr', label: 'IP 段', desc: 'IP CIDR 范围匹配' },
  { value: 'geoip', label: 'GeoIP 国家', desc: '国家代码，如 CN、US' },
  { value: 'geosite', label: 'GeoSite 分类', desc: '站点分类，如 google、youtube' },
  { value: 'port', label: '端口', desc: '目标端口匹配' },
  { value: 'all', label: '兜底规则', desc: '所有剩余流量走此出站（相当于 MATCH）' }
];

/**
 * 收集所有可用的代理节点名称供路由规则参考。
 * 
 * 数据模型说明：
 * - subscriptions 数组中既包含「订阅链接」(http/https) 也包含「手动节点」(ss://, vmess:// 等)
 * - 手动节点的名称可以从 URL 中解析 (extractNodeName)
 * - 订阅链接的节点名只有服务器端解析后才可知，这里尝试从订阅名称推断
 * - 最终由用户手动输入精确的节点名来匹配
 */
const availableProxyNodes = computed(() => {
  const nodes = new Set();
  const subscriptions = dataStore.subscriptions || [];
  
  for (const sub of subscriptions) {
    if (!sub || !sub.url) continue;
    
    // 1. 手动节点 (非 http/https 链接)：从 URL 解析名称
    if (!sub.url.startsWith('http://') && !sub.url.startsWith('https://')) {
      const name = extractNodeName(sub.url);
      if (name) nodes.add(name);
    }
    
    // 2. 如果订阅本身有 name/remark 属性，也作为候选
    if (sub.name) nodes.add(sub.name);
    if (sub.remark) nodes.add(sub.remark);
    
    // 3. 如果已有解析后的节点列表 (某些场景下可能缓存)
    if (sub.nodes && Array.isArray(sub.nodes)) {
      for (const node of sub.nodes) {
        if (typeof node === 'string') nodes.add(node);
        else if (node?.name) nodes.add(node.name);
      }
    }
  }
  
  return [...nodes].sort();
});

/** 节点搜索过滤（用于输入提示） */
const nodeSearch = ref('');
const filteredNodeSuggestions = computed(() => {
  const all = availableProxyNodes.value;
  if (!nodeSearch.value) return all.slice(0, 50);
  const q = nodeSearch.value.toLowerCase();
  return all.filter(n => n.toLowerCase().includes(q)).slice(0, 50);
});

const activeOutbounds = computed(() => (outbounds.value || []).filter(o => o.enabled));

const isLoading = ref(false);
const showEditor = ref(false);
const editingRule = ref(null);
const isSaving = ref(false);

const form = ref({
  name: '',
  description: '',
  enabled: true,
  sourceType: 'node',
  sourceValue: '',
  targetOutbound: '',
  priority: 0
});

function getProtocolLabel(protocol) {
  const labels = { shadowsocks:'SS', vmess:'VMess', trojan:'Trojan', vless:'VLESS',
    hysteria2:'HY2', socks5:'SOCKS5', http:'HTTP', wireguard:'WG', direct:'直连', block:'拒绝' };
  return labels[protocol] || protocol;
}

function getSourceTypeLabel(type) {
  return SOURCE_TYPES.find(s => s.value === type)?.label || type;
}

function openCreate() {
  editingRule.value = null;
  form.value = { name: '', description: '', enabled: true, sourceType: 'node', sourceValue: '', targetOutbound: '', priority: 0 };
  showEditor.value = true;
}

function openEdit(rule) {
  editingRule.value = rule;
  form.value = {
    name: rule.name || '',
    description: rule.description || '',
    enabled: rule.enabled !== false,
    sourceType: rule.sourceType || 'node',
    sourceValue: rule.sourceValue || '',
    targetOutbound: rule.targetOutbound || '',
    priority: rule.priority || 0
  };
  showEditor.value = true;
}

async function saveRule() {
  if (!form.value.name.trim()) { showToast('规则名称不能为空', 'warning'); return; }
  if (form.value.sourceType !== 'all' && !form.value.sourceValue) {
    showToast('请填写匹配值', 'warning'); return;
  }
  if (!form.value.targetOutbound) { showToast('请选择目标出站', 'warning'); return; }
  isSaving.value = true;
  try {
    if (editingRule.value) {
      const res = await api.put(`/api/routing-rules/${editingRule.value.id}`, form.value);
      if (res.success) {
        const idx = routingRules.value.findIndex(r => r.id === editingRule.value.id);
        if (idx !== -1) routingRules.value[idx] = res.data;
        showToast('路由规则已保存', 'success');
      }
    } else {
      const res = await api.post('/api/routing-rules', form.value);
      if (res.success) { routingRules.value.push(res.data); showToast('路由规则已创建', 'success'); }
    }
    showEditor.value = false;
    editorStore.markDirty();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  } finally { isSaving.value = false; }
}

async function removeRule(rule) {
  if (!window.confirm(`确定删除路由规则 "${rule.name}" 吗？`)) return;
  try {
    const res = await api.del(`/api/routing-rules/${rule.id}`);
    if (res.success) {
      routingRules.value = routingRules.value.filter(r => r.id !== rule.id);
      showToast('路由规则已删除', 'success');
      editorStore.markDirty();
    }
  } catch (e) { showToast(e.message || '删除失败', 'error'); }
}

async function toggleRule(rule) {
  try {
    const res = await api.put(`/api/routing-rules/${rule.id}`, { enabled: !rule.enabled });
    if (res.success) { Object.assign(rule, res.data); editorStore.markDirty(); }
  } catch (e) { showToast(e.message || '切换失败', 'error'); }
}

function getOutboundNameById(idOrName) {
  const ob = activeOutbounds.value.find(o => o.id === idOrName || o.name === idOrName);
  return ob ? `${ob.name} (${getProtocolLabel(ob.protocol)})` : idOrName;
}

onMounted(async () => {
  isLoading.value = true;
  try { await dataStore.fetchData(); } catch (e) { console.error(e); }
  finally { isLoading.value = false; }
});
</script>

<template>
  <div class="routing-rules">
    <div class="page-header">
      <div>
        <h2>🚦 路由规则</h2>
        <p class="text-muted">选择哪个节点走哪个出站，从而实现链式代理效果</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        新增路由
      </button>
    </div>

    <div v-if="routingRules.length === 0" class="empty-state">
      <div class="empty-icon">🚦</div>
      <h3>暂无路由规则</h3>
      <p>创建一个路由规则，选择"哪个代理节点 → 哪个出站"，即可实现链式代理效果</p>
      <p class="example">例如：香港节点 → WARP 出站，流量路径为：你 → 香港节点 → WARP → 互联网</p>
    </div>

    <div v-else class="rules-list">
      <div v-for="rule in routingRules" :key="rule.id" class="rule-card" :class="{ disabled: !rule.enabled }">
        <div class="rule-header">
          <div class="rule-info">
            <h4>{{ rule.name }}</h4>
            <span class="badge priority">P{{ rule.priority || 0 }}</span>
            <span class="badge type">{{ getSourceTypeLabel(rule.sourceType) }}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" :checked="rule.enabled" @change="toggleRule(rule)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <p v-if="rule.description" class="rule-desc">{{ rule.description }}</p>
        <div class="rule-flow">
          <div class="flow-step source">
            <template v-if="rule.sourceType === 'node'">
              <span class="flow-icon">📦</span>
              <span class="flow-value">节点: {{ rule.sourceValue }}</span>
            </template>
            <template v-else-if="rule.sourceType === 'all'">
              <span class="flow-icon">🌍</span>
              <span class="flow-value">所有剩余流量</span>
            </template>
            <template v-else>
              <span class="flow-icon">🔍</span>
              <span class="flow-value">{{ getSourceTypeLabel(rule.sourceType) }}: {{ rule.sourceValue }}</span>
            </template>
          </div>
          <div class="flow-arrow">➡️</div>
          <div class="flow-step target">
            <span class="flow-icon">📡</span>
            <span class="flow-value">{{ getOutboundNameById(rule.targetOutbound) }}</span>
          </div>
        </div>
        <div class="rule-actions">
          <button class="btn btn-sm" @click="openEdit(rule)">编辑</button>
          <button class="btn btn-sm btn-danger" @click="removeRule(rule)">删除</button>
        </div>
      </div>
      <div v-if="routingRules.length > 0" class="chain-hint">
        💡 <strong>链式代理效果</strong>：路由规则按优先级从高到低匹配，匹配成功后流量按 节点 → 出站 路径传输
      </div>
    </div>

    <!-- Editor Modal -->
    <div v-if="showEditor" class="modal-overlay" @click.self="showEditor = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ editingRule ? '编辑路由规则' : '新增路由规则' }}</h3>
          <button class="btn-close" @click="showEditor = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group flex-2">
              <label>规则名称</label>
              <input v-model="form.name" class="form-input" placeholder="例如: 香港节点走WARP" />
            </div>
            <div class="form-group flex-1">
              <label>优先级</label>
              <input v-model.number="form.priority" class="form-input" type="number" placeholder="0" />
            </div>
          </div>
          <div class="form-group">
            <label>描述（可选）</label>
            <input v-model="form.description" class="form-input" placeholder="描述这条路由的用途" />
          </div>

          <div class="card form-card">
            <div class="form-card-title">① 选择流量来源（谁来路由）</div>
            <div class="form-group">
              <label>来源类型</label>
              <select v-model="form.sourceType" class="form-input">
                <option v-for="st in SOURCE_TYPES" :key="st.value" :value="st.value">{{ st.label }} — {{ st.desc }}</option>
              </select>
            </div>
            <div class="form-group" v-if="form.sourceType !== 'all'">
              <label>
                <template v-if="form.sourceType === 'node'">选择代理节点</template>
                <template v-else>匹配值</template>
              </label>
              <template v-if="form.sourceType === 'node'">
                <div class="node-input-wrap">
                  <input v-model="form.sourceValue" class="form-input" list="node-suggestions"
                    placeholder="输入节点名称（如「香港 01」「日本 VPS」等）"
                    @input="nodeSearch = form.sourceValue" />
                  <datalist id="node-suggestions">
                    <option v-for="node in filteredNodeSuggestions" :key="node" :value="node" />
                  </datalist>
                  <div v-if="availableProxyNodes.length > 0" class="node-hint">
                    💡 已知节点：{{ availableProxyNodes.slice(0, 8).join('、') }}{{ availableProxyNodes.length > 8 ? '...' : '' }}
                  </div>
                  <div v-else class="node-hint">
                    ⚠️ 暂未检测到节点名称。订阅节点名只有在服务端解析后才可知，请直接输入您希望在路由规则中匹配的节点名称。
                  </div>
                </div>
              </template>
              <template v-else>
                <input v-model="form.sourceValue" class="form-input"
                  :placeholder="form.sourceType === 'domain' ? 'example.com' :
                    form.sourceType === 'domain_suffix' ? '.example.com' :
                    form.sourceType === 'domain_keyword' ? 'google' :
                    form.sourceType === 'ip_cidr' ? '1.2.3.0/24' :
                    form.sourceType === 'geoip' ? 'CN, US, JP' :
                    form.sourceType === 'geosite' ? 'google, youtube' :
                    form.sourceType === 'port' ? '443, 80' : '输入值'" />
              </template>
            </div>
          </div>

          <div class="card form-card">
            <div class="form-card-title">② 选择目标出站（出口节点）</div>
            <div class="form-group">
              <label>目标出站</label>
              <select v-model="form.targetOutbound" class="form-input">
                <option value="">选择出站...</option>
                <option v-for="ob in activeOutbounds" :key="ob.id" :value="ob.id">
                  {{ ob.name }} ({{ getProtocolLabel(ob.protocol) }}) — {{ ob.server || '' }}
                </option>
              </select>
            </div>
            <p class="form-hint" v-if="form.sourceType === 'node' && form.sourceValue && form.targetOutbound">
              路由效果： <strong>{{ form.sourceValue }} → {{ getOutboundNameById(form.targetOutbound) }} → 互联网</strong>
            </p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" @click="showEditor = false">取消</button>
          <button class="btn btn-primary" :disabled="isSaving" @click="saveRule">
            {{ isSaving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.routing-rules { max-width: 1200px; margin: 0 auto; padding: 24px; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
.page-header h2 { margin: 0; font-size: 1.5rem; }
.text-muted { color: var(--text-secondary, #94a3b8); margin: 4px 0 0; font-size: 0.875rem; }
.rules-list { display: flex; flex-direction: column; gap: 12px; }
.rule-card { background: var(--card-bg, #1e293b); border: 1px solid var(--border-color, #334155); border-radius: 12px; padding: 16px; }
.rule-card.disabled { opacity: 0.5; }
.rule-header { display: flex; justify-content: space-between; align-items: flex-start; }
.rule-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rule-info h4 { margin: 0; font-size: 1rem; }
.badge { font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; }
.priority { background: var(--badge-bg, #334155); }
.type { background: var(--primary, #3b82f6); color: white; }
.rule-desc { font-size: 0.85rem; color: var(--text-secondary, #94a3b8); margin: 8px 0; }
.rule-flow { display: flex; align-items: center; gap: 16px; margin: 12px 0; padding: 12px; background: var(--highlight-bg, #0f172a); border-radius: 8px; flex-wrap: wrap; }
.flow-step { display: flex; align-items: center; gap: 6px; }
.flow-icon { font-size: 1.2rem; }
.flow-value { font-weight: 500; }
.flow-arrow { font-size: 1.5rem; color: var(--primary, #3b82f6); }
.rule-actions { display: flex; gap: 8px; margin-top: 8px; }
.chain-hint { font-size: 0.85rem; color: var(--text-secondary, #94a3b8); padding: 12px; background: var(--highlight-bg, #0f172a); border-radius: 8px; }
.empty-state { text-align: center; padding: 60px 20px; }
.empty-icon { font-size: 3rem; margin-bottom: 16px; }
.example { font-size: 0.85rem; color: var(--text-secondary); margin-top: 8px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--card-bg, #1e293b); border-radius: 16px; padding: 24px; max-width: 650px; width: 90%; max-height: 80vh; overflow-y: auto; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.modal-header h3 { margin: 0; }
.btn-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); }
.form-row { display: flex; gap: 12px; }
.form-group { margin-bottom: 16px; }
.form-group.flex-1 { flex: 1; }
.form-group.flex-2 { flex: 2; }
.form-group label { display: block; margin-bottom: 6px; font-size: 0.875rem; font-weight: 500; }
.form-input { width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #334155); border-radius: 8px; background: var(--input-bg, #0f172a); color: inherit; font-size: 0.875rem; box-sizing: border-box; }
.form-card { padding: 16px; margin-bottom: 16px; border: 1px solid var(--border-color, #334155); border-radius: 10px; background: var(--input-bg, #0f172a); }
.form-card-title { font-weight: 600; margin-bottom: 12px; font-size: 0.95rem; }
.form-hint { font-size: 0.85rem; color: var(--primary, #3b82f6); margin-top: 4px; }
.node-input-wrap { position: relative; }
.node-hint { font-size: 0.78rem; color: var(--text-secondary, #94a3b8); margin-top: 6px; line-height: 1.4; }
.modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-color, #334155); }
.btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-color, #334155); background: var(--btn-bg, #334155); color: inherit; cursor: pointer; font-size: 0.875rem; }
.btn-primary { background: var(--primary, #3b82f6); border-color: var(--primary, #3b82f6); color: white; }
.btn-danger { background: var(--danger, #ef4444); border-color: var(--danger, #ef4444); color: white; }
.btn-sm { padding: 4px 12px; font-size: 0.8rem; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.toggle { position: relative; display: inline-block; width: 40px; height: 22px; }
.toggle input { opacity: 0; width: 0; height: 0; }
.toggle-slider { position: absolute; cursor: pointer; inset: 0; background: #475569; border-radius: 22px; transition: 0.3s; }
.toggle-slider::before { content: ''; position: absolute; height: 18px; width: 18px; left: 2px; bottom: 2px; background: white; border-radius: 50%; transition: 0.3s; }
.toggle input:checked + .toggle-slider { background: var(--primary, #3b82f6); }
.toggle input:checked + .toggle-slider::before { transform: translateX(18px); }
</style>
