<script setup>
import { ref, computed, onMounted } from 'vue';
import { useDataStore } from '../stores/useDataStore.js';
import { storeToRefs } from 'pinia';
import { useEditorStore } from '../stores/editor.js';
import { api } from '../lib/http.js';
import { useToastStore } from '../stores/toast';
import { useI18n } from '../i18n/index.js';

const { t } = useI18n();
const dataStore = useDataStore();
const editorStore = useEditorStore();
const toastStore = useToastStore();
const { showToast } = toastStore;

const { routingRules, chains, outbounds } = storeToRefs(dataStore);

const RULE_FIELDS = [
  { value: 'domain', label: 'Domain (完整域名)', placeholder: 'example.com' },
  { value: 'domain_suffix', label: 'Domain Suffix (域名后缀)', placeholder: '.example.com' },
  { value: 'domain_keyword', label: 'Domain Keyword (域名关键字)', placeholder: 'google' },
  { value: 'domain_regex', label: 'Domain Regex (域名正则)', placeholder: '^.*\\.example\\.com$' },
  { value: 'ip_cidr', label: 'IP CIDR (目标IP)', placeholder: '1.2.3.0/24' },
  { value: 'ip_cidr_src', label: 'Source IP CIDR (源IP)', placeholder: '192.168.0.0/16' },
  { value: 'port', label: 'Port (目标端口)', placeholder: '443' },
  { value: 'port_src', label: 'Source Port (源端口)', placeholder: '1024-65535' },
  { value: 'protocol', label: 'Protocol (协议)', placeholder: 'http, tls, etc.' },
  { value: 'network', label: 'Network (网络类型)', placeholder: 'tcp' },
  { value: 'geoip', label: 'GeoIP (国家代码)', placeholder: 'CN, US, JP' },
  { value: 'geosite', label: 'GeoSite (站点分类)', placeholder: 'google, youtube' },
  { value: 'process_name', label: 'Process Name (进程名)', placeholder: 'chrome.exe' }
];

const TARGET_TYPES = [
  { value: 'direct', label: 'DIRECT (直连)' },
  { value: 'block', label: 'REJECT (拒绝)' },
  { value: 'dns', label: 'DNS' },
  { value: 'proxy', label: '代理节点' },
  { value: 'outbound', label: '自定义出站' },
  { value: 'chain', label: '链式代理' },
  { value: 'proxy_group', label: '策略组' }
];

const availableProxyNodes = computed(() => {
  const nodes = [];
  const subs = dataStore.subscriptions || [];
  subs.forEach(sub => {
    if (sub.nodes && Array.isArray(sub.nodes)) {
      sub.nodes.forEach(node => {
        if (typeof node === 'string') nodes.push(node);
        else if (node?.name) nodes.push(node.name);
      });
    }
  });
  return [...new Set(nodes)].sort();
});

const availableOutboundTargets = computed(() => {
  return (outbounds.value || []).filter(o => o.enabled);
});

const availableChainTargets = computed(() => {
  return (chains.value || []).filter(c => c.enabled);
});

const isLoading = ref(false);
const showEditor = ref(false);
const editingRule = ref(null);
const isSaving = ref(false);

const form = ref({
  name: '',
  description: '',
  enabled: true,
  matchMode: 'any',
  conditions: [{ field: 'domain', operator: 'eq', value: '', invert: false }],
  targetType: 'proxy',
  target: '',
  priority: 0
});

function openCreate() {
  editingRule.value = null;
  form.value = { name: '', description: '', enabled: true, matchMode: 'any', conditions: [{ field: 'domain', operator: 'eq', value: '', invert: false }], targetType: 'proxy', target: '', priority: 0 };
  showEditor.value = true;
}

function openEdit(rule) {
  editingRule.value = rule;
  form.value = {
    name: rule.name || '',
    description: rule.description || '',
    enabled: rule.enabled !== false,
    matchMode: rule.matchMode || 'any',
    conditions: rule.conditions?.length ? rule.conditions.map(c => ({ ...c })) : [{ field: 'domain', operator: 'eq', value: '', invert: false }],
    targetType: rule.targetType || 'proxy',
    target: rule.target || '',
    priority: rule.priority || 0
  };
  showEditor.value = true;
}

async function saveRule() {
  if (!form.value.name.trim()) { showToast('规则名称不能为空', 'warning'); return; }
  if (!form.value.conditions.some(c => c.value.trim())) { showToast('至少需要一个有效条件', 'warning'); return; }
  isSaving.value = true;
  try {
    const payload = {
      ...form.value,
      conditions: form.value.conditions.filter(c => c.value.trim())
    };
    if (editingRule.value) {
      const res = await api.put(`/api/routing-rules/${editingRule.value.id}`, payload);
      if (res.success) {
        const idx = routingRules.value.findIndex(r => r.id === editingRule.value.id);
        if (idx !== -1) routingRules.value[idx] = res.data;
        showToast('路由规则已保存', 'success');
      }
    } else {
      const res = await api.post('/api/routing-rules', payload);
      if (res.success) { routingRules.value.push(res.data); showToast('路由规则已创建', 'success'); }
    }
    showEditor.value = false;
    editorStore.markDirty();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  } finally {
    isSaving.value = false;
  }
}

async function removeRule(rule) {
  if (!window.confirm(`确定要删除路由规则 "${rule.name}" 吗？`)) return;
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

function addCondition() {
  form.value.conditions.push({ field: 'domain', operator: 'eq', value: '', invert: false });
}

function removeCondition(idx) {
  if (form.value.conditions.length > 1) {
    form.value.conditions.splice(idx, 1);
  }
}

function getFieldOperators(field) {
  const ops = {
    domain: [{ value: 'eq', label: '等于' }, { value: 'suffix', label: '后缀匹配' }, { value: 'keyword', label: '包含关键字' }, { value: 'regex', label: '正则匹配' }],
    domain_suffix: [{ value: 'eq', label: '等于' }, { value: 'suffix', label: '后缀匹配' }],
    domain_keyword: [{ value: 'eq', label: '等于' }, { value: 'keyword', label: '包含关键字' }],
    domain_regex: [{ value: 'eq', label: '等于' }, { value: 'regex', label: '正则匹配' }],
    ip_cidr: [{ value: 'in', label: '在范围内' }, { value: 'not_in', label: '不在范围内' }],
    ip_cidr_src: [{ value: 'in', label: '在范围内' }, { value: 'not_in', label: '不在范围内' }],
    port: [{ value: 'eq', label: '等于' }, { value: 'range', label: '范围' }, { value: 'in', label: '在列表中' }],
    port_src: [{ value: 'eq', label: '等于' }, { value: 'range', label: '范围' }],
    protocol: [{ value: 'eq', label: '等于' }, { value: 'in', label: '在列表中' }],
    network: [{ value: 'eq', label: '等于' }],
    geoip: [{ value: 'in', label: '在列表中' }, { value: 'not_in', label: '不在列表中' }],
    geosite: [{ value: 'in', label: '在列表中' }, { value: 'not_in', label: '不在列表中' }],
    process_name: [{ value: 'eq', label: '等于' }, { value: 'keyword', label: '包含' }]
  };
  return ops[field] || [{ value: 'eq', label: '等于' }];
}

function getFieldPlaceholder(field) {
  const found = RULE_FIELDS.find(f => f.value === field);
  return found ? found.placeholder : '输入值';
}

function formatConditionDisplay(cond) {
  const prefix = cond.invert ? 'NOT ' : '';
  const fieldLabel = RULE_FIELDS.find(f => f.value === cond.field)?.label || cond.field;
  return `${prefix}${fieldLabel}: ${cond.value}`;
}

function getTargetDisplay(rule) {
  const tt = TARGET_TYPES.find(t => t.value === rule.targetType);
  const typeLabel = tt ? tt.label : rule.targetType;
  if (rule.targetType === 'proxy') return `${typeLabel}: ${rule.target}`;
  if (rule.targetType === 'outbound') {
    const ob = availableOutboundTargets.value.find(o => o.id === rule.target || o.name === rule.target);
    return `${typeLabel}: ${ob ? ob.name : rule.target}`;
  }
  if (rule.targetType === 'chain') {
    const ch = availableChainTargets.value.find(c => c.id === rule.target || c.name === rule.target);
    return `${typeLabel}: ${ch ? ch.name : rule.target}`;
  }
  return typeLabel;
}

onMounted(async () => {
  isLoading.value = true;
  try {
    await dataStore.fetchData();
  } catch (e) {
    console.error('[RoutingRules]', e);
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <div class="routing-rules">
    <div class="page-header">
      <div>
        <h2>路由规则</h2>
        <p class="text-muted">管理 3x-ui 风格的路由规则，实现智能流量分发与链式代理效果</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        新增路由规则
      </button>
    </div>

    <!-- Rules List -->
    <div v-if="routingRules.length === 0" class="empty-state">
      <div class="empty-icon">🚦</div>
      <h3>暂无路由规则</h3>
      <p>创建路由规则来定义流量如何分发到不同的出站、代理节点或链式代理</p>
    </div>

    <div v-else class="rules-list">
      <div v-for="rule in routingRules" :key="rule.id" class="rule-card" :class="{ disabled: !rule.enabled }">
        <div class="rule-header">
          <div class="rule-info">
            <h4>{{ rule.name }}</h4>
            <span class="rule-priority">优先级: {{ rule.priority || 0 }}</span>
            <span class="rule-mode">{{ rule.matchMode === 'all' ? '所有条件匹配' : '任一条件匹配' }}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" :checked="rule.enabled" @change="toggleRule(rule)">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <p v-if="rule.description" class="rule-desc">{{ rule.description }}</p>
        <div class="rule-conditions">
          <span v-for="(cond, idx) in rule.conditions" :key="idx" class="condition-tag" :class="{ invert: cond.invert }">
            {{ formatConditionDisplay(cond) }}
          </span>
        </div>
        <div class="rule-target">
          ➡️ 目标: <strong>{{ getTargetDisplay(rule) }}</strong>
        </div>
        <div class="rule-actions">
          <button class="btn btn-sm" @click="openEdit(rule)">编辑</button>
          <button class="btn btn-sm btn-danger" @click="removeRule(rule)">删除</button>
        </div>
      </div>
    </div>

    <!-- Editor Modal -->
    <div v-if="showEditor" class="modal-overlay" @click.self="showEditor = false">
      <div class="modal modal-wide">
        <div class="modal-header">
          <h3>{{ editingRule ? '编辑路由规则' : '新增路由规则' }}</h3>
          <button class="btn-close" @click="showEditor = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <div class="form-group flex-2">
              <label>规则名称</label>
              <input v-model="form.name" class="form-input" placeholder="例如: 谷歌流量走代理" />
            </div>
            <div class="form-group flex-1">
              <label>优先级</label>
              <input v-model.number="form.priority" class="form-input" type="number" placeholder="0" />
            </div>
          </div>
          <div class="form-group">
            <label>描述</label>
            <input v-model="form.description" class="form-input" placeholder="可选描述" />
          </div>
          <div class="form-row">
            <div class="form-group flex-1">
              <label>匹配模式</label>
              <select v-model="form.matchMode" class="form-input">
                <option value="any">任一条件匹配 (OR)</option>
                <option value="all">所有条件匹配 (AND)</option>
              </select>
            </div>
            <div class="form-group flex-1">
              <label>目标类型</label>
              <select v-model="form.targetType" class="form-input">
                <option v-for="tt in TARGET_TYPES" :key="tt.value" :value="tt.value">{{ tt.label }}</option>
              </select>
            </div>
            <div class="form-group flex-2">
              <label>目标值</label>
              <template v-if="form.targetType === 'proxy'">
                <select v-model="form.target" class="form-input">
                  <option value="">选择代理节点...</option>
                  <option v-for="node in availableProxyNodes" :key="node" :value="node">{{ node }}</option>
                </select>
              </template>
              <template v-else-if="form.targetType === 'outbound'">
                <select v-model="form.target" class="form-input">
                  <option value="">选择自定义出站...</option>
                  <option v-for="ob in availableOutboundTargets" :key="ob.id" :value="ob.id">{{ ob.name }} ({{ ob.type }})</option>
                </select>
              </template>
              <template v-else-if="form.targetType === 'chain'">
                <select v-model="form.target" class="form-input">
                  <option value="">选择链式代理...</option>
                  <option v-for="ch in availableChainTargets" :key="ch.id" :value="ch.id">{{ ch.name }}</option>
                </select>
              </template>
              <template v-else>
                <input v-model="form.target" class="form-input" :placeholder="'输入目标名称 (如: ' + form.targetType.toUpperCase() + ')'" />
              </template>
            </div>
          </div>

          <div class="conditions-section">
            <div class="conditions-header">
              <label>匹配条件</label>
              <button class="btn btn-sm" @click="addCondition">+ 添加条件</button>
            </div>
            <div v-for="(cond, idx) in form.conditions" :key="idx" class="condition-row">
              <label class="invert-label">
                <input type="checkbox" v-model="cond.invert" />
                反向
              </label>
              <select v-model="cond.field" class="form-input cond-field" @change="cond.operator = 'eq'">
                <option v-for="f in RULE_FIELDS" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
              <select v-model="cond.operator" class="form-input cond-operator">
                <option v-for="op in getFieldOperators(cond.field)" :key="op.value" :value="op.value">{{ op.label }}</option>
              </select>
              <input v-model="cond.value" class="form-input cond-value" :placeholder="getFieldPlaceholder(cond.field)" />
              <button v-if="form.conditions.length > 1" class="btn btn-sm btn-danger" @click="removeCondition(idx)">✕</button>
            </div>
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
.rule-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.rule-info h4 { margin: 0; font-size: 1rem; }
.rule-priority { font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; background: var(--badge-bg, #334155); }
.rule-mode { font-size: 0.75rem; color: var(--text-secondary, #94a3b8); }
.rule-desc { font-size: 0.85rem; color: var(--text-secondary, #94a3b8); margin: 8px 0; }
.rule-conditions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.condition-tag { padding: 3px 8px; border-radius: 4px; background: var(--tag-bg, #1e3a5f); font-size: 0.8rem; }
.condition-tag.invert { border: 1px solid var(--warning, #f59e0b); }
.rule-target { font-size: 0.9rem; margin: 8px 0; padding: 8px; background: var(--highlight-bg, #0f172a); border-radius: 6px; }
.rule-actions { display: flex; gap: 8px; margin-top: 8px; }
.empty-state { text-align: center; padding: 60px 20px; }
.empty-icon { font-size: 3rem; margin-bottom: 16px; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: var(--card-bg, #1e293b); border-radius: 16px; padding: 24px; max-width: 800px; width: 90%; max-height: 80vh; overflow-y: auto; }
.modal-wide { max-width: 900px; }
.modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
.modal-header h3 { margin: 0; }
.btn-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); }
.form-row { display: flex; gap: 12px; }
.form-group { margin-bottom: 16px; }
.form-group.flex-1 { flex: 1; }
.form-group.flex-2 { flex: 2; }
.form-group label { display: block; margin-bottom: 6px; font-size: 0.875rem; font-weight: 500; }
.form-input { width: 100%; padding: 8px 12px; border: 1px solid var(--border-color, #334155); border-radius: 8px; background: var(--input-bg, #0f172a); color: inherit; font-size: 0.875rem; box-sizing: border-box; }
.conditions-section { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-color, #334155); }
.conditions-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.conditions-header label { font-weight: 500; }
.condition-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
.condition-row .form-input { flex: 1; }
.cond-field { min-width: 180px; }
.cond-operator { min-width: 100px; }
.cond-value { min-width: 200px; }
.invert-label { display: flex; align-items: center; gap: 4px; font-size: 0.8rem; white-space: nowrap; }
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
