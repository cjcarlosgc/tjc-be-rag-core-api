import json, re, sys
W_SEM, W_STR, TOPK = 0.7, 0.3, 10
TYPE_KINDS = {'CLASS','INTERFACE','TRAIT','ENUM'}
def ns(f): i=f.rfind('\\'); return f[:i] if i>=0 else ''
def short(f): return f[f.rfind('\\')+1:]
def owner(c): return c['parentSymbolName'] or (c['symbolName'] if c['symbolKind'] in TYPE_KINDS else None)
def same(a,b): return all(a[k]==b[k] for k in ('filePath','symbolKind','symbolName','parentSymbolName'))
def strip(s): return s.lstrip('\\')
BUILTIN = {'DateTimeImmutable','DateTime','InvalidArgumentException','Exception','self','static','float','int','string','bool','array','void','null','mixed','callable','iterable','object'}

def classify(c, ctx):
    o = owner(c)
    if o is not None and o in ctx['imports']: return 'IMPORTS'
    ac = ctx['anchorClass']
    if ac is not None and ac in [strip(i) for i in (c['importsUsed'] or [])]: return 'IMPORTED_BY'
    if o is not None and o != ac and ns(o)==ctx['anchorNs'] and re.search(r'\b'+re.escape(short(o))+r'\b', ctx['text']): return 'SAME_NAMESPACE'
    if o is not None and re.search(r'\\'+re.escape(o)+r'(?![\w\u0080-\uFFFF])', ctx['text']): return 'FULLY_QUALIFIED_REFERENCE'
    if ac is not None and c['symbolKind'] in TYPE_KINDS and c['symbolName']==ac: return 'DECLARING_CLASS'
    return None

def run(case, variant):
    meta=json.load(open(f'{case}.meta.json')); chunks=json.load(open(f'{case}.chunks.json')); cands=json.load(open(f'{case}.cands.json'))
    anchor=[c for c in chunks if c['filePath']==meta['filePath'] and c['symbolKind'] in ('METHOD','FUNCTION') and c['symbolName']==meta['methodName'] and c['parentSymbolName']==meta['symbolName']][0]
    byid={c['id']:c for c in chunks}
    ctor=[c for c in chunks if c['symbolKind']=='CONSTRUCTOR' and c['parentSymbolName']==anchor['parentSymbolName'] and c['filePath']==anchor['filePath']]
    ac=anchor['parentSymbolName']
    imports=set(strip(i) for i in (anchor['importsUsed'] or []))
    text=anchor['content']
    if variant in ('V1','V2'):
        for c in ctor:
            text += '\n'+c['content']; imports |= set(strip(i) for i in (c['importsUsed'] or []))
    ctx={'anchorClass':ac,'anchorNs':ns(ac or anchor['symbolName'] or ''),'imports':imports,'text':text}
    pool={}
    for k in cands:
        if k['sem'] is not None and k['chunkId'] in byid and not same(byid[k['chunkId']],anchor):
            pool[k['chunkId']]={'c':byid[k['chunkId']],'sem':k['sem'],'st':None}
    for c in chunks:
        if not c['filePath'].endswith('.php') or same(c,anchor): continue
        rel=classify(c,ctx)
        if rel and variant=='V2' and rel in ('IMPORTS','SAME_NAMESPACE') and c['symbolKind'] not in TYPE_KINDS:
            # solo miembros cuyo nombre aparece en el target
            if not re.search(r'\b'+re.escape(c['symbolName'] if c['symbolName']!='constructor' else '__construct')+r'\b', anchor['content']): rel=None
        if rel:
            if c['id'] in pool: pool[c['id']]['st']=rel
            else: pool[c['id']]={'c':c,'sem':None,'st':rel}
    rows=[]
    for p in pool.values():
        score=W_SEM*(p['sem'] or 0)+W_STR*(1 if p['st'] else 0)
        rows.append((score,p))
    rows.sort(key=lambda r:-r[0])
    return anchor, chunks, rows

def collaborators(anchor, chunks):
    ac=anchor['parentSymbolName']
    cls=[c for c in chunks if c['symbolKind']=='CLASS' and c['symbolName']==ac]
    uses=set(strip(i) for i in (cls[0]['importsUsed'] if cls else []) or [])
    ctor=[c for c in chunks if c['symbolKind']=='CONSTRUCTOR' and c['parentSymbolName']==ac]
    txt=anchor['content']+'\n'+'\n'.join(c['content'] for c in ctor)
    sig=re.findall(r'(?:\(|,)\s*(?:private |public |protected )?(?:readonly )?\??\\?([A-Z][A-Za-z0-9_\\]*)\s+\$', txt)
    news=re.findall(r'new\s+\\?([A-Z][A-Za-z0-9_\\]*)', txt)
    names=set(sig)|set(news)
    types={c['symbolName'] for c in chunks if c['symbolKind'] in TYPE_KINDS}
    out=[]
    for n in names:
        if n in BUILTIN: continue
        full=None
        for u in uses:
            if short(u)==short(n): full=u
        if full is None and ac: 
            cand=ns(ac)+'\\'+n
            if cand in types: full=cand
        if full is None and n in types: full=n
        if full and full in types and full!=ac: out.append(full)
    return sorted(set(out))

def fmt(c): return f"{short(c['parentSymbolName'])+'.' if c['parentSymbolName'] else ''}{short(c['symbolName'])}" 

cases=[l.split()[0] for l in open('cases.txt')]
summary=[]
for case in cases:
    res={}
    for v in ('BASE','V1','V2'):
        anchor,chunks,rows=run(case,v); res[v]=rows
    collab=collaborators(anchor,chunks)
    print(f'\n=== {case}  target={anchor["parentSymbolName"]}::{anchor["symbolName"]}  colaboradores={[short(c) for c in collab]}')
    # validar baseline vs combinedScore real
    cands={k['chunkId']:k for k in json.load(open(f'{case}.cands.json'))}
    top_real=[k['chunkId'] for k in sorted(cands.values(), key=lambda k:k['rank'])][:TOPK]
    top_base=[p['c']['id'] for s,p in res['BASE'][:TOPK]]
    print('  baseline == top-10 real:', set(top_real)==set(top_base))
    for v in ('BASE','V1','V2'):
        top=res[v][:TOPK]
        ids={p['c']['id'] for s,p in top}
        toks=sum((p['c']['tokenCount'] or 0) for s,p in top)
        present=[]; missing=[]
        for f in collab:
            has_type=any(p['c']['symbolName']==f and p['c']['symbolKind'] in TYPE_KINDS for s,p in top)
            has_any=any(owner(p['c'])==f for s,p in top)
            (present if has_type else missing).append(short(f)+('(solo miembros)' if (not has_type and has_any) else ''))
        rank_of={}
        for i,(s,p) in enumerate(res[v]):
            for f in collab:
                if p['c']['symbolName']==f and p['c']['symbolKind'] in TYPE_KINDS: rank_of[short(f)]=i+1
        print(f'  {v}: tokens={toks}  colab-tipo presentes={present} faltan={missing} rank-tipo={rank_of}')
        if v!='BASE':
            base_ids={p['c']['id'] for s,p in res["BASE"][:TOPK]}
            lost=[fmt(p['c']) for s,p in res['BASE'][:TOPK] if p['c']['id'] not in ids]
            gained=[fmt(p['c']) for s,p in top if p['c']['id'] not in base_ids]
            print(f'     pierde={lost}\n     gana={gained}')
    summary.append(case)
