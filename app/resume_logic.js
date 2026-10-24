// resume_logic.js
// Pure, DOM-free parsing/formatting helpers shared by the browser app
// (resume_tailor_app__1_.html) and the automated tests (resume_logic.test.js).
// Kept dependency-free and side-effect-free on purpose so the exact same code
// can run unmodified in both a browser <script> tag and plain Node — testing
// this file is testing the app's real parsing behavior, not a parallel copy.
(function(root){
  'use strict';

  function isBulletLine(l){ return /^\s*[-•*▪◦►]/.test(l); }

  function isLabelLine(l){
    const m = l.match(/^([A-Za-z][A-Za-z0-9 &\/]{2,38}):\s+(.+)$/);
    return m ? {label:m[1]+':', rest:m[2]} : null;
  }

  // A bullet's sentence sometimes arrives already split across multiple physical lines — DOCX
  // extraction (mammoth) and pasted text can both introduce a line break mid-sentence that isn't
  // a real new bullet, subheader, or section. Left alone, the line-based parser mistakes that
  // continuation for a job-title-style "subheader" (bold, out of place) and, worse, later
  // trimming can delete the bullet's opening line while leaving its orphaned tail behind. Fix:
  // merge any non-bullet line that starts with a lowercase letter into the END of whatever line
  // came before it — a continuation of a sentence almost never starts lowercase unless it IS a
  // continuation; a genuine new bullet, subheader, or section always starts uppercase (or a
  // bullet marker). Isolated and reliable, no reliance on blank-line gaps.
  function mergeWrappedLines(lines){
    const merged = [];
    lines.forEach(line=>{
      const trimmed = line.trim();
      const continuesLowercase = /^[a-z]/.test(trimmed) && !isBulletLine(line);
      if(continuesLowercase && merged.length){
        merged[merged.length-1] = merged[merged.length-1].replace(/\s+$/,'') + ' ' + trimmed;
      } else {
        merged.push(line);
      }
    });
    return merged;
  }

  function parseResume(text){
    const lines = text.split('\n').map(l=>l.trim()).filter(l=>l.length);
    const name = lines[0]||'', title = lines[1]||'';
    let idx = 2; const contactLines = [];
    while(idx < lines.length){
      const l = lines[idx];
      const isSectionHeader = l===l.toUpperCase() && l.length>2 && /[A-Z]/.test(l) && l.length<80;
      if(isSectionHeader) break;
      contactLines.push(l); idx++;
    }
    const h = {name, title, contactLines};
    const body = mergeWrappedLines(lines.slice(idx));
    const secs = []; let cur = null;
    body.forEach(line=>{
      const isHeader = line === line.toUpperCase() && line.length>2 && /[A-Z]/.test(line) && line.length<80;
      if(isHeader){ cur = {key: line.toLowerCase().replace(/[^a-z]+/g,'_'), label: line, text: '', history: []}; secs.push(cur); }
      else if(cur){ cur.text += (cur.text?'\n':'') + line; }
      else { if(!secs.length){ cur = {key:'intro', label:'', text:'', history:[]}; secs.push(cur); } cur.text += (cur.text?'\n':'')+line; }
    });
    return {header: h, sections: secs};
  }

  function computeLineRoles(lines){
    const bulletFlags = lines.map(isBulletLine);
    const roles = new Array(lines.length).fill('plain');
    let i = 0;
    while(i < lines.length){
      if(bulletFlags[i]){ roles[i] = 'bullet'; i++; continue; }
      let j = i; while(j < lines.length && !bulletFlags[j]) j++;
      if(j < lines.length){
        roles[i] = 'subheader-bold';
        for(let k=i+1;k<j;k++) roles[k] = 'subheader-plain';
      }
      i = j;
    }
    return roles;
  }

  function cleanBulletArtifacts(text){
    return text.split('\n').map(line=>{
      const m = line.match(/^(\s*)(\S{1,3})(\s{2,})(\S.*)$/);
      if(m && !/^[A-Za-z]{1,2}\.?$/.test(m[2]) && !/^[0-9]+[.)]?$/.test(m[2])){
        return m[1] + '- ' + m[4];
      }
      return line;
    }).join('\n');
  }

  const STOP = new Set('the a an and or of to in on for with is are be as at by from your you we will this that must have has plus etc job role team work our their'.split(' '));
  function computeTopKeywords(jobText, n){
    n = n || 25;
    const freq={};
    (jobText.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g)||[]).forEach(w=>{ if(!STOP.has(w)) freq[w]=(freq[w]||0)+1; });
    return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,n).map(e=>e[0]);
  }

  function getBulletIndices(sectionText){
    return sectionText.split('\n').map((l,i)=>({l,i})).filter(o=>isBulletLine(o.l)).map(o=>o.i);
  }

  // Groups a section's bullets by the job/project entry they actually belong to (each run of
  // bullets following a subheader-bold line, e.g. a job title — or one flat group if the section
  // has no sub-entries at all, like a plain Certifications list). Grouping per job/entry (not per
  // whole section) matters for page-fit trimming: a floor applied to a whole section's bullet
  // count combined could let one job get trimmed to ZERO bullets while the "floor" was still
  // satisfied by another job's bullets in the same section — and once a job has no bullets left,
  // computeLineRoles (which requires a following bullet to recognize a subheader) stops bolding
  // its title too.
  function getBulletGroups(sectionText){
    const lines = sectionText.split('\n');
    const roles = computeLineRoles(lines);
    const groups = [];
    let cur = [];
    for(let i=0;i<lines.length;i++){
      if(roles[i]==='subheader-bold'){
        if(cur.length) groups.push(cur);
        cur = [];
      }
      if(roles[i]==='bullet') cur.push(i);
    }
    if(cur.length) groups.push(cur);
    return groups;
  }

  const api = {
    isBulletLine, isLabelLine, mergeWrappedLines, parseResume, computeLineRoles,
    cleanBulletArtifacts, computeTopKeywords, getBulletIndices, getBulletGroups, STOP
  };

  if(typeof module !== 'undefined' && module.exports){
    module.exports = api;
  } else {
    Object.assign(root, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
