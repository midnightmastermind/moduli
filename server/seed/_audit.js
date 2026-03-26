// Temporary audit script - delete after use
const path = require('path');
const dir = __dirname;

const modules = require(path.join(dir, 'modules.json'));
const occurrences = require(path.join(dir, 'occurrences.json'));
const fields = require(path.join(dir, 'fields.json'));
const views = require(path.join(dir, 'views.json'));
const grids = require(path.join(dir, 'grids.json'));

// Build lookup maps
const modById = {};
modules.forEach(m => modById[m.id] = m);
const occById = {};
occurrences.forEach(o => occById[o.id] = o);
const viewById = {};
views.forEach(v => viewById[v.id] = v);

console.log('============================');
console.log('CHECK 1: Question Fields');
console.log('============================');
const questionFields = fields.filter(f => f.name === 'Question');
questionFields.forEach(f => {
  console.log(`  Field id: ${f.id}`);
  console.log(`    type: ${f.type} (expected: select) ${f.type === 'select' ? 'PASS' : 'FAIL'}`);
  console.log(`    meta.sourceType: ${f.meta?.sourceType} (expected: pool) ${f.meta?.sourceType === 'pool' ? 'PASS' : 'FAIL'}`);
  console.log(`    meta.poolContainerId: ${f.meta?.poolContainerId}`);
});

console.log('\n============================');
console.log('CHECK 2: Question Pool Containers');
console.log('============================');
const poolLabels = ['Went Well Questions', 'Improvement Questions', 'Gratitude Prompts'];
const poolContainers = modules.filter(m => poolLabels.includes(m.label));
console.log(`Found ${poolContainers.length} pool containers by label (expected 3)`);
poolContainers.forEach(m => {
  console.log(`  Module id: ${m.id}, label: "${m.label}", role: ${m.role}`);
});

// Also check if poolContainerIds from question fields match
const poolIds = questionFields.map(f => f.meta?.poolContainerId);
console.log(`\nPool container IDs from question fields: ${JSON.stringify(poolIds)}`);
poolIds.forEach(pid => {
  const mod = modById[pid];
  if (mod) {
    console.log(`  ${pid} -> "${mod.label}", role: ${mod.role} ${mod.role === 'container' ? 'PASS' : 'FAIL'}`);
  } else {
    console.log(`  ${pid} -> NOT FOUND IN MODULES - FAIL`);
  }
});

console.log('\n============================');
console.log('CHECK 3: Question Pool Instances');
console.log('============================');
// Find instances with question-like labels
const questionKeywords = ['What went well', 'What made you smile', 'What accomplishment', 'What new thing', 'What positive',
  'What could be improved', 'What challenge', 'What would you do differently', 'What skill', 'What feedback',
  'What are you grateful', 'What moment', 'Who made a difference', 'What simple pleasure', 'What opportunity'];
const qInstances = modules.filter(m => m.role === 'instance' && m.defaultDragMode === 'copy' &&
  questionKeywords.some(kw => m.label && m.label.toLowerCase().includes(kw.toLowerCase())));
console.log(`Found ${qInstances.length} question instances by keyword search`);
qInstances.forEach(m => {
  console.log(`  ${m.id}: "${m.label}" role=${m.role} dragMode=${m.defaultDragMode}`);
});

// Also find all instances that are children of pool containers
// Need to find occurrences whose parentId or targetId links to pool container occurrences
const poolContainerOccs = occurrences.filter(o => poolIds.includes(o.targetId));
console.log(`\nPool container occurrences: ${poolContainerOccs.length}`);
poolContainerOccs.forEach(o => {
  const mod = modById[o.targetId];
  console.log(`  Occ ${o.id} -> targetId ${o.targetId} ("${mod?.label}") childOccs: ${JSON.stringify(o.occurrences)}`);
});

// Collect all child occ IDs from pool containers
const allPoolChildOccIds = poolContainerOccs.flatMap(o => o.occurrences || []);
console.log(`\nTotal child occurrences in pool containers: ${allPoolChildOccIds.length} (expected 15 = 5 per pool)`);
allPoolChildOccIds.forEach(cid => {
  const occ = occById[cid];
  if (occ) {
    const mod = modById[occ.targetId];
    console.log(`  Occ ${cid} -> targetId ${occ.targetId} ("${mod?.label}") role=${mod?.role} dragMode=${mod?.defaultDragMode}`);
  } else {
    console.log(`  Occ ${cid} -> NOT FOUND IN OCCURRENCES - FAIL`);
  }
});

console.log('\n============================');
console.log('CHECK 4: Question Pool Instance Occurrences');
console.log('============================');
// Already covered above - allPoolChildOccIds are the occurrences
const missingOccs = allPoolChildOccIds.filter(cid => !occById[cid]);
if (missingOccs.length === 0) {
  console.log('PASS: All pool instance occurrences exist');
} else {
  console.log(`FAIL: Missing occurrences: ${JSON.stringify(missingOccs)}`);
}

console.log('\n============================');
console.log('CHECK 5: Question Pool Container Occurrences');
console.log('============================');
if (poolContainerOccs.length === 3) {
  console.log('PASS: All 3 pool container occurrences exist');
} else {
  console.log(`FAIL: Expected 3 pool container occurrences, found ${poolContainerOccs.length}`);
}
poolContainerOccs.forEach(o => {
  const childCount = (o.occurrences || []).length;
  console.log(`  Occ ${o.id} has ${childCount} children ${childCount === 5 ? 'PASS' : 'FAIL (expected 5)'}`);
});

console.log('\n============================');
console.log('CHECK 6: Phil Stone Sections');
console.log('============================');
const philStoneModules = modules.filter(m => m.ownStyle && m.ownStyle.bg === '#d4a010');
console.log(`Found ${philStoneModules.length} modules with ownStyle.bg="#d4a010"`);
philStoneModules.forEach(m => {
  console.log(`  ${m.id}: "${m.label}" role=${m.role} kind=${m.kind}`);
});

console.log('\n============================');
console.log('CHECK 7: Phil Stone Occurrences with viewId');
console.log('============================');
const philStoneIds = philStoneModules.map(m => m.id);
const philStoneOccs = occurrences.filter(o => philStoneIds.includes(o.targetId));
console.log(`Found ${philStoneOccs.length} Phil Stone occurrences`);
let philViewBugs = 0;
philStoneOccs.forEach(o => {
  const mod = modById[o.targetId];
  const hasView = o.viewId !== null && o.viewId !== undefined;
  if (!hasView) philViewBugs++;
  console.log(`  Occ ${o.id} -> "${mod?.label}" viewId=${o.viewId} ${hasView ? 'PASS' : 'FAIL (viewId is null)'}`);
});
if (philViewBugs > 0) {
  console.log(`FAIL: ${philViewBugs} Phil Stone occurrences have null viewId`);
} else {
  console.log('PASS: All Phil Stone occurrences have viewId');
}

console.log('\n============================');
console.log('CHECK 8: Phil Stone View Records');
console.log('============================');
let philViewMissing = 0;
philStoneOccs.filter(o => o.viewId).forEach(o => {
  const view = viewById[o.viewId];
  const mod = modById[o.targetId];
  if (view) {
    const isDoc = view.viewType === 'doc';
    console.log(`  View ${o.viewId} for "${mod?.label}": viewType=${view.viewType} ${isDoc ? 'PASS' : 'FAIL (expected doc)'}`);
  } else {
    philViewMissing++;
    console.log(`  View ${o.viewId} for "${mod?.label}": NOT FOUND - FAIL`);
  }
});
if (philViewMissing > 0) {
  console.log(`FAIL: ${philViewMissing} Phil Stone view records missing`);
} else if (philStoneOccs.filter(o => o.viewId).length === 0) {
  console.log('N/A: No Phil Stone occurrences have viewId to check');
} else {
  console.log('PASS: All Phil Stone view records exist');
}

console.log('\n============================');
console.log('CHECK 9: Q/A Container Occurrences');
console.log('============================');
// Find Q/A containers: "What Went Well?", "What Could Be Improved?", "Gratitude" with ownStyle.bg: "#b56800"
const qaContainers = modules.filter(m => m.ownStyle && m.ownStyle.bg === '#b56800');
console.log(`Found ${qaContainers.length} modules with ownStyle.bg="#b56800"`);
qaContainers.forEach(m => {
  console.log(`  ${m.id}: "${m.label}" role=${m.role} kind=${m.kind}`);
});
const qaIds = qaContainers.map(m => m.id);
const qaOccs = occurrences.filter(o => qaIds.includes(o.targetId));
console.log(`Found ${qaOccs.length} Q/A container occurrences`);
qaOccs.forEach(o => {
  const mod = modById[o.targetId];
  const hasView = o.viewId !== null && o.viewId !== undefined;
  const fieldsEmpty = !o.fields || Object.keys(o.fields).length === 0;
  console.log(`  Occ ${o.id} -> "${mod?.label}" viewId=${o.viewId} ${hasView ? 'PASS' : 'FAIL (viewId null)'} fields=${JSON.stringify(o.fields)} ${fieldsEmpty ? 'PASS' : 'FAIL (fields not empty)'}`);
});

console.log('\n============================');
console.log('CHECK 10: View records for Q/A containers');
console.log('============================');
qaOccs.filter(o => o.viewId).forEach(o => {
  const view = viewById[o.viewId];
  const mod = modById[o.targetId];
  if (view) {
    const isDoc = view.viewType === 'doc';
    console.log(`  View ${o.viewId} for "${mod?.label}": viewType=${view.viewType} ${isDoc ? 'PASS' : 'FAIL (expected doc)'}`);
  } else {
    console.log(`  View ${o.viewId} for "${mod?.label}": NOT FOUND - FAIL`);
  }
});

console.log('\n============================');
console.log('CHECK 11: Grid occurrences');
console.log('============================');
const grid = grids[0];
const gridOccIds = grid.occurrences;
console.log(`Grid has ${gridOccIds.length} panel occurrence IDs`);
let gridOccMissing = 0;
gridOccIds.forEach(oid => {
  const occ = occById[oid];
  if (occ) {
    const mod = modById[occ.targetId];
    console.log(`  ${oid} -> targetId ${occ.targetId} ("${mod?.label}") PASS`);
  } else {
    gridOccMissing++;
    console.log(`  ${oid} -> NOT FOUND IN OCCURRENCES - FAIL`);
  }
});
if (gridOccMissing > 0) {
  console.log(`FAIL: ${gridOccMissing} grid panel occurrences missing`);
} else {
  console.log('PASS: All grid panel occurrences exist');
}

console.log('\n============================');
console.log('CHECK 12: Panel stack display');
console.log('============================');
// Find panels with layout.style.display
const panelModules = modules.filter(m => m.role === 'panel');
console.log(`Total panel modules: ${panelModules.length}`);
const panelsWithDisplay = panelModules.filter(m => m.layout && m.layout.style && m.layout.style.display);
console.log(`Panels with layout.style.display: ${panelsWithDisplay.length}`);
panelsWithDisplay.forEach(m => {
  console.log(`  ${m.id}: "${m.label}" display=${m.layout.style.display} placement=${JSON.stringify(m.layout.placement || 'none')}`);
});

// Check panel occurrences for placement (cell location)
const panelOccurrences = gridOccIds.map(oid => occById[oid]).filter(Boolean);
const cellMap = {};
panelOccurrences.forEach(o => {
  const mod = modById[o.targetId];
  const placement = o.placement || (mod && mod.layout && mod.layout.placement);
  if (placement) {
    const cellKey = `${placement.row},${placement.col}`;
    if (!cellMap[cellKey]) cellMap[cellKey] = [];
    cellMap[cellKey].push({ occId: o.id, label: mod?.label, display: mod?.layout?.style?.display || 'default' });
  }
});

console.log('\nPanel cells with multiple panels:');
Object.entries(cellMap).forEach(([cell, panels]) => {
  if (panels.length > 1) {
    console.log(`  Cell ${cell}: ${panels.length} panels`);
    const blockPanels = panels.filter(p => p.display === 'block');
    panels.forEach(p => console.log(`    "${p.label}" display=${p.display}`));
    if (blockPanels.length > 1) {
      console.log(`    FAIL: ${blockPanels.length} panels have display=block in same cell`);
    } else {
      console.log('    PASS: Only one (or zero) panels have display=block');
    }
  }
});

// Also check occurrence.placement directly
console.log('\nPanel occurrence placements:');
panelOccurrences.forEach(o => {
  const mod = modById[o.targetId];
  console.log(`  Occ ${o.id} ("${mod?.label}"): occ.placement=${JSON.stringify(o.placement)} mod.layout=${JSON.stringify(mod?.layout)}`);
});
