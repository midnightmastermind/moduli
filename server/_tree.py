import sys,json
for line in sys.stdin:
    line=line.rstrip(); ind=len(line)-len(line.lstrip()); body=line.strip()
    kind,_,js=body.partition(' ')
    try: j=json.loads(js)
    except: print(line[:240]); continue
    def show(g,d=0):
        if isinstance(g,dict) and 'rules' in g:
            print('  '*(d+ind//2+1)+g.get('operator','AND'))
            for r in g['rules']: show(r,d+1)
        else: print('  '*(d+ind//2+1)+'%s %s %s'%(g.get('left'),g.get('comparator'),g.get('right')))
    if isinstance(j,dict) and 'rules' in j: print(' '*ind+kind); show(j)
    else: print(line[:240])
