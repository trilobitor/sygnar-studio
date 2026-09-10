import json,glob,sys,os,yaml
ok=True
def check(f,fn,label):
    global ok
    try: fn(); print(f'{label} OK   {f}')
    except Exception as e: ok=False; print(f'{label} FAIL {f}: {str(e)[:90]}')
for f in sorted(glob.glob('charts/*/chart.yaml')+glob.glob('workflows/*.yaml')):
    check(f, lambda f=f: yaml.safe_load(open(f)), 'YAML')
for f in sorted(glob.glob('charts/*/files/.hait/hait.config.json')):
    check(f, lambda f=f: json.load(open(f)), 'JSON')
for d in sorted(glob.glob('skills/*/')):
    name=os.path.basename(d.rstrip('/')); p=d+'SKILL.md'; txt=open(p).read()
    try:
        fm=yaml.safe_load(txt.split('---')[1]); prob=[]
        if fm.get('name')!=name: prob.append(f"name != katalog")
        if not fm.get('description'): prob.append('brak description')
        elif len(fm['description'])<120: prob.append('description za krótki (harness go nie wybierze)')
    except Exception as e:
        prob=[f'nagłówek nie parsuje: {str(e)[:60]}']
    print(('SKILL OK   ' if not prob else 'SKILL FAIL '), name, '; '.join(prob))
    if prob: ok=False
sys.exit(0 if ok else 1)
