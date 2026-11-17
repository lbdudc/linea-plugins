<template>
  <div class="uvla-root">

    <!-- ── Tabs ───────────────────────────────────────────────────────────────── -->
    <Tabs v-model:value="internalActiveTab" class="uvla-tabs">
      <div class="uvla-tabbar">
      <TabList class="uvla-tabbar__tabs">
        <Tab
          value="model information"
          :disabled="modelInvalid === 'yes' || loading || metricsLoadingTabs"
        >
          <i class="pi pi-chart-pie uvla-tab-icon" style="font-size: 14px" aria-hidden="true"></i>{{ $t('labels.model_information') }}
        </Tab>
        <Tab
          value="sat2"
          :disabled="modelInvalid === 'yes' || loading || metricsLoadingTabs"
        >
          <i class="pi pi-microchip uvla-tab-icon" style="font-size: 14px" aria-hidden="true"></i>{{ $t('labels.fm_analysis_tab') }}
        </Tab>
      </TabList>
      <div v-if="$slots.actions" class="uvla-tabbar__actions"><slot name="actions" /></div>
      </div>

      <!-- ── Tab panels ─────────────────────────────────────────────────────────── -->
      <TabPanels class="uvla-panels">

        <!-- ── Model information ──────────────────────────────────────────────── -->
        <TabPanel value="model information" class="uvla-scroll fm-info-panel">
          <!-- Carga: mismos huecos que el contenido real, en gris -->
          <div v-if="loading" class="fm-info-layout">
            <div class="ops-metric-card">
              <div class="ops-metric-card__label-wrap ops-metric-card__label-wrap--gap-md">
                <Skeleton width="122px" height="12px" />
              </div>
              <div class="fm-dist-inner">
                <Skeleton shape="circle" size="120px" />
                <div class="fm-legend">
                  <Skeleton v-for="n in 3" :key="`sk-legend-${n}`" width="160px" height="11px" />
                </div>
              </div>
            </div>

            <div class="fm-kpi-row">
              <Skeleton v-for="n in 4" :key="`sk-kpi-${n}`" height="58px" />
            </div>

            <div v-for="n in 2" :key="`sk-chips-${n}`" class="ops-metric-card">
              <div class="ops-metric-card__label-wrap ops-metric-card__label-wrap--gap-sm">
                <Skeleton width="104px" height="12px" />
              </div>
              <div class="fm-chip-section__chips">
                <Skeleton v-for="c in 6" :key="`sk-chip-${n}-${c}`" width="64px" height="22px" />
              </div>
            </div>
          </div>

          <div v-else-if="modelInvalid === 'no'" class="fm-info-layout">

            <!-- Distribution card -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__label-wrap ops-metric-card__label-wrap--gap-md">
                <i class="pi pi-chart-pie" style="font-size: 13px; color: var(--p-primary-color)" aria-hidden="true"></i>
                <span class="ops-metric-card__label">{{ $t('labels.feature_distribution') }}</span>
              </div>
              <div class="fm-dist-inner">
                <div class="fm-overview__chart-wrap">
                  <Doughnut
                    :data="featureChartData"
                    :options="featureChartOptions"
                    class="fm-overview__donut"
                  />
                  <div class="fm-overview__center">
                    <span class="fm-overview__center-val">{{ totalFeaturesCount }}</span>
                    <span class="fm-overview__center-lbl">{{ $t('labels.total_features') }}</span>
                  </div>
                </div>
                <div class="fm-legend">
                  <div v-for="item in chartLegend" :key="item.label" class="fm-legend__row">
                    <span class="fm-legend__dot" :style="{ background: item.color }"></span>
                    <span class="fm-legend__name">{{ item.label }}</span>
                    <span class="fm-legend__val">{{ item.count }}</span>
                    <span class="fm-legend__pct">({{ totalFeaturesCount > 0 ? Math.round(item.count / totalFeaturesCount * 100) : 0 }}%)</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- KPI tiles -->
            <div class="fm-kpi-row">
              <div class="fm-kpi-tile">
                <span class="fm-kpi-tile__val">{{ internalFlamapyResults.maxDepth ?? '—' }}</span>
                <span class="fm-kpi-tile__lbl">
                  {{ $t('labels.max_depth') }}
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 10px" v-tooltip="$t('labels.tooltip_max_depth')" aria-hidden="true"></i>
                </span>
              </div>
              <div class="fm-kpi-tile">
                <span class="fm-kpi-tile__val">{{ internalFlamapyResults.averageBranchingFactor?.toFixed(2) ?? '—' }}</span>
                <span class="fm-kpi-tile__lbl">
                  {{ $t('labels.avg_branching_factor') }}
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 10px" v-tooltip="$t('labels.tooltip_avg_branching_factor')" aria-hidden="true"></i>
                </span>
              </div>
              <div class="fm-kpi-tile">
                <Skeleton v-if="internalBddLoading && internalFlamapyResults.homogeneity == null" width="42px" height="16px" />
                <span v-else class="fm-kpi-tile__val">{{ internalFlamapyResults.homogeneity?.toFixed(3) ?? '—' }}</span>
                <span class="fm-kpi-tile__lbl">
                  {{ $t('labels.homogeneity') }}
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 10px" v-tooltip="$t('labels.tooltip_homogeneity')" aria-hidden="true"></i>
                </span>
              </div>
              <div class="fm-kpi-tile">
                <Skeleton v-if="internalBddLoading && !internalFlamapyResults.variability" width="58px" height="16px" />
                <span v-else-if="internalFlamapyResults.variability" class="fm-kpi-tile__val fm-kpi-tile__val--sm">
                  {{ internalFlamapyResults.variability[0]?.toFixed(2) }}–{{ internalFlamapyResults.variability[1]?.toFixed(2) }}
                </span>
                <span v-else class="fm-kpi-tile__val">—</span>
                <span class="fm-kpi-tile__lbl">
                  {{ $t('labels.variability') }}
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 10px" v-tooltip="$t('labels.tooltip_variability')" aria-hidden="true"></i>
                </span>
              </div>
            </div>

            <!-- Core features -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__label-wrap ops-metric-card__label-wrap--gap-sm">
                <i class="pi pi-verified" style="font-size: 13px; color: var(--p-primary-color)" aria-hidden="true"></i>
                <span class="ops-metric-card__label">{{ $t('labels.core_features') }}</span>
                <Badge severity="secondary" class="uvla-count-badge uvla-count-badge--primary" :value="internalFlamapyResults.coreFeatures?.length ?? 0" />
                <i class="pi pi-info-circle uvla-info-icon" style="font-size: 11px" v-tooltip="$t('labels.tooltip_core_features')" aria-hidden="true"></i>
              </div>
              <div class="fm-chip-section__chips">
                <Tag v-if="!internalFlamapyResults.coreFeatures?.length" class="uvla-chip uvla-chip--none">{{ $t('labels.none') }}</Tag>
                <Tag v-for="f in internalFlamapyResults.coreFeatures" :key="f" class="uvla-chip uvla-chip--primary">{{ f }}</Tag>
              </div>
            </div>

            <!-- Leaf features -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__label-wrap ops-metric-card__label-wrap--gap-sm">
                <i class="pi pi-circle-fill" style="font-size: 13px; color: var(--p-leaf-color)" aria-hidden="true"></i>
                <span class="ops-metric-card__label">{{ $t('labels.leaf_features') }}</span>
                <Badge severity="secondary" class="uvla-count-badge uvla-count-badge--leaf" :value="internalFlamapyResults.leafFeatures?.length ?? 0" />
                <i class="pi pi-info-circle uvla-info-icon" style="font-size: 11px" v-tooltip="$t('labels.tooltip_leaf_features')" aria-hidden="true"></i>
              </div>
              <div class="fm-chip-section__chips">
                <Tag v-if="!internalFlamapyResults.leafFeatures?.length" class="uvla-chip uvla-chip--none">{{ $t('labels.none') }}</Tag>
                <Tag v-for="f in internalFlamapyResults.leafFeatures" :key="f" class="uvla-chip uvla-chip--leaf">{{ f }}</Tag>
              </div>
            </div>

          </div>

          <div v-else class="uvla-unavailable">
            <i class="pi pi-info-circle" style="font-size: 32px; color: var(--text-muted)" aria-hidden="true"></i>
            <span>{{ unavailable ? $t('error_messages.analysis_unavailable') : $t('labels.information_not_available') }}</span>
          </div>
        </TabPanel>

        <!-- ── Operations ─────────────────────────────────────────────────────── -->
        <TabPanel value="sat2" class="uvla-scroll" style="position: relative">
          <div class="uvla-section-title uvla-section-title--first">{{ $t('labels.operations') }}</div>
          <div v-if="loading" class="uvla-stack-sm">
            <Skeleton v-for="n in 6" :key="`sk-ops-${n}`" height="54px" />
          </div>

          <div v-else class="uvla-stack-sm">

            <!-- Satisfiable -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__row">
                <div class="ops-metric-card__label-wrap">
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 13px" v-tooltip="$t('labels.tooltip_satisfiable')" aria-hidden="true"></i>
                  <span class="ops-metric-card__label">{{ $t('labels.satisfiable') }}</span>
                  <Skeleton v-if="internalMetricLoading.satisfiable" width="34px" height="18px" />
                  <Tag
                    v-else-if="internalFlamapyResults.satisfiable != null"
                    class="uvla-status-badge"
                    :class="internalFlamapyResults.satisfiable ? 'uvla-status-badge--ok' : 'uvla-status-badge--bad'"
                  >
                    {{ $t(internalFlamapyResults.satisfiable ? 'labels.yes' : 'labels.no') }}
                  </Tag>
                  <Tag v-else class="uvla-status-badge uvla-status-badge--none">{{ $t('labels.unknown') }}</Tag>
                </div>
                <ButtonGroup class="ops-solver-group">
                  <PrimeButton
                    label="SAT" size="small"
                    class="ops-toggle-btn"
                    :class="{ 'ops-toggle-btn--active': metricModes2.satisfiable === 'SAT' }"
                    :disabled="internalMetricLoading.satisfiable"
                    @click="onMetricButtonClick('satisfiable', 'SAT')"
                  />
                  <PrimeButton
                    label="BDD" size="small"
                    class="ops-toggle-btn"
                    :class="{ 'ops-toggle-btn--active': metricModes2.satisfiable === 'BDD' }"
                    :disabled="internalMetricLoading.satisfiable"
                    @click="onMetricButtonClick('satisfiable', 'BDD')"
                  />
                </ButtonGroup>
              </div>
            </div>

            <!-- Dead features -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__row ops-metric-card__row--top">
                <div class="ops-metric-card__label-wrap">
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 13px" v-tooltip="$t('labels.tooltip_dead_features')" aria-hidden="true"></i>
                  <span class="ops-metric-card__label">{{ $t('labels.dead_features') }}</span>
                </div>
                <ButtonGroup class="ops-solver-group">
                  <PrimeButton label="SAT" size="small"
                    class="ops-toggle-btn"
                    :class="{ 'ops-toggle-btn--active': metricModes2.deadFeatures === 'SAT' }"
                    :disabled="internalMetricLoading.deadFeatures"
                    @click="onMetricButtonClick('deadFeatures', 'SAT')"
                  />
                  <PrimeButton label="BDD" size="small"
                    class="ops-toggle-btn"
                    :class="{ 'ops-toggle-btn--active': metricModes2.deadFeatures === 'BDD' }"
                    :disabled="internalMetricLoading.deadFeatures"
                    @click="onMetricButtonClick('deadFeatures', 'BDD')"
                  />
                </ButtonGroup>
              </div>
              <div class="fm-chip-section__chips fm-chip-section__chips--spaced">
                <template v-if="internalMetricLoading.deadFeatures">
                  <Skeleton v-for="n in 3" :key="`sk-dead-${n}`" width="64px" height="22px" />
                </template>
                <template v-else>
                  <Tag v-if="!internalFlamapyResults.deadFeatures?.length" class="uvla-chip uvla-chip--none">{{ $t('labels.none') }}</Tag>
                  <Tag v-for="f in internalFlamapyResults.deadFeatures" :key="f" class="uvla-chip uvla-chip--bad">{{ f }}</Tag>
                </template>
              </div>
            </div>

            <!-- False optional features -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__label-wrap">
                <i class="pi pi-info-circle uvla-info-icon" style="font-size: 13px" v-tooltip="$t('labels.tooltip_false_optional_features')" aria-hidden="true"></i>
                <span class="ops-metric-card__label">{{ $t('labels.false_optional_features') }}</span>
              </div>
              <div class="fm-chip-section__chips fm-chip-section__chips--spaced">
                <Tag v-if="!internalFlamapyResults.falseOptionalFeatures?.length" class="uvla-chip uvla-chip--none">{{ $t('labels.none') }}</Tag>
                <Tag v-for="f in internalFlamapyResults.falseOptionalFeatures" :key="f" class="uvla-chip uvla-chip--primary">{{ f }}</Tag>
              </div>
            </div>

            <!-- Variant features -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__label-wrap">
                <i class="pi pi-info-circle uvla-info-icon" style="font-size: 13px" v-tooltip="$t('labels.tooltip_variant_features')" aria-hidden="true"></i>
                <span class="ops-metric-card__label">{{ $t('labels.variant_features') }}</span>
              </div>
              <div class="fm-chip-section__chips fm-chip-section__chips--spaced">
                <Tag v-if="!internalFlamapyResults.variantFeatures?.length" class="uvla-chip uvla-chip--none">{{ $t('labels.none') }}</Tag>
                <Tag v-for="f in internalFlamapyResults.variantFeatures" :key="f" class="uvla-chip uvla-chip--primary">{{ f }}</Tag>
              </div>
            </div>

            <!-- Unique features -->
            <div class="ops-metric-card">
              <div class="ops-metric-card__label-wrap">
                <i class="pi pi-info-circle uvla-info-icon" style="font-size: 13px" v-tooltip="$t('labels.tooltip_unique_features')" aria-hidden="true"></i>
                <span class="ops-metric-card__label">{{ $t('labels.unique_features') }}</span>
              </div>
              <div class="fm-chip-section__chips fm-chip-section__chips--spaced">
                <Tag v-if="!internalFlamapyResults.uniqueFeatures?.length" class="uvla-chip uvla-chip--none">{{ $t('labels.none') }}</Tag>
                <Tag v-for="f in internalFlamapyResults.uniqueFeatures" :key="f" class="uvla-chip uvla-chip--primary">{{ f }}</Tag>
              </div>
            </div>

            <!-- Config distribution -->
            <div class="ops-metric-card ops-metric-card--expand">
              <Accordion class="ops-accordion">
                <AccordionPanel value="0">
                  <AccordionHeader class="ops-expansion-head--flush">
                    <div class="ops-metric-card__label-wrap">
                      <i class="pi pi-info-circle uvla-info-icon" style="font-size: 13px" v-tooltip="$t('labels.tooltip_config_distribution')" aria-hidden="true"></i>
                      <span class="ops-metric-card__label">{{ $t('labels.config_distribution') }}</span>
                    </div>
                  </AccordionHeader>
                  <AccordionContent>
                    <div class="ops-expand-body">
                      <div class="ops-expand-controls">
                        <label class="ops-toggle-field">
                          <ToggleSwitch v-model="showOnlyNonZero" />
                          <span>{{ $t('labels.show_only_non_zero') }}</span>
                        </label>
                        <PrimeSelect v-model="sortOrderDist"
                          :options="[{ label: $t('labels.sort_by_features'), value: 'features' }, { label: $t('labels.sort_ascending'), value: 'asc' }, { label: $t('labels.sort_descending'), value: 'desc' }]"
                          option-value="value" option-label="label" style="min-width: 150px;" />
                      </div>
                      <!-- La fase BDD llega después: filas en gris hasta que hay datos -->
                      <template v-if="internalBddLoading && !internalFlamapyResults.configDistribution">
                        <Skeleton v-for="n in 4" :key="`sk-dist-${n}`" height="14px" />
                      </template>
                      <div v-for="entry in filteredConfigDistribution" :key="entry.index" class="ops-prob-row">
                        <span class="ops-prob-row__label">{{ entry.index === 1 ? `${entry.index} ${$t('labels.feature')}` : `${entry.index} ${$t('labels.features')}` }}</span>
                        <span class="ops-prob-row__val">{{ entry.count }} ({{ internalFlamapyResults.configDistribution.reduce((a, b) => a + b, 0) > 0 ? ((entry.count / internalFlamapyResults.configDistribution.reduce((a, b) => a + b, 0)) * 100).toFixed(1) + '%' : $t('labels.none') }})</span>
                        <ProgressBar class="ops-prob-row__bar" :value="(entry.count / internalFlamapyResults.configDistribution.reduce((a, b) => a + b, 0)) * 100" :show-value="false" />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionPanel>
              </Accordion>
            </div>

            <!-- Feature inclusion prob -->
            <div class="ops-metric-card ops-metric-card--expand">
              <Accordion class="ops-accordion">
                <AccordionPanel value="0">
                  <AccordionHeader class="ops-expansion-head--flush">
                    <div class="ops-metric-card__label-wrap">
                      <i class="pi pi-info-circle uvla-info-icon" style="font-size: 13px" v-tooltip="$t('labels.tooltip_feature_inclusion_prob')" aria-hidden="true"></i>
                      <span class="ops-metric-card__label">{{ $t('labels.feature_inclusion_prob') }}</span>
                    </div>
                  </AccordionHeader>
                  <AccordionContent>
                    <div class="ops-expand-body">
                      <div class="ops-expand-controls ops-expand-controls--end">
                        <PrimeSelect v-model="sortOrder"
                          :options="[{ label: $t('labels.sort_ascending'), value: 'asc' }, { label: $t('labels.sort_descending'), value: 'desc' }]"
                          option-value="value" option-label="label" style="min-width: 150px;" />
                      </div>
                      <template v-if="internalBddLoading && !internalFlamapyResults.featureInclusionProb">
                        <Skeleton v-for="n in 4" :key="`sk-prob-${n}`" height="14px" />
                      </template>
                      <div v-for="(prob, feature) in sortedFeatureInclusionProb" :key="feature" class="ops-prob-row">
                        <span class="ops-prob-row__label">{{ feature }}</span>
                        <span class="ops-prob-row__val">{{ prob != null ? (prob * 100).toFixed(1) + '%' : $t('labels.none') }}</span>
                        <ProgressBar class="ops-prob-row__bar" :value="prob * 100" :show-value="false" />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionPanel>
              </Accordion>
            </div>

          </div>
        <!-- configurations: the same panel -->
          <div class="uvla-section-title">{{ $t('labels.configurations') }}</div>
          <!-- KPI row -->
          <div class="ops-metric-card ops-metric-card--spaced">
            <div class="fm-kpi-grid">
              <div class="fm-kpi">
                <Skeleton v-if="configsPending" width="52px" height="17px" />
                <span v-else class="fm-kpi__val">{{ internalFlamapyResults.estimatedConfigurations ?? '—' }}</span>
                <span class="fm-kpi__lbl">
                  {{ $t('labels.estimated_configs') }}
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 10px" v-tooltip="$t('labels.tooltip_estimated_configs')" aria-hidden="true"></i>
                </span>
              </div>
              <div class="fm-kpi">
                <Skeleton v-if="configsPending" width="52px" height="17px" />
                <span v-else class="fm-kpi__val">{{ internalFlamapyResults.configsNumber ?? '—' }}</span>
                <span class="fm-kpi__lbl">
                  {{ $t('labels.valid_configs') }}
                  <i class="pi pi-info-circle uvla-info-icon" style="font-size: 10px" v-tooltip="$t('labels.tooltip_valid_configs')" aria-hidden="true"></i>
                </span>
              </div>
            </div>
          </div>

          <!-- Config picker -->
          <div class="ops-config-picker">
            <FloatLabel variant="on" class="ops-config-picker__select">
              <PrimeSelect
                id="ops-config-select"
                v-model="selectedConfig"
                :options="configOptions"
                option-value="value" option-label="label"
                :disabled="!internalFlamapyResults.configurations?.length"
                class="ops-config-picker__control"
              />
              <label for="ops-config-select">{{ $t('labels.select_config') }}</label>
            </FloatLabel>
            <PrimeButton :label="$t('labels.save_config')" @click="showModal = true" />
            <ProductCreationModal v-if="showModal" :visible="showModal" :configurations="selectedConfiguration" @close="showModal = false" @product-created="handleProductCreated" />
          </div>

          <!-- Config details -->
          <div v-if="configsPending" class="ops-metric-card">
            <div class="ops-metric-card__label-wrap ops-metric-card__label-wrap--gap-sm">
              <Skeleton width="98px" height="12px" />
            </div>
            <Divider class="uvla-divider-sm" />
            <div class="config-features-list">
              <Skeleton v-for="n in 6" :key="`sk-cfg-${n}`" height="16px" />
            </div>
          </div>

          <div v-else-if="selectedConfiguration" class="ops-metric-card">
            <div class="ops-metric-card__label-wrap ops-metric-card__label-wrap--gap-sm">
              <i class="pi pi-sliders-h" style="font-size: 13px; color: var(--p-primary-color)" aria-hidden="true"></i>
              <span class="ops-metric-card__label">{{ $t('labels.config_details') }}</span>
              <Badge severity="secondary" class="uvla-count-badge" :value="Object.keys(selectedConfiguration).length" />
            </div>
            <Divider class="uvla-divider-sm" />
            <div class="config-features-list">
              <div v-for="(value, feature) in selectedConfiguration" :key="feature" class="config-feature-row">
                <span class="config-feature-row__name">{{ feature }}</span>
                <div class="config-feature-row__badges">
                  <Badge v-if="internalFlamapyResults.coreFeatures?.includes(feature)" severity="secondary" class="uvla-count-badge uvla-count-badge--primary" :value="$t('labels.core')" />
                  <Badge v-if="internalFlamapyResults.leafFeatures?.includes(feature)" severity="secondary" class="uvla-count-badge uvla-count-badge--leaf" :value="$t('labels.leaf')" />
                </div>
              </div>
            </div>
          </div>
        </TabPanel>

      </TabPanels>
    </Tabs>
  </div>
</template>

<script>
import { Doughnut } from 'vue-chartjs';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
ChartJS.register(ArcElement, Tooltip, Legend);

import ProductCreationModal from 'components/product/ProductCreationModal.vue';
import { isDarkState } from 'src/composables/useTheme';

import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import Badge from 'primevue/badge';
import ProgressBar from 'primevue/progressbar';
import Button from 'primevue/button';
import ButtonGroup from 'primevue/buttongroup';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import FloatLabel from 'primevue/floatlabel';
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import Divider from 'primevue/divider';
import PrimeTooltip from 'primevue/tooltip';

export default {
  name: 'UVLAnalysis',
  components: {
    ProductCreationModal, Doughnut,
    Skeleton, Tag, Badge, ProgressBar,
    PrimeButton: Button, ButtonGroup, PrimeSelect: Select, ToggleSwitch, FloatLabel,
    Tabs, TabList, Tab, TabPanels, TabPanel,
    Accordion, AccordionPanel, AccordionHeader, AccordionContent,
    Divider,
  },
  directives: { tooltip: PrimeTooltip },
  props: {
    flamapyResults:  { type: Object,  default: () => ({}) },
    mode:            { type: String,  default: 'BDD' },
    modeTabs:        { type: String,  default: 'BDD' },
    activeTab:       { type: String,  default: 'model information' },
    modelInvalid:    { type: String,  default: 'init' },
    // the analysis service could not be reached: the model was not judged (it is not "invalid")
    unavailable:     { type: Boolean, default: false },
    readOnly:        { type: Boolean, default: false },
    loading:         { type: Boolean, default: false },
    metricsLoading:  { type: Boolean, default: false },
    bddLoading:      { type: Boolean, default: false },
    isMobile:        { type: Boolean, default: false },
    fileContent:     { type: String,  default: '' },
    metricLoading:   { type: Object,  default: () => ({ satisfiable: false, deadFeatures: false }) },
  },
  data() {
    return {
      internalActiveTab: this.activeTab,
      internalFlamapyResults: this.flamapyResults,
      internalMode: this.mode,
      internalModeTabs: this.modeTabs,
      selectedConfig: 0,
      showModal: false,
      isMobileTabs: this.isMobile,
      metricsLoadingTabs: this.metricsLoading,
      internalBddLoading: this.bddLoading,
      sortOrder: 'asc',
      sortOrderDist: 'features',
      showOnlyNonZero: true,
      metricModes2: { satisfiable: 'SAT', deadFeatures: 'SAT' },
      internalMetricLoading: { ...this.metricLoading },
    };
  },
  watch: {
    activeTab(v) { this.internalActiveTab = v; },
    flamapyResults: { deep: true, handler(v) { this.internalFlamapyResults = v; } },
    mode(v) { this.internalMode = v; },
    modeTabs(v) { this.internalModeTabs = v; },
    metricsLoading(v) { this.metricsLoadingTabs = v; },
    bddLoading(v) { this.internalBddLoading = v; },
    metricLoading: { deep: true, handler(v) { this.internalMetricLoading = { ...v }; } },
  },
  computed: {
    configsPending() {
      return this.loading || (this.internalBddLoading && this.internalFlamapyResults.configurations == null);
    },
    totalFeaturesCount() {
      const n = Object.keys(this.internalFlamapyResults.featureInclusionProb || {}).length;
      return n > 0 ? n : (this.internalFlamapyResults.coreFeatures?.length ?? 0) + (this.internalFlamapyResults.leafFeatures?.length ?? 0);
    },
    leafOnlyCount() {
      const core = this.internalFlamapyResults.coreFeatures || [];
      const leaf = this.internalFlamapyResults.leafFeatures || [];
      return leaf.filter(f => !core.includes(f)).length;
    },
    branchCount() {
      return Math.max(0, this.totalFeaturesCount - (this.internalFlamapyResults.coreFeatures?.length ?? 0) - this.leafOnlyCount);
    },
    chartTheme() {
      void isDarkState.value;
      const styles = getComputedStyle(document.documentElement);
      const read = (name) => styles.getPropertyValue(name).trim();
      return {
        chart1: read('--chart-1'),
        chart3: read('--chart-3'),
        chart2: read('--chart-2'),
        surface: read('--p-content-background'),
      };
    },
    chartLegend() {
      return [
        { label: this.$t('labels.core'), color: this.chartTheme.chart1, count: this.internalFlamapyResults.coreFeatures?.length ?? 0 },
        { label: this.$t('labels.leaf'), color: this.chartTheme.chart3, count: this.leafOnlyCount },
        { label: 'Branch', color: this.chartTheme.chart2, count: this.branchCount },
      ];
    },
    featureChartData() {
      return {
        labels: this.chartLegend.map(l => l.label),
        datasets: [{
          data: this.chartLegend.map(l => l.count),
          backgroundColor: this.chartLegend.map(l => l.color),
          borderWidth: 2,
          borderColor: this.chartTheme.surface,
          hoverOffset: 4,
        }]
      };
    },
    featureChartOptions() {
      return {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const pct = this.totalFeaturesCount > 0 ? Math.round(ctx.parsed / this.totalFeaturesCount * 100) : 0;
                return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
              }
            }
          }
        },
      };
    },
    configOptions() {
      return (this.internalFlamapyResults.configurations || []).map((_, i) => ({ label: `${this.$t('labels.configuration')} ${i + 1}`, value: i }));
    },
    selectedConfiguration() {
      if (!this.internalFlamapyResults.configurations || this.selectedConfig === null) return null;
      return this.internalFlamapyResults.configurations[this.selectedConfig];
    },
    sortedFeatureInclusionProb() {
      const entries = Object.entries(this.internalFlamapyResults.featureInclusionProb || {});
      entries.sort((a, b) => this.sortOrder === 'desc' ? b[1] - a[1] : a[1] - b[1]);
      return Object.fromEntries(entries);
    },
    filteredConfigDistribution() {
      let e = (this.internalFlamapyResults.configDistribution || []).map((count, index) => ({ index, count }));
      if (this.showOnlyNonZero) e = e.filter(x => x.count > 0);
      if (this.sortOrderDist === 'asc') e.sort((a, b) => a.count - b.count);
      else if (this.sortOrderDist === 'desc') e.sort((a, b) => b.count - a.count);
      else e.sort((a, b) => a.index - b.index);
      return e;
    },
  },
  methods: {
    onMetricButtonClick(metric, mode) {
      if (this.metricModes2[metric] === mode) return;
      this.metricModes2[metric] = mode;
      this.$emit('metric-mode-changed', { metric, mode });
    },
    handleProductCreated() { this.showModal = false; },
  }
};
</script>

<style scoped lang="scss">
// ─── Root ─────────────────────────────────────────────────────────────────────
.uvla-root {
  background: var(--card-bg);
  border-left: 1px solid var(--card-border);
  height: 100%;
  overflow: hidden;

  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;
}

// ─── Panel header ─────────────────────────────────────────────────────────────
.uvla-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--card-border);
  background: var(--surface-alt);

  &__left {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  &__title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text-heading);
  }

  &__right {
    display: flex;
    align-items: center;
  }

  &__badge { margin-left: 4px; }

  &__loading {
    display: flex;
    align-items: center;
    gap: 4px;     font-size: 0.75rem;
    color: var(--text-muted);
  }
}

.uvla-sk-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
.uvla-tabbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 12px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--p-content-border-color);

  &__tabs { flex: 1; min-width: 0; }
  &__actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }

  :deep(.p-tablist) { border-bottom: 0; }
}

.uvla-section-title {
  margin: 18px 0 8px;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);

  &--first { margin-top: 0; }
}

.uvla-tabs {
  background: var(--card-bg);

  flex: 10000 1 0%;
  display: flex;
  flex-direction: column;
  flex-wrap: nowrap;

  :deep(.p-tablist-tab-list) {
    background: var(--card-bg);
  }

  :deep(.p-tab) {
    padding: 0 12px;
    min-height: 38px;
    font-size: 0.8125rem;
  }
}

// ─── Scrollable panel ─────────────────────────────────────────────────────────
.uvla-panels {
  flex: 1;   min-width: 0;
  overflow: hidden;
  background: var(--card-bg);

  :deep(.p-tabpanels) {
    height: 100%;
    padding: 0;
  }

  :deep(.p-tabpanel) {
    height: 100%;
    min-width: 0;
    overflow: hidden;
  }
}

.uvla-scroll {
  overflow-y: auto;
  height: 100%;
  padding: 14px;
}

// ─── Model information tab ────────────────────────────────────────────────────
.fm-info-panel {
  padding-top: 20px !important;
}

.fm-info-layout {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

// Distribution card inner layout
.fm-dist-inner {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}

// Donut chart wrapper (shared with chart component)
.fm-overview {
  &__chart-wrap {
    position: relative;
    width: 120px;
    height: 120px;
    flex-shrink: 0;
  }

  &__donut {
    width: 120px !important;
    height: 120px !important;
  }

  &__center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    text-align: center;
  }

  &__center-val {
    font-size: 1.1875rem;
    font-weight: 700;
    color: var(--text-heading);
    line-height: 1;
  }

  &__center-lbl {
    font-size: 0.5rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-top: 2px;
  }
}

// Legend (beside the donut)
.fm-legend {
  flex: 1;
  min-width: 120px;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 6px;
    transition: background 0.1s;

    &:hover { background: var(--surface-alt); }
  }

  &__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &__name {
    font-size: 0.875rem;
    color: var(--text-heading);
    font-weight: 500;
    flex: 1;
  }

  &__val {
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text-heading);
    min-width: 22px;
    text-align: right;
  }

  &__pct {
    font-size: 0.8125rem;
    color: var(--text-muted);
    min-width: 44px;
    text-align: right;
  }
}

// KPI tiles row
.fm-kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 8px;
}

.fm-kpi-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 12px 8px;
  background: var(--surface-alt);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  text-align: center;

  &__val {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--text-heading);
    line-height: 1.1;

    &--sm { font-size: 0.8125rem; }
  }

  &__lbl {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    line-height: 1.3;
  }
}

// KPI grid (used in Configurations tab)
.fm-kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.fm-kpi {
  display: flex;
  flex-direction: column;
  gap: 1px;

  &__val {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text-heading);

    &--sm { font-size: 0.8125rem; }
  }

  &__lbl {
    font-size: 0.5625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 3px;
  }
}

// Feature chip sections (shared)
.fm-chip-section {
  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;

    &--spaced { margin-top: 4px; }
  }
}

.uvla-tab-icon { margin-right: 4px; }
.uvla-panel--flush { padding: 0; }
.uvla-divider-sm { margin-bottom: 8px; }

.uvla-stack-sm {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

// ─── Estados/etiquetas (Tag/Badge forzados a tokens semánticos) ───────────────
.uvla-status-badge {
  font-weight: 600;

  &--ok    { background: var(--status-ok)          !important; color: var(--status-on-solid) !important; }
  &--bad   { background: var(--status-bad)         !important; color: var(--status-on-solid) !important; }
  &--none  { background: var(--status-neutral-solid) !important; color: var(--status-on-solid) !important; }
}

.uvla-count-badge {
  &--primary { background: var(--p-button-primary-background)  !important; color: var(--p-primary-contrast-color) !important; }
  &--leaf    { background: var(--p-leaf-color)      !important; color: var(--p-primary-contrast-color) !important; }
}

.uvla-chip {
  &--primary { background: var(--p-button-primary-background)   !important; color: var(--p-primary-contrast-color) !important; }
  &--leaf    { background: var(--p-leaf-color)       !important; color: var(--p-primary-contrast-color) !important; }
  &--bad     { background: var(--status-bad)         !important; color: var(--status-on-solid) !important; }
  &--none    { background: var(--status-neutral-solid) !important; color: var(--status-on-solid) !important; }
}

// ─── Operations tab metric cards ──────────────────────────────────────────────
.ops-metric-card {
  background: var(--surface-alt);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 10px 12px;

  &--spaced { margin-bottom: 8px; }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;

    &--top { align-items: flex-start; }
  }

  &__label-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;

    &--gap-sm { margin-bottom: 8px; }
    &--gap-md { margin-bottom: 16px; }
  }

  &__label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-heading);
  }
}

.ops-solver-group {
  flex-shrink: 0;
}

.ops-toggle-btn {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3px;
  padding: 2px 10px !important;
  background: var(--surface-bg) !important;
  color: var(--text-muted) !important;
  border-color: var(--card-border) !important;

  &--active {
    background: var(--p-button-primary-background) !important;
    color: var(--p-primary-contrast-color) !important;
    border-color: var(--p-primary-color) !important;
  }
}

// Expansion items wrapped inside ops-metric-card
.ops-metric-card--expand {
  padding: 0;

  .ops-accordion {
    :deep(.p-accordionpanel) {
      border: none;
    }
  }
}

.ops-expansion-head--flush {
  :deep(.p-accordionheader) {
    padding: 10px 12px;
  }
}

.ops-expand-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--card-border);
}

.ops-expand-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 0;

  &--end { justify-content: flex-end; }
}

.ops-toggle-field {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 0.8125rem;
  color: var(--text-heading);
}

// Probability / distribution rows
.ops-prob-row {
  display: grid;
  grid-template-columns: 1fr 72px 80px;
  align-items: center;
  gap: 8px;
  padding: 3px 0;

  &__label {
    font-size: 0.8125rem;
    color: var(--text-heading);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__val {
    font-size: 0.8125rem;
    color: var(--text-muted);
    text-align: right;
    white-space: nowrap;
  }

  &__bar {
    height: 6px !important;
    border-radius: 3px;
  }
}

// Config picker row
.ops-config-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  &__select {
    flex: 1;
    display: block;

    .ops-config-picker__control { width: 100%; }
  }
}

// Config feature list
.config-features-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-feature-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 0.1s;

  &:hover { background: var(--surface-alt); }

  &__name {
    font-size: 0.875rem;
    color: var(--text-heading);
    font-weight: 500;
  }

  &__badges {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
}

// ─── Unavailable state ────────────────────────────────────────────────────────
.uvla-unavailable {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 16px;
  color: var(--text-muted);
  font-size: 0.875rem;
  text-align: center;
}

.uvla-info-icon {
  color: var(--text-muted);
  cursor: help;
}
</style>
