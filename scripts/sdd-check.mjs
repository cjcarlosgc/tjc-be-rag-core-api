#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const errors = [];
const required = ['AGENTS.md','README.md','CHANGELOG.md','spec/README.md','spec/backlog.md','spec/contracts/system-contract.md','spec/contracts/interoperability-contract.md','spec/constitution/project-context.md','spec/constitution/mission.md','spec/constitution/architecture.md','spec/constitution/tech-stack.md','spec/constitution/conventions.md','spec/constitution/roadmap.md','spec/constitution/delivery-workflow.md','harness/WORKFLOW.md','harness/state.json','harness/state-schema.md'];
for (const f of required) if (!existsSync(join(root,f))) errors.push(`Falta ${f}`);
let state=null; try { state=JSON.parse(readFileSync(join(root,'harness/state.json'),'utf8')); } catch(e){ errors.push(`state.json inválido: ${e.message}`); }
if(state){
  const allowed=['SELECTED','SPEC_VERIFIED','AWAITING_APPROVAL','IN_PROGRESS','IN_REVIEW','BLOCKED','DONE'];
  if(state.schemaVersion!==2) errors.push('schemaVersion no soportado');
  const item=state.activeWorkItem;
  if(item){
    if(!Array.isArray(item.storyIds)||item.storyIds.length===0) errors.push('activeWorkItem requiere storyIds');
    if(!item.sprint) errors.push('activeWorkItem requiere sprint');
    if(!allowed.includes(item.status)) errors.push('status no permitido');
    for(const p of [...(item.specPaths||[]),...(item.transversalPaths||[])]) if(!existsSync(join(root,p))) errors.push(`Referencia inexistente: ${p}`);
    if(['IN_PROGRESS','IN_REVIEW','DONE'].includes(item.status)&&item.approved!==true) errors.push(`${item.status} requiere approved=true`);
    const gate=item.decisionGate;
    if(!gate) errors.push('activeWorkItem requiere decisionGate');
    else {
      const hasBlockingDecisionIds=Array.isArray(gate.blockingDecisionIds);
      const hasNonBlockingDecisionIds=Array.isArray(gate.nonBlockingDecisionIds);
      const blockingDecisionIds=hasBlockingDecisionIds?gate.blockingDecisionIds:[];
      if(!hasBlockingDecisionIds||!hasNonBlockingDecisionIds) errors.push('decisionGate requiere listas de IDs');
      if(['SPEC_VERIFIED','AWAITING_APPROVAL','IN_PROGRESS','IN_REVIEW','DONE'].includes(item.status)){
        if(gate.checked!==true||!gate.checkedAt) errors.push(`${item.status} requiere decisionGate verificado`);
        if(blockingDecisionIds.length>0) errors.push(`${item.status} no admite decisiones bloqueantes`);
      }
      if(blockingDecisionIds.length>0&&(item.status!=='BLOCKED'||!item.blockedReason)) errors.push('decisiones bloqueantes requieren estado BLOCKED y blockedReason');
    }
  }
}
const features=join(root,'spec/features');
if(existsSync(features)){
  for(const e of readdirSync(features,{withFileTypes:true}).filter(e=>e.isDirectory())){
    for(const f of ['spec.md','plan.md','tasks.md']) if(!existsSync(join(features,e.name,f))) errors.push(`Falta spec/features/${e.name}/${f}`);
  }
}
if(errors.length){ console.error(errors.join('\n')); process.exit(1); }
console.log('SDD check OK');
