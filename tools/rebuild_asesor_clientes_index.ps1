# Rebuild data/asesor_clientes_index.json + data/nit_nombres.json
# TITLE = NIT
# UF_CRM_1746192481 = nombre comercial (principal)
# UF_CRM_1746192546 = razon social (fallback)
# ASSIGNED_BY_ID = vendedor
#
# nit_nombres.json se guarda como array [{nit,nombre}, ...] porque
# ConvertFrom-Json de Windows PowerShell falla con claves duplicadas case-insensitive.

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Write-Host 'Usa Python para este rebuild (archivo grande).'
& py -3 -c @"
import json, re
from pathlib import Path
from collections import OrderedDict, defaultdict
from datetime import datetime
root = Path(r'$Root')
companies = json.loads((root/'data'/'bitrix_companias.json').read_text(encoding='utf-8'))['companies']
vendedores = json.loads((root/'data'/'bitrix_vendedores.json').read_text(encoding='utf-8'))
PRIMARY='UF_CRM_1746192481'; FALLBACK='UF_CRM_1746192546'

def asesor_code(name):
    m=re.search(r'(?<![A-Z0-9])V(\d{1,4})(?![0-9])', str(name).upper())
    return f'V{int(m.group(1))}' if m else ''

def clean_nit(title):
    t=(title or '').strip()
    if not t: return ''
    m=re.match(r'^(\d{6,15})(-\d)?\b', t)
    if m: return m.group(0)
    digits=re.sub(r'\D','',t)
    return digits if 6 <= len(digits) <= 15 else ''

def strip_nit_prefix(nit, name):
    n=(name or '').strip()
    if not n: return ''
    for key in filter(None, [nit, re.sub(r'\D','',nit)]):
        n=re.sub(r'^'+re.escape(key)+r'\s*[-–:/]\s*', '', n, flags=re.I).strip()
    return n

def score_name(nit, name):
    n=strip_nit_prefix(nit, name)
    if not n or n==nit: return (-1, '')
    digits=sum(ch.isdigit() for ch in n)
    return (len(n) - digits*2, n)

best={}
for co in companies:
    nit=clean_nit(co.get('TITLE'))
    if not nit: continue
    for cand in filter(None, [str(co.get(PRIMARY) or '').strip(), str(co.get(FALLBACK) or '').strip(), str(co.get('TITLE') or '').strip()]):
        sc, cleaned = score_name(nit, cand)
        if sc < 0: continue
        prev=best.get(nit)
        if not prev or sc > prev[0]:
            best[nit]=(sc, cleaned)

nombres={nit:val for nit,(_,val) in best.items()}
rows=[{'nit':k,'nombre':v} for k,v in sorted(nombres.items())]
(root/'data'/'nit_nombres.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def extract_phones(phone_field):
    vals=[]; seen=set()
    if not phone_field: return vals
    items=phone_field if isinstance(phone_field, list) else [phone_field]
    for it in items:
        v=str((it.get('VALUE') if isinstance(it, dict) else it) or '').strip()
        v=re.sub(r'[\s\-]', '', v)
        if v.startswith('+57'): v=v[3:]
        elif v.startswith('0057'): v=v[4:]
        elif re.match(r'^57\d{7,10}$', v): v=v[2:]
        if not v: continue
        key=re.sub(r'\D','',v)
        if not key or key in seen: continue
        seen.add(key); vals.append(v)
    return vals

phones_by_nit={}
for co in companies:
    nit=clean_nit(co.get('TITLE'))
    if not nit: continue
    for p in extract_phones(co.get('PHONE')):
        phones_by_nit.setdefault(nit, [])
        seen=set(re.sub(r'\D','',x) for x in phones_by_nit[nit])
        k=re.sub(r'\D','',p)
        if k not in seen:
            phones_by_nit[nit].append(p)
phone_rows=[{'nit':k,'telefono':' / '.join(v)} for k,v in sorted(phones_by_nit.items())]
(root/'data'/'nit_telefonos.json').write_text(json.dumps(phone_rows, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

code_to_ids=defaultdict(list); id_to_code={}
for bid, name in vendedores.items():
    code=asesor_code(name)
    if not code: continue
    bid=str(bid)
    if bid not in code_to_ids[code]: code_to_ids[code].append(bid)
    id_to_code[bid]=code

by={code:{'bitrix_ids':ids,'clientes':[],'seen':set()} for code,ids in code_to_ids.items()}
for co in companies:
    assigned=str(co.get('ASSIGNED_BY_ID') or '')
    code=id_to_code.get(assigned)
    if not code: continue
    nit=clean_nit(co.get('TITLE'))
    if not nit or nit in by[code]['seen']: continue
    by[code]['seen'].add(nit)
    by[code]['clientes'].append({
        'nit':nit,
        'nombre': nombres.get(nit) or nit,
        'telefono': ' / '.join(phones_by_nit.get(nit) or []),
    })

by_codigo=OrderedDict()
for code in sorted(by, key=lambda c:int(re.sub(r'\D','',c) or 0)):
    clientes=sorted(by[code]['clientes'], key=lambda c:(c['nombre'].lower(), c['nit']))
    by_codigo[code]={'bitrix_ids':by[code]['bitrix_ids'],'count':len(clientes),'clientes':clientes}

idx={
  'built_at': datetime.now().astimezone().isoformat(),
  'source': 'bitrix_companias.json + bitrix_vendedores.json',
  'name_fields': [PRIMARY, FALLBACK],
  'nombres_file': 'nit_nombres.json',
  'telefonos_file': 'nit_telefonos.json',
  'by_codigo': by_codigo,
}
(root/'data'/'asesor_clientes_index.json').write_text(json.dumps(idx, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
total=sum(v['count'] for v in by_codigo.values())
named=sum(1 for v in by_codigo.values() for c in v['clientes'] if c['nombre']!=c['nit'])
print(f'OK asesores={len(by_codigo)} clientes={total} con_nombre={named} nombres={len(rows)} telefonos={len(phone_rows)}')
"@
